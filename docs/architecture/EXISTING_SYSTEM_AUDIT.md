# Existing System Audit (`rakazo-crm`)

## 1. Executive Summary

This repository is a TypeScript monorepo (`pnpm` workspaces + `turbo`) built around **Savingroup / Rakazo**: a multi-surface AI agent workspace with persistent bots, conversational threads, memory, scheduled routines, tool approvals, and an integrated **CRM OS & ERP OS** business layer (`@savingroup/business`).

Crucially, the codebase already contains:
- A dual-mode CRM and ERP execution engine (`packages/business/src/execute.ts`) that operates **100% natively on PostgreSQL via Prisma** when no external Frappe site is configured, while supporting optional ERPNext + Frappe CRM site bridging (`packages/business/src/frappe/`).
- Canonical Prisma tables (`packages/db/prisma/schema.prisma`) for workspaces (`Space`), memberships (`SpaceMember`), persistent bots (`Bot`), execution runs (`Run`), approval rules (`ActionApprovalRule`), external effects (`ExternalEffect`), and business records (`CrmCompany`, `CrmContact`, `CrmLead`, `CrmDeal`, `CrmActivity`, `ErpProduct`, `ErpInventoryAdjustment`, `ErpSalesOrder`, `ErpInvoice`, `BusinessActionLog`, `BusinessEvent`, `BusinessSettings`).
- A typed, versioned registry of 37 business actions (`packages/business/src/registry.ts`) shared identically between HTTP/oRPC handlers (`apps/api/src/business-routes.ts`) and AI agent tools (`packages/business/src/tools.ts`).
- Two native, non-Docker sandbox providers (`NoneSandboxProvider` and `DesktopSandboxProvider`) that allow running the entire platform and AI agent workforce without Docker.

---

## 2. Monorepo Structure & Package Boundaries

### Workspace Layout (`pnpm-workspace.yaml`)

| Path | Package Name | Responsibility |
| --- | --- | --- |
| `apps/api` | `@savingroup/api` | Hono HTTP server, `@orpc/server` RPC router (`/rpc/*`), Better Auth (`/api/auth/*`), webhooks, and SSE streams (`port 3100`). |
| `apps/worker` | `@savingroup/worker` | Background worker host (`GraphileJobWorkerHost` on PostgreSQL or `InMemoryJobQueue`) plus `createJobReconciler` for run leases, routines, and computer sleep. |
| `apps/web` | `@savingroup/web` | React 19 + Vite + React Router v7 + Tailwind CSS v4 + Lingui SPA (`port 5173`), including `/app/crm`, `/app/erp`, `/app/board`, and `/app` bot threads. |
| `apps/desktop` | `@savingroup/desktop` | Electron desktop wrapper hosting the web UI. |
| `apps/mobile` | `@savingroup/mobile` | Expo / React Native mobile app. |
| `apps/phone-agent` | `@savingroup/phone-agent` | Optional LiveKit voice/telephony agent worker. |
| `apps/www` | `@savingroup/www` | Astro marketing site. |
| `packages/contracts` | `@savingroup/contracts` | Zod schemas, DTOs, `@orpc/contract` definitions (`src/rpc.ts`), and CRM/ERP/Business contracts (`src/crm.ts`, `src/erp.ts`, `src/business.ts`, `src/admin.ts`). |
| `packages/core` | `@savingroup/core` | Pure domain logic: `action-approval.ts`, `approval-effect-key.ts`, `run-state.ts`, `cron.ts`, `agent-context.ts`, `model-catalog.ts`. |
| `packages/db` | `@savingroup/db` | Prisma client (`@prisma/adapter-pg`), schema (`prisma/schema.prisma`), migrations, workspace scoping (`src/scope.ts`), and repositories (`src/repos.ts`). |
| `packages/business` | `@savingroup/business` | Canonical CRM & ERP domain services, action registry (`src/registry.ts`), execution & audit pipeline (`src/execute.ts`), bot tool adapter (`src/tools.ts`), and digital employee team definitions (`src/team.ts`). |
| `packages/adapter-kit` | `@savingroup/adapter-kit` | Provider-neutral interfaces (`SandboxProvider`, `AgentRuntime`, `SecretStore`, `JobPublisher`, `ConnectorProvider`, `MemoryStore`). |
| `packages/adapters` | `@savingroup/adapters` | Run executor (`src/executor.ts`), `PiAgentRuntime` (`src/pi-runtime.ts`), sandbox providers (`none-sandbox.ts`, `desktop-sandbox.ts`, `docker-sandbox.ts`, cloud sandboxes), and integration connectors. |
| `packages/auth` | `@savingroup/auth` | Better Auth configuration, email/password, social OAuth, and OIDC SSO (`src/sso.ts`). |
| `packages/memory` | `@savingroup/memory` | Markdown-backed agent/space memory store (`MemoryDocument`, `MemoryRevision`). |
| `packages/ui-tokens` | `@savingroup/ui-tokens` | Semantic monochrome color tokens and bot identity palette (`tokens.css`). |
| `packages/ui-web` | `@savingroup/ui-web` | Shadcn/ui on Base UI primitives, `BotAvatar`, `GroupAvatar`. |
| `packages/chat-ui` | `@savingroup/chat-ui` | Cross-platform Markdown, code, and table rendering. |
| `packages/logging` | `@savingroup/logging` | Structured JSON/pretty logger with secret redaction. |
| `packages/testkit` | `@savingroup/testkit` | Offline model emulators, harness, and native PostgreSQL test helpers (`src/local-postgres.ts`). |

