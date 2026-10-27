# Roadmap: what Savingroup adds to ERPNext and Frappe CRM

ERP and CRM vendors are adding assistants that answer questions about records. Savingroup starts
from the other end: persistent teammates with an identity, memory, a computer, a phone line and
an explicit approval policy, working a real open-source ERP through a gateway that never acts
twice and records every write. This roadmap turns that combination into things a business owner
cannot get from an ERP or CRM vendor today, in an order where each step is safe to ship.

It builds on the platform in [the README](README.md) and follows [VISION.md](../../VISION.md):
routines stay scheduled prompts (no visual workflow builder), consequential actions follow an
explicit approval policy and uncertain review fails toward asking, every external provider stays
optional, and tests stay deterministic and offline.

## Where we start

In place:

- Typed CRM and ERP actions on the site (36 `crm.*` and `erp.*`, plus 10 `admin.*`) behind one
  write path: validate, check the bot's permissions, idempotency, audit, outbox. An operation
  ledger reconciles writes whose outcome was lost, and site events arrive signed and
  replay-protected.
- A role-scoped team (Sales Executive, Operations, Finance, Business Analyst) and an Operator,
  run supervised or autonomously ([setup manual, section 8](../setup-manual.md)).
- The site's own sign-in pages in the organization's brand
  ([`infra/frappe/README.md`](../../infra/frappe/README.md), "Sign-in pages").

Gaps, in the order an owner running sales, stock and accounts feels them:

1. Site events refresh screens but never start a bot run, and nothing notices time passing (an
   invoice going overdue, a follow-up coming due). "Low stock" is a fixed threshold of five, not
   ERPNext's reorder levels.
2. Approval rules match a tool, a connector or a category, never an amount, a discount or a
   customer, and the site does not stop a bot from approving an order it drafted.
3. Typed actions cover selling only: no suppliers, purchase orders or purchase invoices,
   quotations, credit notes, returns, expenses or bank reconciliation.
4. The Analyst has no receivables ageing, profit and loss or stock valuation, and the ERP and
   CRM pages show tiles without trends.
5. Customers cannot reach a bot: messaging links the owner to their own bot, calls are outbound
   only, and tools are off during a call.
6. Paper does not get in: no spreadsheet or Word attachments, no OCR for scanned PDFs, no import
   from spreadsheets or Tally.
7. Mobile shows approval cards in threads but no business screens, and a notification cannot
   approve anything.
8. Sites are provisioned by hand, monitoring and backups are documented but not wired, and a
   site holds one company.
9. All of the business platform is still uncommitted.

## The differentiators

Each one says what it is, why no ERP or CRM does it, what in this repository it builds on, and
the first milestone.

### 1. Delegated authority instead of permissions

Bots get an authority matrix the way staff do: "Finance records payments up to ₹50,000 and asks
above that", "Sales may give up to 5% discount", "nobody approves an order they drafted", and
limits per period ("₹2 lakh of purchase orders a week"). ERP roles say which documents a user
may touch; none says how much an automated actor may commit.

- Builds on: `packages/core/src/action-approval.ts` (rules with an effect and a match kind), the
  typed amounts and discounts in `packages/contracts/src/business.ts`, and the bridge's approval
  policy for orders and invoices.
- First milestone: deterministic rule predicates on business tool arguments (amount, discount,
  customer, quantity), evaluated before the AI auto-review; maker-checker on
  `erp.order.approve` and `erp.invoice.issue`, enforced by the bridge as well as by Savingroup.
- Done when: "ask when a payment exceeds ₹50,000" pauses exactly those calls in offline tests,
  and the site refuses an approval from the actor who created the order.

### 2. Autonomy that is earned and revocable

The approval history becomes a track record per bot and tool. After a run of approvals with no
reversals Savingroup proposes the next step: "You approved 47 of 48 stock adjustments by Operations
this month. Let it adjust stock under ₹10,000 on its own?" A denial, a cancellation of something
it did unattended, or a reconciliation failure takes the step back. Elsewhere autonomy is a
switch; here it rests on evidence, per tool.

- Builds on: the approval cards (Allow once, Always allow, Deny), `business_action_log`, and
  `grantBusinessAutonomy` with the four operating modes in `packages/business/src/team.ts`.
- First milestone: approval statistics per bot and tool, a suggestion card in the thread, and
  automatic demotion when an unattended action is reversed.

### 3. Teammates that react to the business

Site events wake the bot whose role owns them. A new lead gets a first reply within minutes; an
invoice seven days overdue starts Finance's follow-up; stock below the reorder level gets a draft
purchase order from Operations; a deal stuck in one stage for two weeks gets flagged to its owner.

