# Human Roles & AI Agent Permission Model

## 1. Identity Separation

The platform enforces a strict boundary between **Human Actors** (`actor.userId` resolved from an authenticated session and `SpaceMember`) and **AI Agent Service Identities** (`actor.botId` + `runId` resolved from an active `Run` row in PostgreSQL).

- An AI bot never supplies its own `spaceId`, `userId`, or `botId` in tool arguments (`runBusinessTool` in `packages/business/src/tools.ts`).
- Every write performed by an agent records both the initiating human (`actorUserId` from the `Run`) and the executing bot (`actorBotId` + `runId`) in `BusinessActionLog` and `BusinessEvent`.

---

## 2. Human Workspace Roles

| Role | Scope | Capabilities |
| --- | --- | --- |
| **Workspace Owner (`owner`)** | `SpaceMember.role === "owner"` | Full administrative control: manage workspace members, configure `BusinessSettings` (currency, negative stock policy, order/invoice approval policy), manage `ActionApprovalRule` policies, connect/disable `BusinessEnvironment`, and approve consequential bot actions. |
| **Workspace Member (`member`)** | `SpaceMember.role === "member"` | Full operational access to CRM and ERP records within the `Space`, ability to create/update leads, deals, contacts, companies, activities, orders, and invoices, and converse with workspace bots. |
| **Deployment Owner** | `DeploymentSettings.ownerUserId` | Server-level settings, signup policy, deployment model credentials. |

---

## 3. AI Agent Operating Modes

AI bots operate under three configurable autonomy modes controlled by the combination of `Bot.disabledBuiltinTools` and workspace `ActionApprovalRule` entries (`packages/core/src/action-approval.ts` and `packages/business/src/team.ts`):

### Mode 1 — Assistant (Read-Only / Advisory)
- **Example Role**: **Business Analyst (`business-demo:analyst`)**.
- **Allowed Tools**: `CRM_READS` (`crm_company_search`, `crm_contact_search`, `crm_lead_search`, `crm_deal_search`, `crm_activity_list`) and `ERP_READS` (`erp_product_search`, `erp_inventory_check`, `erp_order_get`, `erp_order_search`, `erp_invoice_get`, `erp_invoice_search`).
- **Behavior**: Reads authorized workspace records, summarizes customer timelines, answers pipeline/analytics questions, and proposes next steps without mutating data.

### Mode 2 — Supervised Operator (Default Team Mode)
- **Example Roles**:
  - **Sales Executive (`business-demo:sales`)**: Owns companies, contacts, leads, deals, and activities/follow-ups. Cannot adjust inventory, confirm orders, or issue invoices.
  - **Operations (`business-demo:operations`)**: Owns product catalog, inventory adjustments, and sales orders. Cannot issue invoices or record payments.
  - **Finance (`business-demo:finance`)**: Owns invoice drafts, invoice issuance, and payment recording.
  - **CRM Data Steward (`business:steward`)**: Detects duplicate companies/contacts, normalizes CRM records, and logs stewardship notes.
- **Approval Gate**:
  - Routine CRM updates within the bot's role scope execute with full audit logging, or pause for human approval when a workspace owner configures a `require_approval` rule on that tool (`ActionApprovalRule`).
  - Consequential financial and inventory actions (`BUSINESS_CONSEQUENTIAL_ACTION_IDS`: `erp.inventory.adjust`, `erp.order.approve`, `erp.order.confirm`, `erp.order.cancel`, `erp.invoice.issue`, `erp.invoice.record_payment`, and `admin.document.*` writes) **pause by default** and present an interactive approval card (`kind: "ask"`) to the human user.

### Mode 3 — Autonomous Operator (`grantBusinessAutonomy`)
- **Example Role**: **Operator (`business:operator`)**.
- **Behavior**: Explicitly opted-in by the workspace owner via `grantBusinessAutonomy` (`packages/business/src/team.ts`), which replaces `require_approval` rules with `always_allow` rules for routine consequential tools in that space while keeping irreversible document deletion (`admin_document_delete`) gated unless `allowDelete: true` is explicitly passed.
- **Revocation**: Immediately reversible by removing the `always_allow` rules in approval settings or archiving/pausing the bot.

---

## 4. Defense-in-Depth Enforcement Layers

1. **Tool Surface Filtering**: `packages/adapters/src/executor.ts` omits any tool listed in `bot.disabledBuiltinTools` from the LLM tool definitions.
2. **Approval Gate (`dispatchTool`)**: Before running any tool, `planActionGate` (`packages/core/src/action-approval.ts`) evaluates explicit approval tools, user `ActionApprovalRule` rows, and optional AI Auto-Review. If approval is required, an `ExternalEffect` (`status = "intended"`) is persisted and the run pauses in `waiting_input`.
3. **Database-Enforced Service Boundary (`checkBotPermission`)**: Even if a tool call reaches `executeBusinessAction` (`packages/business/src/execute.ts`), `checkBotPermission` reloads `bot.disabledBuiltinTools` and `bot.archivedAt` directly from PostgreSQL and rejects any unauthorized or archived bot with `permission_denied`.
4. **Prompt Injection Resistance**: Customer notes, emails, and CRM fields are returned strictly as structured JSON tool results (`role: "toolResult"`), never interpolated into system instructions or authorization context.