---

## 3. Existing Database, Schema, and Multi-Tenant Isolation

- **Database Engine**: Native PostgreSQL accessed via `@prisma/client` and `@prisma/adapter-pg` (`packages/db/src/index.ts`).
- **Workspace Isolation**:
  - `Organization` holds org-level membership (`Member`) and billing.
  - `Space` is the primary tenant boundary. Every bot, thread, run, routine, board ticket, and CRM/ERP record carries a non-nullable `spaceId` with foreign-key cascade rules and composite indexes.
  - `requireMembership(prisma, userId, requestedSpaceId)` (`packages/db/src/scope.ts`) verifies `SpaceMember` membership on every authenticated API request before constructing the `Actor` (`apps/api/src/app.ts`).

### Existing CRM & ERP Entities in `packages/db/prisma/schema.prisma`

| Model | Table | Status | Notes |
| --- | --- | --- | --- |
| `BusinessSettings` | `business_settings` | Implemented | Per-space currency, negative stock policy, order/invoice approval flags, and sequential counters (`nextLeadNumber`, `nextDealNumber`, `nextOrderNumber`, `nextInvoiceNumber`). |
| `CrmCompany` | `crm_companies` | Implemented | Customer accounts with `name`, `domain`, `phone`, `notes`, and creator attribution. |
| `CrmContact` | `crm_contacts` | Implemented | Contacts linked to `CrmCompany` with `firstName`, `lastName`, `email`, `phone`, `title`, `notes`. |
| `CrmLead` | `crm_leads` | Implemented | Sequential ref (`L-1`), `status` (`new`, `contacted`, `qualified`, `unqualified`, `converted`), `source`, `value`, `companyId`, `contactId`, `assigneeUserId`, `assigneeBotId`, `convertedDealId`. |
| `CrmDeal` | `crm_deals` | Implemented | Sequential ref (`D-1`), `stage` (`qualification`, `proposal`, `negotiation`, `won`, `lost`), `amount`, `currency`, `expectedCloseAt`, `closedAt`, `ownerUserId`, `ownerBotId`. |
| `CrmActivity` | `crm_activities` | Implemented | Unified activity and task model (`call`, `email`, `meeting`, `note`, `follow_up`), with `dueAt`, `completedAt`, assignee, and links to company, contact, lead, or deal. |
| `ErpProduct` | `erp_products` | Implemented | Catalog SKU (`@@unique([spaceId, sku])`), `name`, `unitPrice`, `currency`, `stockOnHand`, `active`. |
| `ErpInventoryAdjustment` | `erp_inventory_adjustments` | Implemented | Immutable ledger of stock changes with `delta`, `quantityAfter`, `reason`, and optional `orderId`. |
| `ErpSalesOrder` / `ErpSalesOrderLine` | `erp_sales_orders` / `erp_sales_order_lines` | Implemented | Sequential ref (`SO-1`), lifecycle (`draft` → `pending_approval` → `approved` → `confirmed` / `cancelled`), deterministic line totals, stock deduction on confirmation. |
| `ErpInvoice` / `ErpInvoiceLine` | `erp_invoices` / `erp_invoice_lines` | Implemented | Sequential ref (`INV-1`), lifecycle (`draft` → `issued`), `paymentStatus` (`unpaid`, `partial`, `paid`), deterministic balance tracking. |
| `BusinessActionLog` | `business_action_log` | Implemented | Durable audit trail and idempotency store (`@@unique([spaceId, idempotencyKey])`) recording `actionId`, `actorUserId`, `actorBotId`, `runId`, `outcome`, `input`, and `result`. |
| `BusinessEvent` | `business_events` | Implemented | Transactional outbox published via PostgreSQL `LISTEN/NOTIFY` to live SSE subscribers (`packages/business/src/live.ts`). |

---

## 4. Existing AI Agent Execution, Approval, and Tool Lifecycle

1. **Bot Identity & Role Enforcement**:
   - Each bot (`Bot`) belongs to a `Space` and has a `disabledBuiltinTools: String[]` list stored in PostgreSQL.
   - Digital employee roles (`packages/business/src/team.ts`)—**Sales Executive**, **Operations**, **Finance**, **Business Analyst**, and **Operator**—use `disabledToolsForRole(role.allowedActions)` so the backend (`checkBotPermission` in `packages/business/src/execute.ts`) rejects unauthorized actions even if prompted.
