import { I18nProvider } from "@lingui/react";
import type {
  Bot,
  BusinessActor,
  BusinessChange,
  BusinessEnvironment,
  BusinessHistoryEntry,
  BusinessSettings,
  BusinessTeamRoleKey,
  CrmActivity,
  CrmCompany,
  CrmContact,
  CrmDeal,
  CrmLead,
  ErpInvoice,
  ErpProduct,
  ErpSalesOrder,
  InventoryAdjustment,
  MessageBlock,
  ProductEvent,
  Run,
  ThreadMessage,
  ThreadSnapshot,
} from "@savingroup/contracts";
import { BUSINESS_TEAM_SPAWN_KEYS } from "@savingroup/contracts";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { bootstrapI18n, i18n } from "../../src/lib/i18n";
import { CrmPage } from "../../src/pages/BusinessCrm";
import { ErpPage } from "../../src/pages/BusinessErp";
import "../../src/styles.css";

/* Offline CRM OS + ERP OS with fake records. Every /rpc/ call the pages make is
   answered here, so screens render the same way on every run. */

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get("theme") === "light" ? "light" : "dark";

const minute = 60_000;
const ago = (minutes: number) => new Date(Date.now() - minutes * minute).toISOString();
const ahead = (days: number) => new Date(Date.now() + days * 24 * 60 * minute).toISOString();

const owner: BusinessActor = { userId: "user-owner", botId: null, name: "Ada Owner" };
const sales: BusinessActor = { userId: null, botId: "bot-sales", name: "Sales Executive" };
const operations: BusinessActor = { userId: null, botId: "bot-ops", name: "Operations" };
const finance: BusinessActor = { userId: null, botId: "bot-finance", name: "Finance" };
const nobody: BusinessActor = { userId: null, botId: null, name: null };

function bot(
  id: string,
  name: string,
  title: string,
  color: string,
  role: BusinessTeamRoleKey,
  description: string,
): Bot {
  return {
    id,
    spaceId: "space-demo",
    name,
    title,
    description,
    instructions: "",
    color,
    notifyOnFinish: false,
    pinned: false,
    sectionId: null,
    archivedAt: null,
    unread: false,
    parentBotId: null,
    memoryScope: null,
    threadId: `thread-${id}`,
    preview: "",
    status: "idle",
    runErrorId: null,
    computerMode: "team",
    updatedAt: ago(600),
    createdAt: ago(6000),
    voiceId: null,
    autoSpeak: false,
    modelProvider: null,
    modelId: null,
    thinkingLevel: null,
    teamChatAmbientEnabled: false,
    teamChatRules: "",
    disabledBuiltinTools: [],
    webhookConfigured: false,
    spawnKey: BUSINESS_TEAM_SPAWN_KEYS[role],
  };
}

const bots: Bot[] = [
  bot(
    "bot-operator",
    "Operator",
    "ERP & CRM operator",
    "#3B82F6",
    "operator",
    "Runs CRM OS and ERP OS end to end and directs the team.",
  ),
  bot(
    "bot-sales",
    "Sales Executive",
    "Sales",
    "#8B5CF6",
    "sales",
    "Owns the pipeline: companies, contacts, leads, deals and the activity log.",
  ),
  bot(
    "bot-ops",
    "Operations",
    "Operations",
    "#F97316",
    "operations",
    "Owns the catalog, stock and sales orders.",
  ),
  bot("bot-finance", "Finance", "Finance", "#10B981", "finance", "Owns invoices and payments."),
];

function company(id: string, name: string, domain: string | null, phone: string | null) {
  return {
    id,
    spaceId: "space-demo",
    name,
    domain,
    phone,
    notes: null,
    createdBy: id === "company-kaveri" ? sales : owner,
    createdAt: ago(9000),
    updatedAt: ago(300),
  } satisfies CrmCompany;
}

