# Business platform: repository audit and replacement map

Audit of the Savingroup codebase before replacing the prototype CRM OS and ERP OS with
ERPNext and Frappe CRM behind a first-party gateway. Written 2026-10-18 against the
working branch, not the public upstream.

## What exists

### Prototype CRM OS and ERP OS (built in this branch)

| Layer | Where | Notes |
| --- | --- | --- |
| Action vocabulary | `packages/contracts/src/business.ts`, `crm.ts`, `erp.ts` | 36 dotted action ids (`crm.lead.create`, `erp.order.confirm`), zod inputs and record shapes, error codes, event types, refs (`L-3`, `SO-5`) |
| Executor | `packages/business/src/execute.ts` | Single entry for API and bots: validate, bot permission check from the bot row, idempotency replay, transaction, audit log, outbox events |
| Registry | `packages/business/src/registry.ts` | One definition per action: version, kind (read/write), input schema, service function |
| Services | `packages/business/src/crm/*`, `erp/*` | Prisma against 14 prototype tables (`crm_companies` … `erp_invoices`), stock with row locks, order and invoice state machines |
| Bot tools | `packages/business/src/tools.ts`, `packages/adapters/src/builtin-tools.ts`, `executor.ts` | `crm_*`/`erp_*` built-in tools derived from the registry; executor passes `run.spaceId`, `run.userId`, `bot.id`; approval classes in `packages/core/src/action-approval.ts` |
| API | `apps/api/src/router.ts` (`business`, `crm`, `erp` blocks), `business-routes.ts` | oRPC handlers calling `executeBusinessAction`; owner-only settings |
| UI | `apps/web/src/pages/BusinessCrm.tsx`, `BusinessErp.tsx`, `components/business/shell.tsx` | Tabs, record dialogs with history, live refresh over `business:${spaceId}` |
| Data | `packages/db/prisma/schema.prisma`, migrations `20261017150000_business_apps`, `20261017150001_business_cascades` | Per-space tables keyed by `spaceId`; `BusinessActionLog` (audit, idempotency), `BusinessEvent` (outbox), `BusinessSettings` (currency, approval flags, counters) |
| Tests | `packages/business/src/*.test.ts`, `business.postgres.test.ts`, `apps/api/src/business-app.postgres.test.ts`, `apps/web/src/pages/BusinessCrm.test.tsx` | Unit, PostgreSQL-gated service tests, HTTP tests including a scripted bot with approval pauses |
| Demo | `packages/business/src/demo.ts`, `cli/seed-demo.ts` | Sample company, products, leads, deal, order, three role bots, approval rules |

Live data: the local development database holds one real workspace with the demo
seed (two companies, three contacts, three products, two leads, one deal, one draft
order) and the three demo bots. There is no production deployment of the prototype.

### Platform pieces the replacement reuses unchanged

- Organizations, spaces, members, roles (`Organization`, `Space`, `SpaceMember`), Better Auth.
- Bots, runs, threads, approvals: `ActionApprovalRule`, `ExternalEffect` effect records keyed by run + tool + args, `approvalEffectKey`, `toolRequiresApproval`, Auto Review.
- Durable jobs: `JobPublisher`/`JobWorkerHost` (Graphile), `BackgroundJobPayloads` registry in `packages/adapter-kit`, handlers in `packages/adapters/src/background-job-handlers.ts`.
- Secrets: `SecretStore` (`EncryptedSecretStore`, Infisical) sealed with the deployment `ENCRYPTION_KEY`.
- Realtime fanout, feature flags via env (`BUSINESS_APPS_ENABLED`), webhook verification precedent (`apps/api/src/github-webhook.ts`), bounded body reader.
- Deployment: `infra/compose/*` for Savingroup itself; Docker available locally.

## Decision: what is retained, replaced, migrated, retired

| Component | Decision | Why |
| --- | --- | --- |
| Action contracts, tool names, approval classes | **Retain** | They are the public surface people and bots already use; the backend changes underneath. Statuses map onto Frappe CRM and ERPNext states without changing the contract. |
| `executeBusinessAction` | **Retain and extend** | Still the one validation, authorization and audit path. It now routes per organization: active business environment → gateway, otherwise prototype tables. |
| Prototype services and tables | **Keep until cutover, then retire** | They answer for organizations without an environment and remain the rollback target. Nothing is dropped; a later, explicitly authorized decommission removes the tables after migration is validated. |
| Audit log, outbox events, live refresh | **Retain** | Savingroup stays the system of record for who did what; site events are mirrored into the same stream. |
| Bot tools and executor wiring | **Retain** | Same tools, same approval rules; the executor now hands the gateway to the business runner. |
| UI pages | **Retain** | The pages read the same contracts. Ids become Frappe document names (`CRM-LEAD-2026-00001`, `SAL-ORD-2026-00001`); the ERP overview gains the business-system card. |
| Settings (currency, approval policy) | **Retain, currency follows the site** | Approval policy stays Savingroup-side and is enforced by the bridge too; currency is the site company's. |
| Demo seeder | **Retain** | Works on both backends because it goes through the actions. |

## New pieces

| Piece | Where |
| --- | --- |
| Environment registry, operation ledger, record mappings, webhook deliveries | Prisma models `BusinessEnvironment`, `BusinessOperation`, `BusinessRecordMapping`, `BusinessWebhookDelivery`; migration `20261018120000_business_environments` |
| Gateway | `packages/business/src/frappe/*`: `client.ts` (REST, typed errors, unknown-outcome detection), `environment.ts` (registry, sealed credentials, verification), `ledger.ts`, `run.ts` (write protocol), `actions.ts` (every action on Frappe), `mapping.ts`, `webhook.ts`, `reconcile.ts`, `blueprints.ts` |
| Bridge app | `infra/frappe/apps/savingroup_business_bridge` (Python): idempotent `execute`, `get_operation`, `query`, `ping`, `configure_webhook`, custom fields, gateway role, signed events |
| Infrastructure | `infra/frappe/Containerfile`, `compose.yaml`, `scripts/bootstrap-site.sh`, `blueprints/*.json` |
| API | `business.environment.*` RPCs, `/webhooks/business/frappe/:environmentId`, overview and adjustments routed per environment |
| Jobs | `business.operation.reconcile`, `business.environment.verify` |
| Tests | `packages/business/src/frappe/gateway.test.ts` (offline, fake site), `apps/api/src/business-frappe.postgres.test.ts` (HTTP, fake site on a socket) |

## Data ownership after cutover

- **Frappe CRM**: organizations, contacts, leads, deals, tasks (activities).
- **ERPNext**: customers, items, prices, stock, sales orders, delivery notes, invoices, payments, accounting.
- **Savingroup**: organizations and spaces, people and bots, approval rules, the audit log and event stream, the operation ledger, environment credentials, legacy-to-site record mappings.

One ERPNext Customer per CRM Organization, created by the bridge the first time an
order needs it and named identically, so there is no second customer master.
