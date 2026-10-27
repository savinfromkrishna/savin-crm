# Open-Source License Compatibility Report

## 1. Repository License Baseline

- **This Project (`rakazo-crm` / `savingroup`)**: Licensed under **Apache License 2.0** (`LICENSE`).
- All bundled npm packages, workspace libraries (`packages/*`), and frontend/backend applications (`apps/*`) must remain compatible with **Apache-2.0**.

---

## 2. Reference Project Licenses & Legal Reuse Policy

| Reference Project | Repository | License | Compatibility with Apache-2.0 | Permitted Usage in `rakazo-crm` |
| --- | --- | --- | --- | --- |
| **Rakazo** | `https://github.com/elie222/rakazo` | Apache-2.0 | **Fully Compatible** | Direct preservation, modification, and extension of all source files, schemas, and packages. Preserve existing `LICENSE` and copyright headers. |
| **Twenty CRM** | `https://github.com/twentyhq/twenty` | GPL-3.0 (core) | **Copyleft (Incompatible for direct source copying into Apache-2.0)** | **Clean-room reimplementation only**: study product concepts, UX layout patterns (Kanban, tables, filter chips, timelines), and implement independently using our own `@savingroup/ui-web` (shadcn/Base UI) and `@savingroup/business` TypeScript code. Never copy GPL-3.0 source files into this repository. |
| **Frappe CRM** | `https://github.com/frappe/crm` | AGPL-3.0 | **Network Copyleft (Incompatible for direct source copying)** | **Clean-room reimplementation + External REST API Bridge**: study domain workflows (lead statuses, qualification, conversion) and implement independently in TypeScript/Prisma. Optional network integration via standard HTTP REST calls (`packages/business/src/frappe/`) does not link AGPL code into the core application. |
| **ERPNext** | `https://github.com/frappe/erpnext` | GPL-3.0 | **Copyleft (Incompatible for direct source copying)** | **Clean-room reimplementation + External REST API Bridge**: implement deterministic catalog, inventory, order, and invoice logic natively in `packages/business/src/erp/`, and optionally connect to an external ERPNext instance over HTTP REST/webhooks. |
| **Shadcn UI / Base UI / Lucide** | Official npm packages | MIT | **Fully Compatible** | Direct dependency usage via `pnpm` (`packages/ui-web`). |

---

## 3. Compliance Safeguards

1. **No GPL/AGPL Source Code in Core Packages**:
   - All TypeScript, React, and Prisma code in `apps/*` and `packages/*` is authored under Apache-2.0.
   - No code from `twentyhq/twenty`, `frappe/crm`, or `frappe/erpnext` is copied into the TypeScript monorepo.
2. **Optional External Site Isolation**:
   - The optional Frappe/ERPNext connector (`packages/business/src/frappe/`) communicates strictly over standard JSON/HTTP REST endpoints (`api/resource/*`, `api/method/*`) and HMAC-signed webhooks.
3. **No Proprietary or Enterprise-Only Assets**:
   - No commercial-only modules, protected third-party logos, or proprietary fonts are included.
