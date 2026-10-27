# CRM OS and ERP OS

Two first-party business applications that give a workspace a system of record for
customers and sales (CRM OS) and for products, stock, orders and invoices (ERP OS). Both
are built so that bots operate them through typed, permission-checked actions: a bot
decides and requests; the application validates, executes and records who did what.

They are deliberately small. There is no marketing automation, general ledger, payroll,
tax engine or manufacturing. Invoices are a document workflow with manual payment status,
not accounting.

## Enable

Set `BUSINESS_APPS_ENABLED=true` for both the API and the worker (the same way the ticket
board is enabled), then run `pnpm db:migrate`. Users see CRM and ERP in the sidebar of the
web and desktop apps, and every bot in the deployment gains the `crm_*` and `erp_*`
tools. The flag is off by default, so existing deployments do not change.

Mobile does not include CRM or ERP screens. Bots on mobile still use the tools; the
records themselves are reviewed on web or desktop.

## What is in it

CRM OS: companies, contacts, leads (new → contacted → qualified → converted or
unqualified), deals with a five-stage pipeline (qualification, proposal, negotiation, won,
lost), and activities (calls, emails, meetings, notes, follow-ups with a due date).

ERP OS: products with SKU and price, stock on hand with an adjustment history, sales orders
(draft → pending approval → approved → confirmed, or cancelled before confirmation), and
invoices created from confirmed orders (draft → issued → paid, with partial payments).

Per-space settings: currency, whether stock may go negative, and whether orders and
invoices need an approval step. Only the space owner can change them.

Records carry human refs a bot can quote: `L-3`, `D-2`, `SO-5`, `INV-1`. Products are
referenced by SKU.

## The pages

Each app opens on an overview built from the same records the lists show:

- **CRM**: pipeline value, won value and win rate, open leads and follow-ups; the open
  follow-ups by due date (overdue first), the pipeline by stage, the largest open deals,
  leads by status, and the companies that carry the most open value.
- **ERP**: confirmed value, outstanding invoices, approvals and low stock; a list of what
  waits on a person (orders to approve or confirm, unpaid and draft invoices, products at
  or below `LOW_STOCK_THRESHOLD`), confirmed sales for the last six months, recent orders
  and the products the confirmed orders sold.