const companies: CrmCompany[] = [
  company("company-acme", "Acme Industrial Pvt Ltd", "acme.example", "+91 20 5550 0101"),
  company("company-kaveri", "Kaveri Textiles", "kaveri.example", "+91 80 5550 0177"),
  company("company-northwind", "Northwind Pumps", "northwind.example", null),
  company("company-sahyadri", "Sahyadri Agro Foods", "sahyadri.example", "+91 22 5550 0142"),
  company("company-bharat", "Bharat Motors", null, null),
];

function contact(
  id: string,
  firstName: string,
  lastName: string,
  email: string | null,
  title: string | null,
  companyId: string,
): CrmContact {
  return {
    id,
    spaceId: "space-demo",
    firstName,
    lastName,
    name: `${firstName} ${lastName}`,
    email,
    phone: null,
    title,
    notes: null,
    companyId,
    companyName: companies.find((row) => row.id === companyId)?.name ?? null,
    createdBy: owner,
    createdAt: ago(8000),
    updatedAt: ago(800),
  };
}

const contacts: CrmContact[] = [
  contact(
    "contact-priya",
    "Priya",
    "Nair",
    "priya@acme.example",
    "Procurement lead",
    "company-acme",
  ),
  contact(
    "contact-rahul",
    "Rahul",
    "Mehta",
    "rahul@kaveri.example",
    "Plant manager",
    "company-kaveri",
  ),
  contact(
    "contact-ananya",
    "Ananya",
    "Rao",
    "ananya@northwind.example",
    "Head of operations",
    "company-northwind",
  ),
  contact("contact-vikram", "Vikram", "Singh", null, "Director", "company-sahyadri"),
];

function lead(
  number: number,
  title: string,
  status: CrmLead["status"],
  value: number | null,
  companyId: string | null,
  assignee: BusinessActor,
  updatedMinutes: number,
): CrmLead {
  const linked = contacts.find((row) => row.companyId === companyId);
  return {
    id: `lead-${number}`,
    spaceId: "space-demo",
    number,
    ref: `L-${number}`,
    title,
    status,
    source: number === 5 ? "Website" : "Referral",
    notes: null,
    value,
    companyId,
    companyName: companies.find((row) => row.id === companyId)?.name ?? null,
    contactId: linked?.id ?? null,
    contactName: linked?.name ?? null,
    assignee,
    convertedDealId: status === "converted" ? "deal-2" : null,
    createdBy: sales,
    createdAt: ago(updatedMinutes + 4000),
    updatedAt: ago(updatedMinutes),
  };
}

const leads: CrmLead[] = [
  lead(1, "Acme line upgrade", "qualified", 850000, "company-acme", sales, 35),
  lead(2, "Kaveri dyeing sensors", "contacted", 240000, "company-kaveri", sales, 190),
  lead(3, "Northwind pump controllers", "new", 120000, "company-northwind", nobody, 900),
  lead(4, "Sahyadri cold-chain monitoring", "converted", 560000, "company-sahyadri", sales, 2900),
  lead(5, "Cable harness enquiry", "unqualified", null, null, owner, 7200),
];

function deal(
  number: number,
  title: string,
  stage: CrmDeal["stage"],
  amount: number,
  companyId: string,
  dealOwner: BusinessActor,
): CrmDeal {
  const closed = stage === "won" || stage === "lost";
  const linked = contacts.find((row) => row.companyId === companyId);
  return {
    id: `deal-${number}`,
    spaceId: "space-demo",
    number,
    ref: `D-${number}`,
    title,
    stage,
    amount,
    currency: "INR",
    expectedCloseAt: closed ? null : ahead(14 * number),
    closedAt: closed ? ago(1500 * number) : null,
    notes: null,
    companyId,
    companyName: companies.find((row) => row.id === companyId)?.name ?? null,
    contactId: linked?.id ?? null,
    contactName: linked?.name ?? null,
    sourceLeadId: number === 2 ? "lead-4" : null,
    owner: dealOwner,
    createdBy: sales,
    createdAt: ago(9000),
    updatedAt: ago(60 * number),
  };
}

