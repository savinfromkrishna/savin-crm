# CRM & AI Operator Verification & Test Plan

## 1. Testing Philosophy

All tests run **deterministically and offline without Docker**:
- **Unit & Contract Tests (`pnpm test`)**: Validate schemas (`@savingroup/contracts`), action registry (`@savingroup/business`), approval gates (`@savingroup/core`), and UI components (`@savingroup/web`, `@savingroup/ui-web`).
- **PostgreSQL Integration Tests (`pnpm test:crm` / `pnpm test:integration`)**: Execute against native PostgreSQL using isolated scratch databases (`packages/testkit/src/local-postgres.ts`).

---

## 2. Test Coverage Matrix

### A. Canonical CRM & ERP Actions (`packages/business/src/business.postgres.test.ts`)
- **Companies & Contacts**:
  - Create, update, search, and duplicate detection (`crm.company.find_duplicates`, `crm.contact.find_duplicates`).
- **Leads**:
  - Sequential numbering (`L-1`, `L-2`) per space.
  - Lead update (`crm.lead.update`), assignment (`crm.lead.assign`), qualification (`crm.lead.qualify`), and atomic conversion (`crm.lead.convert` → `CrmDeal` `D-1`).
- **Deals & Pipeline**:
  - Stage transitions (`qualification` → `proposal` → `negotiation` → `won` / `lost`) and `closedAt` tracking.
- **Activities & Follow-up Tasks**:
  - Logging calls, emails, meetings, notes, and follow-up tasks (`dueAt`).
  - Completing tasks (`crm.activity.complete`) and filtering `openOnly` overdue follow-ups.
- **Products, Inventory, Orders & Invoices**:
  - Deterministic `Decimal(14, 2)` line calculations.
  - Negative stock rejection when `allowNegativeStock = false`.
  - Order approval lifecycle (`draft` → `pending_approval` → `approved` → `confirmed`) deducting stock and marking the linked deal `won`.
  - Invoice issuance and partial/full payment recording.

### B. Multi-Tenant Workspace Isolation & Negative Security Tests
- **Cross-Workspace Access**:
  - A user or bot in `Space A` cannot read, update, qualify, convert, or log activities on records belonging to `Space B` (`not_found` / `IsolationError`).
- **Bot Role Authorization (`checkBotPermission`)**:
  - **Business Analyst** bot attempting any write tool (`crm_lead_create`, `erp_order_confirm`) is rejected with `permission_denied`.
  - **Sales Executive** bot attempting `erp_invoice_issue` or `erp_inventory_adjust` is rejected with `permission_denied`.
  - Archived bot (`bot.archivedAt !== null`) attempting any action is rejected with `permission_denied`.

### C. Idempotency, Concurrency & Failure Recovery
- **Duplicate Tool Execution / Network Retry**:
  - Repeating any write action with the same `(spaceId, idempotencyKey)` or same `(runId, toolName, args)` via `runBusinessTool` returns `{ ok: true, replayed: true }` with the original record and does not create duplicate rows or duplicate `BusinessEvent` entries.
- **Approval Gate & Rejection**:
  - Consequential actions (`erp.order.confirm`, `erp.invoice.issue`, or any tool with a `require_approval` rule) pause the `Run` in `waiting_input` and emit an approval ask block (`ExternalEffect`).
  - Rejecting the approval cancels/skips the tool execution without mutating CRM/ERP state.
  - Approving the action resumes the run, executes the tool once, and records both `actorUserId` and `actorBotId` in `BusinessActionLog`.

### D. End-to-End Vertical Slice Verification (`apps/api/src/business-app.postgres.test.ts`)
1. Human signs into a workspace and creates a lead (`L-1`).
2. Lead is persisted in PostgreSQL and visible via `rpc.crm.leads.list`.
3. AI bot (`Sales Executive`) inspects the lead via `crm_lead_search`.
4. Bot qualifies the lead (`crm_lead_qualify`), updates value/notes (`crm_lead_update`), and creates a follow-up task (`crm_activity_create` with `kind: "follow_up"` and `dueAt`).
5. Where approval rules require confirmation, the human approves the action and the run completes.
6. `rpc.business.history` returns the `BusinessActionLog` entries identifying the bot service identity (`actor.botId`), `runId`, and initiating human (`actor.userId`).