An overview item opens the record itself: the open record is kept in the address
(`?record=<id>`), so a link, a reload or the browser's address bar lands on the same
dialog. On the deal pipeline, dragging a card to another column moves the deal to that
stage (the deal's dialog does the same from the keyboard).

## How bots use it

Every action is a built-in tool named after its action id: `crm.lead.create` is
`crm_lead_create`. The full list is in `packages/contracts/src/business.ts`
(`BUSINESS_ACTION_IDS`), and `business/actions` on the API returns the same catalog with
descriptions and the approval class of each action.

- **Workspace and identity** come from the run, never from the model's arguments. A tool
  call executes as the bot, in the bot's space, under the run that produced it.
- **Allowed and restricted actions** use the existing per-bot tool switch
  (`disabledBuiltinTools`). A Sales bot with `erp_order_confirm` disabled never sees the
  tool, and if a prompt ever named it anyway the server refuses with `permission_denied`,
  because the check reads the bot row, not the prompt.
- **Approval** uses the existing action approval rules. Stock adjustments, order approval,
  confirmation and cancellation, issuing an invoice and recording a payment are classed as
  consequential: webhook-triggered runs always ask, Auto Review can judge them, and a
  `require_approval` rule for the tool makes every run pause with an approval card and
  resume with the approved arguments. Like the other consequential built-in tools, they run
  without a card until the owner adds such a rule; the demo seeder adds rules for all six.
- **Policy settings** add two server-side checks that do not depend on the model. With
  "orders need approval" on, an order must be approved before it can be confirmed. With
  "invoices need approval" on (the default), bots may draft and read invoices but a person
  must issue them and record payments.
- **Idempotency** has two layers. The executor already records every effect per run, tool
  and arguments, so a resumed or retried run returns the stored result. The application
  adds its own key: every write accepts `idempotencyKey`, and bot calls get one derived
  from the run and call automatically. A repeated key returns the committed result.
- **Audit and events** are written in the same transaction as the change. The action log
  (`business/history`) shows which person or bot ran each action; domain events such as
  `crm.lead.converted` and `erp.order.confirmed` drive the live refresh of the pages and
  are published after commit with an outbox marker, so a lost publish is retried on the
  next change in the space.

ERP calls CRM through the same services: confirming an order linked to a deal marks that
deal won, in the same transaction.

## Asking the team from the pages

Every CRM and ERP page has an **Ask** button for the space's bots. It opens that bot's own
chat thread in a panel beside the records, so a conversation started there continues in chat
and the other way round. The bot works through the same `crm_*` and `erp_*` tools,
permissions and approval rules as anywhere else. Approval cards are answered in the panel,
and records the bot changes refresh on the page while it works. On a wide screen the panel is
open until the person closes it, which is remembered.

- The Operator answers by default when the space has one. Otherwise it is the bot whose role
  owns the section (Sales Executive in CRM, Operations in ERP, Finance on invoices), then the
  Business Analyst, then any bot. The pick is remembered per app. Team bots are recognised
  by spawn key (`BUSINESS_TEAM_SPAWN_KEYS` in `packages/contracts/src/business.ts`).
- Record dialogs have their own **Ask** button, and every row in a list or an overview
  shows the bot's avatar on hover (always on touch screens) to ask about that record
  without opening it. The next message then starts with the record's kind, ref and title,
  for example `Lead L-3 (Line upgrade): …`, and the bot looks the record up with its
  search tools. Nothing hidden is sent: the transcript shows exactly what the bot received.
- Suggested requests (summaries, next steps, drafted emails, restocking, unpaid invoices)
  appear when the panel opens, and only those whose tools the bot is allowed to run.
- Mobile has no business screens; the same bots answer in their mobile chat.

## The business team

```bash
BUSINESS_APPS_ENABLED=true pnpm --filter @savingroup/business team -- --email you@example.com --space-name Business
```

This creates a space named Business (or reuses it) with four bots whose allowed actions are
enforced server-side, and adds `require_approval` rules for the six consequential tools so
those steps pause for the owner. Without `--space-name` the team lands in the default
space; `--sync` refreshes the role of bots that already exist.

| Bot | Allowed | Not allowed |
| --- | --- | --- |
| Sales Executive | CRM reads and writes, ERP reads (including `erp_inventory_check`) | stock adjustments, order approval and confirmation, invoices |
| Operations | products, stock, order drafting and approval requests, confirm and cancel (each pauses for the owner) | invoices, leads, deals |
| Finance | invoice drafts; issuing and payments once the invoice-approval policy is turned off (each pauses for the owner) | orders, stock, leads, deals |
| Business Analyst | every read | every write |

The team works on whatever backend the organization uses: the prototype tables, or the
connected ERPNext + Frappe CRM site (below), where record ids are the site's document names
(`CRM-LEAD-2026-00001`, `SAL-ORD-2026-00001`).

`pnpm --filter @savingroup/business demo -- --email you@example.com` seeds an example company
(two companies, three contacts, three products with stock, two leads, a deal and a draft
order) into the default space and creates the same team there. Then ask Operations:
"Prepare a sales order for the Acme deal and request approval." In a scripted deployment
(`AGENT_RUNTIME=scripted`) the prompt "Run the business demo workflow." walks a bot through
lead → deal → order → draft invoice; with the seeded rules it pauses for the owner at order
approval and again at confirmation.

## Where the records live

By default the records live in Savingroup's own tables (the prototype backend). An
organization can instead connect a dedicated ERPNext + Frappe CRM site: ERP → Overview →
**Connect Savingroup ERP**, or `pnpm --filter @savingroup/api business:connect`. From then on every
CRM OS and ERP OS action in every space of the organization runs on that site through the
native business gateway, with the same contracts, bot tools, permissions, approvals, audit
log and live events. **Disable** switches back; nothing is deleted. How to build and
provision a site is in `infra/frappe/README.md`; the design, the data ownership and the
migration rules are in `docs/business-platform/`. Prototype data moves with
`pnpm --filter @savingroup/api business:migrate` (dry run by default, `--apply` to write).

While the connection is active, the business sidebar and the Business system card link to
the site's ERPNext desk and Frappe CRM, and every record's dialog links to the same document
there (a lead in Frappe CRM, an order in the desk). The links go through the site's sign-in,
which sends a signed-in person straight on.

- **A failed connection is not a silent fallback.** When the check fails (for example the
  site rejects the gateway credentials), pages and bot tools report the reason instead of
  quietly using the built-in tables, whose records differ from the site's. **Check** tries
  again; **Disable** is the deliberate way back to the built-in tables.
- **Company renames are followed.** The connection stores the company's name, which every
  write sends to the site. ERPNext keeps a company's abbreviation through a rename, so
  **Check** finds a renamed company by its abbreviation and stores the new name. A bot's
  `admin_*` change to the Company does the same right away.
- **Reconnecting from the terminal** reuses the gateway credentials that bootstrap wrote:
  `pnpm --filter @savingroup/api business:connect -- --email <owner> --site-url http://localhost:8090 --state-file infra/frappe/state/frontend.gateway.json --company <name on the site> --abbr <abbreviation>`.

On a GST-enabled site (the India blueprint) every product needs an HSN or SAC code of at
least six digits; the product form shows the field there and `business:migrate --hsn <code>`
stamps migrated products that have none. The site validates the code against its own
HSN list.

## Tests

- Offline: `packages/contracts/src/business.test.ts`, `packages/business/src/*.test.ts`,
  `packages/core/src/action-approval-business.test.ts`,
  `packages/adapters/src/executor-business-tools.test.ts`,
  `apps/web/src/pages/BusinessCrm.test.tsx`, `apps/web/src/pages/BusinessErp.test.tsx`,
  `apps/web/src/components/business/assistant.test.tsx`.
- Screens: `apps/web/e2e/business-pages.spec.ts` drives both apps against offline fake records
  (`apps/web/e2e/fixtures/business.tsx`) at desktop and phone widths, opens records from
  both overviews and captures screenshots.
  `apps/web/e2e/business-assistant.spec.ts` asks the Operator about a lead and has it approve an
  order from the panel against the same fixture, whose bot replies are scripted.
- PostgreSQL (`VERIFY_DATABASE=1` with `DATABASE_URL`):
  `packages/business/src/business.postgres.test.ts` covers the service rules (stock
  rejection, state machine, isolation, idempotent replay, bot permissions, invalid input,
  demo seeding) and `apps/api/src/business-app.postgres.test.ts` covers the feature flag,
  the workflow over HTTP including cross-account isolation, and a scripted bot running the
  whole workflow through the agent executor with two approval pauses. The scripted bot is
  a deterministic simulation of a model; it exercises the real executor, tools, approvals
  and database, not a real LLM.

## Limitations and next steps

- Stock has no reservations: availability equals stock on hand until an order is
  confirmed, and a confirmed order cannot be cancelled (reverse it with an adjustment).
- One invoice per order, no credit notes, no taxes or discounts; totals equal line sums.
- Lead and deal history is the action log, not a separate stage-history table.
- Events are published at least once to the live stream; consumers refetch rather than
  replaying payloads. A background sweep for events whose publish failed is not included;
  the next write in the space republishes them.
- No mobile screens.