const deals: CrmDeal[] = [
  deal(1, "Acme line upgrade", "proposal", 850000, "company-acme", sales),
  deal(2, "Sahyadri cold-chain monitoring", "negotiation", 560000, "company-sahyadri", sales),
  deal(3, "Kaveri annual maintenance", "qualification", 180000, "company-kaveri", owner),
  deal(4, "Northwind retrofit", "won", 320000, "company-northwind", sales),
  deal(5, "Bharat Motors pilot", "lost", 90000, "company-bharat", owner),
];

function activity(
  id: string,
  kind: CrmActivity["kind"],
  subject: string,
  dueAt: string | null,
  completedAt: string | null,
  companyId: string,
  assignee: BusinessActor,
  createdMinutes: number,
): CrmActivity {
  return {
    id,
    spaceId: "space-demo",
    kind,
    subject,
    body: null,
    dueAt,
    completedAt,
    companyId,
    contactId: null,
    leadId: null,
    dealId: null,
    assignee,
    createdBy: assignee.botId ? assignee : owner,
    createdAt: ago(createdMinutes),
    updatedAt: ago(createdMinutes),
  };
}

const activities: CrmActivity[] = [
  activity(
    "act-1",
    "follow_up",
    "Send revised quotation to Acme",
    ahead(1),
    null,
    "company-acme",
    sales,
    50,
  ),
  activity(
    "act-2",
    "email",
    "Share CTRL-200 datasheet",
    ago(1440),
    null,
    "company-kaveri",
    sales,
    3000,
  ),
  activity(
    "act-3",
    "meeting",
    "Plant visit at Kaveri",
    ahead(5),
    null,
    "company-kaveri",
    owner,
    400,
  ),
  activity(
    "act-4",
    "call",
    "Discovery call with Priya",
    null,
    ago(200),
    "company-acme",
    sales,
    260,
  ),
  activity(
    "act-5",
    "note",
    "Northwind prefers quarterly billing",
    null,
    null,
    "company-northwind",
    owner,
    5000,
  ),
];

function product(
  id: string,
  sku: string,
  name: string,
  unitPrice: number,
  stockOnHand: number,
  active = true,
): ErpProduct {
  return {
    id,
    spaceId: "space-demo",
    sku,
    name,
    description: null,
    unitPrice,
    currency: "INR",
    active,
    stockOnHand,
    hsnCode: "85365090",
    createdBy: operations,
    createdAt: ago(9000),
    updatedAt: ago(700),
  };
}

const products: ErpProduct[] = [
  product("product-sensor", "SENSOR-X1", "Industrial temperature sensor", 4500, 42),
  product("product-ctrl", "CTRL-200", "PLC controller, 200 series", 38500, 3),
  product("product-cable", "CABLE-5M", "Shielded sensor cable, 5 m", 650, 260),
  product("product-relay", "RELAY-24V", "Relay module, 24 V", 1200, 0),
  product("product-panel", "PANEL-IP65", "IP65 control panel enclosure", 15800, 8),
  product("product-legacy", "SENSOR-X0", "Temperature sensor, first generation", 3900, 0, false),
];

const adjustments: InventoryAdjustment[] = [
  {
    id: "adj-3",
    productId: "product-ctrl",
    sku: "CTRL-200",
    productName: "PLC controller, 200 series",
    delta: -2,
    quantityAfter: 3,
    reason: "Damaged in transit",
    orderId: null,
    createdBy: operations,
    createdAt: ago(95),
  },
  {
    id: "adj-2",
    productId: "product-sensor",
    sku: "SENSOR-X1",
    productName: "Industrial temperature sensor",
    delta: -8,
    quantityAfter: 42,
    reason: "Delivered on SO-3",
    orderId: "order-3",
    createdBy: operations,
    createdAt: ago(1300),
  },
  {
    id: "adj-1",
    productId: "product-sensor",
    sku: "SENSOR-X1",
    productName: "Industrial temperature sensor",
    delta: 50,
    quantityAfter: 50,
    reason: "Opening stock",
    orderId: null,
    createdBy: owner,
    createdAt: ago(9000),
  },
];