- Builds on: the bridge's `doc_events`, the webhook route and `ingestBusinessWebhook` in
  `apps/api/src/business-webhook.ts` (today they store a `BusinessEvent` and refresh screens),
  routines, and the ticket-assignment wake in `packages/adapters/src/ticket-wake.ts`.
- Needs: `scheduler_events` in the bridge for facts that come from time passing, and ERPNext
  reorder levels in place of `LOW_STOCK_THRESHOLD`.
- Care: an event is an unattended trigger. Extend the executor's
  `unattendedTriggerToolRequiresApproval` so consequential tools started by an event follow the
  space's policy explicitly.
- First milestone: event subscriptions per role in the team template (`lead.created`,
  `invoice.overdue`, `stock.below_reorder`), deduplicated per document.

### 4. A phone line into the books

The owner calls the business number: "How much did we collect today?", "Book 20 cartons for Acme
Traders at last month's price." Bots call customers for payment reminders, delivery confirmations
and lead follow-ups, then write the outcome, the promise-to-pay date and the next step into the
CRM. Many small businesses run on the phone; no ERP lets them operate it by voice under the same
permissions and approvals as the app.

- Builds on: `apps/phone-agent` (LiveKit with any SIP trunk, and an emulator for tests),
  stored transcripts and summaries, and the bot waking when a call ends. Calls are outbound only
  and `apps/api/src/phone-calls.ts` keeps tools off during the call.
- First milestone: read-only business tools during calls (stock, price, a customer's balance),
  then writes that need a spoken confirmation on top of the normal approval policy; inbound
  calls routed to the right role; call log entries in the CRM.
- Care: calling customers is regulated (in India, TRAI's commercial-communication rules and DND
  preferences). Start with reminders to existing customers who consented, recorded on the contact.

### 5. Work on portals that have no API

On their computers, bots download GSTR-2B from the GST portal and reconcile it with purchase
invoices, fetch bank statements and match receipts to invoices, and check supplier and
marketplace dashboards. A person takes over the screen for an OTP or a captcha and hands it back.
Integration-based tools stop where the API stops; Savingroup bots have browsers, persistent sign-ins
and a takeover flow.

- Builds on: the sandbox supervisor and computer image (screen, browser and shell tools, a
  persistent browser profile per bot, user takeover; see `docs/computer-runtime.md`).
- First milestone: statement to ledger. A bank statement (PDF or CSV) becomes draft payment
  entries matched to open invoices, each with its evidence, approved in one step.
- Care: credentials stay in the computer's browser profile, never in chat or on the site; output
  stays draft until approved; GST work is prepared by bots and reviewed by a qualified person.

### 6. Paper, photos and spreadsheets in, records out

Photograph a supplier's bill or a visiting card in the thread and get a draft purchase invoice
or lead, every field with its source. Upload last year's spreadsheet or a Tally export and the
Operator maps the columns, shows a dry run of what it will create or match, and imports it
idempotently.

- Builds on: vision-capable models, attachments in `packages/contracts/src/attachments.ts` (no
  xlsx or docx today; PDFs are read as text, so scans fail), `business:migrate`, and the ledger.
- First milestone: xlsx and docx attachments, OCR for scanned PDFs on the computer, and a typed
  `erp.import` action with a preview, remembered column mappings and ledger rows. Bots stay
  blocked from Frappe's raw Data Import.

### 7. Rehearse every change on a copy first

Before the Operator changes price lists, taxes or workflows, or bulk-updates records, it restores
the latest backup into a rehearsal site, applies the plan there and shows the impact: "142 items
change price; 3 open quotations and 1 unpaid invoice are affected." Once approved, the same plan
runs on the live site. Small-business ERPs have no staging; this is what makes autonomous
administration safe.

- Builds on: one site per organization (ADR 0002), bench backup and restore (manual today, see
  `infra/frappe/README.md`), the Operator's `admin.*` actions, and the ledger.
- First milestone: a rehearsal job (restore into a scratch site, run the plan, diff the documents
  it touched) and a plan format the Operator writes and the owner approves once.

### 8. Every number explains itself

Ask "why is receivables ₹4.2 lakh?" on a tile and get the documents behind it and their history:
which person or bot created, approved or adjusted each one, through which operation.

- Builds on: the business action log, `Savingroup Operation` rows on the site, and run traces in
  `packages/core/src/run-trace.ts`.
- First milestone: report reads for the Analyst (receivables ageing, profit and loss, stock
  valuation, sales by customer and item), an Explain action on the ERP and CRM overview tiles,
  and trends drawn with `render_plot`.

### 9. The day runs in the thread

A morning brief from the Analyst, or a call: yesterday's sales, cash in, overdue invoices, stock
to reorder, and the decisions waiting, each with its approve button. On a phone the owner
approves from the notification.

- Builds on: routines, Expo push notifications (including "needs approval"), approval cards.
  Mobile has no business screens yet.
- First milestone: a brief routine in the team template, notifications that approve or deny
  without opening the thread, and a compact business summary on mobile.

### 10. One account for Savingroup and the site

"Continue with Savingroup" on the site's sign-in page: people use one account in the app and in
ERPNext and Frappe CRM, their site roles follow their space role, and removing someone from the
space removes their site access.

- Builds on: the site's sign-in pages (they already render Frappe's social sign-in providers),
  Frappe's Social Login Key (any OAuth or OIDC provider), and Savingroup's authentication.
