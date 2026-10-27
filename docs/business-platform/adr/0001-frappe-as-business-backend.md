# ADR 0001: ERPNext and Frappe CRM replace the prototype business backend

Status: accepted, 2026-10-18.

## Context

The prototype CRM OS and ERP OS proved that bots can operate typed business actions
with server-side permissions, approvals and audit. They do not have accounting,
valuation, taxes, documents, multi-currency or the long tail of real business rules,
and building those in TypeScript would be a second ERP.

## Decision

Transactional business records move to a dedicated Frappe site per organization running
ERPNext (customers, items, stock, orders, invoices, payments, ledger) and Frappe CRM
(leads, deals, organizations, contacts, tasks), with India Compliance where the
blueprint asks for it. Savingroup keeps the action contracts, the executor, approvals, the
audit log and the event stream, and talks to the site through a first-party gateway.

Versions, verified on 2026-10-18 against the published images and repositories:

| Component | Version | Pin |
| --- | --- | --- |
| Frappe Framework | 16.52.0 (inside the ERPNext image) | via image digest |
| ERPNext | v16.51.1 | `frappe/erpnext:v16.51.1@sha256:a856e7f6…ec9268` |
| Frappe CRM | v1.88.0 (`main`, declared compatible with Frappe v15 and v16) | git tag |
| India Compliance | v16.10.1 (`version-16`) | git tag |
| MariaDB | 11.8 | `mariadb:11.8@sha256:f16d7a34…b34fa` |
| Redis | 6.2-alpine | `redis:6.2-alpine@sha256:b362b5df…daea` |

The image is built from the official ERPNext image by adding the two apps with
`bench get-app` at their tags and building their assets into the baked assets
directory the image's entrypoint links at start. This keeps Frappe and ERPNext exactly
as published and pins every app.

## Alternatives considered

- **Keep extending the prototype.** Rejected: it would recreate accounting and stock
  valuation badly and never reach GST or statutory reporting.
- **Fork ERPNext or Odoo into the monorepo.** Rejected: out of scope by the brief and
  unmaintainable.
- **Embed ERPNext in an iframe.** Rejected: not a native integration; bots could not act,
  and Savingroup would not own the audit trail.
- **frappe_docker layered build with apps.json.** Viable, but it would rebuild Frappe and
  ERPNext from the moving `version-16` branch; starting from the published image pins
  both and is faster to rebuild.

## Consequences

- Document names become record ids in Savingroup (`CRM-LEAD-2026-00001`); the contracts
  did not change.
- Confirming an order submits it and delivers it (stock moves through a Delivery
  Note); invoices post to the ledger on submit; payments are Payment Entries. Behaviour
  follows ERPNext, not the prototype's shortcuts.
- A site must exist before an organization can be moved; until then the prototype
  tables answer and nothing changes for existing deployments.