function order(
  number: number,
  status: ErpSalesOrder["status"],
  companyId: string,
  lines: [string, number][],
  invoiceId: string | null = null,
): ErpSalesOrder {
  const orderLines = lines.map(([productId, quantity], position) => {
    const item = products.find((row) => row.id === productId)!;
    return {
      id: `order-${number}-line-${position}`,
      productId,
      sku: item.sku,
      description: item.name,
      quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.unitPrice * quantity,
      position,
    };
  });
  const requested = status !== "draft" && status !== "cancelled";
  const approved = status === "approved" || status === "confirmed";
  return {
    id: `order-${number}`,
    spaceId: "space-demo",
    number,
    ref: `SO-${number}`,
    status,
    currency: "INR",
    subtotal: orderLines.reduce((sum, line) => sum + line.lineTotal, 0),
    notes: number === 2 ? "Deliver before the monsoon shutdown" : null,
    companyId,
    companyName: companies.find((row) => row.id === companyId)?.name ?? null,
    contactId: null,
    contactName: null,
    dealId: number === 2 ? "deal-2" : null,
    invoiceId,
    lines: orderLines,
    approvalRequestedAt: requested ? ago(120) : null,
    approvedAt: approved ? ago(100) : null,
    approvedBy: approved ? owner : nobody,
    // Confirmations spread over recent months, so the sales chart has a history.
    confirmedAt: status === "confirmed" ? ago(90 + (number - 3) * 60 * 24 * 12) : null,
    cancelledAt: status === "cancelled" ? ago(4000) : null,
    createdBy: operations,
    createdAt: ago(200 * number),
    updatedAt: ago(30 * number),
  };
}

const orders: ErpSalesOrder[] = [
  order(1, "draft", "company-acme", [
    ["product-sensor", 10],
    ["product-cable", 10],
  ]),
  order(2, "pending_approval", "company-sahyadri", [
    ["product-ctrl", 2],
    ["product-sensor", 8],
  ]),
  order(3, "confirmed", "company-northwind", [["product-ctrl", 4]], "invoice-1"),
  order(4, "confirmed", "company-kaveri", [["product-cable", 40]], "invoice-2"),
  order(5, "approved", "company-acme", [["product-panel", 2]]),
  order(6, "cancelled", "company-bharat", [["product-relay", 5]]),
  order(7, "confirmed", "company-acme", [["product-sensor", 12]], "invoice-3"),
];

function invoice(
  number: number,
  orderNumber: number,
  status: ErpInvoice["status"],
  amountPaid: number,
): ErpInvoice {
  const source = orders.find((row) => row.number === orderNumber)!;
  const paymentStatus =
    amountPaid <= 0 ? "unpaid" : amountPaid >= source.subtotal ? "paid" : "partial";
  return {
    id: `invoice-${number}`,
    spaceId: "space-demo",
    number,
    ref: `INV-${number}`,
    status,
    paymentStatus,
    currency: "INR",
    subtotal: source.subtotal,
    total: source.subtotal,
    amountPaid,
    notes: null,
    orderId: source.id,
    orderRef: source.ref,
    companyId: source.companyId,
    companyName: source.companyName,
    lines: source.lines.map((line) => ({
      id: `invoice-${number}-${line.id}`,
      productId: line.productId,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      lineTotal: line.lineTotal,
      position: line.position,
    })),
    issuedAt: status === "draft" ? null : ago(80),
    dueAt: status === "draft" ? null : ahead(30),
    paidAt: paymentStatus === "paid" ? ago(40) : null,
    approvedBy: status === "draft" ? nobody : owner,
    createdBy: finance,
    createdAt: ago(85),
    updatedAt: ago(40),
  };
}

