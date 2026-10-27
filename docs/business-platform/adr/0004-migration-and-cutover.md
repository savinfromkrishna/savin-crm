# ADR 0004: migration and cutover by environment status

Status: accepted, 2026-10-18.

## Context

The prototype holds data per space. An organization moves to its site once, and must
be able to go back without losing anything.

## Decision

- The organization's `BusinessEnvironment.status` is the cutover switch. `active`
  routes every read and write to the site; anything else leaves the prototype tables
  answering. `disable` is the rollback: it flips the status and deletes nothing.
- The migration tool (`pnpm --filter @savingroup/api business:migrate`) runs in dry-run mode by
  default and prints an inventory per space and record type, name collisions with
  records already on the site, and the financial totals of legacy invoices for
  reconciliation. With `--apply` it creates companies, contacts, leads, deals and
  products (with opening stock) on the site through the gateway's idempotent writes,
  stamps each document with `savingroup_legacy_id`, and records
  `BusinessRecordMapping` rows. Reruns skip mapped records. On GST sites `--hsn <code>`
  supplies the HSN/SAC code the site requires for products that have none.
- Orders and invoices are inventoried and reported but not migrated automatically in
  this version: a confirmed prototype order already moved stock in the prototype, and
  recreating posted invoices would create accounting history the legacy system never
  had. They stay readable in the prototype tables until a person decides per document.
- No prototype table is dropped. Decommissioning is a separate, explicitly authorized
  step after the mappings and totals are checked.

## Consequences

- Cutover is reversible at any time; the two systems never both accept writes for one
  organization because routing is decided per request from one status column.
- Legacy ids remain resolvable through the mapping table and the `savingroup_legacy_id`
  field on the site.
