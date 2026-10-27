# Native (No-Docker) Development & Deployment Guide

This platform runs **100% natively without Docker Engine, Docker Desktop, Docker Compose, or Testcontainers**.

---

## 1. Prerequisites

- **Operating System**: Windows 10/11 (PowerShell), macOS, or Linux.
- **Node.js**: `v22.22.2+` or `v24.0.0+`.
- **Package Manager**: `pnpm@9.15.0` (via Corepack or global install).
- **Database**: Native **PostgreSQL 15+** running locally (e.g., on `127.0.0.1:5432` or `127.0.0.1:5433`).

---

## 2. Native PostgreSQL Setup

Create a database and role for local development using `psql`:

```sql
CREATE ROLE savingroup WITH LOGIN PASSWORD 'savingroup' CREATEDB;
CREATE DATABASE savingroup OWNER savingroup;
```

> `CREATEDB` is only needed if you run the integration test suite (`pnpm test:integration`), which creates and drops isolated temporary databases (`savingroup_test_<uuid>`) on the native PostgreSQL server via `packages/testkit/src/local-postgres.ts`.

---

## 3. Environment Configuration (`.env`)

Copy `.env.example` to `.env` and configure the native, zero-Docker variables:

```dotenv
# Native PostgreSQL connection
DATABASE_URL=postgresql://savingroup:savingroup@127.0.0.1:5432/savingroup

# Enable CRM OS, ERP OS, and Ticket Board natively
BUSINESS_APPS_ENABLED=true
TICKET_BOARD_ENABLED=true

# Native sandbox mode (never requires Docker):
# - "none": API-only tools (CRM, ERP, Board, Web, Memory, MCP, Routines)
# - "desktop": Native host-isolated workspace per bot under DATA_DIR/desktop-computers/<botId>
SANDBOX_PROVIDER=none

# Background job driver ("graphile" uses native PostgreSQL; "memory" runs in-process)
WAKEUP_DRIVER=graphile

# Application origins & ports
API_HOST=127.0.0.1
API_PORT=3100
API_URL=http://127.0.0.1:3100
WEB_ORIGIN=http://127.0.0.1:5173
BETTER_AUTH_URL=http://127.0.0.1:5173

# Local data directory for artifacts and optional desktop workspaces
DATA_DIR=./data
```

---

## 4. Dependency Installation & Database Migrations

From the repository root:

```powershell
# 1. Install workspace dependencies
pnpm install

# 2. Generate the Prisma client
pnpm db:generate

# 3. Apply versioned PostgreSQL migrations
pnpm db:migrate

# 4. (Optional) Seed a demo workspace with CRM/ERP records and AI digital employees
pnpm db:seed
```

---

## 5. Starting the Platform Natively

You can run the full stack together or start each native process individually:

```powershell
# Start API + Background Worker + Web UI concurrently (no Docker supervisor)
pnpm dev

# Or run individual processes in separate terminals:
pnpm dev:api      # Hono + oRPC + Better Auth API server on http://127.0.0.1:3100
pnpm dev:worker   # Graphile Worker + routine/lease reconciler
pnpm dev:web      # Vite React 19 web frontend on http://127.0.0.1:5173
```

---

## 6. Native-Compatible AI Agent Execution

- **CRM & ERP Operations**: All `crm_*` and `erp_*` tools execute in-process against PostgreSQL through `executeBusinessAction` (`packages/business/src/execute.ts`). No container runtime is ever invoked.
- **Computer / File Operations**:
  - When `SANDBOX_PROVIDER=none`, virtual graphical computer tools are cleanly disabled while all CRM, ERP, Board, Memory, Web, and Routine tools remain active.
  - When `SANDBOX_PROVIDER=desktop`, `DesktopSandboxProvider` (`packages/adapters/src/desktop-sandbox.ts`) provides per-bot isolated directories under `DATA_DIR/desktop-computers/<botId>` with path-traversal protection (`desktop-sandbox-win32-path.ts` on Windows) without Docker.

---

## 7. Health Checks

Verify the API and database health once running:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:3100/api/health"
```

---

## 8. Running Tests Without Docker

```powershell
# Fast offline unit and conformance tests (no Docker required)
pnpm test

# CRM & ERP PostgreSQL integration tests (uses native PostgreSQL via DATABASE_URL)
pnpm test:crm

# Full integration suite against native PostgreSQL
pnpm test:integration

# End-to-end browser Playwright suite (starts native API, Worker, and Web)
pnpm test:e2e
```

> Any legacy Docker computer-replay test (`*.docker.test.ts`) is excluded from `pnpm test` by `vitest.config.ts` and only runs if explicitly invoked.

---

## 9. Backup, Recovery & Native Server Deployment

### Database & Data Backup
Use native `pg_dump` and `pg_restore` (or `scripts/backup.sh` / `scripts/restore.sh`):

```powershell
pg_dump --format=custom --file=backup.dump $env:DATABASE_URL
pg_restore --clean --if-exists --dbname=$env:DATABASE_URL backup.dump
```

### Native Production Build & Start
```powershell
pnpm build
pnpm start
```
For production servers (Linux `systemd` or Windows Service / PM2), run:
1. `@savingroup/api` (`pnpm start:api`) behind a TLS reverse proxy (Caddy or Nginx).
2. `@savingroup/worker` (`pnpm start:worker`) connected to the same `DATABASE_URL`.
3. Static assets from `apps/web/dist` served by the reverse proxy or CDN.