const invoices: ErpInvoice[] = [
  invoice(1, 3, "issued", 50000),
  invoice(2, 4, "draft", 0),
  invoice(3, 7, "paid", 54000),
];

const settings: BusinessSettings = {
  spaceId: "space-demo",
  currency: "INR",
  allowNegativeStock: false,
  orderApprovalRequired: true,
  invoiceApprovalRequired: true,
  updatedAt: ago(9000),
};

const environment: BusinessEnvironment | null =
  params.get("environment") === "none"
    ? null
    : {
        id: "env-demo",
        organizationId: "org-demo",
        provider: "frappe",
        blueprintId: "india-smb",
        blueprintVersion: 1,
        siteUrl: "http://erp.example.test",
        siteName: "erp.example.test",
        companyName: "Savingroup Demo Pvt Ltd",
        companyAbbr: "RDPL",
        country: "India",
        currency: "INR",
        status: "active",
        installedApps: ["frappe", "erpnext", "crm", "india_compliance"],
        lastVerifiedAt: ago(12),
        lastError: null,
        createdAt: ago(9000),
        updatedAt: ago(12),
      };

function history(recordType: string): BusinessHistoryEntry[] {
  const entry = (
    id: string,
    actionId: string,
    actor: BusinessActor,
    minutes: number,
    outcome: BusinessHistoryEntry["outcome"] = "succeeded",
    input: BusinessHistoryEntry["input"] = {},
  ): BusinessHistoryEntry => ({
    id,
    actionId,
    outcome,
    errorCode: outcome === "failed" ? "invalid_input" : null,
    actor,
    runId: actor.botId ? `run-${id}` : null,
    input,
    createdAt: ago(minutes),
  });
  if (recordType === "order") {
    return [
      entry("h-4", "erp.order.request_approval", operations, 120),
      entry("h-3", "erp.order.add_item", operations, 125),
      entry("h-2", "erp.order.confirm", operations, 128, "failed"),
      entry("h-1", "erp.order.create_draft", operations, 130),
    ];
  }
  if (recordType === "invoice") {
    return [
      entry("h-3", "erp.invoice.record_payment", owner, 60),
      entry("h-2", "erp.invoice.issue", owner, 80),
      entry("h-1", "erp.invoice.create_draft", finance, 85),
    ];
  }
  return [
    entry("h-3", "crm.lead.qualify", sales, 35, "succeeded", { status: "qualified" }),
    entry("h-2", "crm.lead.assign", owner, 300),
    entry("h-1", "crm.lead.create", sales, 4035),
  ];
}

const overviews: Record<string, unknown> = {
  "crm/overview": {
    companies: companies.length,
    contacts: contacts.length,
    openLeads: leads.filter((row) => ["new", "contacted", "qualified"].includes(row.status)).length,
    openDeals: deals.filter((row) => row.stage !== "won" && row.stage !== "lost").length,
    openDealAmount: deals
      .filter((row) => row.stage !== "won" && row.stage !== "lost")
      .reduce((sum, row) => sum + row.amount, 0),
    wonDealAmount: deals
      .filter((row) => row.stage === "won")
      .reduce((sum, row) => sum + row.amount, 0),
    openFollowUps: activities.filter((row) => row.dueAt && !row.completedAt).length,
    currency: "INR",
  },
  "erp/overview": {
    products: products.filter((row) => row.active).length,
    lowStockProducts: products.filter((row) => row.active && row.stockOnHand <= 5).length,
    draftOrders: orders.filter((row) => row.status === "draft").length,
    pendingApprovalOrders: orders.filter((row) => row.status === "pending_approval").length,
    confirmedOrders: orders.filter((row) => row.status === "confirmed").length,
    confirmedOrderAmount: orders
      .filter((row) => row.status === "confirmed")
      .reduce((sum, row) => sum + row.subtotal, 0),
    draftInvoices: invoices.filter((row) => row.status === "draft").length,
    outstandingInvoiceAmount: invoices
      .filter((row) => row.status === "issued")
      .reduce((sum, row) => sum + row.total - row.amountPaid, 0),
    currency: "INR",
  },
};

