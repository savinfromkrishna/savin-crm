# Open-Source Feature Research & Reuse Matrix

## 1. Architectural Principle

Rather than embedding incompatible frameworks (Twenty's NestJS/GraphQL/Nx stack or Frappe's Python/MariaDB/Vue stack) inside the application, we combine:
1. **Rakazo (`elie222/rakazo`)** as the foundational runtime (Hono, oRPC, Better Auth, Prisma + PostgreSQL, Graphile Worker, Pi AI runtime, Shadcn/Base UI).
2. **Domain concepts, UX patterns, and clean-room TypeScript/React implementations** inspired by Twenty CRM, Frappe CRM, and ERPNext.
3. **Optional API gateway connectivity** (`packages/business/src/frappe/`) for organizations that choose to connect an external ERPNext / Frappe CRM instance via standard REST APIs and signed webhooks.

---

## 2. Reference Repositories Analyzed

| Project | Repository | Primary License | Tech Stack | Role in `rakazo-crm` |
| --- | --- | --- | --- | --- |
| **Rakazo / Savingroup** | `https://github.com/elie222/rakazo` | Apache-2.0 | TypeScript, Hono, oRPC, Prisma, PostgreSQL, React 19, Tailwind v4 | Core foundation (preserved and extended in-place). |
| **Twenty CRM** | `https://github.com/twentyhq/twenty` | GPL-3.0 (with MIT sub-packages) | TypeScript, React, NestJS, PostgreSQL, GraphQL | UX inspiration for Kanban pipelines, command-driven record tables, filter chips, activity timelines, and workflow triggers. Reimplemented cleanly in our stack. |
| **Frappe CRM** | `https://github.com/frappe/crm` | AGPL-3.0 | Python (Frappe), Vue 3 / Frappe UI, MariaDB/Postgres | Domain model inspiration for lead lifecycle (`new` → `contacted` → `qualified` → `converted`), deal stages, quick activity logging, and optional external REST bridge. |
| **ERPNext** | `https://github.com/frappe/erpnext` | GPL-3.0 | Python (Frappe), JS/Frappe Desk | Domain workflow inspiration for deterministic SKU catalog, stock ledger adjustments, sales order approval/confirmation, and invoicing; optional external REST bridge. |

---

## 3. Feature Classification Matrix

Classification key:
- **Already Implemented**: Present and working in `@savingroup/business`, `@savingroup/db`, and `@savingroup/web`.
- **Reimplemented in Native Stack**: Clean-room TypeScript/React/Prisma implementation following Apache-2.0 licensing rules (no GPL/AGPL code copied).
- **Integrated via Official API**: Supported through the optional `FrappeGateway` REST/webhook adapter (`packages/business/src/frappe/`).
- **Not Relevant**: Out of scope for the core AI-native CRM & Business Operations platform.

| Feature / Capability | Reference Source | Classification | Target Package / Files | Complexity | Priority |
| --- | --- | --- | --- | --- | --- |
| **Persistent AI Bots, Threads, Memory & Routines** | Rakazo (`packages/adapters`, `packages/memory`) | Already Implemented | `packages/adapters`, `packages/memory`, `apps/worker` | Low | P0 |
| **Action Approval Rules & Consequential Tool Gating** | Rakazo (`packages/core/src/action-approval.ts`) | Already Implemented | `packages/core`, `packages/adapters/src/executor.ts` | Low | P0 |
| **Companies & Contacts Management** | Twenty CRM / Frappe CRM | Already Implemented + Extended | `packages/business/src/crm/companies.ts`, `contacts.ts`, `apps/web/src/pages/BusinessCrm.tsx` | Low | P0 |
| **Duplicate Detection (Companies & Contacts)** | Twenty CRM | Reimplemented in Native Stack | `packages/business/src/crm/duplicates.ts`, `packages/contracts/src/crm.ts` | Medium | P1 |
| **Lead Capture, Qualification, Scoring & Conversion** | Frappe CRM | Already Implemented + Extended (`crm.lead.update`, explainable score/notes) | `packages/business/src/crm/leads.ts`, `apps/web/src/pages/BusinessCrm.tsx` | Medium | P0 |
| **Deal Pipeline, Drag-and-Drop Kanban & List Views** | Twenty CRM / Frappe CRM | Already Implemented + Extended | `packages/business/src/crm/deals.ts`, `apps/web/src/pages/BusinessCrm.tsx` | Low | P0 |
| **Unified Activities, Tasks & Follow-up Completion** | Frappe CRM / Twenty CRM | Already Implemented + Extended (`crm.activity.complete`) | `packages/business/src/crm/activities.ts`, `apps/web/src/pages/BusinessCrm.tsx` | Low | P0 |
| **Unified Customer Timeline (Human + Agent Actions)** | Twenty CRM / Frappe CRM | Reimplemented in Native Stack | `packages/business/src/audit.ts`, `apps/web/src/components/business/forms.tsx` | Medium | P0 |
| **Contextual AI Copilot Docked in CRM/ERP** | Rakazo + Twenty UX | Already Implemented + Extended | `apps/web/src/components/business/assistant.tsx` | Low | P0 |
| **Digital Employee Team & Role Permissions** | Rakazo (`packages/business/src/team.ts`) | Already Implemented + Extended | `packages/business/src/team.ts`, `apps/web/src/components/business/assistant.tsx` | Medium | P0 |
| **Deterministic Product Catalog & Stock Ledger** | ERPNext | Already Implemented | `packages/business/src/erp/products.ts`, `inventory.ts` | Low | P1 |
| **Sales Orders / Quotations with Approval & Stock Deduction** | ERPNext | Already Implemented | `packages/business/src/erp/orders.ts`, `apps/web/src/pages/BusinessErp.tsx` | Low | P1 |
| **Invoices & Deterministic Payment Recording** | ERPNext | Already Implemented | `packages/business/src/erp/invoices.ts`, `apps/web/src/pages/BusinessErp.tsx` | Low | P1 |
| **CRM & Sales Analytics / KPI Dashboards** | Twenty CRM / Frappe CRM | Already Implemented + Extended | `packages/business/src/crm/overview.ts`, `erp/overview.ts`, `apps/web/src/pages/BusinessCrm.tsx` | Medium | P1 |
| **Scheduled & Event-Driven Routines / Workflows** | Rakazo + Twenty Workflows | Already Implemented | `packages/core/src/cron.ts`, `apps/api/src/routine-runs.ts` | Medium | P2 |
| **Full Manufacturing / Payroll / Double-Entry GL** | ERPNext | Integrated via Official API | `packages/business/src/frappe/` | High | P3 (Optional) |