2. **Action Approval & Idempotency**:
   - Consequential tools (`BUSINESS_CONSEQUENTIAL_ACTION_IDS` and any tool matching a `require_approval` row in `ActionApprovalRule`) are gated by `planActionGate` (`packages/core/src/action-approval.ts`) inside `dispatchTool` (`packages/adapters/src/executor.ts`).
   - When gated, the executor records an `ExternalEffect` (`status = "intended"`), writes an interactive approval card (`kind: "ask"`) to the thread, and transitions the `Run` to `waiting_input`.
   - When a human approves the action (`rpc.threads.answer`), the run resumes and executes `runBusinessTool` (`packages/business/src/tools.ts`) with a deterministic idempotency key (`approvalEffectKey(runId, toolName, args)`), preventing duplicate mutations across retries or worker restarts.

---

## 5. Docker Dependency Audit & Native Replacement Strategy

### Identified Docker Touchpoints

| Component | File Path | Role of Docker | Native Non-Docker Replacement |
| --- | --- | --- | --- |
| Root `dev` script | `package.json` | Includes `--filter=@savingroup/sandbox-supervisor` and `sandbox:build` / `compose:*` scripts. | Replace default `dev` script with native API + Worker + Web processes (`SANDBOX_PROVIDER=none` or `desktop`, `BUSINESS_APPS_ENABLED=true`, `TICKET_BOARD_ENABLED=true`). |
| Sandbox Provider Resolution | `packages/adapters/src/sandbox-provider-env.ts` | Defaults to `"docker"` when `SANDBOX_PROVIDER` is unset. | Default to `"none"` (or `"desktop"` when explicitly configured) in native CRM environments so Docker is never required or probed at boot. |
| Computer Sandbox Supervisor | `infra/sandboxes/supervisor/src/index.ts` | Mounts `/var/run/docker.sock` to spawn Linux Xvfb containers. | Not started in native mode. CRM/ERP operations run via permission-checked `crm_*` and `erp_*` API tools (`packages/business/src/tools.ts`). File/host tasks use `DesktopSandboxProvider` (`packages/adapters/src/desktop-sandbox.ts`) when authorized. |
| Compose Stacks | `infra/compose/*` | Optional Docker Compose files for containerized deployment. | Replaced by native process management (`docs/NO_DOCKER_SETUP.md`) and native PostgreSQL. |
| Testkit Local Postgres | `packages/testkit/src/local-postgres.ts` | Already connects to native `DATABASE_URL` or `SAVINGROUP_TEST_DATABASE_URL` and creates isolated scratch databases via standard SQL `CREATE DATABASE`. | No Testcontainers used; works natively with local PostgreSQL. |

---

## 6. Functional vs. Incomplete Modules (Gap Analysis for Full AI-Native CRM)

### Already Working & Verified
- Core CRM (`CrmCompany`, `CrmContact`, `CrmLead`, `CrmDeal`, `CrmActivity`) CRUD, search, lead qualification, lead-to-deal conversion, Kanban drag-and-drop deal pipeline, and activity logging.
- Core ERP (`ErpProduct`, `ErpInventoryAdjustment`, `ErpSalesOrder`, `ErpInvoice`) catalog, stock checks/adjustments, order draft/approval/confirmation, and invoicing.
- Audit logging (`BusinessActionLog`), live SSE updates (`BusinessEvent`), and contextual AI side panel (`apps/web/src/components/business/assistant.tsx`).

### Gaps to Close in This Transformation
1. **Docker-Free Defaults**:
   - `BUSINESS_APPS_ENABLED` and `TICKET_BOARD_ENABLED` currently default to `false` unless set in env, and `resolveSandboxProvider` defaults to `"docker"` when `SANDBOX_PROVIDER` is unset.
   - Root `package.json` `dev` script starts `@savingroup/sandbox-supervisor` (which requires Docker) and lacks dedicated `dev:api`, `dev:web`, `dev:worker`, and `db:seed` scripts.
2. **CRM Lead & Activity Completeness**:
   - Lead update (`crm.lead.update`), activity completion/update (`crm.activity.complete` as a first-class business action for both humans and bots), duplicate detection (`crm.company.find_duplicates` / `crm.contact.find_duplicates`), and customer timeline aggregation (`crm.timeline.get`) need first-class actions and UI controls.
   - Lead qualification and follow-up approval vertical slice: allow configuring lead qualification / stage transitions with human approval policies and completing follow-up tasks directly from the CRM Activities table and Lead dialog.
3. **Quotations / Proposals & Sales Workflow**:
   - Quotations (`crm.quote.*` / `erp.order.*` draft-to-approval workflow) and richer AI Operations Center / Approval Queue visibility within the CRM/ERP navigation shell.
4. **Specialist CRM Agent Templates**:
   - Expand `BUSINESS_TEAM` (`packages/business/src/team.ts`) and UI provisioning controls so users can 1-click provision the specialized CRM agents (Sales Executive, Lead Qualification / Data Steward capabilities, Operations, Finance, Business Analyst, and Operator) directly from the CRM/ERP interface.
