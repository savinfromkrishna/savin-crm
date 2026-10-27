# ADR 0003: gateway protocol, operation ledger and the bridge app

Status: accepted, 2026-10-18.

## Context

A model picks an action and arguments; deterministic code must validate, authorize and
execute it exactly once, and must be able to tell what happened when the network fails
between Savingroup and the site.

## Decision

### Where logic lives

- **Savingroup gateway** (`packages/business/src/frappe`): validation (zod), bot permissions
  from the bot row, approval classes, audit log, events, the operation ledger, mapping
  to contract shapes.
- **Bridge app** (`savingroup_business_bridge`): a small whitelisted surface on the site.
  `execute(operation_id, action, payload, context)` runs one named handler inside the
  request transaction and records the outcome in `Savingroup Operation` in the same
  transaction. `get_operation(operation_id)` answers "did that commit?". `query` serves
  composite reads. `configure_webhook` stores where to deliver events. Handlers use
  ERPNext and Frappe CRM documents and functions (`convert_to_deal`,
  `make_delivery_note`, `make_sales_invoice`, `get_payment_entry`); no SQL writes.
- No generic document write, SQL or administrator operation is exposed to Savingroup.

### Write protocol

1. The gateway finds or creates the ledger row for `(environment, idempotency key)`.
   Succeeded → return the stored result (replayed). Failed → return the stored error.
2. `executing`, `outcome_unknown` or `requires_reconciliation` → ask the site first.
   Found → settle and return. Not found → proceed.
3. Mark `executing`, call `execute` with the ledger row id as the operation id.
4. Success → `succeeded` with result and the primary document. A typed bridge error →
   `failed`. A timeout or dropped connection → `outcome_unknown`, one immediate
   `get_operation`, then a durable `business.operation.reconcile` job with backoff.
   A failure after the commit while recording the result (a mapping bug, a
   saturated database) → `outcome_unknown` with the same job, never a reported
   failure for a change that happened. **Check** on the environment sweeps stale
   unsettled rows into that job.
5. The reconcile job settles the row from the site, or returns it to `requested` when
   the site never saw it, or hands it to a person (`requires_reconciliation`) after
   eight attempts.

Keys: bots get `approvalEffectKey(runId, tool, args)` from the executor; people get the
request's key or a generated one. The site-side `Savingroup Operation` row is unique on the
operation id, so two concurrent requests cannot both commit.

### Events

The bridge posts signed deliveries (HMAC-SHA256 over `timestamp.body`, five-minute
skew, unique delivery id) after commit. Savingroup stores the delivery id first, settles any
operation the event confirms, writes a `BusinessEvent` for every space of the
organization and republishes the live signal.

## Alternatives considered

- **Direct REST document writes from Savingroup.** Rejected: no transactional idempotency,
  every multi-document action (convert lead, confirm and deliver) would be partial on
  failure.
- **Frappe Webhooks doctype instead of a bridge hook.** Rejected for now: no signing
  control, no after-commit guarantee for our payload shape.

## Consequences

- Every write is visible in `business/environment/operations` with status and the
  document it produced.
- A lost response never produces a duplicate; at worst a request returns
  `unavailable` once and the next identical request returns the committed result.
