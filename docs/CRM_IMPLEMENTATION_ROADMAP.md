# CRM & Business Operations Implementation Roadmap

## Phase 0 — Audit & Architecture Foundation (Completed)
- [x] Clone existing Rakazo / Savingroup monorepo into dedicated `rakazo-crm` workspace.
- [x] Audit monorepo packages, database schema, business actions, and Docker touchpoints (`docs/architecture/EXISTING_SYSTEM_AUDIT.md`).
- [x] Complete open-source feature matrix (`docs/architecture/OPEN_SOURCE_FEATURE_MATRIX.md`) and license compliance report (`docs/architecture/OPEN_SOURCE_LICENSES.md`).
- [x] Document canonical CRM architecture (`docs/architecture/CRM_ARCHITECTURE.md`), data model (`docs/architecture/CRM_DATA_MODEL.md`), and agent permission model (`docs/architecture/AGENT_PERMISSION_MODEL.md`).
- [x] Document native non-Docker setup (`docs/NO_DOCKER_SETUP.md`) and test plan (`docs/CRM_TEST_PLAN.md`).

## Phase 1 — Native No-Docker Startup & Core CRM Completeness (In Progress)
- [ ] Update root `package.json` scripts (`dev`, `dev:api`, `dev:web`, `dev:worker`, `db:migrate`, `db:seed`, `test`, `test:crm`, `test:integration`, `test:e2e`, `build`, `start`) so native execution without Docker is the default.
- [ ] Update `.env.example` and `.env` in `rakazo-crm` so `BUSINESS_APPS_ENABLED=true`, `TICKET_BOARD_ENABLED=true`, and `SANDBOX_PROVIDER=none` are pre-configured out of the box.
- [ ] Add missing first-class CRM actions across `@savingroup/contracts`, `@savingroup/business`, `@savingroup/api`, and `@savingroup/web`:
  - `crm.lead.update`: Update lead title, source, notes, value, company, or contact with full audit logging.
  - `crm.activity.complete`: Complete or reopen a follow-up activity/task (`completedAt`) with full audit logging and domain events (`crm.activity.completed`).
  - `crm.company.find_duplicates` & `crm.contact.find_duplicates`: Explainable duplicate detection by normalized domain, name, email, and phone.

## Phase 2 — Sales CRM & Customer Timelines
- [ ] Enhance `BusinessCrm.tsx` (`LeadsSection`, `LeadDialog`, `ActivitiesSection`, `DealsSection`):
  - Direct lead editing (`title`, `value`, `source`, `notes`, `company`, `contact`) alongside 1-click qualification and deal conversion.
  - 1-click task completion toggle in `ActivitiesSection` and `OverviewSection` follow-ups list.
  - Unified activity & audit history timeline on Company, Contact, Lead, and Deal dialogs.

## Phase 3 — AI Operators, Specialist Team & End-to-End Vertical Slice
- [ ] Expand `BUSINESS_TEAM` (`packages/business/src/team.ts`) with the **CRM Data Steward** specialist role alongside **Sales Executive**, **Operations**, **Finance**, **Business Analyst**, and **Operator**.
- [ ] Add 1-click **Provision AI Team** control in the CRM/ERP UI when a workspace has not yet spawned its specialist bots.
- [ ] Verify the complete vertical slice end-to-end:
  - Human creates a lead → AI agent reviews the lead → AI suggests/requests qualification & follow-up task → human approves consequential/gated action → agent updates CRM & creates follow-up task → audit trail (`BusinessActionLog`) records bot identity, run ID, and approving human.

## Phase 4 — Workflow Automation & Routines Integration
- [ ] Connect CRM overdue follow-ups and lead qualification checks with scheduled routines (`Routine`) and live `BusinessEvent` triggers.

## Phase 5 — Business Operations (Products, Quotations/Orders, Invoices, Analytics)
- [ ] Verify deterministic calculations (`packages/business/src/money.ts`) across multi-line orders/quotations and invoices.
- [ ] Enhance CRM & ERP overview analytics with conversion rate, win rate, and agent activity metrics.

## Phase 6 — Production Hardening & Verification
- [ ] Run unit, conformance, and integration tests covering happy paths and negative security cases (cross-workspace access, unauthorized bot tool execution, idempotency replay, approval rejection).
