# Business platform dependency register

Versions, licenses, deployment boundary and data ownership for every component the
business environment runs. Verified 2026-10-18.

| Component | Version | License | Boundary | Owns | Notes |
| --- | --- | --- | --- | --- | --- |
| Frappe Framework | 16.52.0 | MIT | Site container image | Users, permissions, doctypes | Inside the ERPNext image |
| ERPNext | v16.51.1 | GPL-3.0 | Site | Customers, items, stock, orders, invoices, payments, GL | Hosted use is fine; modifications to ERPNext itself must stay GPL. We add an app, we do not modify ERPNext. |
| Frappe CRM | v1.88.0 | AGPL-3.0 | Site | Organizations, contacts, leads, deals, tasks | AGPL: the source of the app as run must be available to users of the hosted service. We run the published tag unmodified; custom fields are configuration. |
| India Compliance | v16.10.1 | GPL-3.0 | Site (india-smb blueprint only) | GST fields, HSN/SAC, GST accounts, returns | Statutory configuration still needs a qualified review per company. GST service providers (e-invoice, e-way bill) are optional paid integrations configured inside the app, not by Savingroup. |
| Savingroup Business Bridge | 0.1.0 | Apache-2.0 (this repository) | Site | Idempotent operations, custom fields, signed events | Our code; Frappe app that imports ERPNext and Frappe CRM at runtime |
| MariaDB | 11.8 | GPL-2.0 | Site database container | Site data | Pinned by digest |
| Redis | 6.2-alpine | BSD-3 | Site cache and queue containers | Transient | Pinned by digest; frappe_docker's choice |
| frappe_docker layout | main, 2026-10 | MIT | Compose layout reference | — | `compose.yaml` follows `pwd.yml`'s service layout; images are ours |
| Docker Compose | local | Apache-2.0 | Host | — | Development and single-server production |

Trademarks: "ERPNext" and "Frappe" are trademarks of Frappe Technologies. Savingroup refers
to them descriptively and does not present itself as ERPNext.

## Evaluated, not adopted in this slice

| Candidate | Decision | Reason |
| --- | --- | --- |
| Frappe HR, India Payroll | Not installed | No payroll requirement in scope; payroll is excluded from bot authority anyway. |
| Frappe Helpdesk, Chatwoot | Not installed | Savingroup already owns conversations and tasks; a second ticketing system duplicates the ticket board. |
| Frappe Drive, Documenso | Not installed | Attachments live with the document in Frappe; e-signature is not a requirement yet. |
| Metabase | Not installed | ERPNext reports cover the first slice; add when cross-source BI is needed. |
| Frappe Press | Not adopted | Automated multi-site hosting beyond one compose stack per deployment is a later milestone; evaluate when provisioning volume justifies its complexity. |
| OpenBao | Not adopted | The existing `SecretStore` (encrypted at rest or Infisical) already seals gateway credentials. |
| Prometheus, Grafana, OpenTelemetry, Restic | Documented as the operations path | See `infra/frappe/README.md`; not wired into the compose file yet. |
| Kubernetes | Not adopted | No scaling or isolation requirement a single compose stack per deployment does not meet. |
