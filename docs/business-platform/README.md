# Business platform

Savingroup's CRM OS and ERP OS backed by ERPNext and Frappe CRM through a first-party
gateway. Start with [the audit and replacement map](audit.md), then the decisions:

- [ADR 0001: ERPNext and Frappe CRM replace the prototype backend](adr/0001-frappe-as-business-backend.md)
- [ADR 0002: one site per organization, shared by its spaces](adr/0002-one-site-per-organization.md)
- [ADR 0003: gateway protocol, operation ledger and the bridge app](adr/0003-gateway-ledger-and-bridge.md)
- [ADR 0004: migration and cutover by environment status](adr/0004-migration-and-cutover.md)
- [Dependency and license register](dependencies.md)
- [Roadmap: what Savingroup adds to ERPNext and Frappe CRM](roadmap.md)

Operations (build, provision, connect, back up, upgrade): [`infra/frappe/README.md`](../../infra/frappe/README.md).
User-facing behaviour of the apps: [`docs/business-apps.md`](../business-apps.md).

## Milestone status

| Milestone | Status | Evidence |
| --- | --- | --- |
| A — Audit and migration design | Done | `audit.md`, ADRs 0001–0004 |
| B — Real Frappe environment | Done for a single compose stack | `infra/frappe/Containerfile` (ERPNext v16.51.1 + CRM v1.88.0 + India Compliance v16.10.1 + bridge), `compose.yaml`, `scripts/bootstrap-site.sh`; built, provisioned and connected locally on 2026-10-18, with `live.frappe.test.ts` passing against it |
| C — Native CRM replacement | Done at the action level | All `crm.*` actions run on Frappe CRM (`packages/business/src/frappe/actions.ts`, bridge `handlers/crm.py`); lead dedupe by contact email; `gateway.test.ts` against the fake site, `live.frappe.test.ts` against a real one |
| D — Native ERP replacement | Done at the action level | All `erp.*` actions run on ERPNext: items with opening stock and price list, stock entries, sales orders with Savingroup approval state, delivery on confirm, invoices and payment entries |
| E — Existing agent execution | Done | The executor hands the gateway to `runBusinessTool`; the same `crm_*`/`erp_*` tools, bot permissions, approval rules and effect keys apply. `pnpm --filter @savingroup/business team` creates a space with the role-scoped team (`packages/business/src/team.ts`) and the approval policy; the roles are written for the site's document names and the GST product rule. A scripted bot run against a connected site is not yet in the test suite (the existing scripted run covers the prototype path) |
| F — Tenant provisioning | Partial | Deterministic, idempotent provisioning per site via the bootstrap script and compose profile; connecting the organization is a Savingroup action (UI or CLI). No automated "create a site when an organization opts in" control plane yet |
| G — Migration and cutover | Partial | `business:migrate` dry run and apply for companies, contacts, leads, deals, products with mapping rows and legacy ids (run locally on 2026-10-18: 2 companies, 3 contacts, 3 leads, 2 deals, 4 products moved; 2 orders left for review); orders and invoices reported for manual review; cutover and rollback by environment status; no table is dropped |
| H — Operational hardening | Partial | Operation ledger with unknown-outcome reconciliation and a durable retry job (a bookkeeping failure after the site committed becomes an unknown outcome too, and **Check** sweeps stale rows into the reconciler, which also writes the missing audit row and event), signed events with replay protection, sealed credentials, owner-only environment changes, bot policy enforced on both sides. Monitoring, backup automation and restore drills are documented, not wired |

## Tests

- Offline: `packages/business/src/frappe/gateway.test.ts` (routing, isolation, idempotency, lost responses, permissions, verification, signed events), `packages/business/src/migrate/legacy.test.ts`, plus the existing business, contracts, executor and job suites.
- PostgreSQL (`VERIFY_DATABASE=1`): `apps/api/src/business-frappe.postgres.test.ts` (HTTP connect, routing, isolation, ledger listing, webhook route, rollback) and the existing `business.postgres.test.ts` / `business-app.postgres.test.ts`.
- Live site (`VERIFY_FRAPPE=1` with `FRAPPE_SITE_URL`, `FRAPPE_API_KEY`, `FRAPPE_API_SECRET`, `FRAPPE_COMPANY`): `packages/business/src/frappe/live.frappe.test.ts` runs the same chain against the real bridge.