/* Bot threads: one conversation per bot. A send or an answer streams its events
   to open subscriptions the way the API's live feed does, and a bot's change to a
   record reaches the pages through the business stream. */

type Listeners = Set<ReadableStreamDefaultController<Uint8Array>>;
const encoder = new TextEncoder();
const businessListeners: Listeners = new Set();

function openStream(listeners: Listeners): Response {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(next) {
      controller = next;
      listeners.add(next);
    },
    cancel() {
      if (controller) listeners.delete(controller);
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

function publish(listeners: Listeners, value: unknown) {
  const frame = encoder.encode(`event: message\ndata: ${JSON.stringify({ json: value })}\n\n`);
  for (const listener of listeners) {
    try {
      listener.enqueue(frame);
    } catch {
      listeners.delete(listener);
    }
  }
}

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const text = (value: string): MessageBlock => ({ kind: "text", text: value });

type FixtureThread = { botId: string; snapshot: ThreadSnapshot; listeners: Listeners };
const threads = new Map<string, FixtureThread>();

function startedRun(botId: string, id: string, status: Run["status"], minutes: number): Run {
  return {
    id,
    botId,
    threadId: `thread-${botId}`,
    taskId: `task-${id}`,
    status,
    trigger: "user",
    routineId: null,
    modelProvider: null,
    modelId: null,
    error: null,
    startedAt: ago(minutes),
    completedAt: null,
    createdAt: ago(minutes),
  };
}

function seedThread(botId: string): FixtureThread {
  const threadId = `thread-${botId}`;
  const messages: ThreadMessage[] = [];
  let run: Run | null = null;
  const add = (role: ThreadMessage["role"], blocks: MessageBlock[], minutes: number) =>
    messages.push({
      id: `${threadId}-m${messages.length + 1}`,
      threadId,
      seq: messages.length + 1,
      role,
      blocks,
      ...(role === "bot" ? { botId } : {}),
      ...(run ? { runId: run.id } : {}),
      createdAt: ago(minutes),
    });
  if (botId === "bot-operator") {
    const order = orders.find((row) => row.ref === "SO-2")!;
    const unpaid = invoices.find((row) => row.ref === "INV-1")!;
    add("user", [text("What needs my approval today?")], 14);
    add(
      "bot",
      [
        text(
          `Two things are waiting on you:\n\n- **SO-2** · ${order.companyName}, ${inr.format(order.subtotal)}: Operations asked for approval.\n- **INV-1** · ${unpaid.companyName}: ${inr.format(unpaid.total - unpaid.amountPaid)} still outstanding.\n\nShall I approve SO-2?`,
        ),
      ],
      13,
    );
    // ?assistant=approval leaves the Operator paused on an approval card.
    if (params.get("assistant") === "approval") {
      add("user", [text("Yes, approve SO-2.")], 2);
      run = startedRun(botId, "run-approve", "waiting_input", 2);
      add(
        "bot",
        [
          {
            kind: "ask",
            text: "Review before erp_order_approve",
            approvalEffectId: "effect-approve",
            status: "pending",
            actions: [
              { id: "allow", label: "Allow once" },
              { id: "always", label: "Always allow this tool" },
              { id: "deny", label: "Deny" },
            ],
          },
        ],
        2,
      );
    }
  }
  return {
    botId,
    listeners: new Set(),
    snapshot: {
      threadId,
      cursor: messages.length,
      botId,
      messages,
      olderCursor: null,
      run,
      activeRuns: run ? [run] : [],
    },
  };
}

function threadFor(botId: string): FixtureThread {
  let thread = threads.get(botId);
  if (!thread) {
    thread = seedThread(botId);
    threads.set(botId, thread);
  }
  return thread;
}

function emit(
  thread: FixtureThread,
  type: ProductEvent["type"],
  payload: Record<string, unknown>,
  runId?: string,
) {
  const seq = thread.snapshot.cursor + 1;
  thread.snapshot = { ...thread.snapshot, cursor: seq };
  publish(thread.listeners, {
    id: `${thread.snapshot.threadId}-e${seq}`,
    spaceId: "space-demo",
    threadId: thread.snapshot.threadId,
    botId: thread.botId,
    seq,
    type,
    ...(runId ? { runId } : {}),
    createdAt: new Date().toISOString(),
    payload,
  } satisfies ProductEvent);
}

function post(
  thread: FixtureThread,
  role: ThreadMessage["role"],
  blocks: MessageBlock[],
  runId?: string,
): ThreadMessage {
  const seq = thread.snapshot.cursor + 1;
  const message: ThreadMessage = {
    id: `${thread.snapshot.threadId}-m${seq}`,
    threadId: thread.snapshot.threadId,
    seq,
    role,
    blocks,
    ...(role === "bot" ? { botId: thread.botId } : {}),
    ...(runId ? { runId } : {}),
    createdAt: new Date().toISOString(),
  };
  thread.snapshot = { ...thread.snapshot, messages: [...thread.snapshot.messages, message] };
  emit(thread, "thread.message.created", { messageId: message.id, role, blocks }, runId);
  return message;
}

function finishRun(thread: FixtureThread, runId: string) {
  thread.snapshot = { ...thread.snapshot, run: null, activeRuns: [] };
  emit(thread, "run.completed", {}, runId);
}

/** A short scripted answer: a drafted email for a lead, otherwise a quick check. */
function replyTo(request: string): string {
  const leadRef = /^Lead (\S+)/.exec(request)?.[1];
  const lead = leads.find((row) => row.ref === leadRef);
  if (lead && /follow-up email/i.test(request)) {
    const contact = contacts.find((row) => row.companyId === lead.companyId);
    return `Here is a follow-up for **${lead.ref}**:\n\n> **Subject:** ${lead.title}, next steps\n>\n> Hi ${contact?.firstName ?? "there"}, thanks for showing us around last week. SENSOR-X1 with the CTRL-200 controller fits what you described, and we can start with a pilot on two lines. Could we take 20 minutes on Thursday to agree the quote?\n\nShall I log it as an email activity on ${lead.ref}?`;
  }
  return "I checked the records. Nothing else needs you right now.";
}

function sendToBot(input: Input) {
  const thread = threadFor(String(input.botId));
  const request = String(input.text ?? "");
  const sent = post(thread, "user", [text(request)]);
  const run = startedRun(thread.botId, `run-${sent.seq}`, "running", 0);
  thread.snapshot = { ...thread.snapshot, run, activeRuns: [run] };
  emit(thread, "run.started", { trigger: "user" }, run.id);
  setTimeout(() => {
    post(thread, "bot", [text(replyTo(request))], run.id);
    finishRun(thread, run.id);
  }, 900);
  return { taskId: run.taskId, runId: run.id, seq: sent.seq };
}

function answerBot(input: Input) {
  const thread = threadFor(String(input.botId));
  const runId = String(input.runId);
  const answer = String(input.answer);
  const asked = thread.snapshot.messages.find((message) => message.id === input.messageId);
  if (!asked) return { ok: true };
  const blocks = asked.blocks.map((block) =>
    block.kind === "ask" ? { ...block, status: "answered" as const, answer } : block,
  );
  const running = thread.snapshot.run
    ? { ...thread.snapshot.run, status: "running" as const }
    : null;
  thread.snapshot = {
    ...thread.snapshot,
    messages: thread.snapshot.messages.map((message) =>
      message.id === asked.id ? { ...message, blocks } : message,
    ),
    run: running,
    activeRuns: running ? [running] : [],
  };
  emit(thread, "thread.message.updated", { messageId: asked.id, role: "bot", blocks }, runId);
  setTimeout(() => {
    if (answer === "deny") {
      post(thread, "bot", [text("Left **SO-2** waiting for your approval.")], runId);
    } else {
      const index = orders.findIndex((row) => row.ref === "SO-2");
      const at = new Date().toISOString();
      orders[index] = {
        ...orders[index]!,
        status: "approved",
        approvedAt: at,
        approvedBy: { userId: null, botId: thread.botId, name: "Operator" },
        updatedAt: at,
      };
      publish(businessListeners, {
        spaceId: "space-demo",
        type: "erp.order.approved",
        recordType: "order",
        recordId: "order-2",
        createdAt: at,
      } satisfies BusinessChange);
      post(
        thread,
        "bot",
        [text("**SO-2** is approved. Operations can confirm it once the stock is picked.")],
        runId,
      );
    }
    finishRun(thread, runId);
  }, 600);
  return { ok: true };
}

type Input = Record<string, unknown>;

function respond(path: string, input: Input): unknown {
  if (path in overviews) return overviews[path];
  switch (path) {
    case "threads/get":
      return threadFor(String(input.botId)).snapshot;
    case "threads/head": {
      const { snapshot } = threadFor(String(input.botId));
      return { threadId: snapshot.threadId, cursor: snapshot.cursor };
    }
    case "threads/messages":
      return {
        threadId: threadFor(String(input.botId)).snapshot.threadId,
        messages: [],
        olderCursor: null,
      };
    case "threads/send":
      return sendToBot(input);
    case "threads/answer":
      return answerBot(input);
    case "threads/stop": {
      const thread = threadFor(String(input.botId));
      if (thread.snapshot.run) finishRun(thread, thread.snapshot.run.id);
      return { ok: true };
    }
    case "threads/markRead":
      return { ok: true };
    case "bots/list":
      return bots;
    case "business/settings":
      return settings;
    case "business/environment/get":
      return environment;
    case "business/history":
      return history(String(input.recordType ?? ""));
    case "crm/companies/list":
      return { companies };
    case "crm/contacts/list":
      return { contacts };
    case "crm/leads/list":
      return { leads: leads.filter((row) => !input.status || row.status === input.status) };
    case "crm/deals/list":
      return { deals };
    case "crm/activities/list":
      return { activities };
    case "erp/products/list":
      return { products: products.filter((row) => input.includeInactive || row.active) };
    case "erp/inventory/adjustments":
      return adjustments;
    case "erp/orders/list":
      return { orders: orders.filter((row) => !input.status || row.status === input.status) };
    case "erp/orders/get":
      return orders.find((row) => row.id === input.id) ?? orders[0];
    case "erp/invoices/list":
      return { invoices };
    case "erp/invoices/get":
      return invoices.find((row) => row.id === input.id) ?? invoices[0];
    default:
      // Writes echo their input; the pages reload their lists afterwards.
      return { id: "written", ...input };
  }
}

const realFetch = window.fetch.bind(window);
window.fetch = async (resource, init) => {
  const request = new Request(resource, init);
  const url = new URL(request.url, location.origin);
  if (!url.pathname.startsWith("/rpc/")) return realFetch(resource, init);
  const path = url.pathname.slice("/rpc/".length);
  const raw = await request.text();
  const input = (raw ? (JSON.parse(raw) as { json?: Input }) : {}).json ?? {};
  if (path === "business/subscribe") return openStream(businessListeners);
  if (path === "threads/subscribe") return openStream(threadFor(String(input.botId)).listeners);
  return new Response(JSON.stringify({ json: respond(path, input) }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

const path = params.get("path") ?? "/app/crm";

void bootstrapI18n("en").then(() => {
  createRoot(document.getElementById("root")!).render(
    <I18nProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/app" element={<main data-testid="savingroup-home" />} />
          <Route path="/app/crm" element={<CrmPage />} />
          <Route path="/app/erp" element={<ErpPage />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
});