- First milestone: Savingroup as an OIDC provider for the organization's site, with site users created
  and disabled from space membership.

### 11. Customer-facing teammates with the books open

A sales bot answers customers on WhatsApp or the website with live stock and prices, drafts the
quotation, sends a payment link, and hands over to a person when a discount is beyond its
authority (differentiator 1).

- Builds on: the messaging platforms in `packages/adapters/src/messaging-platforms.ts` (today
  they connect the owner to their own bot, and incoming photos arrive as links in
  `apps/api/src/messaging-inbound.ts`), CRM leads and contacts.
- First milestone: a customer inbox per space where each conversation belongs to a CRM lead or
  contact, photos and files arrive as attachments, and a person can take over.

### 12. Setup by conversation

"We sell spices wholesale from two warehouses in Gujarat and are GST registered." The Operator
picks the blueprint and creates the company, warehouses, tax templates, price lists, item
groups, naming series, print formats and invitations, each step in the ledger and reversible.

- Builds on: the blueprints in `infra/frappe/blueprints` (`india-smb.json` is small today), the
  bootstrap script, the Operator, the operating modes, and the setup manual.
- First milestone: industry packs (distribution, retail, light manufacturing, services) with
  master data, roles and a default team, and a setup plan the Operator runs as a checklist after
  one approval.

### Always: owned, open and model-neutral

The frame rather than a feature: the ERP is open source and runs on the owner's server, any
model works, local ones included, and leaving costs nothing.

## Phases

### Phase 0: make it shippable (now)

- [ ] Move the business platform into reviewed pull requests by area, with CI green.
- [ ] A scripted bot run against a connected site in the test suite (milestone E).
- [ ] Backups on a schedule, a restore drill, and health checks for the site (milestone H).
- [x] The site's sign-in pages in the organization's brand.

### Phase 1: react safely (next)

Differentiators 1, 2 and 3, and the buying side of the ERP.

- Event subscriptions, time-based facts and reorder levels.
- Argument-aware approval rules and maker-checker.
- Track record and earned autonomy.
- Typed actions for suppliers, purchase orders, purchase invoices, quotations, credit notes and
  returns, and expenses.

Exit: in offline tests an overdue invoice and a low-stock item each lead to exactly one bot
action, a payment above the limit always pauses, and no bot approves its own order.

### Phase 2: meet people where they are

Differentiators 4, 6, 8, 9 and 11.

- Tools during calls (reads first), inbound calls, CRM call logs.
- Spreadsheet and Word attachments, OCR, `erp.import`.
- Reports, Explain and trends.
- The morning brief, actionable notifications, a mobile summary.
- A customer inbox on WhatsApp Business.

Exit: an owner runs a day from the phone (the brief, the approvals, a spoken question about
stock) without opening the desk.

### Phase 3: operations no hosted ERP offers

Differentiators 5, 7, 10 and 12, and the platform work.

- Rehearsal sites.
- Portal work on computers: bank statement to ledger, GSTR-2B reconciliation.
- Savingroup sign-in for the site.
- Setup by conversation with industry packs.
- Automatic site provisioning (milestone F), several companies per site, wired monitoring.

Exit: a new business goes from a conversation to its first GST invoice without a consultant, and
every bulk change was rehearsed first.

## How we will know it works

- Minutes from a new lead to its first reply.
- Days sales outstanding before and after Finance's follow-ups.
- Share of consequential actions that ran unattended and were never reversed.
- Approvals asked of the owner per day, which should fall as autonomy is earned.
- Stockouts, and the time from reaching a reorder level to a purchase order.
- Time from a new site to its first invoice.

## Guardrails

- Approval policy is explicit and deterministic; the AI review decides only when no rule
  matches, and fails toward asking.
- The site stays the system of record; Savingroup owns actors, approvals, the audit log and the
  ledger ([audit.md](audit.md)).
- Statutory work (GST returns, e-invoices, TDS) is prepared by bots and reviewed by a qualified
  person before filing.
- No hosted vendor becomes required: telephony, OCR, models and messaging stay behind
  provider-neutral interfaces with offline conformance tests.
- Reactions are role instructions plus event subscriptions; there is no visual workflow builder.
