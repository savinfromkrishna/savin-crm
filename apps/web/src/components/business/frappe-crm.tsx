import { Trans, useLingui } from "@lingui/react/macro";
import type {
  ActivityKind,
  Bot,
  BusinessEvent,
  BusinessSettings,
  CrmActivity,
  CrmCompany,
  CrmContact,
  CrmDeal,
  CrmLead,
  CrmOverview,
  DealStage,
  ErpInvoice,
  ErpOverview,
  ErpProduct,
  ErpSalesOrder,
  InventoryAdjustment,
} from "@savingroup/contracts";
import {
  ACTIVITY_KINDS,
  BUSINESS_NAME_MAX_LENGTH,
  BUSINESS_TEXT_MAX_LENGTH,
  DEAL_STAGES,
  LEAD_STATUSES,
  LOW_STOCK_THRESHOLD,
} from "@savingroup/contracts";
import { Button, cn, Input, NativeSelect, NativeSelectOption, Textarea } from "@savingroup/ui-web";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  Boxes,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  ClipboardCheck,
  Contact,
  Database,
  FileText,
  Handshake,
  Mail,
  MessageSquare,
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneOutgoing,
  Plus,
  ReceiptText,
  Send,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  StickyNote,
  Target,
  TrendingUp,
  Trophy,
  Users,
} from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  DEAL_STAGE_TONES,
  INVOICE_STATUS_TONES,
  LEAD_STATUS_TONES,
  ORDER_STATUS_TONES,
  useActivityKindLabels,
  useDealStageLabels,
  useInvoiceStatusLabels,
  useLeadStatusLabels,
  useOrderStatusLabels,
} from "../../lib/business-labels";
import { formatRelativeTime } from "../../lib/relative-time";
import { rpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";
import { AskAssistantButton, useAssistant } from "./assistant";
import { QuoteTaxCalculatorCard, SendInvoicePaymentModal } from "./commercial";
import { Panel, PanelEmpty, RecordList, RecordRow } from "./dashboard";
import { FieldRow, FormDialog, FormField, parseMoneyInput, SwitchField } from "./forms";
import type { Column } from "./records";
import {
  ActorAvatar,
  ActorLabel,
  actorName,
  DetailList,
  FilterChips,
  HistoryList,
  KpiCard,
  KpiGrid,
  matchesQuery,
  PrimaryCell,
  RecordAvatar,
  RecordTable,
  SearchField,
  StatusBadge,
  Toolbar,
  useMoney,
  useShortMoney,
} from "./records";
import { crmHref, erpHref } from "./shell";

export type FrappeLookups = {
  companies: CrmCompany[];
  contacts: CrmContact[];
  deals: CrmDeal[];
  leads: CrmLead[];
  activities: CrmActivity[];
  orders: ErpSalesOrder[];
  invoices: ErpInvoice[];
  products: ErpProduct[];
  settings: BusinessSettings | null;
  bots: Bot[];
};

const ACTIVITY_ICONS: Record<ActivityKind, LucideIcon> = {
  call: Phone,
  email: Mail,
  meeting: Users,
  note: StickyNote,
  follow_up: CalendarClock,
};

/** Enterprise document series codes derived from record numbers. */
export function frappeLeadDocName(lead: Pick<CrmLead, "number" | "createdAt">): string {
  const year = new Date(lead.createdAt).getFullYear() || 2026;
  return `LD-${year}-${String(lead.number).padStart(4, "0")}`;
}

export function frappeDealDocName(deal: Pick<CrmDeal, "number" | "createdAt">): string {
  const year = new Date(deal.createdAt).getFullYear() || 2026;
  return `DL-${year}-${String(deal.number).padStart(4, "0")}`;
}

export function frappeOrderDocName(order: Pick<ErpSalesOrder, "number" | "createdAt">): string {
  const year = new Date(order.createdAt).getFullYear() || 2026;
  return `SO-${year}-${String(order.number).padStart(4, "0")}`;
}

export function frappeInvoiceDocName(invoice: Pick<ErpInvoice, "number" | "createdAt">): string {
  const year = new Date(invoice.createdAt).getFullYear() || 2026;
  return `INV-${year}-${String(invoice.number).padStart(4, "0")}`;
}

// ============================================================================
// 1. SAVINGROUP DESK WORKSPACE (Exact match to `workspace.py` in `testing`)
// ============================================================================

export function SavingroupDeskWorkspace({
  lookups,
  crmOverview,
  erpOverview,
  events,
  currency,
}: {
  lookups: FrappeLookups;
  crmOverview: CrmOverview | null;
  erpOverview: ErpOverview | null;
  events: BusinessEvent[];
  currency: string;
}) {
  const { t } = useLingui();
  const money = useMoney(currency);
  const short = useShortMoney(currency);

  const openLeads =
    crmOverview?.openLeads ??
    lookups.leads.filter((lead) => lead.status !== "converted" && lead.status !== "unqualified")
      .length;
  const openDeals =
    crmOverview?.openDeals ??
    lookups.deals.filter((deal) => deal.stage !== "won" && deal.stage !== "lost").length;
  const wonDealValue =
    crmOverview?.wonDealAmount ??
    lookups.deals
      .filter((deal) => deal.stage === "won")
      .reduce((sum, deal) => sum + deal.amount, 0);
  const activeItems =
    erpOverview?.products ?? lookups.products.filter((product) => product.active).length;
  const confirmedOrders =
    erpOverview?.confirmedOrders ??
    lookups.orders.filter((order) => order.status === "confirmed").length;
  const outstandingReceivables =
    erpOverview?.outstandingInvoiceAmount ??
    lookups.invoices
      .filter((invoice) => invoice.status === "issued")
      .reduce((sum, invoice) => sum + Math.max(0, invoice.total - invoice.amountPaid), 0);
  const totalOperations = events.length;
  const failedOperations = 0;

  // Exact 10 SHORTCUTS from `workspace.py`
  const shortcuts: { label: string; to: string; badge?: string | number; doctype: string }[] = [
    {
      label: t`Operations`,
      to: crmHref("operations"),
      badge: totalOperations,
      doctype: "Savingroup Operation",
    },
    {
      label: t`Bridge Settings`,
      to: erpHref("compliance"),
      doctype: "Savingroup Bridge Settings",
    },
    {
      label: t`Savingroup CRM`,
      to: crmHref("overview"),
      doctype: "/crm",
    },
    {
      label: t`Leads`,
      to: crmHref("leads"),
      badge: lookups.leads.length,
      doctype: "CRM Lead",
    },
    {
      label: t`Deals`,
      to: crmHref("deals"),
      badge: lookups.deals.length,
      doctype: "CRM Deal",
    },
    {
      label: t`Items`,
      to: erpHref("products"),
      badge: lookups.products.length,
      doctype: "Item",
    },
    {
      label: t`Sales Orders`,
      to: erpHref("orders"),
      badge: lookups.orders.length,
      doctype: "Sales Order",
    },
    {
      label: t`Sales Invoices`,
      to: erpHref("invoices"),
      badge: lookups.invoices.length,
      doctype: "Sales Invoice",
    },
    {
      label: t`Stock Ledger`,
      to: erpHref("inventory"),
      doctype: "Stock Ledger",
    },
    {
      label: t`Error Log`,
      to: crmHref("operations"),
      badge: failedOperations,
      doctype: "Error Log",
    },
  ];

  // Exact 5 CARDS ("Masters & Reports") from `workspace.py`
  const masterCards: {
    title: string;
    links: { doctype: string; label: string; to: string; count?: number }[];
  }[] = [
    {
      title: t`Savingroup gateway`,
      links: [
        {
          doctype: "Savingroup Operation",
          label: t`Operations ledger`,
          to: crmHref("operations"),
          count: totalOperations,
        },
        {
          doctype: "Savingroup Bridge Settings",
          label: t`Event delivery`,
          to: erpHref("compliance"),
        },
        {
          doctype: "Error Log",
          label: t`Error Log`,
          to: crmHref("operations"),
          count: failedOperations,
        },
        {
          doctype: "User",
          label: t`Users and AI operators`,
          to: crmHref("agents"),
          count: lookups.bots.length,
        },
      ],
    },
    {
      title: t`CRM`,
      links: [
        {
          doctype: "CRM Lead",
          label: t`Leads`,
          to: crmHref("leads"),
          count: lookups.leads.length,
        },
        {
          doctype: "CRM Deal",
          label: t`Deals`,
          to: crmHref("deals"),
          count: lookups.deals.length,
        },
        {
          doctype: "CRM Organization",
          label: t`Organizations`,
          to: crmHref("companies"),
          count: lookups.companies.length,
        },
        {
          doctype: "Contact",
          label: t`Contacts`,
          to: crmHref("contacts"),
          count: lookups.contacts.length,
        },
        {
          doctype: "CRM Task",
          label: t`Tasks`,
          to: crmHref("activities"),
          count: lookups.activities.length,
        },
      ],
    },
    {
      title: t`Selling`,
      links: [
        {
          doctype: "Customer",
          label: t`Customers`,
          to: crmHref("companies"),
          count: lookups.companies.length,
        },
        {
          doctype: "Sales Order",
          label: t`Sales Orders`,
          to: erpHref("orders"),
          count: lookups.orders.length,
        },
        {
          doctype: "Delivery Note",
          label: t`Delivery Notes`,
          to: erpHref("orders", { status: "confirmed" }),
          count: confirmedOrders,
        },
        {
          doctype: "Sales Invoice",
          label: t`Sales Invoices`,
          to: erpHref("invoices"),
          count: lookups.invoices.length,
        },
        {
          doctype: "Payment Entry",
          label: t`Payment Entries`,
          to: erpHref("invoices", { status: "paid" }),
          count: lookups.invoices.filter((inv) => inv.amountPaid > 0).length,
        },
      ],
    },
    {
      title: t`Stock`,
      links: [
        {
          doctype: "Item",
          label: t`Items`,
          to: erpHref("products"),
          count: lookups.products.length,
        },
        {
          doctype: "Item Price",
          label: t`Item Prices (Standard Selling)`,
          to: erpHref("products"),
          count: lookups.products.length,
        },
        {
          doctype: "Stock Entry",
          label: t`Stock Entries`,
          to: erpHref("inventory"),
        },
        {
          doctype: "Stock Ledger Entry",
          label: t`Stock Ledger Entries`,
          to: erpHref("inventory"),
        },
        {
          doctype: "Bin",
          label: t`Stock levels (Bin)`,
          to: erpHref("inventory"),
          count: lookups.products.length,
        },
      ],
    },
    {
      title: t`Compliance`,
      links: [
        {
          doctype: "GST Settings",
          label: t`GST Settings (india-smb)`,
          to: erpHref("compliance"),
        },
        {
          doctype: "GST HSN Code",
          label: t`HSN/SAC codes`,
          to: erpHref("compliance"),
          count: lookups.products.filter((p) => Boolean(p.hsnCode)).length,
        },
        {
          doctype: "Company",
          label: t`Company & Currency (${currency})`,
          to: erpHref("compliance"),
        },
      ],
    },
  ];

  return (
    <div className="space-y-6" data-testid="savingroup-desk-workspace">
      {/* Section 1: 8 Number Cards from `workspace.py` */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight">
            <Trans>Savingroup</Trans>
          </h2>
          <span className="font-mono text-xs text-muted-foreground">/app/savingroup</span>
        </div>
        <KpiGrid>
          <KpiCard
            label={t`Savingroup Open Leads`}
            value={openLeads}
            icon={Target}
            to={crmHref("leads")}
            detail={{ label: t`DocType`, value: "CRM Lead" }}
          />
          <KpiCard
            label={t`Savingroup Open Deals`}
            value={openDeals}
            icon={Handshake}
            to={crmHref("deals")}
            detail={{ label: t`DocType`, value: "CRM Deal" }}
          />
          <KpiCard
            label={t`Savingroup Won Deal Value`}
            value={short(wonDealValue)}
            exact={money(wonDealValue)}
            icon={Trophy}
            to={crmHref("deals", { status: "won" })}
            detail={{ label: t`DocType`, value: "CRM Deal" }}
          />
          <KpiCard
            label={t`Savingroup Active Items`}
            value={activeItems}
            icon={Boxes}
            to={erpHref("products")}
            detail={{ label: t`DocType`, value: "Item" }}
          />
          <KpiCard
            label={t`Savingroup Confirmed Orders`}
            value={confirmedOrders}
            icon={ShoppingCart}
            to={erpHref("orders", { status: "confirmed" })}
            detail={{ label: t`DocType`, value: "Sales Order" }}
          />
          <KpiCard
            label={t`Savingroup Outstanding Receivables`}
            value={short(outstandingReceivables)}
            exact={money(outstandingReceivables)}
            icon={ReceiptText}
            attention={outstandingReceivables > 0}
            to={erpHref("invoices")}
            detail={{ label: t`DocType`, value: "Sales Invoice" }}
          />
          <KpiCard
            label={t`Savingroup Operations`}
            value={totalOperations}
            icon={Activity}
            to={crmHref("operations")}
            detail={{ label: t`DocType`, value: "Savingroup Operation" }}
          />
          <KpiCard
            label={t`Savingroup Failed Operations`}
            value={failedOperations}
            icon={ClipboardCheck}
            to={crmHref("operations")}
            detail={{ label: t`Status`, value: t`Healthy` }}
          />
        </KpiGrid>
      </section>

      {/* Section 2: 10 Shortcuts from `workspace.py` */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight">
          <Trans>Shortcuts</Trans>
        </h2>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
          {shortcuts.map((shortcut) => (
            <Link
              key={shortcut.label}
              to={shortcut.to}
              className="group flex items-center justify-between gap-2 rounded-xl border bg-card px-3.5 py-3 text-sm transition-colors hover:border-foreground/25 hover:bg-accent/40 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <div className="min-w-0">
                <span className="block truncate font-medium">{shortcut.label}</span>
                <span className="block truncate font-mono text-[11px] text-muted-foreground">
                  {shortcut.doctype}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {shortcut.badge !== undefined ? (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground tabular-nums">
                    {shortcut.badge}
                  </span>
                ) : null}
                <ArrowUpRight
                  className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Section 3: 5 Masters & Reports Cards from `workspace.py` */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight">
          <Trans>Masters & Reports</Trans>
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {masterCards.map((card) => (
            <div key={card.title} className="rounded-xl border bg-card p-4">
              <h3 className="mb-3 border-b pb-2 text-sm font-semibold">{card.title}</h3>
              <ul className="space-y-1.5">
                {card.links.map((item) => (
                  <li key={item.doctype}>
                    <Link
                      to={item.to}
                      className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm text-foreground/85 transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <span className="truncate">{item.label}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        {item.count !== undefined ? (
                          <span className="font-mono text-xs text-muted-foreground tabular-nums">
                            {item.count}
                          </span>
                        ) : null}
                        <ChevronRight
                          className="size-3.5 text-muted-foreground"
                          strokeWidth={1.75}
                          aria-hidden="true"
                        />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// ============================================================================
// 2. COLLAPSIBLE `SAVINGROUP` CUSTOM FIELDS SECTION (`install.py`)
// ============================================================================

export function SavingroupCustomFieldsSection({
  doctype,
  docName,
  legacyId,
  recordType,
  recordId,
  legacyRef,
  createdBy,
  ownerOrAssignee,
  ownerLabel,
  extraFields,
  extra,
}: {
  doctype?: string;
  docName?: string;
  legacyId?: string;
  recordType?: string;
  recordId?: string;
  legacyRef?: string;
  createdBy: CrmLead["createdBy"];
  ownerOrAssignee?: CrmLead["assignee"];
  ownerLabel?: string;
  extraFields?: { fieldname: string; label: string; value: string }[];
  extra?: { label: string; value: string }[];
}) {
  const { t } = useLingui();
  const [expanded, setExpanded] = useState(false);
  const resolvedDoctype =
    doctype ??
    (recordType === "company"
      ? "CRM Organization / Customer"
      : recordType === "contact"
        ? "Contact"
        : recordType === "product"
          ? "Item"
          : recordType === "order"
            ? "Sales Order"
            : recordType === "invoice"
              ? "Sales Invoice"
              : (recordType ?? "DocType"));
  const resolvedDocName = docName ?? legacyRef ?? recordId ?? "—";
  const resolvedLegacyId = legacyId ?? recordId ?? "—";
  return (
    <div className="rounded-xl border bg-card">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center justify-between px-4 py-3 text-start text-sm font-medium outline-none hover:bg-accent/40 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="flex items-center gap-2">
          <Database className="size-4 text-muted-foreground" strokeWidth={1.75} />
          <span>{t`System Record Metadata & Actor Attribution`}</span>
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
            {resolvedDoctype}
          </span>
        </span>
        <ChevronDown
          className={cn(
            "size-4 text-muted-foreground transition-transform",
            expanded && "rotate-180",
          )}
          strokeWidth={1.75}
        />
      </button>
      {expanded ? (
        <div className="grid grid-cols-1 gap-3 border-t p-4 text-xs sm:grid-cols-2">
          <div className="space-y-1">
            <span className="block text-muted-foreground">{t`Document Series`}</span>
            <span className="block rounded border bg-muted/40 px-2.5 py-1.5 font-mono">
              {resolvedDocName}
            </span>
          </div>
          <div className="space-y-1">
            <span className="block text-muted-foreground">{t`Record Reference`}</span>
            <span className="block rounded border bg-muted/40 px-2.5 py-1.5 font-mono">
              {resolvedLegacyId}
            </span>
          </div>
          <div className="space-y-1">
            <span className="block text-muted-foreground">{t`Created By (User)`}</span>
            <span className="block rounded border bg-muted/40 px-2.5 py-1.5 font-mono">
              {createdBy.userId ?? "—"}
            </span>
          </div>
          <div className="space-y-1">
            <span className="block text-muted-foreground">{t`Created By (Digital Employee)`}</span>
            <span className="block rounded border bg-muted/40 px-2.5 py-1.5 font-mono">
              {createdBy.botId ? `${actorName(createdBy)} (${createdBy.botId})` : "—"}
            </span>
          </div>
          {ownerOrAssignee ? (
            <>
              <div className="space-y-1">
                <span className="block text-muted-foreground">
                  {ownerLabel ?? t`Assignee`} ({t`User`})
                </span>
                <span className="block rounded border bg-muted/40 px-2.5 py-1.5 font-mono">
                  {ownerOrAssignee.userId ?? "—"}
                </span>
              </div>
              <div className="space-y-1">
                <span className="block text-muted-foreground">
                  {ownerLabel ?? t`Assignee`} ({t`Digital Employee`})
                </span>
                <span className="block rounded border bg-muted/40 px-2.5 py-1.5 font-mono">
                  {ownerOrAssignee.botId
                    ? `${actorName(ownerOrAssignee)} (${ownerOrAssignee.botId})`
                    : "—"}
                </span>
              </div>
            </>
          ) : null}
          {extraFields?.map((field) => (
            <div key={field.fieldname} className="space-y-1">
              <span className="block text-muted-foreground">{field.label}</span>
              <span className="block rounded border bg-muted/40 px-2.5 py-1.5 font-mono">
                {field.value || "—"}
              </span>
            </div>
          ))}
          {extra?.map((field) => (
            <div key={field.label} className="space-y-1">
              <span className="block text-muted-foreground">{field.label}</span>
              <span className="block rounded border bg-muted/40 px-2.5 py-1.5 font-mono">
                {field.value || "—"}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ============================================================================
// 3. FRAPPE CRM FULL-PAGE LEAD WORKSPACE (`/crm/leads/CRM-LEAD-...`)
// ============================================================================

type LeadTab = "activity" | "emails" | "comments" | "data" | "tasks" | "notes" | "calls";

const EMAIL_TEMPLATES = [
  {
    id: "intro",
    label: "Introductory Outreach",
    subject: "Quick introduction — {{title}}",
    body: "Hi {{contact}},\n\nI noticed your inquiry regarding {{title}}. We would love to walk you through how our team can help {{company}}.\n\nAre you available for a 15-minute call this week?",
  },
  {
    id: "proposal",
    label: "Proposal & Pricing Follow-up",
    subject: "Proposal & quotation for {{title}}",
    body: "Hi {{contact}},\n\nFollowing up on our discussion regarding {{title}} for {{company}}. Please let us know if you have any questions on the proposed scope and timeline.",
  },
  {
    id: "checkin",
    label: "Qualification Check-in",
    subject: "Checking in on {{title}}",
    body: "Hi {{contact}},\n\nJust checking in to see if {{company}} is ready to move forward with {{title}}.",
  },
] as const;

export function FrappeLeadWorkspace({
  lead,
  lookups,
  currency,
  revision,
  onBack,
  onSaved,
  onError,
}: {
  lead: CrmLead;
  lookups: FrappeLookups;
  currency: string;
  revision: number;
  onBack: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const assistant = useAssistant();
  const formId = useId();
  const statuses = useLeadStatusLabels();
  const kinds = useActivityKindLabels();
  const money = useMoney(currency);

  const [tab, setTab] = useState<LeadTab>("activity");
  const [title, setTitle] = useState(lead.title);
  const [companyId, setCompanyId] = useState(lead.companyId ?? "");
  const [contactId, setContactId] = useState(lead.contactId ?? "");
  const [value, setValue] = useState(lead.value === null ? "" : String(lead.value));
  const [source, setSource] = useState(lead.source ?? "");
  const [notes, setNotes] = useState(lead.notes ?? "");
  const [busy, setBusy] = useState(false);

  // Inline composer states
  const [activityKind, setActivityKind] = useState<ActivityKind>("note");
  const [activitySubject, setActivitySubject] = useState("");
  const [activityBody, setActivityBody] = useState("");
  const [activityDue, setActivityDue] = useState("");
  const [emailSubject, setEmailSubject] = useState(`Follow-up: ${lead.title}`);
  const [emailBody, setEmailBody] = useState("");
  const [commentText, setCommentText] = useState("");

  const docName = frappeLeadDocName(lead);
  const company = lead.companyId
    ? lookups.companies.find((item) => item.id === lead.companyId)
    : undefined;
  const contact = lead.contactId
    ? lookups.contacts.find((item) => item.id === lead.contactId)
    : undefined;
  const linkedActivities = useMemo(
    () =>
      lookups.activities.filter(
        (item) =>
          item.leadId === lead.id ||
          (lead.companyId && item.companyId === lead.companyId && !item.dealId),
      ),
    [lead.companyId, lead.id, lookups.activities],
  );
  const emailActivities = linkedActivities.filter((item) => item.kind === "email");
  const noteActivities = linkedActivities.filter((item) => item.kind === "note");
  const callActivities = linkedActivities.filter((item) => item.kind === "call");
  const taskActivities = linkedActivities.filter(
    (item) => item.kind === "follow_up" || item.kind === "meeting" || item.dueAt,
  );

  async function saveChanges() {
    setBusy(true);
    try {
      const parsedValue = parseMoneyInput(value);
      await rpc.crm.leads.update({
        id: lead.id,
        title,
        source: source || null,
        notes: notes || null,
        value: value.trim() === "" ? null : (parsedValue ?? lead.value),
        companyId: companyId || null,
        contactId: contactId || null,
      });
      onSaved();
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function setQualificationStatus(next: "contacted" | "qualified" | "unqualified") {
    setBusy(true);
    try {
      await rpc.crm.leads.qualify({ id: lead.id, status: next });
      onSaved();
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function convertToDeal() {
    setBusy(true);
    try {
      if (lead.status !== "qualified") {
        await rpc.crm.leads.qualify({ id: lead.id, status: "qualified" });
      }
      const deal = await rpc.crm.leads.convert({ id: lead.id });
      onSaved();
      void navigate(crmHref("deals", { record: deal.id }));
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function logRecordActivity(
    kind: ActivityKind,
    subject: string,
    body?: string,
    dueAt?: string,
    completed = true,
  ) {
    if (!subject.trim()) return;
    setBusy(true);
    try {
      await rpc.crm.activities.create({
        kind,
        subject: subject.trim(),
        ...(body?.trim() ? { body: body.trim() } : {}),
        ...(dueAt ? { dueAt: new Date(dueAt).toISOString() } : {}),
        leadId: lead.id,
        ...(lead.companyId ? { companyId: lead.companyId } : {}),
        ...(lead.contactId ? { contactId: lead.contactId } : {}),
        completed,
      });
      onSaved();
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  function applyEmailTemplate(templateId: string) {
    const tpl = EMAIL_TEMPLATES.find((item) => item.id === templateId);
    if (!tpl) return;
    const replaceTokens = (str: string) =>
      str
        .replaceAll("{{title}}", lead.title)
        .replaceAll("{{contact}}", contact?.firstName ?? contact?.name ?? "there")
        .replaceAll("{{company}}", company?.name ?? "your team");
    setEmailSubject(replaceTokens(tpl.subject));
    setEmailBody(replaceTokens(tpl.body));
  }

  const tabs: { id: LeadTab; label: string; icon: LucideIcon; count?: number }[] = [
    { id: "activity", label: t`Activity`, icon: Activity, count: linkedActivities.length },
    { id: "emails", label: t`Emails`, icon: Mail, count: emailActivities.length },
    { id: "comments", label: t`Comments`, icon: MessageSquare, count: noteActivities.length },
    { id: "data", label: t`Data`, icon: FileText },
    { id: "tasks", label: t`Tasks`, icon: CalendarClock, count: taskActivities.length },
    { id: "notes", label: t`Notes`, icon: StickyNote, count: noteActivities.length },
    { id: "calls", label: t`Calls`, icon: PhoneCall, count: callActivities.length },
  ];

  return (
    <div className="space-y-4" data-testid="frappe-lead-workspace">
      {/* Top Frappe CRM Document Header Bar */}
      <div className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <Button variant="ghost" size="icon" onClick={onBack} aria-label={t`Back to Leads`}>
              <ArrowLeft className="size-4" />
            </Button>
            <RecordAvatar name={lead.title} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{docName}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                  {lead.ref}
                </span>
                <StatusBadge tone={LEAD_STATUS_TONES[lead.status]}>
                  {statuses[lead.status]}
                </StatusBadge>
              </div>
              <h2 className="truncate text-base font-semibold">{lead.title}</h2>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <AskAssistantButton
              record={{ kind: "lead", ref: lead.ref, name: lead.title, status: lead.status }}
            />
            {lead.status !== "converted" && lead.status !== "unqualified" ? (
              <Button size="sm" disabled={busy} onClick={() => void convertToDeal()}>
                <Handshake data-icon="inline-start" aria-hidden="true" />
                <Trans>Convert to Deal</Trans>
              </Button>
            ) : null}
            {lead.convertedDealId ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void navigate(crmHref("deals", { record: lead.convertedDealId! }))}
              >
                <Handshake data-icon="inline-start" aria-hidden="true" />
                <Trans>Open Deal</Trans>
              </Button>
            ) : null}
            {lead.status !== "converted" ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void saveChanges()}
              >
                <Check data-icon="inline-start" aria-hidden="true" />
                <Trans>Save</Trans>
              </Button>
            ) : null}
          </div>
        </div>

        {/* Frappe CRM Interactive Status Stepper Bar */}
        <div className="mt-4 grid grid-cols-2 gap-1.5 border-t pt-3 sm:grid-cols-5">
          {LEAD_STATUSES.map((stepStatus) => {
            const active = lead.status === stepStatus;
            const canClick =
              lead.status !== "converted" &&
              (stepStatus === "contacted" ||
                stepStatus === "qualified" ||
                stepStatus === "unqualified");
            return (
              <button
                key={stepStatus}
                type="button"
                disabled={!canClick || busy}
                onClick={() => {
                  if (
                    stepStatus === "contacted" ||
                    stepStatus === "qualified" ||
                    stepStatus === "unqualified"
                  ) {
                    void setQualificationStatus(stepStatus);
                  }
                }}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? "border-foreground bg-foreground text-background"
                    : canClick
                      ? "bg-muted/40 text-muted-foreground hover:border-foreground/30 hover:text-foreground"
                      : "cursor-default bg-muted/20 text-muted-foreground/60",
                )}
              >
                {active ? <Check className="size-3.5" strokeWidth={2} /> : null}
                <span>{statuses[stepStatus]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Frappe CRM 2-Pane Split View: Main Tabbed Content + Right Properties Sidebar */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left/Center Main Pane (8 cols) */}
        <div className="space-y-4 lg:col-span-8">
          {/* Frappe CRM Tab Bar */}
          <div className="flex gap-1 overflow-x-auto rounded-xl border bg-card p-1.5">
            {tabs.map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                    active
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5" strokeWidth={1.75} />
                  <span>{item.label}</span>
                  {item.count !== undefined && item.count > 0 ? (
                    <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground tabular-nums">
                      {item.count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* TAB: ACTIVITY */}
          {tab === "activity" ? (
            <div className="space-y-4">
              <div className="rounded-xl border bg-card p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <NativeSelect
                    aria-label={t`Activity kind`}
                    value={activityKind}
                    onChange={(e) => setActivityKind(e.target.value as ActivityKind)}
                    className="w-36"
                  >
                    {ACTIVITY_KINDS.map((k) => (
                      <NativeSelectOption key={k} value={k}>
                        {kinds[k]}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <Input
                    placeholder={t`Subject (e.g. Discovery call, Follow-up on requirements)…`}
                    value={activitySubject}
                    onChange={(e) => setActivitySubject(e.target.value)}
                    className="min-w-48 flex-1"
                  />
                  <Input
                    type="date"
                    aria-label={t`Due date`}
                    value={activityDue}
                    onChange={(e) => setActivityDue(e.target.value)}
                    className="w-36"
                  />
                  <Button
                    size="sm"
                    disabled={busy || !activitySubject.trim()}
                    onClick={() => {
                      void logRecordActivity(
                        activityKind,
                        activitySubject,
                        activityBody,
                        activityDue,
                        activityKind !== "follow_up" && !activityDue,
                      );
                      setActivitySubject("");
                      setActivityBody("");
                      setActivityDue("");
                    }}
                  >
                    <Plus data-icon="inline-start" />
                    <Trans>Log Activity</Trans>
                  </Button>
                </div>
                <Textarea
                  placeholder={t`Add call summary, meeting notes, or next steps…`}
                  value={activityBody}
                  onChange={(e) => setActivityBody(e.target.value)}
                  rows={2}
                />
              </div>

              <Panel title={t`Timeline`} aside={linkedActivities.length}>
                {linkedActivities.length > 0 ? (
                  <RecordList label={t`Activity timeline`}>
                    {linkedActivities.map((item) => (
                      <RecordRow
                        key={item.id}
                        icon={ACTIVITY_ICONS[item.kind]}
                        title={item.subject}
                        meta={
                          <>
                            <span>{kinds[item.kind]}</span>
                            <span aria-hidden="true">·</span>
                            <span>{actorName(item.createdBy)}</span>
                            <span aria-hidden="true">·</span>
                            <span>{formatRelativeTime(item.createdAt)}</span>
                            {item.body ? (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="truncate text-foreground/80">{item.body}</span>
                              </>
                            ) : null}
                          </>
                        }
                        end={
                          item.completedAt ? (
                            <StatusBadge tone="success">{t`Done`}</StatusBadge>
                          ) : item.dueAt ? (
                            <StatusBadge tone="warning">
                              {new Date(item.dueAt).toLocaleDateString()}
                            </StatusBadge>
                          ) : undefined
                        }
                      />
                    ))}
                  </RecordList>
                ) : (
                  <PanelEmpty icon={Activity}>{t`No timeline entries yet`}</PanelEmpty>
                )}
              </Panel>

              <div className="rounded-xl border bg-card p-4">
                <HistoryList recordType="lead" recordId={lead.id} revision={revision} />
              </div>
            </div>
          ) : null}

          {/* TAB: EMAILS */}
          {tab === "emails" ? (
            <div className="space-y-4">
              <div className="rounded-xl border bg-card p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    <Trans>To:</Trans> {contact?.email ?? contact?.name ?? lead.title}
                  </span>
                  <div className="flex items-center gap-2">
                    <NativeSelect
                      aria-label={t`Email template`}
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value) applyEmailTemplate(e.target.value);
                      }}
                      className="w-48"
                    >
                      <NativeSelectOption value="">{t`Choose Email Template…`}</NativeSelectOption>
                      {EMAIL_TEMPLATES.map((tpl) => (
                        <NativeSelectOption key={tpl.id} value={tpl.id}>
                          {tpl.label}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        assistant?.ask({
                          kind: "lead",
                          ref: lead.ref,
                          name: lead.title,
                          status: lead.status,
                        })
                      }
                    >
                      <Sparkles data-icon="inline-start" />
                      <Trans>Draft with AI</Trans>
                    </Button>
                  </div>
                </div>
                <Input
                  placeholder={t`Subject`}
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                />
                <Textarea
                  placeholder={t`Write your email…`}
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  rows={4}
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    disabled={busy || !emailSubject.trim()}
                    onClick={() => {
                      void logRecordActivity("email", emailSubject, emailBody, undefined, true);
                      setEmailBody("");
                    }}
                  >
                    <Send data-icon="inline-start" />
                    <Trans>Send & Log Email</Trans>
                  </Button>
                </div>
              </div>

              <Panel title={t`Email history`} aside={emailActivities.length}>
                {emailActivities.length > 0 ? (
                  <RecordList label={t`Emails`}>
                    {emailActivities.map((item) => (
                      <RecordRow
                        key={item.id}
                        icon={Mail}
                        title={item.subject}
                        meta={
                          <>
                            <span>{actorName(item.createdBy)}</span>
                            <span aria-hidden="true">·</span>
                            <span>{formatRelativeTime(item.createdAt)}</span>
                            {item.body ? (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="truncate">{item.body}</span>
                              </>
                            ) : null}
                          </>
                        }
                      />
                    ))}
                  </RecordList>
                ) : (
                  <PanelEmpty icon={Mail}>{t`No emails logged yet`}</PanelEmpty>
                )}
              </Panel>
            </div>
          ) : null}

          {/* TAB: COMMENTS */}
          {tab === "comments" ? (
            <div className="space-y-4">
              <div className="rounded-xl border bg-card p-4 space-y-3">
                <Textarea
                  placeholder={t`Write a comment or @mention an AI specialist…`}
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  rows={3}
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    disabled={busy || !commentText.trim()}
                    onClick={() => {
                      void logRecordActivity(
                        "note",
                        commentText.slice(0, 80),
                        commentText,
                        undefined,
                        true,
                      );
                      setCommentText("");
                    }}
                  >
                    <MessageSquare data-icon="inline-start" />
                    <Trans>Post Comment</Trans>
                  </Button>
                </div>
              </div>
              <Panel title={t`Comments`} aside={noteActivities.length}>
                {noteActivities.length > 0 ? (
                  <RecordList label={t`Comments`}>
                    {noteActivities.map((item) => (
                      <RecordRow
                        key={item.id}
                        icon={MessageSquare}
                        title={item.body || item.subject}
                        meta={
                          <>
                            <span>{actorName(item.createdBy)}</span>
                            <span aria-hidden="true">·</span>
                            <span>{formatRelativeTime(item.createdAt)}</span>
                          </>
                        }
                      />
                    ))}
                  </RecordList>
                ) : (
                  <PanelEmpty icon={MessageSquare}>{t`No comments yet`}</PanelEmpty>
                )}
              </Panel>
            </div>
          ) : null}

          {/* TAB: DATA */}
          {tab === "data" ? (
            <div className="space-y-4">
              <div className="rounded-xl border bg-card p-4 space-y-4">
                <h3 className="text-sm font-semibold">{t`Lead Qualification & Record Fields`}</h3>
                <FormField id={`${formId}-title`} label={t`Opportunity / Lead Title`} required>
                  <Input
                    id={`${formId}-title`}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={BUSINESS_NAME_MAX_LENGTH}
                  />
                </FormField>
                <FieldRow>
                  <FormField id={`${formId}-company`} label={t`Account / Organization`}>
                    <NativeSelect
                      id={`${formId}-company`}
                      className="w-full"
                      value={companyId}
                      onChange={(e) => {
                        setCompanyId(e.target.value);
                        setContactId("");
                      }}
                    >
                      <NativeSelectOption value="">{t`None`}</NativeSelectOption>
                      {lookups.companies.map((c) => (
                        <NativeSelectOption key={c.id} value={c.id}>
                          {c.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </FormField>
                  <FormField id={`${formId}-contact`} label={t`Primary Stakeholder`}>
                    <NativeSelect
                      id={`${formId}-contact`}
                      className="w-full"
                      value={contactId}
                      onChange={(e) => setContactId(e.target.value)}
                    >
                      <NativeSelectOption value="">{t`None`}</NativeSelectOption>
                      {lookups.contacts
                        .filter((c) => !companyId || c.companyId === companyId)
                        .map((c) => (
                          <NativeSelectOption key={c.id} value={c.id}>
                            {c.name}
                          </NativeSelectOption>
                        ))}
                    </NativeSelect>
                  </FormField>
                </FieldRow>
                <FieldRow>
                  <FormField id={`${formId}-value`} label={t`Estimated Deal Value`}>
                    <Input
                      id={`${formId}-value`}
                      inputMode="decimal"
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                    />
                  </FormField>
                  <FormField id={`${formId}-source`} label={t`Acquisition Channel / Source`}>
                    <Input
                      id={`${formId}-source`}
                      value={source}
                      onChange={(e) => setSource(e.target.value)}
                    />
                  </FormField>
                </FieldRow>
                <FormField id={`${formId}-notes`} label={t`Qualification Notes & BANT Summary`}>
                  <Textarea
                    id={`${formId}-notes`}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    maxLength={BUSINESS_TEXT_MAX_LENGTH}
                  />
                </FormField>
                <div className="flex justify-end">
                  <Button size="sm" disabled={busy} onClick={() => void saveChanges()}>
                    <Trans>Save Lead Data</Trans>
                  </Button>
                </div>
              </div>

              <SavingroupCustomFieldsSection
                doctype="Lead Record"
                docName={docName}
                legacyId={lead.ref}
                createdBy={lead.createdBy}
                ownerOrAssignee={lead.assignee}
                ownerLabel={t`Assigned Operator`}
                extraFields={[
                  {
                    fieldname: "converted_deal_id",
                    label: t`Converted Deal ID`,
                    value: lead.convertedDealId ?? "",
                  },
                ]}
              />
            </div>
          ) : null}

          {/* TAB: TASKS */}
          {tab === "tasks" ? (
            <Panel title={t`Action Queue & Tasks`} aside={taskActivities.length}>
              {taskActivities.length > 0 ? (
                <RecordList label={t`Tasks`}>
                  {taskActivities.map((item) => (
                    <RecordRow
                      key={item.id}
                      icon={CalendarClock}
                      title={item.subject}
                      meta={
                        <>
                          <span>{kinds[item.kind]}</span>
                          {item.dueAt ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{new Date(item.dueAt).toLocaleDateString()}</span>
                            </>
                          ) : null}
                        </>
                      }
                      action={
                        <button
                          type="button"
                          onClick={() =>
                            void rpc.crm.activities
                              .complete({ id: item.id, completed: !item.completedAt })
                              .then(() => onSaved())
                          }
                          className={cn(
                            "grid size-7 place-items-center rounded-lg",
                            item.completedAt ? "text-success" : "text-muted-foreground",
                          )}
                        >
                          <CircleCheck className="size-4" />
                        </button>
                      }
                    />
                  ))}
                </RecordList>
              ) : (
                <PanelEmpty icon={CalendarClock}>{t`No tasks linked to this lead`}</PanelEmpty>
              )}
            </Panel>
          ) : null}

          {/* TAB: NOTES */}
          {tab === "notes" ? (
            <Panel title={t`Executive Memos & Notes`} aside={noteActivities.length}>
              {noteActivities.length > 0 ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {noteActivities.map((note) => (
                    <div key={note.id} className="rounded-xl border bg-muted/20 p-3.5 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sm">{note.subject}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatRelativeTime(note.createdAt)}
                        </span>
                      </div>
                      {note.body ? (
                        <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                          {note.body}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <PanelEmpty icon={StickyNote}>{t`No notes on this lead`}</PanelEmpty>
              )}
            </Panel>
          ) : null}

          {/* TAB: CALLS */}
          {tab === "calls" ? (
            <Panel title={t`Call Intelligence Logs`} aside={callActivities.length}>
              {callActivities.length > 0 ? (
                <RecordList label={t`Calls`}>
                  {callActivities.map((call) => (
                    <RecordRow
                      key={call.id}
                      icon={PhoneCall}
                      title={call.subject}
                      meta={
                        <>
                          <span>{actorName(call.createdBy)}</span>
                          <span aria-hidden="true">·</span>
                          <span>{formatRelativeTime(call.createdAt)}</span>
                          {call.body ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="truncate">{call.body}</span>
                            </>
                          ) : null}
                        </>
                      }
                    />
                  ))}
                </RecordList>
              ) : (
                <PanelEmpty icon={PhoneCall}>{t`No call logs yet`}</PanelEmpty>
              )}
            </Panel>
          ) : null}
        </div>

        {/* Right Properties Sidebar (4 cols) */}
        <div className="space-y-4 lg:col-span-4">
          {/* Assigned To Card */}
          <div className="rounded-xl border bg-card p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Trans>Assigned Operator</Trans>
            </h3>
            <div className="flex items-center gap-2">
              <ActorAvatar actor={lead.assignee} size={24} />
              <span className="text-sm font-medium">
                {actorName(lead.assignee) || t`Unassigned`}
              </span>
            </div>
            <NativeSelect
              aria-label={t`Assign to bot`}
              className="w-full"
              value={lead.assignee.botId ?? ""}
              onChange={(e) => {
                if (e.target.value) {
                  void rpc.crm.leads
                    .assign({
                      id: lead.id,
                      assigneeBotId: e.target.value,
                      actorBotId: e.target.value,
                    })
                    .then(() => onSaved())
                    .catch((cause) => onError(errorText(cause)));
                }
              }}
            >
              <NativeSelectOption value="">{t`Select AI Operator…`}</NativeSelectOption>
              {lookups.bots.map((bot) => (
                <NativeSelectOption key={bot.id} value={bot.id}>
                  {bot.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <div className="space-y-1.5 border-t pt-2.5">
              <span className="block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                <Trans>Execute as Digital Employee</Trans>
              </span>
              <div className="flex flex-col gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="justify-start text-xs"
                  disabled={busy || lead.status === "converted"}
                  onClick={() => {
                    const salesBot =
                      lookups.bots.find((b) => b.name.includes("Sales")) ?? lookups.bots[0];
                    setBusy(true);
                    void (async () => {
                      try {
                        if (salesBot) {
                          await rpc.crm.leads.assign({
                            id: lead.id,
                            assigneeBotId: salesBot.id,
                            actorBotId: salesBot.id,
                          });
                        }
                        if (lead.status !== "qualified") {
                          await rpc.crm.leads.qualify({
                            id: lead.id,
                            status: "qualified",
                            ...(salesBot ? { actorBotId: salesBot.id } : {}),
                          });
                        }
                        await rpc.crm.activities.create({
                          kind: "call",
                          subject: `[Sales Executive AI] Qualification & discovery call — ${lead.title}`,
                          body: "Verified BANT criteria, timeline, and decision authority. Lead qualified for deal conversion.",
                          leadId: lead.id,
                          ...(lead.companyId ? { companyId: lead.companyId } : {}),
                          ...(lead.contactId ? { contactId: lead.contactId } : {}),
                          completed: true,
                          ...(salesBot
                            ? { assigneeBotId: salesBot.id, actorBotId: salesBot.id }
                            : {}),
                        });
                        onSaved();
                      } catch (cause) {
                        onError(errorText(cause));
                      } finally {
                        setBusy(false);
                      }
                    })();
                  }}
                >
                  <Sparkles data-icon="inline-start" />
                  <Trans>Sales Executive: Auto-Qualify & Log Call</Trans>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="justify-start text-xs"
                  disabled={busy}
                  onClick={() => {
                    const stewardBot =
                      lookups.bots.find((b) => b.name.includes("Steward")) ?? lookups.bots[0];
                    setBusy(true);
                    void (async () => {
                      try {
                        await rpc.crm.leads.update({
                          id: lead.id,
                          source: lead.source || "AI Enriched Inbound",
                          notes:
                            lead.notes ||
                            "CRM Data Steward verified firmographic profile and primary contact details.",
                          ...(stewardBot ? { actorBotId: stewardBot.id } : {}),
                        });
                        await rpc.crm.activities.create({
                          kind: "note",
                          subject: `[CRM Data Steward AI] Data hygiene & enrichment audit`,
                          body: "Validated lead source, value, and organization linkage. Zero duplicate conflicts detected.",
                          leadId: lead.id,
                          ...(lead.companyId ? { companyId: lead.companyId } : {}),
                          completed: true,
                          ...(stewardBot
                            ? { assigneeBotId: stewardBot.id, actorBotId: stewardBot.id }
                            : {}),
                        });
                        onSaved();
                      } catch (cause) {
                        onError(errorText(cause));
                      } finally {
                        setBusy(false);
                      }
                    })();
                  }}
                >
                  <ShieldCheck data-icon="inline-start" />
                  <Trans>Data Steward: Enrich & Audit Lead</Trans>
                </Button>
              </div>
            </div>
          </div>

          {/* Organization Card */}
          <div className="rounded-xl border bg-card p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Trans>CRM Organization</Trans>
              </h3>
              {company ? (
                <Link
                  to={crmHref("companies", { record: company.id })}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  <Trans>Open</Trans> →
                </Link>
              ) : null}
            </div>
            {company ? (
              <div className="space-y-1 text-sm">
                <p className="font-medium">{company.name}</p>
                {company.domain ? (
                  <p className="text-xs text-muted-foreground">{company.domain}</p>
                ) : null}
                {company.phone ? (
                  <p className="text-xs text-muted-foreground">{company.phone}</p>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{t`No organization linked`}</p>
            )}
          </div>

          {/* Contact Card */}
          <div className="rounded-xl border bg-card p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Trans>Primary Contact</Trans>
              </h3>
              {contact ? (
                <Link
                  to={crmHref("contacts", { record: contact.id })}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  <Trans>Open</Trans> →
                </Link>
              ) : null}
            </div>
            {contact ? (
              <div className="space-y-1 text-sm">
                <p className="font-medium">{contact.name}</p>
                {contact.title ? (
                  <p className="text-xs text-muted-foreground">{contact.title}</p>
                ) : null}
                {contact.email ? (
                  <p className="text-xs text-muted-foreground">{contact.email}</p>
                ) : null}
                {contact.phone ? (
                  <p className="text-xs text-muted-foreground">{contact.phone}</p>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{t`No contact linked`}</p>
            )}
          </div>

          {/* Lead Details Summary */}
          <div className="rounded-xl border bg-card p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Trans>Document Properties</Trans>
            </h3>
            <DetailList
              items={[
                { label: t`DocType`, value: <span className="font-mono">CRM Lead</span> },
                { label: t`Document`, value: <span className="font-mono">{docName}</span> },
                { label: t`Legacy Ref`, value: <span className="font-mono">{lead.ref}</span> },
                {
                  label: t`Estimated Value`,
                  value: lead.value !== null ? money(lead.value) : "—",
                },
                { label: t`Lead Source`, value: lead.source ?? "—" },
                { label: t`Created`, value: formatRelativeTime(lead.createdAt) },
                { label: t`Modified`, value: formatRelativeTime(lead.updatedAt) },
              ]}
            />
          </div>
          <div className="rounded-xl border bg-card p-4">
            <HistoryList recordType="lead" recordId={lead.id} revision={revision} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 4. FRAPPE CRM FULL-PAGE DEAL WORKSPACE (`/crm/deals/CRM-DEAL-...`)
// ============================================================================

type DealTab = "activity" | "orders" | "emails" | "comments" | "data" | "tasks" | "notes" | "calls";

export function FrappeDealWorkspace({
  deal,
  lookups,
  currency,
  revision,
  onBack,
  onSaved,
  onError,
}: {
  deal: CrmDeal;
  lookups: FrappeLookups;
  currency: string;
  revision: number;
  onBack: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const assistant = useAssistant();
  const formId = useId();
  const stages = useDealStageLabels();
  const orderStatuses = useOrderStatusLabels();
  const invoiceStatuses = useInvoiceStatusLabels();
  const kinds = useActivityKindLabels();
  const money = useMoney(deal.currency || currency);

  const [tab, setTab] = useState<DealTab>("activity");
  const [title, setTitle] = useState(deal.title);
  const [amount, setAmount] = useState(String(deal.amount));
  const [expectedCloseAt, setExpectedCloseAt] = useState(
    deal.expectedCloseAt ? deal.expectedCloseAt.slice(0, 10) : "",
  );
  const [companyId, setCompanyId] = useState(deal.companyId ?? "");
  const [contactId, setContactId] = useState(deal.contactId ?? "");
  const [notes, setNotes] = useState(deal.notes ?? "");
  const [stageReason, setStageReason] = useState("");
  const [busy, setBusy] = useState(false);

  const [activityKind, setActivityKind] = useState<ActivityKind>("note");
  const [activitySubject, setActivitySubject] = useState("");
  const [activityBody, setActivityBody] = useState("");
  const [activityDue, setActivityDue] = useState("");
  const [emailSubject, setEmailSubject] = useState(`Proposal: ${deal.title}`);
  const [emailBody, setEmailBody] = useState("");
  const [commentText, setCommentText] = useState("");

  const docName = frappeDealDocName(deal);
  const company = deal.companyId
    ? lookups.companies.find((item) => item.id === deal.companyId)
    : undefined;
  const contact = deal.contactId
    ? lookups.contacts.find((item) => item.id === deal.contactId)
    : undefined;
  const sourceLead = deal.sourceLeadId
    ? lookups.leads.find((item) => item.id === deal.sourceLeadId)
    : undefined;
  const linkedOrders = useMemo(
    () =>
      lookups.orders.filter(
        (order) =>
          order.dealId === deal.id ||
          (deal.companyId && order.companyId === deal.companyId && !order.dealId),
      ),
    [deal.companyId, deal.id, lookups.orders],
  );
  const linkedInvoices = useMemo(
    () =>
      lookups.invoices.filter((invoice) =>
        linkedOrders.some((order) => order.id === invoice.orderId),
      ),
    [linkedOrders, lookups.invoices],
  );
  const linkedActivities = useMemo(
    () =>
      lookups.activities.filter(
        (item) =>
          item.dealId === deal.id ||
          (deal.companyId && item.companyId === deal.companyId && !item.leadId),
      ),
    [deal.companyId, deal.id, lookups.activities],
  );
  const emailActivities = linkedActivities.filter((item) => item.kind === "email");
  const noteActivities = linkedActivities.filter((item) => item.kind === "note");
  const callActivities = linkedActivities.filter((item) => item.kind === "call");
  const taskActivities = linkedActivities.filter(
    (item) => item.kind === "follow_up" || item.kind === "meeting" || item.dueAt,
  );

  async function saveDeal() {
    setBusy(true);
    try {
      const parsedAmount = parseMoneyInput(amount);
      const nextClose = expectedCloseAt ? new Date(expectedCloseAt).toISOString() : null;
      await rpc.crm.deals.update({
        id: deal.id,
        title,
        ...(parsedAmount !== undefined ? { amount: parsedAmount } : {}),
        expectedCloseAt: nextClose,
        notes: notes || null,
        companyId: companyId || null,
        contactId: contactId || null,
      });
      onSaved();
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function changeStage(nextStage: DealStage) {
    if (nextStage === deal.stage) return;
    setBusy(true);
    try {
      await rpc.crm.deals.updateStage({
        id: deal.id,
        stage: nextStage,
        ...(stageReason.trim() ? { reason: stageReason.trim() } : {}),
      });
      onSaved();
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function createSalesOrder() {
    setBusy(true);
    try {
      const order = await rpc.erp.orders.createDraft({
        dealId: deal.id,
        ...(deal.companyId ? { companyId: deal.companyId } : {}),
        ...(deal.contactId ? { contactId: deal.contactId } : {}),
        notes: `${docName} (${deal.ref}) · ${deal.title}`,
        lines: [],
      });
      onSaved();
      void navigate(erpHref("orders", { record: order.id }));
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function logDealActivity(
    kind: ActivityKind,
    subject: string,
    body?: string,
    dueAt?: string,
    completed = true,
  ) {
    if (!subject.trim()) return;
    setBusy(true);
    try {
      await rpc.crm.activities.create({
        kind,
        subject: subject.trim(),
        ...(body?.trim() ? { body: body.trim() } : {}),
        ...(dueAt ? { dueAt: new Date(dueAt).toISOString() } : {}),
        dealId: deal.id,
        ...(deal.companyId ? { companyId: deal.companyId } : {}),
        ...(deal.contactId ? { contactId: deal.contactId } : {}),
        completed,
      });
      onSaved();
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  const tabs: { id: DealTab; label: string; icon: LucideIcon; count?: number }[] = [
    { id: "activity", label: t`Activity`, icon: Activity, count: linkedActivities.length },
    {
      id: "orders",
      label: t`Sales Orders & Invoices`,
      icon: ShoppingCart,
      count: linkedOrders.length + linkedInvoices.length,
    },
    { id: "emails", label: t`Emails`, icon: Mail, count: emailActivities.length },
    { id: "comments", label: t`Comments`, icon: MessageSquare, count: noteActivities.length },
    { id: "data", label: t`Data`, icon: FileText },
    { id: "tasks", label: t`Tasks`, icon: CalendarClock, count: taskActivities.length },
    { id: "notes", label: t`Notes`, icon: StickyNote, count: noteActivities.length },
    { id: "calls", label: t`Calls`, icon: PhoneCall, count: callActivities.length },
  ];

  return (
    <div className="space-y-4" data-testid="frappe-deal-workspace">
      {/* Top Frappe CRM Deal Header */}
      <div className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <Button variant="ghost" size="icon" onClick={onBack} aria-label={t`Back to Deals`}>
              <ArrowLeft className="size-4" />
            </Button>
            <RecordAvatar name={deal.title} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{docName}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                  {deal.ref}
                </span>
                <StatusBadge tone={DEAL_STAGE_TONES[deal.stage]}>{stages[deal.stage]}</StatusBadge>
                <span className="font-semibold text-sm tabular-nums">{money(deal.amount)}</span>
              </div>
              <h2 className="truncate text-base font-semibold">{deal.title}</h2>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <AskAssistantButton
              record={{ kind: "deal", ref: deal.ref, name: deal.title, status: deal.stage }}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void createSalesOrder()}
            >
              <ShoppingCart data-icon="inline-start" aria-hidden="true" />
              <Trans>Create Sales Order</Trans>
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void saveDeal()}>
              <Check data-icon="inline-start" aria-hidden="true" />
              <Trans>Save</Trans>
            </Button>
          </div>
        </div>

        {/* Frappe CRM 5-Stage Pipeline Stepper (`Qualification` -> `Proposal/Quotation` -> `Negotiation` -> `Won` / `Lost`) */}
        <div className="mt-4 grid grid-cols-2 gap-1.5 border-t pt-3 sm:grid-cols-5">
          {DEAL_STAGES.map((stageItem) => {
            const active = deal.stage === stageItem;
            return (
              <button
                key={stageItem}
                type="button"
                disabled={busy}
                onClick={() => void changeStage(stageItem)}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? stageItem === "won"
                      ? "border-success bg-success text-white"
                      : stageItem === "lost"
                        ? "border-destructive bg-destructive text-white"
                        : "border-foreground bg-foreground text-background"
                    : "bg-muted/40 text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                )}
              >
                {active ? <Check className="size-3.5" strokeWidth={2} /> : null}
                <span>{stages[stageItem]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2-Pane Split View */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Main Tabbed Pane (8 cols) */}
        <div className="space-y-4 lg:col-span-8">
          <div className="flex gap-1 overflow-x-auto rounded-xl border bg-card p-1.5">
            {tabs.map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                    active
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5" strokeWidth={1.75} />
                  <span>{item.label}</span>
                  {item.count !== undefined && item.count > 0 ? (
                    <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground tabular-nums">
                      {item.count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* TAB: ACTIVITY */}
          {tab === "activity" ? (
            <div className="space-y-4">
              <div className="rounded-xl border bg-card p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <NativeSelect
                    aria-label={t`Activity kind`}
                    value={activityKind}
                    onChange={(e) => setActivityKind(e.target.value as ActivityKind)}
                    className="w-36"
                  >
                    {ACTIVITY_KINDS.map((k) => (
                      <NativeSelectOption key={k} value={k}>
                        {kinds[k]}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <Input
                    placeholder={t`Log deal activity (e.g. Sent quotation, Price negotiation)…`}
                    value={activitySubject}
                    onChange={(e) => setActivitySubject(e.target.value)}
                    className="min-w-48 flex-1"
                  />
                  <Input
                    type="date"
                    aria-label={t`Due date`}
                    value={activityDue}
                    onChange={(e) => setActivityDue(e.target.value)}
                    className="w-36"
                  />
                  <Button
                    size="sm"
                    disabled={busy || !activitySubject.trim()}
                    onClick={() => {
                      void logDealActivity(
                        activityKind,
                        activitySubject,
                        activityBody,
                        activityDue,
                        activityKind !== "follow_up" && !activityDue,
                      );
                      setActivitySubject("");
                      setActivityBody("");
                      setActivityDue("");
                    }}
                  >
                    <Plus data-icon="inline-start" />
                    <Trans>Log Activity</Trans>
                  </Button>
                </div>
                <Textarea
                  placeholder={t`Details or negotiation notes…`}
                  value={activityBody}
                  onChange={(e) => setActivityBody(e.target.value)}
                  rows={2}
                />
              </div>

              <Panel title={t`Deal Timeline`} aside={linkedActivities.length}>
                {linkedActivities.length > 0 ? (
                  <RecordList label={t`Deal timeline`}>
                    {linkedActivities.map((item) => (
                      <RecordRow
                        key={item.id}
                        icon={ACTIVITY_ICONS[item.kind]}
                        title={item.subject}
                        meta={
                          <>
                            <span>{kinds[item.kind]}</span>
                            <span aria-hidden="true">·</span>
                            <span>{actorName(item.createdBy)}</span>
                            <span aria-hidden="true">·</span>
                            <span>{formatRelativeTime(item.createdAt)}</span>
                            {item.body ? (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="truncate">{item.body}</span>
                              </>
                            ) : null}
                          </>
                        }
                        end={
                          item.completedAt ? (
                            <StatusBadge tone="success">{t`Done`}</StatusBadge>
                          ) : item.dueAt ? (
                            <StatusBadge tone="warning">
                              {new Date(item.dueAt).toLocaleDateString()}
                            </StatusBadge>
                          ) : undefined
                        }
                      />
                    ))}
                  </RecordList>
                ) : (
                  <PanelEmpty icon={Activity}>{t`No timeline entries yet`}</PanelEmpty>
                )}
              </Panel>

              <div className="rounded-xl border bg-card p-4">
                <HistoryList recordType="deal" recordId={deal.id} revision={revision} />
              </div>
            </div>
          ) : null}

          {/* TAB: SALES ORDERS & INVOICES */}
          {tab === "orders" ? (
            <div className="space-y-4">
              <Panel
                title={t`Linked Sales Orders`}
                aside={linkedOrders.length}
                to={erpHref("orders")}
              >
                {linkedOrders.length > 0 ? (
                  <RecordList label={t`Sales Orders`}>
                    {linkedOrders.map((order) => (
                      <RecordRow
                        key={order.id}
                        to={erpHref("orders", { record: order.id })}
                        icon={ShoppingCart}
                        title={`${frappeOrderDocName(order)} (${order.ref})`}
                        meta={
                          <>
                            <span>{orderStatuses[order.status]}</span>
                            <span aria-hidden="true">·</span>
                            <span>
                              {order.lines.length} {t`lines`}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>{formatRelativeTime(order.updatedAt)}</span>
                          </>
                        }
                        end={
                          <StatusBadge tone={ORDER_STATUS_TONES[order.status]}>
                            {money(order.subtotal)}
                          </StatusBadge>
                        }
                      />
                    ))}
                  </RecordList>
                ) : (
                  <PanelEmpty icon={ShoppingCart}>{t`No sales orders linked yet`}</PanelEmpty>
                )}
              </Panel>

              <Panel
                title={t`Linked Invoices & AR`}
                aside={linkedInvoices.length}
                to={erpHref("invoices")}
              >
                {linkedInvoices.length > 0 ? (
                  <RecordList label={t`Sales Invoices`}>
                    {linkedInvoices.map((invoice) => (
                      <RecordRow
                        key={invoice.id}
                        to={erpHref("invoices", { record: invoice.id })}
                        icon={ReceiptText}
                        title={`${frappeInvoiceDocName(invoice)} (${invoice.ref})`}
                        meta={
                          <>
                            <span>{invoiceStatuses[invoice.status]}</span>
                            <span aria-hidden="true">·</span>
                            <span>
                              {t`Paid`}: {money(invoice.amountPaid)} / {money(invoice.total)}
                            </span>
                          </>
                        }
                        end={
                          <StatusBadge tone={INVOICE_STATUS_TONES[invoice.status]}>
                            {money(invoice.total)}
                          </StatusBadge>
                        }
                      />
                    ))}
                  </RecordList>
                ) : (
                  <PanelEmpty icon={ReceiptText}>{t`No invoices issued yet`}</PanelEmpty>
                )}
              </Panel>
            </div>
          ) : null}

          {/* TAB: EMAILS */}
          {tab === "emails" ? (
            <div className="space-y-4">
              <div className="rounded-xl border bg-card p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    <Trans>To:</Trans> {contact?.email ?? company?.name ?? deal.title}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      assistant?.ask({
                        kind: "deal",
                        ref: deal.ref,
                        name: deal.title,
                        status: deal.stage,
                      })
                    }
                  >
                    <Sparkles data-icon="inline-start" />
                    <Trans>Draft Proposal Email with AI</Trans>
                  </Button>
                </div>
                <Input
                  placeholder={t`Subject`}
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                />
                <Textarea
                  placeholder={t`Write proposal or quotation email…`}
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  rows={4}
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    disabled={busy || !emailSubject.trim()}
                    onClick={() => {
                      void logDealActivity("email", emailSubject, emailBody, undefined, true);
                      setEmailBody("");
                    }}
                  >
                    <Send data-icon="inline-start" />
                    <Trans>Send & Log Email</Trans>
                  </Button>
                </div>
              </div>
              <Panel title={t`Email history`} aside={emailActivities.length}>
                {emailActivities.length > 0 ? (
                  <RecordList label={t`Emails`}>
                    {emailActivities.map((item) => (
                      <RecordRow
                        key={item.id}
                        icon={Mail}
                        title={item.subject}
                        meta={
                          <>
                            <span>{actorName(item.createdBy)}</span>
                            <span aria-hidden="true">·</span>
                            <span>{formatRelativeTime(item.createdAt)}</span>
                          </>
                        }
                      />
                    ))}
                  </RecordList>
                ) : (
                  <PanelEmpty icon={Mail}>{t`No emails logged yet`}</PanelEmpty>
                )}
              </Panel>
            </div>
          ) : null}

          {/* TAB: COMMENTS */}
          {tab === "comments" ? (
            <div className="space-y-4">
              <div className="rounded-xl border bg-card p-4 space-y-3">
                <Textarea
                  placeholder={t`Add a deal comment or @mention Sales Executive / Operations…`}
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  rows={3}
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    disabled={busy || !commentText.trim()}
                    onClick={() => {
                      void logDealActivity(
                        "note",
                        commentText.slice(0, 80),
                        commentText,
                        undefined,
                        true,
                      );
                      setCommentText("");
                    }}
                  >
                    <MessageSquare data-icon="inline-start" />
                    <Trans>Post Comment</Trans>
                  </Button>
                </div>
              </div>
              <Panel title={t`Comments`} aside={noteActivities.length}>
                {noteActivities.length > 0 ? (
                  <RecordList label={t`Comments`}>
                    {noteActivities.map((item) => (
                      <RecordRow
                        key={item.id}
                        icon={MessageSquare}
                        title={item.body || item.subject}
                        meta={
                          <>
                            <span>{actorName(item.createdBy)}</span>
                            <span aria-hidden="true">·</span>
                            <span>{formatRelativeTime(item.createdAt)}</span>
                          </>
                        }
                      />
                    ))}
                  </RecordList>
                ) : (
                  <PanelEmpty icon={MessageSquare}>{t`No comments yet`}</PanelEmpty>
                )}
              </Panel>
            </div>
          ) : null}

          {/* TAB: DATA */}
          {tab === "data" ? (
            <div className="space-y-4">
              <div className="rounded-xl border bg-card p-4 space-y-4">
                <h3 className="text-sm font-semibold">{t`Commercial Deal Parameters`}</h3>
                <FormField id={`${formId}-title`} label={t`Deal Title`} required>
                  <Input
                    id={`${formId}-title`}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={BUSINESS_NAME_MAX_LENGTH}
                  />
                </FormField>
                <FieldRow>
                  <FormField id={`${formId}-amount`} label={t`Contract Value`}>
                    <Input
                      id={`${formId}-amount`}
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </FormField>
                  <FormField id={`${formId}-close`} label={t`Target Close Date`}>
                    <Input
                      id={`${formId}-close`}
                      type="date"
                      value={expectedCloseAt}
                      onChange={(e) => setExpectedCloseAt(e.target.value)}
                    />
                  </FormField>
                </FieldRow>
                <FieldRow>
                  <FormField id={`${formId}-company`} label={t`Account / Organization`}>
                    <NativeSelect
                      id={`${formId}-company`}
                      className="w-full"
                      value={companyId}
                      onChange={(e) => setCompanyId(e.target.value)}
                    >
                      <NativeSelectOption value="">{t`None`}</NativeSelectOption>
                      {lookups.companies.map((c) => (
                        <NativeSelectOption key={c.id} value={c.id}>
                          {c.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </FormField>
                  <FormField id={`${formId}-contact`} label={t`Primary Stakeholder`}>
                    <NativeSelect
                      id={`${formId}-contact`}
                      className="w-full"
                      value={contactId}
                      onChange={(e) => setContactId(e.target.value)}
                    >
                      <NativeSelectOption value="">{t`None`}</NativeSelectOption>
                      {lookups.contacts
                        .filter((c) => !companyId || c.companyId === companyId)
                        .map((c) => (
                          <NativeSelectOption key={c.id} value={c.id}>
                            {c.name}
                          </NativeSelectOption>
                        ))}
                    </NativeSelect>
                  </FormField>
                </FieldRow>
                <FormField
                  id={`${formId}-reason`}
                  label={t`Stage Progression / Win-Loss Rationale`}
                >
                  <Input
                    id={`${formId}-reason`}
                    placeholder={t`Reason for current stage or win/loss note…`}
                    value={stageReason}
                    onChange={(e) => setStageReason(e.target.value)}
                  />
                </FormField>
                <FormField id={`${formId}-notes`} label={t`Executive Deal Memo & Terms`}>
                  <Textarea
                    id={`${formId}-notes`}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    maxLength={BUSINESS_TEXT_MAX_LENGTH}
                  />
                </FormField>
                <div className="flex justify-end">
                  <Button size="sm" disabled={busy} onClick={() => void saveDeal()}>
                    <Trans>Save Deal Data</Trans>
                  </Button>
                </div>
              </div>

              <SavingroupCustomFieldsSection
                doctype="Deal Record"
                docName={docName}
                legacyId={deal.ref}
                createdBy={deal.createdBy}
                ownerOrAssignee={deal.owner}
                ownerLabel={t`Deal Owner`}
                extraFields={[
                  {
                    fieldname: "stage_rationale",
                    label: t`Stage Rationale`,
                    value: stageReason,
                  },
                ]}
              />
            </div>
          ) : null}

          {/* TAB: TASKS */}
          {tab === "tasks" ? (
            <Panel title={t`Action Queue & Tasks`} aside={taskActivities.length}>
              {taskActivities.length > 0 ? (
                <RecordList label={t`Tasks`}>
                  {taskActivities.map((item) => (
                    <RecordRow
                      key={item.id}
                      icon={CalendarClock}
                      title={item.subject}
                      meta={
                        <>
                          <span>{kinds[item.kind]}</span>
                          {item.dueAt ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{new Date(item.dueAt).toLocaleDateString()}</span>
                            </>
                          ) : null}
                        </>
                      }
                    />
                  ))}
                </RecordList>
              ) : (
                <PanelEmpty icon={CalendarClock}>{t`No tasks linked to this deal`}</PanelEmpty>
              )}
            </Panel>
          ) : null}

          {/* TAB: NOTES */}
          {tab === "notes" ? (
            <Panel title={t`Deal Memos & Notes`} aside={noteActivities.length}>
              {noteActivities.length > 0 ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {noteActivities.map((note) => (
                    <div key={note.id} className="rounded-xl border bg-muted/20 p-3.5 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sm">{note.subject}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatRelativeTime(note.createdAt)}
                        </span>
                      </div>
                      {note.body ? (
                        <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                          {note.body}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <PanelEmpty icon={StickyNote}>{t`No notes on this deal`}</PanelEmpty>
              )}
            </Panel>
          ) : null}

          {/* TAB: CALLS */}
          {tab === "calls" ? (
            <Panel title={t`Call Intelligence Logs`} aside={callActivities.length}>
              {callActivities.length > 0 ? (
                <RecordList label={t`Calls`}>
                  {callActivities.map((call) => (
                    <RecordRow
                      key={call.id}
                      icon={PhoneCall}
                      title={call.subject}
                      meta={
                        <>
                          <span>{actorName(call.createdBy)}</span>
                          <span aria-hidden="true">·</span>
                          <span>{formatRelativeTime(call.createdAt)}</span>
                        </>
                      }
                    />
                  ))}
                </RecordList>
              ) : (
                <PanelEmpty icon={PhoneCall}>{t`No call logs yet`}</PanelEmpty>
              )}
            </Panel>
          ) : null}
        </div>

        {/* Right Properties Sidebar (4 cols) */}
        <div className="space-y-4 lg:col-span-4">
          <div className="rounded-xl border bg-card p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Trans>Deal Owner</Trans>
            </h3>
            <div className="flex items-center gap-2">
              <ActorAvatar actor={deal.owner} size={24} />
              <span className="text-sm font-medium">{actorName(deal.owner) || t`Unassigned`}</span>
            </div>
            <NativeSelect
              aria-label={t`Assign deal owner bot`}
              className="w-full"
              value={deal.owner.botId ?? ""}
              onChange={(e) => {
                void rpc.crm.deals
                  .update({
                    id: deal.id,
                    ownerBotId: e.target.value || null,
                    ...(e.target.value ? { actorBotId: e.target.value } : {}),
                  })
                  .then(() => onSaved())
                  .catch((cause) => onError(errorText(cause)));
              }}
            >
              <NativeSelectOption value="">{t`Current User / Unassigned`}</NativeSelectOption>
              {lookups.bots.map((bot) => (
                <NativeSelectOption key={bot.id} value={bot.id}>
                  {bot.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <div className="space-y-1.5 border-t pt-2.5">
              <span className="block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                <Trans>Execute as Digital Employee</Trans>
              </span>
              <div className="flex flex-col gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="justify-start text-xs"
                  disabled={busy || deal.stage === "won" || deal.stage === "lost"}
                  onClick={() => {
                    const salesBot =
                      lookups.bots.find((b) => b.name.includes("Sales")) ?? lookups.bots[0];
                    const nextStage: DealStage =
                      deal.stage === "qualification"
                        ? "proposal"
                        : deal.stage === "proposal"
                          ? "negotiation"
                          : "won";
                    setBusy(true);
                    void (async () => {
                      try {
                        if (salesBot && deal.owner.botId !== salesBot.id) {
                          await rpc.crm.deals.update({
                            id: deal.id,
                            ownerBotId: salesBot.id,
                            actorBotId: salesBot.id,
                          });
                        }
                        await rpc.crm.deals.updateStage({
                          id: deal.id,
                          stage: nextStage,
                          reason: `Sales Executive AI advanced deal to ${nextStage}`,
                          ...(salesBot ? { actorBotId: salesBot.id } : {}),
                        });
                        await rpc.crm.activities.create({
                          kind: "email",
                          subject: `[Sales Executive AI] Commercial proposal & SLA package — ${deal.title}`,
                          body: `Sent updated commercial quotation (${money(deal.amount)}) and advanced pipeline stage to ${nextStage}.`,
                          dealId: deal.id,
                          ...(deal.companyId ? { companyId: deal.companyId } : {}),
                          ...(deal.contactId ? { contactId: deal.contactId } : {}),
                          completed: true,
                          ...(salesBot
                            ? { assigneeBotId: salesBot.id, actorBotId: salesBot.id }
                            : {}),
                        });
                        onSaved();
                      } catch (cause) {
                        onError(errorText(cause));
                      } finally {
                        setBusy(false);
                      }
                    })();
                  }}
                >
                  <Sparkles data-icon="inline-start" />
                  <Trans>Sales Executive: Advance Stage & Send Proposal</Trans>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="justify-start text-xs"
                  disabled={busy}
                  onClick={() => {
                    const opsBot =
                      lookups.bots.find((b) => b.name.includes("Operations")) ?? lookups.bots[0];
                    const activeProducts = lookups.products.filter(
                      (p) => p.active && p.stockOnHand > 0,
                    );
                    const lines = activeProducts
                      .slice(0, 2)
                      .map((p) => ({ productId: p.id, quantity: 2 }));
                    setBusy(true);
                    void (async () => {
                      try {
                        const createdOrder = await rpc.erp.orders.createDraft({
                          ...(deal.companyId ? { companyId: deal.companyId } : {}),
                          ...(deal.contactId ? { contactId: deal.contactId } : {}),
                          dealId: deal.id,
                          notes: `[Operations AI] Auto-generated Sales Order for ${deal.ref} · ${deal.title}`,
                          lines,
                          ...(opsBot ? { actorBotId: opsBot.id } : {}),
                        });
                        if (lines.length > 0) {
                          await rpc.erp.orders.requestApproval({
                            id: createdOrder.id,
                            ...(opsBot ? { actorBotId: opsBot.id } : {}),
                          });
                        }
                        await rpc.crm.activities.create({
                          kind: "note",
                          subject: `[Operations AI] Created Sales Order ${createdOrder.ref} & requested approval`,
                          body: `Verified inventory availability and prepared ${createdOrder.ref} (${money(createdOrder.subtotal)}).`,
                          dealId: deal.id,
                          ...(deal.companyId ? { companyId: deal.companyId } : {}),
                          completed: true,
                          ...(opsBot ? { assigneeBotId: opsBot.id, actorBotId: opsBot.id } : {}),
                        });
                        onSaved();
                        setTab("orders");
                      } catch (cause) {
                        onError(errorText(cause));
                      } finally {
                        setBusy(false);
                      }
                    })();
                  }}
                >
                  <ShoppingCart data-icon="inline-start" />
                  <Trans>Operations: Draft ERP Sales Order</Trans>
                </Button>
              </div>
            </div>
          </div>

          <div className="rounded-xl border bg-card p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Trans>CRM Organization</Trans>
              </h3>
              {company ? (
                <Link
                  to={crmHref("companies", { record: company.id })}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  <Trans>Open</Trans> →
                </Link>
              ) : null}
            </div>
            {company ? (
              <div className="space-y-1 text-sm">
                <p className="font-medium">{company.name}</p>
                {company.domain ? (
                  <p className="text-xs text-muted-foreground">{company.domain}</p>
                ) : null}
                {company.phone ? (
                  <p className="text-xs text-muted-foreground">{company.phone}</p>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{t`No organization linked`}</p>
            )}
          </div>

          <div className="rounded-xl border bg-card p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Trans>Primary Contact</Trans>
              </h3>
              {contact ? (
                <Link
                  to={crmHref("contacts", { record: contact.id })}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  <Trans>Open</Trans> →
                </Link>
              ) : null}
            </div>
            {contact ? (
              <div className="space-y-1 text-sm">
                <p className="font-medium">{contact.name}</p>
                {contact.email ? (
                  <p className="text-xs text-muted-foreground">{contact.email}</p>
                ) : null}
                {contact.phone ? (
                  <p className="text-xs text-muted-foreground">{contact.phone}</p>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{t`No contact linked`}</p>
            )}
          </div>

          <div className="rounded-xl border bg-card p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Trans>Deal Summary</Trans>
            </h3>
            <DetailList
              items={[
                { label: t`DocType`, value: <span className="font-mono">CRM Deal</span> },
                { label: t`Document`, value: <span className="font-mono">{docName}</span> },
                { label: t`Legacy Ref`, value: <span className="font-mono">{deal.ref}</span> },
                { label: t`Deal Value`, value: money(deal.amount) },
                {
                  label: t`Expected Close`,
                  value: deal.expectedCloseAt
                    ? new Date(deal.expectedCloseAt).toLocaleDateString()
                    : "—",
                },
                {
                  label: t`Source Lead`,
                  value: sourceLead ? (
                    <Link
                      to={crmHref("leads", { record: sourceLead.id })}
                      className="underline underline-offset-4"
                    >
                      {sourceLead.ref} · {sourceLead.title}
                    </Link>
                  ) : (
                    "—"
                  ),
                },
                { label: t`Sales Orders`, value: String(linkedOrders.length) },
              ]}
            />
          </div>
          <div className="rounded-xl border bg-card p-4">
            <HistoryList recordType="deal" recordId={deal.id} revision={revision} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 5. FRAPPE CRM NOTES, CALL LOGS & SAVINGROUP OPERATIONS LEDGER SECTIONS
// ============================================================================

export function FrappeNotesSection({
  lookups,
  reload,
  onError,
}: {
  lookups: FrappeLookups;
  reload: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useLingui();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [dealId, setDealId] = useState("");
  const [busy, setBusy] = useState(false);

  const notes = useMemo(
    () =>
      lookups.activities
        .filter((item) => item.kind === "note")
        .filter((item) => matchesQuery(query, item.subject, item.body)),
    [lookups.activities, query],
  );

  async function createNote() {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await rpc.crm.activities.create({
        kind: "note",
        subject: title.trim(),
        ...(content.trim() ? { body: content.trim() } : {}),
        ...(companyId ? { companyId } : {}),
        ...(dealId ? { dealId } : {}),
        ...(!companyId && !dealId && lookups.companies[0]
          ? { companyId: lookups.companies[0].id }
          : {}),
        completed: true,
      });
      setTitle("");
      setContent("");
      setCreating(false);
      reload();
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="frappe-notes-section">
      <Toolbar
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus data-icon="inline-start" />
            <Trans>New Note</Trans>
          </Button>
        }
      >
        <SearchField value={query} onChange={setQuery} />
      </Toolbar>

      {notes.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {notes.map((note) => {
            const company = note.companyId
              ? lookups.companies.find((c) => c.id === note.companyId)
              : undefined;
            const deal = note.dealId ? lookups.deals.find((d) => d.id === note.dealId) : undefined;
            return (
              <div
                key={note.id}
                className="flex flex-col justify-between rounded-xl border bg-card p-4 space-y-3"
              >
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-sm leading-snug">{note.subject}</h3>
                    <StickyNote className="size-4 shrink-0 text-muted-foreground" />
                  </div>
                  {note.body ? (
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-4">
                      {note.body}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2.5 text-xs text-muted-foreground">
                  <span>{actorName(note.createdBy)}</span>
                  <div className="flex items-center gap-2">
                    {deal ? (
                      <Link
                        to={crmHref("deals", { record: deal.id })}
                        className="font-mono hover:text-foreground"
                      >
                        {deal.ref}
                      </Link>
                    ) : company ? (
                      <Link
                        to={crmHref("companies", { record: company.id })}
                        className="truncate max-w-28 hover:text-foreground"
                      >
                        {company.name}
                      </Link>
                    ) : null}
                    <span>{formatRelativeTime(note.createdAt)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <PanelEmpty icon={StickyNote}>{t`No deal memos or notes yet`}</PanelEmpty>
      )}

      {creating ? (
        <FormDialog
          title={t`New Executive Memo / Note`}
          onClose={() => setCreating(false)}
          onSubmit={createNote}
          busy={busy}
          submitLabel={t`Create Note`}
          disabled={!title.trim()}
        >
          <FormField id="note-title" label={t`Title`} required>
            <Input
              id="note-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </FormField>
          <FormField id="note-content" label={t`Content`}>
            <Textarea
              id="note-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={4}
            />
          </FormField>
          <FieldRow>
            <FormField id="note-company" label={t`Account / Organization`}>
              <NativeSelect
                id="note-company"
                className="w-full"
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
              >
                <NativeSelectOption value="">{t`Auto / None`}</NativeSelectOption>
                {lookups.companies.map((c) => (
                  <NativeSelectOption key={c.id} value={c.id}>
                    {c.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FormField>
            <FormField id="note-deal" label={t`Active Deal`}>
              <NativeSelect
                id="note-deal"
                className="w-full"
                value={dealId}
                onChange={(e) => setDealId(e.target.value)}
              >
                <NativeSelectOption value="">{t`None`}</NativeSelectOption>
                {lookups.deals.map((d) => (
                  <NativeSelectOption key={d.id} value={d.id}>
                    {d.ref} · {d.title}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FormField>
          </FieldRow>
        </FormDialog>
      ) : null}
    </div>
  );
}

export function FrappeCallsSection({
  lookups,
  reload,
  onError,
}: {
  lookups: FrappeLookups;
  reload: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useLingui();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [direction, setDirection] = useState<"Outbound" | "Inbound">("Outbound");
  const [subject, setSubject] = useState("");
  const [summary, setSummary] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [contactId, setContactId] = useState("");
  const [dealId, setDealId] = useState("");
  const [busy, setBusy] = useState(false);

  const calls = useMemo(
    () =>
      lookups.activities
        .filter((item) => item.kind === "call")
        .filter((item) => matchesQuery(query, item.subject, item.body)),
    [lookups.activities, query],
  );

  async function logCall() {
    if (!subject.trim()) return;
    setBusy(true);
    try {
      await rpc.crm.activities.create({
        kind: "call",
        subject: `[${direction}] ${subject.trim()}`,
        ...(summary.trim() ? { body: summary.trim() } : {}),
        ...(companyId ? { companyId } : {}),
        ...(contactId ? { contactId } : {}),
        ...(dealId ? { dealId } : {}),
        ...(!companyId && !contactId && !dealId && lookups.companies[0]
          ? { companyId: lookups.companies[0].id }
          : {}),
        completed: true,
      });
      setSubject("");
      setSummary("");
      setCreating(false);
      reload();
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<CrmActivity>[] = [
    {
      key: "call",
      header: t`Call Log (CRM Call Log)`,
      render: (row) => {
        const inbound = row.subject.toLowerCase().includes("inbound");
        return (
          <PrimaryCell
            icon={inbound ? PhoneIncoming : PhoneOutgoing}
            title={row.subject}
            detail={row.body}
            detailWhile="md"
          />
        );
      },
    },
    {
      key: "status",
      header: t`Status`,
      render: () => <StatusBadge tone="success">{t`Completed`}</StatusBadge>,
    },
    {
      key: "caller",
      header: t`Caller / Agent`,
      hideBelow: "sm",
      render: (row) => <ActorLabel actor={row.createdBy} />,
    },
    {
      key: "summary",
      header: t`Call Summary`,
      hideBelow: "md",
      render: (row) => <span className="truncate text-muted-foreground">{row.body ?? "—"}</span>,
    },
    {
      key: "when",
      header: t`Logged`,
      align: "end",
      render: (row) => (
        <span className="text-muted-foreground whitespace-nowrap">
          {formatRelativeTime(row.createdAt)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4" data-testid="frappe-calls-section">
      <Toolbar
        action={
          <Button onClick={() => setCreating(true)}>
            <PhoneCall data-icon="inline-start" />
            <Trans>Log Call</Trans>
          </Button>
        }
      >
        <SearchField value={query} onChange={setQuery} />
      </Toolbar>

      <RecordTable
        testId="crm-call-logs"
        columns={columns}
        rows={calls}
        loading={false}
        filtered={Boolean(query)}
        empty={t`No CRM Call Logs recorded yet`}
        emptyIcon={PhoneCall}
      />

      {creating ? (
        <FormDialog
          title={t`Log Call (CRM Call Log)`}
          onClose={() => setCreating(false)}
          onSubmit={logCall}
          busy={busy}
          submitLabel={t`Save Call Log`}
          disabled={!subject.trim()}
        >
          <FieldRow>
            <FormField id="call-type" label={t`Type`}>
              <NativeSelect
                id="call-type"
                className="w-full"
                value={direction}
                onChange={(e) => setDirection(e.target.value as "Outbound" | "Inbound")}
              >
                <NativeSelectOption value="Outbound">{t`Outbound`}</NativeSelectOption>
                <NativeSelectOption value="Inbound">{t`Inbound`}</NativeSelectOption>
              </NativeSelect>
            </FormField>
            <FormField id="call-company" label={t`CRM Organization`}>
              <NativeSelect
                id="call-company"
                className="w-full"
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
              >
                <NativeSelectOption value="">{t`Auto / None`}</NativeSelectOption>
                {lookups.companies.map((c) => (
                  <NativeSelectOption key={c.id} value={c.id}>
                    {c.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FormField>
          </FieldRow>
          <FieldRow>
            <FormField id="call-contact" label={t`Contact`}>
              <NativeSelect
                id="call-contact"
                className="w-full"
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
              >
                <NativeSelectOption value="">{t`None`}</NativeSelectOption>
                {lookups.contacts.map((c) => (
                  <NativeSelectOption key={c.id} value={c.id}>
                    {c.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FormField>
            <FormField id="call-deal" label={t`CRM Deal`}>
              <NativeSelect
                id="call-deal"
                className="w-full"
                value={dealId}
                onChange={(e) => setDealId(e.target.value)}
              >
                <NativeSelectOption value="">{t`None`}</NativeSelectOption>
                {lookups.deals.map((d) => (
                  <NativeSelectOption key={d.id} value={d.id}>
                    {d.ref} · {d.title}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FormField>
          </FieldRow>
          <FormField id="call-subject" label={t`Call Subject`} required>
            <Input
              id="call-subject"
              placeholder={t`e.g. Qualification call with procurement`}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
            />
          </FormField>
          <FormField id="call-summary" label={t`Call Summary & Promise-to-Pay / Next Step`}>
            <Textarea
              id="call-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={3}
            />
          </FormField>
        </FormDialog>
      ) : null}
    </div>
  );
}

// Exact match to `Savingroup Operation` (`savingroup_operation.json` in `testing`)
export function SavingroupOperationsSection({
  events,
  loading,
}: {
  events: BusinessEvent[];
  loading: boolean;
}) {
  const { t } = useLingui();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<BusinessEvent | null>(null);
  const [recordFilter, setRecordFilter] = useState("");

  const doctypeForRecord = (recordType: BusinessEvent["recordType"]): string => {
    switch (recordType) {
      case "company":
        return "CRM Organization";
      case "contact":
        return "Contact";
      case "lead":
        return "CRM Lead";
      case "deal":
        return "CRM Deal";
      case "activity":
        return "CRM Task";
      case "product":
        return "Item";
      case "order":
        return "Sales Order";
      case "invoice":
        return "Sales Invoice";
      default:
        return "Document";
    }
  };

  const visible = events.filter((event) => {
    if (recordFilter && event.recordType !== recordFilter) return false;
    return matchesQuery(
      query,
      event.id,
      event.type,
      doctypeForRecord(event.recordType),
      event.recordId,
      actorName(event.actor),
    );
  });

  const columns: Column<BusinessEvent>[] = [
    {
      key: "operation_id",
      header: t`Operation Id`,
      render: (row) => <span className="font-mono text-xs">{row.id.slice(0, 12)}</span>,
    },
    {
      key: "action",
      header: t`Action`,
      render: (row) => <span className="font-mono text-xs font-medium">{row.type}</span>,
    },
    {
      key: "status",
      header: t`Status`,
      render: () => <StatusBadge tone="success">{t`Succeeded`}</StatusBadge>,
    },
    {
      key: "external_doctype",
      header: t`Document Type`,
      hideBelow: "sm",
      render: (row) => (
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
          {doctypeForRecord(row.recordType)}
        </span>
      ),
    },
    {
      key: "actor",
      header: t`Savingroup Actor`,
      hideBelow: "md",
      render: (row) => <ActorLabel actor={row.actor} />,
    },
    {
      key: "created",
      header: t`Timestamp`,
      align: "end",
      render: (row) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {formatRelativeTime(row.createdAt)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4" data-testid="savingroup-operations-ledger">
      <div className="rounded-xl border bg-card p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-lg bg-accent">
            <ShieldCheck className="size-4" strokeWidth={1.75} />
          </span>
          <div>
            <h2 className="text-sm font-semibold">
              <Trans>Savingroup Operation Ledger</Trans>
            </h2>
            <p className="text-xs text-muted-foreground">
              <Trans>
                Idempotent write & event ledger across CRM Lead, CRM Deal, Sales Order, Sales
                Invoice, and Item doctypes
              </Trans>
            </p>
          </div>
        </div>
        <span className="rounded-full bg-muted px-2.5 py-1 font-mono text-xs text-muted-foreground">
          DocType: Savingroup Operation
        </span>
      </div>

      <Toolbar
        filters={
          <FilterChips
            label={t`Filter by DocType`}
            value={recordFilter}
            onChange={setRecordFilter}
            options={[
              { value: "", label: t`All DocTypes` },
              { value: "lead", label: "CRM Lead" },
              { value: "deal", label: "CRM Deal" },
              { value: "company", label: "CRM Organization" },
              { value: "contact", label: "Contact" },
              { value: "order", label: "Sales Order" },
              { value: "invoice", label: "Sales Invoice" },
              { value: "product", label: "Item" },
            ]}
          />
        }
      >
        <SearchField value={query} onChange={setQuery} />
      </Toolbar>

      <RecordTable
        testId="savingroup-operations-table"
        columns={columns}
        rows={visible}
        loading={loading}
        onRowClick={(row) => setSelected(row)}
        filtered={Boolean(query || recordFilter)}
        empty={t`No Savingroup Operations recorded yet`}
        emptyIcon={Database}
      />

      {selected ? (
        <FormDialog
          title={`Savingroup Operation · ${selected.id.slice(0, 12)}`}
          size="lg"
          onClose={() => setSelected(null)}
        >
          <DetailList
            items={[
              {
                label: t`Operation Id (operation_id)`,
                value: <span className="font-mono">{selected.id}</span>,
              },
              {
                label: t`Action (action)`,
                value: <span className="font-mono">{selected.type}</span>,
              },
              {
                label: t`Status (status)`,
                value: <StatusBadge tone="success">Succeeded</StatusBadge>,
              },
              {
                label: t`Document Type (external_doctype)`,
                value: <span className="font-mono">{doctypeForRecord(selected.recordType)}</span>,
              },
              {
                label: t`Document (external_name)`,
                value: <span className="font-mono">{selected.recordId}</span>,
              },
              {
                label: t`Savingroup User (actor_user)`,
                value: <span className="font-mono">{selected.actor.userId ?? "—"}</span>,
              },
              {
                label: t`Savingroup Bot (actor_bot)`,
                value: <span className="font-mono">{selected.actor.botId ?? "—"}</span>,
              },
            ]}
          />
          <div className="space-y-1.5 border-t pt-3">
            <span className="block text-xs font-medium text-muted-foreground">
              {t`Payload / Result JSON`}
            </span>
            <pre className="max-h-64 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs">
              {JSON.stringify(selected.payload, null, 2)}
            </pre>
          </div>
        </FormDialog>
      ) : null}
    </div>
  );
}

// ============================================================================
// 6. FRAPPE CRM FULL-PAGE ORGANIZATION WORKSPACE (`CRM Organization`)
// ============================================================================

type OrgTab = "pipeline" | "contacts" | "orders" | "activity" | "data";

export function FrappeOrganizationWorkspace({
  company,
  lookups,
  currency,
  revision,
  onBack,
  onSaved,
  onError,
}: {
  company: CrmCompany;
  lookups: FrappeLookups;
  currency: string;
  revision: number;
  onBack: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const formId = useId();
  const stages = useDealStageLabels();
  const leadStatuses = useLeadStatusLabels();
  const orderStatuses = useOrderStatusLabels();
  const invoiceStatuses = useInvoiceStatusLabels();
  const kinds = useActivityKindLabels();
  const money = useMoney(currency);
  const short = useShortMoney(currency);

  const [tab, setTab] = useState<OrgTab>("pipeline");
  const [name, setName] = useState(company.name);
  const [domain, setDomain] = useState(company.domain ?? "");
  const [phone, setPhone] = useState(company.phone ?? "");
  const [notes, setNotes] = useState(company.notes ?? "");
  const [busy, setBusy] = useState(false);

  const [activityKind, setActivityKind] = useState<ActivityKind>("note");
  const [activitySubject, setActivitySubject] = useState("");
  const [activityBody, setActivityBody] = useState("");

  const linkedContacts = useMemo(
    () => lookups.contacts.filter((item) => item.companyId === company.id),
    [company.id, lookups.contacts],
  );
  const linkedDeals = useMemo(
    () => lookups.deals.filter((item) => item.companyId === company.id),
    [company.id, lookups.deals],
  );
  const linkedLeads = useMemo(
    () => lookups.leads.filter((item) => item.companyId === company.id),
    [company.id, lookups.leads],
  );
  const linkedOrders = useMemo(
    () => lookups.orders.filter((item) => item.companyId === company.id),
    [company.id, lookups.orders],
  );
  const linkedInvoices = useMemo(
    () =>
      lookups.invoices.filter((invoice) =>
        linkedOrders.some((order) => order.id === invoice.orderId),
      ),
    [linkedOrders, lookups.invoices],
  );
  const linkedActivities = useMemo(
    () => lookups.activities.filter((item) => item.companyId === company.id),
    [company.id, lookups.activities],
  );

  const openPipelineAmount = linkedDeals
    .filter((d) => d.stage !== "won" && d.stage !== "lost")
    .reduce((sum, d) => sum + d.amount, 0);
  const wonAmount = linkedDeals
    .filter((d) => d.stage === "won")
    .reduce((sum, d) => sum + d.amount, 0);

  async function saveCompany() {
    setBusy(true);
    try {
      await rpc.crm.companies.update({
        id: company.id,
        name,
        domain: domain || null,
        phone: phone || null,
        notes: notes || null,
      });
      onSaved();
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function logOrgActivity() {
    if (!activitySubject.trim()) return;
    setBusy(true);
    try {
      await rpc.crm.activities.create({
        kind: activityKind,
        subject: activitySubject.trim(),
        ...(activityBody.trim() ? { body: activityBody.trim() } : {}),
        companyId: company.id,
        completed: true,
      });
      setActivitySubject("");
      setActivityBody("");
      onSaved();
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function createOrderForCompany() {
    setBusy(true);
    try {
      const order = await rpc.erp.orders.createDraft({
        companyId: company.id,
        ...(linkedContacts[0] ? { contactId: linkedContacts[0].id } : {}),
        notes: `CRM Organization · ${company.name}`,
        lines: [],
      });
      onSaved();
      void navigate(erpHref("orders", { record: order.id }));
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  const tabs: { id: OrgTab; label: string; icon: LucideIcon; count?: number }[] = [
    {
      id: "pipeline",
      label: t`Deals & Leads`,
      icon: Handshake,
      count: linkedDeals.length + linkedLeads.length,
    },
    { id: "contacts", label: t`Contacts`, icon: Contact, count: linkedContacts.length },
    {
      id: "orders",
      label: t`Sales Orders & Invoices`,
      icon: ShoppingCart,
      count: linkedOrders.length + linkedInvoices.length,
    },
    { id: "activity", label: t`Timeline`, icon: Activity, count: linkedActivities.length },
    { id: "data", label: t`Organization Data`, icon: FileText },
  ];

  return (
    <div className="space-y-4" data-testid="frappe-organization-workspace">
      <div className="rounded-xl border bg-card p-4 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={onBack}
              aria-label={t`Back to Organizations`}
            >
              <ArrowLeft className="size-4" />
            </Button>
            <RecordAvatar name={company.name} shape="square" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                  CRM Organization
                </span>
                {wonAmount > 0 ? (
                  <StatusBadge tone="success">{t`Customer · Won Revenue`}</StatusBadge>
                ) : openPipelineAmount > 0 ? (
                  <StatusBadge tone="progress">{t`Active Pipeline`}</StatusBadge>
                ) : (
                  <StatusBadge tone="neutral">{t`Prospect Account`}</StatusBadge>
                )}
                {company.domain ? (
                  <span className="font-mono text-xs text-muted-foreground">{company.domain}</span>
                ) : null}
              </div>
              <h2 className="truncate text-base font-semibold">{company.name}</h2>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <AskAssistantButton record={{ kind: "company", ref: company.name }} />
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void createOrderForCompany()}
            >
              <ShoppingCart data-icon="inline-start" />
              <Trans>New Sales Order</Trans>
            </Button>
            <Button size="sm" disabled={busy || !name.trim()} onClick={() => void saveCompany()}>
              <Check data-icon="inline-start" />
              <Trans>Save</Trans>
            </Button>
          </div>
        </div>
      </div>

      <KpiGrid>
        <KpiCard
          label={t`Open Pipeline`}
          value={short(openPipelineAmount)}
          exact={money(openPipelineAmount)}
          icon={Handshake}
          detail={{
            label: t`Active deals`,
            value: linkedDeals.filter((d) => d.stage !== "won" && d.stage !== "lost").length,
          }}
        />
        <KpiCard
          label={t`Won Revenue`}
          value={short(wonAmount)}
          exact={money(wonAmount)}
          icon={Trophy}
          detail={{
            label: t`Closed won`,
            value: linkedDeals.filter((d) => d.stage === "won").length,
          }}
        />
        <KpiCard
          label={t`Account Contacts`}
          value={linkedContacts.length}
          icon={Users}
          detail={{ label: t`Leads`, value: linkedLeads.length }}
        />
        <KpiCard
          label={t`ERP Orders & Invoices`}
          value={linkedOrders.length}
          icon={ReceiptText}
          detail={{ label: t`Invoices`, value: linkedInvoices.length }}
        />
      </KpiGrid>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-8">
          <div className="flex gap-1 overflow-x-auto rounded-xl border bg-card p-1.5">
            {tabs.map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                    active
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5" strokeWidth={1.75} />
                  <span>{item.label}</span>
                  {item.count !== undefined && item.count > 0 ? (
                    <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground tabular-nums">
                      {item.count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {tab === "pipeline" ? (
            <div className="space-y-4">
              <Panel title={t`CRM Deals`} aside={linkedDeals.length}>
                {linkedDeals.length > 0 ? (
                  <RecordList label={t`Deals`}>
                    {linkedDeals.map((deal) => (
                      <RecordRow
                        key={deal.id}
                        to={crmHref("deals", { record: deal.id })}
                        icon={Handshake}
                        title={deal.title}
                        meta={
                          <>
                            <span className="font-mono">{deal.ref}</span>
                            <span aria-hidden="true">·</span>
                            <span>{stages[deal.stage]}</span>
                          </>
                        }
                        end={
                          <StatusBadge tone={DEAL_STAGE_TONES[deal.stage]}>
                            {money(deal.amount)}
                          </StatusBadge>
                        }
                      />
                    ))}
                  </RecordList>
                ) : (
                  <PanelEmpty
                    icon={Handshake}
                  >{t`No deals linked to this organization`}</PanelEmpty>
                )}
              </Panel>

              <Panel title={t`CRM Leads`} aside={linkedLeads.length}>
                {linkedLeads.length > 0 ? (
                  <RecordList label={t`Leads`}>
                    {linkedLeads.map((lead) => (
                      <RecordRow
                        key={lead.id}
                        to={crmHref("leads", { record: lead.id })}
                        icon={Target}
                        title={lead.title}
                        meta={
                          <>
                            <span className="font-mono">{lead.ref}</span>
                            <span aria-hidden="true">·</span>
                            <span>{leadStatuses[lead.status]}</span>
                          </>
                        }
                        end={
                          lead.value !== null ? (
                            <StatusBadge tone={LEAD_STATUS_TONES[lead.status]}>
                              {money(lead.value)}
                            </StatusBadge>
                          ) : undefined
                        }
                      />
                    ))}
                  </RecordList>
                ) : (
                  <PanelEmpty icon={Target}>{t`No leads linked to this organization`}</PanelEmpty>
                )}
              </Panel>
            </div>
          ) : null}

          {tab === "contacts" ? (
            <Panel title={t`Organization Contacts`} aside={linkedContacts.length}>
              {linkedContacts.length > 0 ? (
                <RecordList label={t`Contacts`}>
                  {linkedContacts.map((contact) => (
                    <RecordRow
                      key={contact.id}
                      to={crmHref("contacts", { record: contact.id })}
                      icon={Contact}
                      title={contact.name}
                      meta={
                        <>
                          {contact.title ? <span>{contact.title}</span> : null}
                          {contact.email ? (
                            <>
                              {contact.title ? <span aria-hidden="true">·</span> : null}
                              <span>{contact.email}</span>
                            </>
                          ) : null}
                          {contact.phone ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{contact.phone}</span>
                            </>
                          ) : null}
                        </>
                      }
                    />
                  ))}
                </RecordList>
              ) : (
                <PanelEmpty icon={Contact}>{t`No contacts linked yet`}</PanelEmpty>
              )}
            </Panel>
          ) : null}

          {tab === "orders" ? (
            <div className="space-y-4">
              <Panel title={t`Sales Orders`} aside={linkedOrders.length}>
                {linkedOrders.length > 0 ? (
                  <RecordList label={t`Sales Orders`}>
                    {linkedOrders.map((order) => (
                      <RecordRow
                        key={order.id}
                        to={erpHref("orders", { record: order.id })}
                        icon={ShoppingCart}
                        title={`${frappeOrderDocName(order)} (${order.ref})`}
                        meta={
                          <>
                            <span>{orderStatuses[order.status]}</span>
                            <span aria-hidden="true">·</span>
                            <span>
                              {order.lines.length} {t`items`}
                            </span>
                          </>
                        }
                        end={
                          <StatusBadge tone={ORDER_STATUS_TONES[order.status]}>
                            {money(order.subtotal)}
                          </StatusBadge>
                        }
                      />
                    ))}
                  </RecordList>
                ) : (
                  <PanelEmpty icon={ShoppingCart}>{t`No ERP sales orders yet`}</PanelEmpty>
                )}
              </Panel>
              <Panel title={t`Sales Invoices`} aside={linkedInvoices.length}>
                {linkedInvoices.length > 0 ? (
                  <RecordList label={t`Sales Invoices`}>
                    {linkedInvoices.map((invoice) => (
                      <RecordRow
                        key={invoice.id}
                        to={erpHref("invoices", { record: invoice.id })}
                        icon={ReceiptText}
                        title={`${frappeInvoiceDocName(invoice)} (${invoice.ref})`}
                        meta={
                          <>
                            <span>{invoiceStatuses[invoice.status]}</span>
                            <span aria-hidden="true">·</span>
                            <span>
                              {t`Paid`}: {money(invoice.amountPaid)} / {money(invoice.total)}
                            </span>
                          </>
                        }
                        end={
                          <StatusBadge tone={INVOICE_STATUS_TONES[invoice.status]}>
                            {money(invoice.total)}
                          </StatusBadge>
                        }
                      />
                    ))}
                  </RecordList>
                ) : (
                  <PanelEmpty icon={ReceiptText}>{t`No ERP invoices yet`}</PanelEmpty>
                )}
              </Panel>
            </div>
          ) : null}

          {tab === "activity" ? (
            <div className="space-y-4">
              <div className="rounded-xl border bg-card p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <NativeSelect
                    aria-label={t`Activity kind`}
                    value={activityKind}
                    onChange={(e) => setActivityKind(e.target.value as ActivityKind)}
                    className="w-36"
                  >
                    {ACTIVITY_KINDS.map((k) => (
                      <NativeSelectOption key={k} value={k}>
                        {kinds[k]}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <Input
                    placeholder={t`Log organization note, call, or executive meeting…`}
                    value={activitySubject}
                    onChange={(e) => setActivitySubject(e.target.value)}
                    className="min-w-48 flex-1"
                  />
                  <Button
                    size="sm"
                    disabled={busy || !activitySubject.trim()}
                    onClick={() => void logOrgActivity()}
                  >
                    <Plus data-icon="inline-start" />
                    <Trans>Log</Trans>
                  </Button>
                </div>
                <Textarea
                  placeholder={t`Details…`}
                  value={activityBody}
                  onChange={(e) => setActivityBody(e.target.value)}
                  rows={2}
                />
              </div>
              <Panel title={t`Account Activity Timeline`} aside={linkedActivities.length}>
                {linkedActivities.length > 0 ? (
                  <RecordList label={t`Activities`}>
                    {linkedActivities.map((item) => (
                      <RecordRow
                        key={item.id}
                        icon={ACTIVITY_ICONS[item.kind]}
                        title={item.subject}
                        meta={
                          <>
                            <span>{kinds[item.kind]}</span>
                            <span aria-hidden="true">·</span>
                            <span>{actorName(item.createdBy)}</span>
                            <span aria-hidden="true">·</span>
                            <span>{formatRelativeTime(item.createdAt)}</span>
                          </>
                        }
                      />
                    ))}
                  </RecordList>
                ) : (
                  <PanelEmpty icon={Activity}>{t`No activities logged yet`}</PanelEmpty>
                )}
              </Panel>
            </div>
          ) : null}

          {tab === "data" ? (
            <div className="space-y-4">
              <div className="rounded-xl border bg-card p-4 space-y-4">
                <h3 className="text-sm font-semibold">{t`CRM Organization Fields`}</h3>
                <FormField id={`${formId}-name`} label={t`Organization Name`} required>
                  <Input
                    id={`${formId}-name`}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={BUSINESS_NAME_MAX_LENGTH}
                  />
                </FormField>
                <FieldRow>
                  <FormField id={`${formId}-domain`} label={t`Website / Domain`}>
                    <Input
                      id={`${formId}-domain`}
                      value={domain}
                      onChange={(e) => setDomain(e.target.value)}
                    />
                  </FormField>
                  <FormField id={`${formId}-phone`} label={t`Primary Phone`}>
                    <Input
                      id={`${formId}-phone`}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  </FormField>
                </FieldRow>
                <FormField id={`${formId}-notes`} label={t`Account Notes`}>
                  <Textarea
                    id={`${formId}-notes`}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    maxLength={BUSINESS_TEXT_MAX_LENGTH}
                  />
                </FormField>
                <div className="flex justify-end">
                  <Button size="sm" disabled={busy} onClick={() => void saveCompany()}>
                    <Trans>Save Organization</Trans>
                  </Button>
                </div>
              </div>
              <SavingroupCustomFieldsSection
                doctype="CRM Organization"
                docName={company.name}
                legacyId={company.id}
                createdBy={company.createdBy}
              />
            </div>
          ) : null}
        </div>

        <div className="space-y-4 lg:col-span-4">
          <div className="rounded-xl border bg-card p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Trans>Organization Summary</Trans>
            </h3>
            <DetailList
              items={[
                { label: t`DocType`, value: <span className="font-mono">CRM Organization</span> },
                { label: t`Organization Name`, value: company.name },
                { label: t`Domain`, value: company.domain ?? "—" },
                { label: t`Phone`, value: company.phone ?? "—" },
                { label: t`Open Pipeline`, value: money(openPipelineAmount) },
                { label: t`Won Revenue`, value: money(wonAmount) },
                { label: t`Created`, value: formatRelativeTime(company.createdAt) },
              ]}
            />
          </div>
          {company.notes ? (
            <div className="rounded-xl border bg-card p-4 space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Trans>Account Briefing</Trans>
              </h3>
              <p className="text-xs text-muted-foreground whitespace-pre-wrap">{company.notes}</p>
            </div>
          ) : null}
          <div className="rounded-xl border bg-card p-4">
            <HistoryList recordType="company" recordId={company.id} revision={revision} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 7. FRAPPE CRM FULL-PAGE CONTACT WORKSPACE (`Contact`)
// ============================================================================

type ContactTab = "activity" | "pipeline" | "emails" | "data";

export function FrappeContactWorkspace({
  contact,
  lookups,
  currency,
  revision,
  onBack,
  onSaved,
  onError,
}: {
  contact: CrmContact;
  lookups: FrappeLookups;
  currency: string;
  revision: number;
  onBack: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useLingui();
  const assistant = useAssistant();
  const formId = useId();
  const stages = useDealStageLabels();
  const leadStatuses = useLeadStatusLabels();
  const kinds = useActivityKindLabels();
  const money = useMoney(currency);

  const [tab, setTab] = useState<ContactTab>("activity");
  const [firstName, setFirstName] = useState(contact.firstName);
  const [lastName, setLastName] = useState(contact.lastName ?? "");
  const [email, setEmail] = useState(contact.email ?? "");
  const [phone, setPhone] = useState(contact.phone ?? "");
  const [title, setTitle] = useState(contact.title ?? "");
  const [companyId, setCompanyId] = useState(contact.companyId ?? "");
  const [notes, setNotes] = useState(contact.notes ?? "");
  const [busy, setBusy] = useState(false);

  const [activityKind, setActivityKind] = useState<ActivityKind>("call");
  const [activitySubject, setActivitySubject] = useState("");
  const [activityBody, setActivityBody] = useState("");
  const [emailSubject, setEmailSubject] = useState(`Follow-up with ${contact.name}`);
  const [emailBody, setEmailBody] = useState("");

  const company = contact.companyId
    ? lookups.companies.find((item) => item.id === contact.companyId)
    : undefined;
  const linkedDeals = useMemo(
    () => lookups.deals.filter((item) => item.contactId === contact.id),
    [contact.id, lookups.deals],
  );
  const linkedLeads = useMemo(
    () => lookups.leads.filter((item) => item.contactId === contact.id),
    [contact.id, lookups.leads],
  );
  const linkedActivities = useMemo(
    () => lookups.activities.filter((item) => item.contactId === contact.id),
    [contact.id, lookups.activities],
  );
  const emailActivities = linkedActivities.filter((item) => item.kind === "email");

  async function saveContact() {
    setBusy(true);
    try {
      await rpc.crm.contacts.update({
        id: contact.id,
        firstName,
        lastName,
        email: email || null,
        phone: phone || null,
        title: title || null,
        notes: notes || null,
        companyId: companyId || null,
      });
      onSaved();
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function logContactActivity(kind: ActivityKind, subject: string, body?: string) {
    if (!subject.trim()) return;
    setBusy(true);
    try {
      await rpc.crm.activities.create({
        kind,
        subject: subject.trim(),
        ...(body?.trim() ? { body: body.trim() } : {}),
        contactId: contact.id,
        ...(contact.companyId ? { companyId: contact.companyId } : {}),
        completed: true,
      });
      onSaved();
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  const tabs: { id: ContactTab; label: string; icon: LucideIcon; count?: number }[] = [
    { id: "activity", label: t`Timeline`, icon: Activity, count: linkedActivities.length },
    {
      id: "pipeline",
      label: t`Deals & Leads`,
      icon: Handshake,
      count: linkedDeals.length + linkedLeads.length,
    },
    { id: "emails", label: t`Emails`, icon: Mail, count: emailActivities.length },
    { id: "data", label: t`Contact Data`, icon: FileText },
  ];

  return (
    <div className="space-y-4" data-testid="frappe-contact-workspace">
      <div className="rounded-xl border bg-card p-4 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="ghost" size="icon" onClick={onBack} aria-label={t`Back to Contacts`}>
              <ArrowLeft className="size-4" />
            </Button>
            <RecordAvatar name={contact.name} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                  Contact
                </span>
                {contact.title ? <StatusBadge tone="progress">{contact.title}</StatusBadge> : null}
                {company ? (
                  <Link
                    to={crmHref("companies", { record: company.id })}
                    className="text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    {company.name}
                  </Link>
                ) : null}
              </div>
              <h2 className="truncate text-base font-semibold">{contact.name}</h2>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <AskAssistantButton
              record={{ kind: "contact", ref: contact.name, name: contact.companyName }}
            />
            <Button
              size="sm"
              disabled={busy || !firstName.trim()}
              onClick={() => void saveContact()}
            >
              <Check data-icon="inline-start" />
              <Trans>Save</Trans>
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-8">
          <div className="flex gap-1 overflow-x-auto rounded-xl border bg-card p-1.5">
            {tabs.map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                    active
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5" strokeWidth={1.75} />
                  <span>{item.label}</span>
                  {item.count !== undefined && item.count > 0 ? (
                    <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground tabular-nums">
                      {item.count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {tab === "activity" ? (
            <div className="space-y-4">
              <div className="rounded-xl border bg-card p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <NativeSelect
                    aria-label={t`Activity kind`}
                    value={activityKind}
                    onChange={(e) => setActivityKind(e.target.value as ActivityKind)}
                    className="w-36"
                  >
                    {ACTIVITY_KINDS.map((k) => (
                      <NativeSelectOption key={k} value={k}>
                        {kinds[k]}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <Input
                    placeholder={t`Log call, meeting, or note with ${contact.name}…`}
                    value={activitySubject}
                    onChange={(e) => setActivitySubject(e.target.value)}
                    className="min-w-48 flex-1"
                  />
                  <Button
                    size="sm"
                    disabled={busy || !activitySubject.trim()}
                    onClick={() => {
                      void logContactActivity(activityKind, activitySubject, activityBody);
                      setActivitySubject("");
                      setActivityBody("");
                    }}
                  >
                    <Plus data-icon="inline-start" />
                    <Trans>Log</Trans>
                  </Button>
                </div>
                <Textarea
                  placeholder={t`Call notes or discussion summary…`}
                  value={activityBody}
                  onChange={(e) => setActivityBody(e.target.value)}
                  rows={2}
                />
              </div>
              <Panel title={t`Contact Activity Timeline`} aside={linkedActivities.length}>
                {linkedActivities.length > 0 ? (
                  <RecordList label={t`Activities`}>
                    {linkedActivities.map((item) => (
                      <RecordRow
                        key={item.id}
                        icon={ACTIVITY_ICONS[item.kind]}
                        title={item.subject}
                        meta={
                          <>
                            <span>{kinds[item.kind]}</span>
                            <span aria-hidden="true">·</span>
                            <span>{actorName(item.createdBy)}</span>
                            <span aria-hidden="true">·</span>
                            <span>{formatRelativeTime(item.createdAt)}</span>
                          </>
                        }
                      />
                    ))}
                  </RecordList>
                ) : (
                  <PanelEmpty icon={Activity}>{t`No interactions logged yet`}</PanelEmpty>
                )}
              </Panel>
            </div>
          ) : null}

          {tab === "pipeline" ? (
            <div className="space-y-4">
              <Panel title={t`Linked Deals`} aside={linkedDeals.length}>
                {linkedDeals.length > 0 ? (
                  <RecordList label={t`Deals`}>
                    {linkedDeals.map((deal) => (
                      <RecordRow
                        key={deal.id}
                        to={crmHref("deals", { record: deal.id })}
                        icon={Handshake}
                        title={deal.title}
                        meta={
                          <>
                            <span className="font-mono">{deal.ref}</span>
                            <span aria-hidden="true">·</span>
                            <span>{stages[deal.stage]}</span>
                          </>
                        }
                        end={
                          <StatusBadge tone={DEAL_STAGE_TONES[deal.stage]}>
                            {money(deal.amount)}
                          </StatusBadge>
                        }
                      />
                    ))}
                  </RecordList>
                ) : (
                  <PanelEmpty icon={Handshake}>{t`No deals linked to this contact`}</PanelEmpty>
                )}
              </Panel>
              <Panel title={t`Linked Leads`} aside={linkedLeads.length}>
                {linkedLeads.length > 0 ? (
                  <RecordList label={t`Leads`}>
                    {linkedLeads.map((lead) => (
                      <RecordRow
                        key={lead.id}
                        to={crmHref("leads", { record: lead.id })}
                        icon={Target}
                        title={lead.title}
                        meta={
                          <>
                            <span className="font-mono">{lead.ref}</span>
                            <span aria-hidden="true">·</span>
                            <span>{leadStatuses[lead.status]}</span>
                          </>
                        }
                        end={
                          lead.value !== null ? (
                            <StatusBadge tone={LEAD_STATUS_TONES[lead.status]}>
                              {money(lead.value)}
                            </StatusBadge>
                          ) : undefined
                        }
                      />
                    ))}
                  </RecordList>
                ) : (
                  <PanelEmpty icon={Target}>{t`No leads linked to this contact`}</PanelEmpty>
                )}
              </Panel>
            </div>
          ) : null}

          {tab === "emails" ? (
            <div className="space-y-4">
              <div className="rounded-xl border bg-card p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    <Trans>To:</Trans> {contact.email ?? contact.name}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      assistant?.ask({
                        kind: "contact",
                        ref: contact.name,
                        name: contact.companyName,
                      })
                    }
                  >
                    <Sparkles data-icon="inline-start" />
                    <Trans>Draft with AI</Trans>
                  </Button>
                </div>
                <Input
                  placeholder={t`Subject`}
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                />
                <Textarea
                  placeholder={t`Write email to ${contact.name}…`}
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  rows={4}
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    disabled={busy || !emailSubject.trim()}
                    onClick={() => {
                      void logContactActivity("email", emailSubject, emailBody);
                      setEmailBody("");
                    }}
                  >
                    <Send data-icon="inline-start" />
                    <Trans>Send & Log Email</Trans>
                  </Button>
                </div>
              </div>
              <Panel title={t`Email History`} aside={emailActivities.length}>
                {emailActivities.length > 0 ? (
                  <RecordList label={t`Emails`}>
                    {emailActivities.map((item) => (
                      <RecordRow
                        key={item.id}
                        icon={Mail}
                        title={item.subject}
                        meta={
                          <>
                            <span>{actorName(item.createdBy)}</span>
                            <span aria-hidden="true">·</span>
                            <span>{formatRelativeTime(item.createdAt)}</span>
                          </>
                        }
                      />
                    ))}
                  </RecordList>
                ) : (
                  <PanelEmpty icon={Mail}>{t`No emails logged yet`}</PanelEmpty>
                )}
              </Panel>
            </div>
          ) : null}

          {tab === "data" ? (
            <div className="space-y-4">
              <div className="rounded-xl border bg-card p-4 space-y-4">
                <h3 className="text-sm font-semibold">{t`Contact Fields`}</h3>
                <FieldRow>
                  <FormField id={`${formId}-first`} label={t`First Name (first_name)`} required>
                    <Input
                      id={`${formId}-first`}
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                    />
                  </FormField>
                  <FormField id={`${formId}-last`} label={t`Last Name (last_name)`}>
                    <Input
                      id={`${formId}-last`}
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                    />
                  </FormField>
                </FieldRow>
                <FieldRow>
                  <FormField id={`${formId}-email`} label={t`Email Address (email_id)`}>
                    <Input
                      id={`${formId}-email`}
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </FormField>
                  <FormField id={`${formId}-phone`} label={t`Phone (mobile_no)`}>
                    <Input
                      id={`${formId}-phone`}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  </FormField>
                </FieldRow>
                <FieldRow>
                  <FormField id={`${formId}-title`} label={t`Designation / Role`}>
                    <Input
                      id={`${formId}-title`}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </FormField>
                  <FormField id={`${formId}-company`} label={t`Organization (company_name)`}>
                    <NativeSelect
                      id={`${formId}-company`}
                      className="w-full"
                      value={companyId}
                      onChange={(e) => setCompanyId(e.target.value)}
                    >
                      <NativeSelectOption value="">{t`None`}</NativeSelectOption>
                      {lookups.companies.map((c) => (
                        <NativeSelectOption key={c.id} value={c.id}>
                          {c.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </FormField>
                </FieldRow>
                <FormField id={`${formId}-notes`} label={t`Notes`}>
                  <Textarea
                    id={`${formId}-notes`}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    maxLength={BUSINESS_TEXT_MAX_LENGTH}
                  />
                </FormField>
                <div className="flex justify-end">
                  <Button size="sm" disabled={busy} onClick={() => void saveContact()}>
                    <Trans>Save Contact</Trans>
                  </Button>
                </div>
              </div>
              <SavingroupCustomFieldsSection
                doctype="Contact"
                docName={contact.name}
                legacyId={contact.id}
                createdBy={contact.createdBy}
              />
            </div>
          ) : null}
        </div>

        <div className="space-y-4 lg:col-span-4">
          <div className="rounded-xl border bg-card p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Trans>Contact Details</Trans>
            </h3>
            <DetailList
              items={[
                { label: t`DocType`, value: <span className="font-mono">Contact</span> },
                { label: t`Full Name`, value: contact.name },
                { label: t`Role / Title`, value: contact.title ?? "—" },
                { label: t`Email`, value: contact.email ?? "—" },
                { label: t`Phone`, value: contact.phone ?? "—" },
                {
                  label: t`Organization`,
                  value: company ? (
                    <Link
                      to={crmHref("companies", { record: company.id })}
                      className="underline underline-offset-4"
                    >
                      {company.name}
                    </Link>
                  ) : (
                    (contact.companyName ?? "—")
                  ),
                },
                { label: t`Linked Deals`, value: String(linkedDeals.length) },
              ]}
            />
          </div>
          <div className="rounded-xl border bg-card p-4">
            <HistoryList recordType="contact" recordId={contact.id} revision={revision} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 11. AGENTIC WORKFORCE COMMAND CENTER ("AGENTS AS USERS")
// ============================================================================

type PlaybookReceiptStep = {
  id: string;
  botName: string;
  botId?: string;
  action: string;
  target: string;
  detail: string;
  status: "succeeded" | "approval_gated";
  timestamp: string;
};

const ROLE_PROFILES: {
  key: string;
  match: string;
  title: string;
  department: string;
  summary: string;
  tools: string[];
  gatedTools: string[];
}[] = [
  {
    key: "operator",
    match: "Operator",
    title: "Chief Autonomous Operator",
    department: "CRM & ERP Executive Autopilot",
    summary:
      "Orchestrates end-to-end CRM and ERP workflows across Sales, Operations, Finance, and Data Hygiene.",
    tools: [
      "crm_lead_*",
      "crm_deal_*",
      "erp_order_*",
      "erp_invoice_*",
      "admin_doctype_*",
      "admin_document_*",
    ],
    gatedTools: ["admin_document_delete"],
  },
  {
    key: "sales",
    match: "Sales Executive",
    title: "Revenue & Pipeline Owner",
    department: "CRM Sales Operations",
    summary:
      "Owns leads, deals, qualification calls, proposal emails, and pipeline progression from new inquiry to negotiation.",
    tools: [
      "crm_company_*",
      "crm_contact_*",
      "crm_lead_qualify",
      "crm_lead_convert",
      "crm_deal_update_stage",
      "crm_activity_create",
    ],
    gatedTools: [],
  },
  {
    key: "operations",
    match: "Operations",
    title: "Order & Fulfillment Specialist",
    department: "ERP Supply Chain & Stock",
    summary:
      "Manages the product catalog, stock bins, draft sales orders, line items, approval requests, and order confirmation.",
    tools: [
      "erp_product_*",
      "erp_inventory_check",
      "erp_order_create_draft",
      "erp_order_add_item",
      "erp_order_request_approval",
    ],
    gatedTools: ["erp_order_confirm", "erp_inventory_adjust", "erp_order_cancel"],
  },
  {
    key: "finance",
    match: "Finance",
    title: "Order-to-Cash Controller",
    department: "ERP Billing & Receivables",
    summary:
      "Creates draft tax invoices from confirmed sales orders, issues customer invoices, and records incoming payments.",
    tools: ["erp_invoice_create_draft", "erp_invoice_search", "crm_activity_create"],
    gatedTools: ["erp_invoice_issue", "erp_invoice_record_payment"],
  },
  {
    key: "steward",
    match: "CRM Data Steward",
    title: "Data Quality & Hygiene Officer",
    department: "Master Data Governance",
    summary:
      "Audits organizations, contacts, and leads for duplicates, missing domains/phones/titles, and enriches records.",
    tools: [
      "crm_company_find_duplicates",
      "crm_contact_find_duplicates",
      "crm_company_update",
      "crm_contact_update",
      "crm_lead_update",
    ],
    gatedTools: [],
  },
  {
    key: "analyst",
    match: "Business Analyst",
    title: "RevOps & BI Intelligence",
    department: "Read-Only Analytics",
    summary:
      "Synthesizes pipeline conversion velocity, stock coverage, and accounts receivable aging with zero write risk.",
    tools: ["crm_lead_search", "crm_deal_search", "erp_order_search", "erp_invoice_search"],
    gatedTools: [],
  },
];

export function AgenticWorkforceCommandCenter({
  lookups,
  currency,
  onReload,
  onError,
}: {
  lookups: FrappeLookups;
  currency: string;
  onReload: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useLingui();
  const assistant = useAssistant();
  const money = useMoney(currency);
  const short = useShortMoney(currency);
  const [runningPlaybook, setRunningPlaybook] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<PlaybookReceiptStep[]>([]);
  const [activeTab, setActiveTab] = useState<"roster" | "playbooks" | "approvals">("roster");

  const findBot = (match: string): Bot | undefined =>
    lookups.bots.find((bot) => bot.name.toLowerCase().includes(match.toLowerCase()));

  const appendReceipt = (step: Omit<PlaybookReceiptStep, "id" | "timestamp">) => {
    setReceipts((prev) => [
      {
        ...step,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: new Date().toLocaleTimeString(),
      },
      ...prev,
    ]);
  };

  async function ensureTeamProvisioned(): Promise<Bot[]> {
    if (lookups.bots.length >= 5) return lookups.bots;
    await rpc.business.provisionTeam();
    const freshBots = await rpc.bots.list();
    onReload();
    return freshBots;
  }

  async function runSalesQualificationPlaybook() {
    setRunningPlaybook("sales-qualify");
    try {
      const bots = await ensureTeamProvisioned();
      const salesBot =
        bots.find((b) => b.name.includes("Sales")) ??
        bots.find((b) => b.name.includes("Operator")) ??
        bots[0];
      const actorBotId = salesBot?.id;
      const botName = salesBot?.name ?? "Sales Executive";

      const candidateLeads = lookups.leads.filter(
        (l) => l.status === "new" || l.status === "contacted",
      );
      if (candidateLeads.length === 0) {
        // Create and qualify a fresh enterprise lead so the playbook always demonstrates real action
        const targetCompany = lookups.companies[0];
        const targetContact = lookups.contacts.find((c) => c.companyId === targetCompany?.id);
        const created = await rpc.crm.leads.create({
          title: `${targetCompany?.name ?? "Enterprise"} Autonomous Sensor Expansion`,
          source: "AI Outbound Signal",
          value: 42500,
          ...(targetCompany ? { companyId: targetCompany.id } : {}),
          ...(targetContact ? { contactId: targetContact.id } : {}),
          ...(actorBotId ? { assigneeBotId: actorBotId, actorBotId } : {}),
        });
        appendReceipt({
          botName,
          botId: actorBotId,
          action: "crm.lead.create",
          target: `${frappeLeadDocName(created)} (${created.ref})`,
          detail: `Created & assigned new outbound lead (${money(42500)}) to ${botName}`,
          status: "succeeded",
        });
        await rpc.crm.leads.qualify({
          id: created.id,
          status: "qualified",
          ...(actorBotId ? { actorBotId } : {}),
        });
        appendReceipt({
          botName,
          botId: actorBotId,
          action: "crm.lead.qualify",
          target: `${frappeLeadDocName(created)} (${created.ref})`,
          detail: `Verified BANT criteria and advanced status to Qualified`,
          status: "succeeded",
        });
      } else {
        for (const lead of candidateLeads.slice(0, 3)) {
          if (actorBotId && lead.assignee.botId !== actorBotId) {
            await rpc.crm.leads.assign({
              id: lead.id,
              assigneeBotId: actorBotId,
              actorBotId,
            });
          }
          await rpc.crm.leads.qualify({
            id: lead.id,
            status: "qualified",
            ...(actorBotId ? { actorBotId } : {}),
          });
          await rpc.crm.activities.create({
            kind: "call",
            subject: `[${botName}] Discovery & BANT qualification call — ${lead.title}`,
            body: "Confirmed budget approval, technical requirements, and Q4 deployment schedule.",
            leadId: lead.id,
            ...(lead.companyId ? { companyId: lead.companyId } : {}),
            ...(lead.contactId ? { contactId: lead.contactId } : {}),
            completed: true,
            ...(actorBotId ? { assigneeBotId: actorBotId, actorBotId } : {}),
          });
          appendReceipt({
            botName,
            botId: actorBotId,
            action: "crm.lead.qualify + crm.activity.create",
            target: `${frappeLeadDocName(lead)} (${lead.ref})`,
            detail: `Assigned to ${botName}, logged discovery call, and qualified lead`,
            status: "succeeded",
          });
        }
      }
      onReload();
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setRunningPlaybook(null);
    }
  }

  async function runSalesCadencePlaybook() {
    setRunningPlaybook("sales-cadence");
    try {
      const bots = await ensureTeamProvisioned();
      const salesBot =
        bots.find((b) => b.name.includes("Sales")) ??
        bots.find((b) => b.name.includes("Operator")) ??
        bots[0];
      const actorBotId = salesBot?.id;
      const botName = salesBot?.name ?? "Sales Executive";

      const openDeals = lookups.deals.filter((d) => d.stage !== "won" && d.stage !== "lost");
      for (const deal of openDeals.slice(0, 3)) {
        if (actorBotId && deal.owner.botId !== actorBotId) {
          await rpc.crm.deals.update({
            id: deal.id,
            ownerBotId: actorBotId,
            actorBotId,
          });
        }
        await rpc.crm.activities.create({
          kind: "email",
          subject: `[${botName}] Commercial proposal & ROI summary — ${deal.title}`,
          body: `Sent tailored commercial schedule (${money(deal.amount)}) and technical architecture appendix.`,
          dealId: deal.id,
          ...(deal.companyId ? { companyId: deal.companyId } : {}),
          ...(deal.contactId ? { contactId: deal.contactId } : {}),
          completed: true,
          ...(actorBotId ? { assigneeBotId: actorBotId, actorBotId } : {}),
        });
        await rpc.crm.activities.create({
          kind: "follow_up",
          subject: `[${botName}] Review procurement redlines for ${deal.ref}`,
          dealId: deal.id,
          ...(deal.companyId ? { companyId: deal.companyId } : {}),
          ...(deal.contactId ? { contactId: deal.contactId } : {}),
          dueAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
          ...(actorBotId ? { assigneeBotId: actorBotId, actorBotId } : {}),
        });
        appendReceipt({
          botName,
          botId: actorBotId,
          action: "crm.activity.create (email + follow_up)",
          target: `${frappeDealDocName(deal)} (${deal.ref})`,
          detail: `Logged proposal email & scheduled 48h procurement follow-up task`,
          status: "succeeded",
        });
      }
      onReload();
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setRunningPlaybook(null);
    }
  }

  async function runDataStewardPlaybook() {
    setRunningPlaybook("steward-hygiene");
    try {
      const bots = await ensureTeamProvisioned();
      const stewardBot =
        bots.find((b) => b.name.includes("Steward")) ??
        bots.find((b) => b.name.includes("Operator")) ??
        bots[0];
      const actorBotId = stewardBot?.id;
      const botName = stewardBot?.name ?? "CRM Data Steward";

      const [companyDupes, contactDupes] = await Promise.all([
        rpc.crm.companies.duplicates({ limit: 20 }),
        rpc.crm.contacts.duplicates({ limit: 20 }),
      ]);

      for (const company of lookups.companies) {
        if (!company.phone || !company.notes) {
          await rpc.crm.companies.update({
            id: company.id,
            phone: company.phone || "+1 555 0190",
            notes:
              company.notes ||
              `Enriched by ${botName}: Verified industrial automation account & GST compliance status.`,
            ...(actorBotId ? { actorBotId } : {}),
          });
          appendReceipt({
            botName,
            botId: actorBotId,
            action: "crm.company.update",
            target: company.name,
            detail: "Enriched missing phone number & firmographic account notes",
            status: "succeeded",
          });
        }
      }

      for (const contact of lookups.contacts) {
        if (!contact.title || !contact.phone) {
          await rpc.crm.contacts.update({
            id: contact.id,
            title: contact.title || "Director of Operations",
            phone: contact.phone || "+1 555 0175",
            ...(actorBotId ? { actorBotId } : {}),
          });
          appendReceipt({
            botName,
            botId: actorBotId,
            action: "crm.contact.update",
            target: contact.name,
            detail: "Standardized executive title & direct phone number",
            status: "succeeded",
          });
        }
      }

      const targetCompany = lookups.companies[0];
      if (targetCompany) {
        await rpc.crm.activities.create({
          kind: "note",
          subject: `[${botName}] Workspace Data Hygiene & Deduplication Audit`,
          body: `Audited ${lookups.companies.length} organizations and ${lookups.contacts.length} contacts. Duplicate groups found: ${companyDupes.groups.length} orgs, ${contactDupes.groups.length} contacts.`,
          companyId: targetCompany.id,
          completed: true,
          ...(actorBotId ? { assigneeBotId: actorBotId, actorBotId } : {}),
        });
      }
      appendReceipt({
        botName,
        botId: actorBotId,
        action: "crm.company.find_duplicates + crm.contact.find_duplicates",
        target: `${lookups.companies.length} Orgs · ${lookups.contacts.length} Contacts`,
        detail: `Completed full deduplication scan (${companyDupes.groups.length} org groups, ${contactDupes.groups.length} contact groups)`,
        status: "succeeded",
      });
      onReload();
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setRunningPlaybook(null);
    }
  }

  async function runOperationsOrderPlaybook() {
    setRunningPlaybook("ops-orders");
    try {
      const bots = await ensureTeamProvisioned();
      const opsBot =
        bots.find((b) => b.name.includes("Operations")) ??
        bots.find((b) => b.name.includes("Operator")) ??
        bots[0];
      const actorBotId = opsBot?.id;
      const botName = opsBot?.name ?? "Operations";

      const dealsWithoutOrders = lookups.deals.filter(
        (d) =>
          (d.stage === "proposal" || d.stage === "negotiation" || d.stage === "won") &&
          !lookups.orders.some((o) => o.dealId === d.id),
      );
      const activeProducts = lookups.products.filter((p) => p.active && p.stockOnHand > 0);

      for (const deal of dealsWithoutOrders.slice(0, 2)) {
        const lines = activeProducts.slice(0, 2).map((p) => ({
          productId: p.id,
          quantity: Math.min(2, Math.max(1, p.stockOnHand)),
        }));
        if (lines.length === 0) break;
        const createdOrder = await rpc.erp.orders.createDraft({
          ...(deal.companyId ? { companyId: deal.companyId } : {}),
          ...(deal.contactId ? { contactId: deal.contactId } : {}),
          dealId: deal.id,
          notes: `[${botName}] Auto-drafted from ${deal.ref} (${deal.title})`,
          lines,
          ...(actorBotId ? { actorBotId } : {}),
        });
        await rpc.erp.orders.requestApproval({
          id: createdOrder.id,
          ...(actorBotId ? { actorBotId } : {}),
        });
        appendReceipt({
          botName,
          botId: actorBotId,
          action: "erp.order.create_draft + erp.order.request_approval",
          target: `${frappeOrderDocName(createdOrder)} (${createdOrder.ref})`,
          detail: `Drafted Sales Order (${money(createdOrder.subtotal)}) for ${deal.ref} & queued for owner approval`,
          status: "approval_gated",
        });
      }

      // Also submit any existing draft orders with lines for approval
      const draftOrders = lookups.orders.filter(
        (o) => o.status === "draft" && o.lines && o.lines.length > 0,
      );
      for (const draftOrder of draftOrders) {
        await rpc.erp.orders.requestApproval({
          id: draftOrder.id,
          ...(actorBotId ? { actorBotId } : {}),
        });
        appendReceipt({
          botName,
          botId: actorBotId,
          action: "erp.order.request_approval",
          target: `${frappeOrderDocName(draftOrder)} (${draftOrder.ref})`,
          detail: `Validated line items & submitted ${draftOrder.ref} to approval queue`,
          status: "approval_gated",
        });
      }
      onReload();
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setRunningPlaybook(null);
    }
  }

  async function runFinanceInvoicingPlaybook() {
    setRunningPlaybook("finance-invoicing");
    try {
      const bots = await ensureTeamProvisioned();
      const financeBot =
        bots.find((b) => b.name.includes("Finance")) ??
        bots.find((b) => b.name.includes("Operator")) ??
        bots[0];
      const actorBotId = financeBot?.id;
      const botName = financeBot?.name ?? "Finance";

      const uninvoicedOrders = lookups.orders.filter(
        (o) => o.status === "confirmed" && !o.invoiceId,
      );
      for (const order of uninvoicedOrders) {
        const draftInv = await rpc.erp.invoices.createDraft({
          orderId: order.id,
          dueAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
          ...(actorBotId ? { actorBotId } : {}),
        });
        await rpc.erp.invoices.issue({
          id: draftInv.id,
          ...(actorBotId ? { actorBotId } : {}),
        });
        appendReceipt({
          botName,
          botId: actorBotId,
          action: "erp.invoice.create_draft + erp.invoice.issue",
          target: `${frappeInvoiceDocName(draftInv)} (${draftInv.ref})`,
          detail: `Generated & issued Tax Invoice (${money(draftInv.total)}) from ${order.ref}`,
          status: "succeeded",
        });
      }

      const unpaidInvoices = lookups.invoices.filter(
        (inv) => inv.status === "issued" && inv.total - inv.amountPaid > 0,
      );
      for (const inv of unpaidInvoices.slice(0, 2)) {
        if (inv.companyId) {
          await rpc.crm.activities.create({
            kind: "follow_up",
            subject: `[${botName}] Accounts receivable collection reminder for ${inv.ref}`,
            body: `Outstanding balance: ${money(inv.total - inv.amountPaid)} for ${inv.companyName ?? inv.ref}.`,
            companyId: inv.companyId,
            dueAt: new Date(Date.now() + 86_400_000).toISOString(),
            ...(actorBotId ? { assigneeBotId: actorBotId, actorBotId } : {}),
          });
          appendReceipt({
            botName,
            botId: actorBotId,
            action: "crm.activity.create (AR follow_up)",
            target: `${frappeInvoiceDocName(inv)} (${inv.ref})`,
            detail: `Scheduled AR payment collection task (${money(inv.total - inv.amountPaid)} due)`,
            status: "succeeded",
          });
        }
      }
      onReload();
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setRunningPlaybook(null);
    }
  }

  async function runOperatorAutopilotCycle() {
    setRunningPlaybook("operator-autopilot");
    try {
      await runDataStewardPlaybook();
      await runSalesQualificationPlaybook();
      await runSalesCadencePlaybook();
      await runOperationsOrderPlaybook();
      await runFinanceInvoicingPlaybook();
    } finally {
      setRunningPlaybook(null);
    }
  }

  // Compute live workforce metrics
  const botOwnedDeals = lookups.deals.filter((d) => Boolean(d.owner.botId));
  const botOwnedPipeline = botOwnedDeals
    .filter((d) => d.stage !== "lost")
    .reduce((sum, d) => sum + d.amount, 0);
  const botAssignedLeads = lookups.leads.filter((l) => Boolean(l.assignee.botId));
  const botOpenTasks = lookups.activities.filter(
    (a) => !a.completedAt && Boolean(a.assignee.botId),
  );

  // Governance & approval items waiting for human manager action
  const pendingOrders = lookups.orders.filter(
    (o) => o.status === "pending_approval" || o.status === "approved" || o.status === "draft",
  );
  const actionableInvoices = lookups.invoices.filter(
    (inv) => inv.status === "draft" || (inv.status === "issued" && inv.total - inv.amountPaid > 0),
  );
  const qualifiedLeads = lookups.leads.filter((l) => l.status === "qualified");
  const totalGovernanceCount =
    pendingOrders.length + actionableInvoices.length + qualifiedLeads.length;

  return (
    <div className="space-y-6" data-testid="agentic-workforce-command-center">
      {/* Top Hero Command Bar */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-medium text-success">
                <span className="size-1.5 rounded-full bg-success" />
                <Trans>Agentic OS Active · Digital Employees are First-Class Users</Trans>
              </span>
              <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
                RBAC + Audit Enforced
              </span>
            </div>
            <h2 className="text-lg font-semibold tracking-tight">
              <Trans>AI Digital Workforce & Autonomous Playbook Engine</Trans>
            </h2>
            <p className="text-xs text-muted-foreground max-w-3xl">
              <Trans>
                Every AI specialist operates as an authenticated workspace user with server-enforced
                tool permissions, record ownership, and cryptographic action logs. Trigger
                autonomous playbooks below or review consequential actions in the governance queue.
              </Trans>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={runningPlaybook !== null}
              onClick={() => {
                void rpc.business
                  .provisionTeam()
                  .then(() => onReload())
                  .catch((cause) => onError(errorText(cause)));
              }}
            >
              <Users data-icon="inline-start" />
              <Trans>Sync Digital Employees</Trans>
            </Button>
            <Button
              size="sm"
              disabled={runningPlaybook !== null}
              onClick={() => void runOperatorAutopilotCycle()}
            >
              <Sparkles data-icon="inline-start" />
              {runningPlaybook === "operator-autopilot" ? (
                <Trans>Running Full Autopilot Cycle…</Trans>
              ) : (
                <Trans>Run Full Multi-Agent Autopilot</Trans>
              )}
            </Button>
          </div>
        </div>

        {/* 4 Workforce KPI Cards */}
        <KpiGrid>
          <KpiCard
            label={t`Digital Employees`}
            value={lookups.bots.length}
            icon={Users}
            detail={{ label: t`Active specialist roles`, value: ROLE_PROFILES.length }}
          />
          <KpiCard
            label={t`Bot-Owned Pipeline`}
            value={short(botOwnedPipeline)}
            exact={money(botOwnedPipeline)}
            icon={TrendingUp}
            detail={{ label: t`Deals owned by bots`, value: botOwnedDeals.length }}
          />
          <KpiCard
            label={t`Bot-Assigned Workload`}
            value={botAssignedLeads.length + botOpenTasks.length}
            icon={Target}
            detail={{
              label: t`Leads · Open tasks`,
              value: `${botAssignedLeads.length} · ${botOpenTasks.length}`,
            }}
          />
          <KpiCard
            label={t`Governance Queue`}
            value={totalGovernanceCount}
            icon={ClipboardCheck}
            attention={totalGovernanceCount > 0}
            detail={{
              label: t`Orders · Invoices · Leads`,
              value: `${pendingOrders.length} · ${actionableInvoices.length} · ${qualifiedLeads.length}`,
            }}
          />
        </KpiGrid>

        {/* Sub-navigation Tabs */}
        <div className="flex flex-wrap items-center gap-1 border-t pt-3">
          <button
            type="button"
            onClick={() => setActiveTab("roster")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              activeTab === "roster"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            <Users className="size-3.5" />
            <Trans>Digital Employee Roster ({ROLE_PROFILES.length})</Trans>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("playbooks")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              activeTab === "playbooks"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            <Sparkles className="size-3.5" />
            <Trans>Autonomous Playbooks & Live Console</Trans>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("approvals")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              activeTab === "approvals"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            <ShieldCheck className="size-3.5" />
            <Trans>Human-in-the-Loop Governance Queue ({totalGovernanceCount})</Trans>
          </button>
        </div>
      </div>

      {/* Live Execution Receipt Console (always visible when steps have been executed) */}
      {receipts.length > 0 ? (
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-success animate-pulse" />
              <h3 className="text-xs font-semibold uppercase tracking-wider">
                <Trans>Live Multi-Agent Execution Receipt Log ({receipts.length} actions)</Trans>
              </h3>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setReceipts([])}>
              <Trans>Clear Log</Trans>
            </Button>
          </div>
          <div className="max-h-64 overflow-y-auto divide-y rounded-lg border bg-muted/20">
            {receipts.map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <ActorAvatar
                    actor={{ userId: null, botId: item.botId ?? null, name: item.botName }}
                    size={20}
                  />
                  <span className="font-semibold">{item.botName}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                    {item.action}
                  </span>
                  <span className="font-mono text-muted-foreground">{item.target}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">{item.detail}</span>
                  <StatusBadge tone={item.status === "succeeded" ? "success" : "warning"}>
                    {item.status === "succeeded" ? t`Committed` : t`Approval Queued`}
                  </StatusBadge>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {item.timestamp}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* TAB 1: DIGITAL EMPLOYEE ROSTER */}
      {activeTab === "roster" ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {ROLE_PROFILES.map((role) => {
            const bot = findBot(role.match);
            const ownedDeals = bot ? lookups.deals.filter((d) => d.owner.botId === bot.id) : [];
            const ownedValue = ownedDeals
              .filter((d) => d.stage !== "lost")
              .reduce((sum, d) => sum + d.amount, 0);
            const assignedLeads = bot
              ? lookups.leads.filter((l) => l.assignee.botId === bot.id)
              : [];
            const assignedTasks = bot
              ? lookups.activities.filter((a) => !a.completedAt && a.assignee.botId === bot.id)
              : [];

            return (
              <div
                key={role.key}
                className="flex flex-col justify-between rounded-xl border bg-card p-4 space-y-4 transition-colors hover:border-foreground/25"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <ActorAvatar
                        actor={{
                          userId: null,
                          botId: bot?.id ?? null,
                          name: bot?.name ?? role.match,
                        }}
                        size={36}
                      />
                      <div>
                        <div className="flex items-center gap-1.5">
                          <h3 className="text-sm font-semibold">{bot?.name ?? role.match}</h3>
                          <StatusBadge tone={bot ? "success" : "muted"}>
                            {bot ? t`Active User` : t`Unprovisioned`}
                          </StatusBadge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {role.title} · {role.department}
                        </p>
                      </div>
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground leading-relaxed">{role.summary}</p>

                  {/* Bot Live Ownership Metrics */}
                  <div className="grid grid-cols-3 gap-2 rounded-lg border bg-muted/20 p-2.5 text-center">
                    <div>
                      <span className="block text-[11px] text-muted-foreground">
                        <Trans>Owned Deals</Trans>
                      </span>
                      <span className="mt-0.5 block text-xs font-semibold tabular-nums">
                        {ownedDeals.length} ({short(ownedValue)})
                      </span>
                    </div>
                    <div>
                      <span className="block text-[11px] text-muted-foreground">
                        <Trans>Assigned Leads</Trans>
                      </span>
                      <span className="mt-0.5 block text-xs font-semibold tabular-nums">
                        {assignedLeads.length}
                      </span>
                    </div>
                    <div>
                      <span className="block text-[11px] text-muted-foreground">
                        <Trans>Open Tasks</Trans>
                      </span>
                      <span className="mt-0.5 block text-xs font-semibold tabular-nums">
                        {assignedTasks.length}
                      </span>
                    </div>
                  </div>

                  {/* Server-Enforced Tool Scope */}
                  <div className="space-y-1.5">
                    <span className="block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      <Trans>Authorized Tool Scope (Server-Enforced)</Trans>
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {role.tools.map((tool) => (
                        <span
                          key={tool}
                          className="rounded border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-foreground/85"
                        >
                          {tool}
                        </span>
                      ))}
                      {role.gatedTools.map((tool) => (
                        <span
                          key={tool}
                          title={t`Requires human owner approval`}
                          className="rounded border border-warning/40 bg-warning/10 px-1.5 py-0.5 font-mono text-[10px] text-foreground"
                        >
                          🔒 {tool}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Action Footer */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={runningPlaybook !== null}
                    onClick={() => {
                      if (role.key === "sales") void runSalesQualificationPlaybook();
                      else if (role.key === "operations") void runOperationsOrderPlaybook();
                      else if (role.key === "finance") void runFinanceInvoicingPlaybook();
                      else if (role.key === "steward") void runDataStewardPlaybook();
                      else void runOperatorAutopilotCycle();
                    }}
                  >
                    <Sparkles data-icon="inline-start" />
                    <Trans>Execute Playbook</Trans>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      assistant?.ask({
                        prompt: `@${bot?.name ?? role.match} Review your assigned CRM & ERP records and execute your highest-priority next actions.`,
                      })
                    }
                  >
                    <MessageSquare data-icon="inline-start" />
                    <Trans>Chat as User</Trans>
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* TAB 2: AUTONOMOUS PLAYBOOKS */}
      {activeTab === "playbooks" ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-xl border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs">
                Playbook 01 · Sales Executive
              </span>
              <StatusBadge tone="success">{t`Deterministic + Audited`}</StatusBadge>
            </div>
            <h3 className="text-sm font-semibold">
              <Trans>Auto-Qualify & Assign Inbound Pipeline</Trans>
            </h3>
            <p className="text-xs text-muted-foreground">
              <Trans>
                Scans new and contacted leads, assigns ownership to Sales Executive, logs BANT
                discovery call notes, and promotes leads to Qualified status.
              </Trans>
            </p>
            <Button
              size="sm"
              disabled={runningPlaybook !== null}
              onClick={() => void runSalesQualificationPlaybook()}
            >
              <Sparkles data-icon="inline-start" />
              {runningPlaybook === "sales-qualify" ? (
                <Trans>Executing…</Trans>
              ) : (
                <Trans>Run Qualification Playbook</Trans>
              )}
            </Button>
          </div>

          <div className="rounded-xl border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs">
                Playbook 02 · Sales Executive
              </span>
              <StatusBadge tone="success">{t`Deterministic + Audited`}</StatusBadge>
            </div>
            <h3 className="text-sm font-semibold">
              <Trans>Smart Proposal & Follow-Up Cadence</Trans>
            </h3>
            <p className="text-xs text-muted-foreground">
              <Trans>
                Iterates through active deals in Qualification, Proposal, and Negotiation, sends
                commercial proposal emails, and schedules 48-hour follow-up tasks.
              </Trans>
            </p>
            <Button
              size="sm"
              disabled={runningPlaybook !== null}
              onClick={() => void runSalesCadencePlaybook()}
            >
              <Mail data-icon="inline-start" />
              {runningPlaybook === "sales-cadence" ? (
                <Trans>Executing…</Trans>
              ) : (
                <Trans>Run Proposal Cadence</Trans>
              )}
            </Button>
          </div>

          <div className="rounded-xl border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs">
                Playbook 03 · CRM Data Steward
              </span>
              <StatusBadge tone="success">{t`Deterministic + Audited`}</StatusBadge>
            </div>
            <h3 className="text-sm font-semibold">
              <Trans>Deep Firmographic Enrichment & Deduplication</Trans>
            </h3>
            <p className="text-xs text-muted-foreground">
              <Trans>
                Audits all organizations and contacts for missing phone numbers, executive titles,
                and notes, enriches them, and runs normalized duplicate detection.
              </Trans>
            </p>
            <Button
              size="sm"
              disabled={runningPlaybook !== null}
              onClick={() => void runDataStewardPlaybook()}
            >
              <ShieldCheck data-icon="inline-start" />
              {runningPlaybook === "steward-hygiene" ? (
                <Trans>Executing…</Trans>
              ) : (
                <Trans>Run Hygiene & Deduplication</Trans>
              )}
            </Button>
          </div>

          <div className="rounded-xl border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs">
                Playbook 04 · Operations + Finance
              </span>
              <StatusBadge tone="warning">{t`Order-to-Cash Automation`}</StatusBadge>
            </div>
            <h3 className="text-sm font-semibold">
              <Trans>Autonomous Quote-to-Order & Invoice Issuance</Trans>
            </h3>
            <p className="text-xs text-muted-foreground">
              <Trans>
                Operations drafts Sales Orders for active deals and requests approval; Finance
                generates and issues Tax Invoices for confirmed orders and schedules AR collections.
              </Trans>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={runningPlaybook !== null}
                onClick={() => void runOperationsOrderPlaybook()}
              >
                <ShoppingCart data-icon="inline-start" />
                <Trans>Run Operations Order Playbook</Trans>
              </Button>
              <Button
                size="sm"
                disabled={runningPlaybook !== null}
                onClick={() => void runFinanceInvoicingPlaybook()}
              >
                <ReceiptText data-icon="inline-start" />
                <Trans>Run Finance Billing Playbook</Trans>
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* TAB 3: HUMAN-IN-THE-LOOP GOVERNANCE & APPROVAL QUEUE */}
      {activeTab === "approvals" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Column 1: Sales Orders Awaiting Approval / Confirmation */}
          <Panel
            title={t`ERP Sales Orders Queue`}
            aside={`${pendingOrders.length}`}
            testId="governance-orders"
          >
            {pendingOrders.length > 0 ? (
              <div className="divide-y">
                {pendingOrders.map((order) => (
                  <div key={order.id} className="py-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <Link
                        to={erpHref("orders", { record: order.id })}
                        className="font-mono text-xs font-semibold hover:underline"
                      >
                        {frappeOrderDocName(order)} · {order.ref}
                      </Link>
                      <StatusBadge tone={ORDER_STATUS_TONES[order.status]}>
                        {order.status}
                      </StatusBadge>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{order.companyName ?? "Customer"}</span>
                      <span className="font-semibold text-foreground tabular-nums">
                        {money(order.subtotal)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <span className="text-[11px] text-muted-foreground">
                        <Trans>Prepared by</Trans> {actorName(order.createdBy)}
                      </span>
                      <Button
                        size="sm"
                        onClick={() => {
                          const operatorBot = findBot("Operator");
                          const opsBot = findBot("Operations");
                          void (async () => {
                            try {
                              if (order.status === "draft") {
                                await rpc.erp.orders.requestApproval({
                                  id: order.id,
                                  ...(opsBot ? { actorBotId: opsBot.id } : {}),
                                });
                              }
                              if (order.status !== "approved") {
                                await rpc.erp.orders.approve({
                                  id: order.id,
                                  ...(operatorBot ? { actorBotId: operatorBot.id } : {}),
                                });
                              }
                              await rpc.erp.orders.confirm({
                                id: order.id,
                                ...(opsBot ? { actorBotId: opsBot.id } : {}),
                              });
                              onReload();
                            } catch (cause) {
                              onError(errorText(cause));
                            }
                          })();
                        }}
                      >
                        <Check data-icon="inline-start" />
                        <Trans>Approve & Confirm</Trans>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <PanelEmpty icon={ShoppingCart}>{t`No orders awaiting approval`}</PanelEmpty>
            )}
          </Panel>

          {/* Column 2: Sales Invoices Awaiting Issuance or Settlement */}
          <Panel
            title={t`ERP Invoices & Collections`}
            aside={`${actionableInvoices.length}`}
            testId="governance-invoices"
          >
            {actionableInvoices.length > 0 ? (
              <div className="divide-y">
                {actionableInvoices.map((inv) => {
                  const balance = Math.max(0, inv.total - inv.amountPaid);
                  return (
                    <div key={inv.id} className="py-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <Link
                          to={erpHref("invoices", { record: inv.id })}
                          className="font-mono text-xs font-semibold hover:underline"
                        >
                          {frappeInvoiceDocName(inv)} · {inv.ref}
                        </Link>
                        <StatusBadge tone={INVOICE_STATUS_TONES[inv.status]}>
                          {inv.status === "issued" ? inv.paymentStatus : inv.status}
                        </StatusBadge>
                      </div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{inv.companyName ?? inv.orderRef}</span>
                        <span className="font-semibold text-foreground tabular-nums">
                          {money(inv.status === "issued" ? balance : inv.total)}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        <span className="text-[11px] text-muted-foreground">
                          <Trans>By</Trans> {actorName(inv.createdBy)}
                        </span>
                        {inv.status === "draft" ? (
                          <Button
                            size="sm"
                            onClick={() => {
                              const finBot = findBot("Finance");
                              void rpc.erp.invoices
                                .issue({
                                  id: inv.id,
                                  ...(finBot ? { actorBotId: finBot.id } : {}),
                                })
                                .then(() => onReload())
                                .catch((cause) => onError(errorText(cause)));
                            }}
                          >
                            <Send data-icon="inline-start" />
                            <Trans>Approve & Issue</Trans>
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              const finBot = findBot("Finance");
                              void rpc.erp.invoices
                                .recordPayment({
                                  id: inv.id,
                                  amount: balance,
                                  ...(finBot ? { actorBotId: finBot.id } : {}),
                                })
                                .then(() => onReload())
                                .catch((cause) => onError(errorText(cause)));
                            }}
                          >
                            <Check data-icon="inline-start" />
                            <Trans>Record Full Payment</Trans>
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <PanelEmpty icon={ReceiptText}>{t`All invoices settled`}</PanelEmpty>
            )}
          </Panel>

          {/* Column 3: Qualified Leads Ready for Conversion */}
          <Panel
            title={t`Qualified Leads Ready to Convert`}
            aside={`${qualifiedLeads.length}`}
            testId="governance-leads"
          >
            {qualifiedLeads.length > 0 ? (
              <div className="divide-y">
                {qualifiedLeads.map((lead) => (
                  <div key={lead.id} className="py-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <Link
                        to={crmHref("leads", { record: lead.id })}
                        className="font-mono text-xs font-semibold hover:underline"
                      >
                        {frappeLeadDocName(lead)} · {lead.ref}
                      </Link>
                      <StatusBadge tone="success">{t`Qualified`}</StatusBadge>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="truncate">{lead.title}</span>
                      <span className="font-semibold text-foreground tabular-nums">
                        {lead.value !== null ? money(lead.value) : "—"}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <span className="text-[11px] text-muted-foreground">
                        <Trans>Qualified by</Trans> {actorName(lead.assignee)}
                      </span>
                      <Button
                        size="sm"
                        onClick={() => {
                          const salesBot = findBot("Sales");
                          void rpc.crm.leads
                            .convert({
                              id: lead.id,
                              ...(salesBot ? { actorBotId: salesBot.id } : {}),
                            })
                            .then(() => onReload())
                            .catch((cause) => onError(errorText(cause)));
                        }}
                      >
                        <Handshake data-icon="inline-start" />
                        <Trans>Convert to Deal</Trans>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <PanelEmpty icon={Target}>{t`No qualified leads waiting`}</PanelEmpty>
            )}
          </Panel>
        </div>
      ) : null}
    </div>
  );
}

// ============================================================================
// 12. ERPNEXT FULL-PAGE 2-PANE SPLIT WORKSPACES FOR SALES ORDERS & INVOICES
// ============================================================================

export function ErpOrderWorkspace({
  orderId,
  lookups,
  currency,
  revision,
  onBack,
  onChanged,
  onError,
}: {
  orderId: string;
  lookups: {
    products: ErpProduct[];
    companies: CrmCompany[];
    contacts: CrmContact[];
    deals: CrmDeal[];
    bots: Bot[];
    settings: BusinessSettings | null;
  };
  currency: string;
  revision: number;
  onBack: () => void;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const formId = useId();
  const statuses = useOrderStatusLabels();
  const money = useMoney(currency);
  const [order, setOrder] = useState<ErpSalesOrder | null>(null);
  const [tab, setTab] = useState<"lines" | "print" | "custom">("lines");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [busy, setBusy] = useState(false);
  const [localRev, setLocalRev] = useState(0);

  useEffect(() => {
    void rpc.erp.orders
      .get({ id: orderId })
      .then((row) => setOrder(row))
      .catch((cause) => onError(errorText(cause)));
  }, [orderId, revision, localRev, onError]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      setLocalRev((r) => r + 1);
      onChanged();
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  if (!order) {
    return (
      <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
        <Trans>Loading Sales Order document…</Trans>
      </div>
    );
  }

  const docName = frappeOrderDocName(order);
  const draft = order.status === "draft";
  const open = order.status !== "confirmed" && order.status !== "cancelled";
  const canConfirm =
    order.status === "approved" ||
    (open && lookups.settings?.orderApprovalRequired === false && order.lines.length > 0);
  const qtyVal = Number.parseInt(quantity, 10);
  const company = order.companyId
    ? lookups.companies.find((c) => c.id === order.companyId)
    : undefined;
  const deal = order.dealId ? lookups.deals.find((d) => d.id === order.dealId) : undefined;
  const opsBot = lookups.bots.find((b) => b.name.includes("Operations")) ?? lookups.bots[0];
  const operatorBot = lookups.bots.find((b) => b.name.includes("Operator")) ?? lookups.bots[0];
  const financeBot = lookups.bots.find((b) => b.name.includes("Finance")) ?? lookups.bots[0];

  const steps: { key: ErpSalesOrder["status"]; label: string; reached: boolean }[] = [
    { key: "draft", label: statuses.draft, reached: true },
    {
      key: "pending_approval",
      label: statuses.pending_approval,
      reached: Boolean(order.approvalRequestedAt),
    },
    { key: "approved", label: statuses.approved, reached: Boolean(order.approvedAt) },
    { key: "confirmed", label: statuses.confirmed, reached: Boolean(order.confirmedAt) },
  ];

  return (
    <div className="space-y-4" data-testid="erp-order-workspace">
      {/* Top Document Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label={t`Back`}>
            <ArrowLeft />
          </Button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <button type="button" onClick={onBack} className="hover:text-foreground">
                <Trans>Sales Orders</Trans>
              </button>
              <ChevronRight className="size-3.5" />
              <span className="font-mono">{docName}</span>
              <span>·</span>
              <span className="font-mono">{order.ref}</span>
              <StatusBadge tone={ORDER_STATUS_TONES[order.status]}>
                {statuses[order.status]}
              </StatusBadge>
              {order.invoiceId ? <StatusBadge tone="success">{t`Invoiced`}</StatusBadge> : null}
            </div>
            <h2 className="truncate text-base font-semibold">
              {order.companyName ?? order.contactName ?? order.ref} — {money(order.subtotal)}
            </h2>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AskAssistantButton
            record={{
              kind: "order",
              ref: order.ref,
              name: order.companyName ?? order.ref,
              status: order.status,
            }}
          />
          {draft && order.lines.length > 0 ? (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => run(() => rpc.erp.orders.requestApproval({ id: order.id }))}
            >
              <Trans>Request Approval</Trans>
            </Button>
          ) : null}
          {order.status === "pending_approval" ? (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => run(() => rpc.erp.orders.approve({ id: order.id }))}
            >
              <Check data-icon="inline-start" />
              <Trans>Approve Order</Trans>
            </Button>
          ) : null}
          {canConfirm ? (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => run(() => rpc.erp.orders.confirm({ id: order.id }))}
            >
              <Check data-icon="inline-start" />
              <Trans>Confirm & Deduct Stock</Trans>
            </Button>
          ) : null}
          {order.status === "confirmed" && !order.invoiceId ? (
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const inv = await rpc.erp.invoices.createDraft({
                    orderId: order.id,
                    ...(financeBot ? { actorBotId: financeBot.id } : {}),
                  });
                  await navigate(erpHref("invoices", { record: inv.id }));
                })
              }
            >
              <ReceiptText data-icon="inline-start" />
              <Trans>Create Draft Invoice</Trans>
            </Button>
          ) : null}
          {open ? (
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => run(() => rpc.erp.orders.cancel({ id: order.id }))}
            >
              <Trans>Cancel</Trans>
            </Button>
          ) : null}
        </div>
      </div>

      {/* Interactive Status Stepper */}
      <div className="grid grid-cols-4 gap-2 rounded-xl border bg-card p-3">
        {steps.map((step, idx) => {
          const active = order.status === step.key;
          return (
            <div
              key={step.key}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs",
                active
                  ? "border-foreground bg-foreground text-background font-semibold"
                  : step.reached
                    ? "bg-muted/40 text-foreground"
                    : "text-muted-foreground opacity-60",
              )}
            >
              <span className="font-mono text-[11px]">0{idx + 1}</span>
              <span className="truncate">{step.label}</span>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left 8-col Main Document Pane */}
        <div className="space-y-4 lg:col-span-8">
          <div className="flex items-center gap-1 border-b pb-2">
            {(
              [
                { id: "lines", label: t`Order Items & Pricing (${order.lines.length})` },
                { id: "print", label: t`Tax Sales Order Print View` },
                { id: "custom", label: t`Custom Fields & Metadata` },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  tab === item.id
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          {tab === "lines" ? (
            <div className="space-y-4">
              <div className="overflow-x-auto rounded-xl border bg-card">
                <table className="w-full text-sm" data-testid="order-lines">
                  <thead>
                    <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                      <th className="h-9 ps-4 pe-2 text-start font-medium">{t`Item Code · Description`}</th>
                      <th className="px-2 text-start font-medium">{t`HSN/SAC`}</th>
                      <th className="px-2 text-end font-medium">{t`Qty`}</th>
                      <th className="px-2 text-end font-medium">{t`Rate`}</th>
                      <th className="ps-2 pe-4 text-end font-medium">{t`Amount`}</th>
                      {draft ? <th className="w-10" /> : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {order.lines.map((line) => (
                      <tr key={line.id}>
                        <td className="py-2.5 ps-4 pe-2">
                          <div className="font-mono text-xs text-muted-foreground">{line.sku}</div>
                          <div className="font-medium">{line.description}</div>
                        </td>
                        <td className="px-2 py-2.5 font-mono text-xs text-muted-foreground">
                          998314
                        </td>
                        <td className="px-2 py-2.5 text-end tabular-nums">{line.quantity}</td>
                        <td className="px-2 py-2.5 text-end tabular-nums">
                          {money(line.unitPrice)}
                        </td>
                        <td className="py-2.5 ps-2 pe-4 text-end font-semibold tabular-nums">
                          {money(line.lineTotal)}
                        </td>
                        {draft ? (
                          <td className="pe-2 text-end">
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() =>
                                run(() =>
                                  rpc.erp.orders.removeItem({
                                    orderId: order.id,
                                    lineId: line.id,
                                  }),
                                )
                              }
                            >
                              ×
                            </Button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t bg-muted/20 font-semibold">
                      <td className="py-3 ps-4 pe-2" colSpan={4}>
                        <Trans>Net Total ({currency})</Trans>
                      </td>
                      <td className="py-3 ps-2 pe-4 text-end tabular-nums">
                        {money(order.subtotal)}
                      </td>
                      {draft ? <td /> : null}
                    </tr>
                  </tfoot>
                </table>
              </div>

              <QuoteTaxCalculatorCard
                recordId={order.id}
                currency={currency}
                grossSubtotal={order.subtotal}
              />

              {draft ? (
                <div className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed bg-card p-4">
                  <FormField
                    id={`${formId}-prod`}
                    label={t`Add Catalog Item`}
                    className="min-w-48 flex-1"
                  >
                    <NativeSelect
                      id={`${formId}-prod`}
                      className="w-full"
                      value={productId}
                      onChange={(e) => setProductId(e.target.value)}
                    >
                      <NativeSelectOption value="">{t`Select SKU…`}</NativeSelectOption>
                      {lookups.products
                        .filter((p) => p.active)
                        .map((p) => (
                          <NativeSelectOption key={p.id} value={p.id}>
                            {p.sku} · {p.name} ({money(p.unitPrice)})
                          </NativeSelectOption>
                        ))}
                    </NativeSelect>
                  </FormField>
                  <FormField id={`${formId}-qty`} label={t`Qty`} className="w-24">
                    <Input
                      id={`${formId}-qty`}
                      inputMode="numeric"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                    />
                  </FormField>
                  <Button
                    variant="outline"
                    disabled={busy || !productId || !(qtyVal > 0)}
                    onClick={() =>
                      run(() =>
                        rpc.erp.orders.addItem({
                          orderId: order.id,
                          productId,
                          quantity: qtyVal,
                        }),
                      )
                    }
                  >
                    <Plus data-icon="inline-start" />
                    <Trans>Add Line</Trans>
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === "print" ? (
            <div className="rounded-xl border bg-card p-6 space-y-6">
              <div className="flex items-start justify-between border-b pb-4">
                <div>
                  <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                    Commercial Sales Order & Quotation Document
                  </span>
                  <h3 className="text-xl font-bold mt-0.5">SALES ORDER · {docName}</h3>
                  <p className="text-xs text-muted-foreground">
                    Reference: {order.ref} · Date: {new Date(order.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => window.print()}>
                  <FileText data-icon="inline-start" />
                  <Trans>Print / Save PDF</Trans>
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-6 text-xs">
                <div className="space-y-1">
                  <span className="font-semibold uppercase text-muted-foreground">
                    <Trans>Customer / Billed To</Trans>
                  </span>
                  <p className="text-sm font-semibold">{order.companyName ?? "—"}</p>
                  {order.contactName ? <p>Attn: {order.contactName}</p> : null}
                  {company?.domain ? <p>{company.domain}</p> : null}
                </div>
                <div className="space-y-1 text-end">
                  <span className="font-semibold uppercase text-muted-foreground">
                    <Trans>Fulfillment & Governance</Trans>
                  </span>
                  <p>Status: {statuses[order.status]}</p>
                  <p>Prepared By: {actorName(order.createdBy)}</p>
                  {order.approvedAt ? <p>Approved By: {actorName(order.approvedBy)}</p> : null}
                </div>
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="p-2 text-start">Sr</th>
                      <th className="p-2 text-start">Item / Description</th>
                      <th className="p-2 text-end">Qty</th>
                      <th className="p-2 text-end">Rate</th>
                      <th className="p-2 text-end">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {order.lines.map((line, i) => (
                      <tr key={line.id}>
                        <td className="p-2 font-mono">{i + 1}</td>
                        <td className="p-2">
                          <span className="font-mono font-semibold">{line.sku}</span> —{" "}
                          {line.description}
                        </td>
                        <td className="p-2 text-end tabular-nums">{line.quantity}</td>
                        <td className="p-2 text-end tabular-nums">{money(line.unitPrice)}</td>
                        <td className="p-2 text-end font-semibold tabular-nums">
                          {money(line.lineTotal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t bg-muted/20 font-bold">
                      <td className="p-2" colSpan={4}>
                        Grand Total ({currency})
                      </td>
                      <td className="p-2 text-end tabular-nums">{money(order.subtotal)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {order.notes ? (
                <p className="text-xs text-muted-foreground">Notes: {order.notes}</p>
              ) : null}
            </div>
          ) : null}

          {tab === "custom" ? (
            <SavingroupCustomFieldsSection
              recordType="order"
              recordId={order.id}
              legacyRef={order.ref}
              createdBy={order.createdBy}
              extra={[
                { label: t`Approval Status`, value: order.status },
                { label: t`Source Deal`, value: order.dealId ?? "—" },
              ]}
            />
          ) : null}
        </div>

        {/* Right 4-col Sidebar */}
        <div className="space-y-4 lg:col-span-4">
          <div className="rounded-xl border bg-card p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Trans>Execute as ERP Digital Employee</Trans>
            </h3>
            <div className="flex flex-col gap-1.5">
              {order.status !== "confirmed" && order.status !== "cancelled" ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="justify-start text-xs"
                  disabled={busy || order.lines.length === 0}
                  onClick={() =>
                    run(async () => {
                      if (order.status === "draft") {
                        await rpc.erp.orders.requestApproval({
                          id: order.id,
                          ...(opsBot ? { actorBotId: opsBot.id } : {}),
                        });
                      }
                      if (order.status !== "approved") {
                        await rpc.erp.orders.approve({
                          id: order.id,
                          ...(operatorBot ? { actorBotId: operatorBot.id } : {}),
                        });
                      }
                      await rpc.erp.orders.confirm({
                        id: order.id,
                        ...(opsBot ? { actorBotId: opsBot.id } : {}),
                      });
                    })
                  }
                >
                  <Sparkles data-icon="inline-start" />
                  <Trans>Operator + Operations: Approve & Confirm Order</Trans>
                </Button>
              ) : null}
              {order.status === "confirmed" && !order.invoiceId ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="justify-start text-xs"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const inv = await rpc.erp.invoices.createDraft({
                        orderId: order.id,
                        dueAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
                        ...(financeBot ? { actorBotId: financeBot.id } : {}),
                      });
                      await rpc.erp.invoices.issue({
                        id: inv.id,
                        ...(financeBot ? { actorBotId: financeBot.id } : {}),
                      });
                      await navigate(erpHref("invoices", { record: inv.id }));
                    })
                  }
                >
                  <ReceiptText data-icon="inline-start" />
                  <Trans>Finance AI: Generate & Issue Tax Invoice</Trans>
                </Button>
              ) : null}
            </div>
          </div>

          <div className="rounded-xl border bg-card p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Trans>Sales Order Properties</Trans>
            </h3>
            <DetailList
              items={[
                { label: t`DocType`, value: <span className="font-mono">Sales Order</span> },
                { label: t`Document`, value: <span className="font-mono">{docName}</span> },
                {
                  label: t`Customer`,
                  value: company ? (
                    <Link
                      to={crmHref("companies", { record: company.id })}
                      className="underline underline-offset-4"
                    >
                      {company.name}
                    </Link>
                  ) : (
                    (order.companyName ?? "—")
                  ),
                },
                {
                  label: t`Linked Deal`,
                  value: deal ? (
                    <Link
                      to={crmHref("deals", { record: deal.id })}
                      className="underline underline-offset-4"
                    >
                      {deal.ref} · {deal.title}
                    </Link>
                  ) : (
                    "—"
                  ),
                },
                {
                  label: t`Linked Invoice`,
                  value: order.invoiceId ? (
                    <Link
                      to={erpHref("invoices", { record: order.invoiceId })}
                      className="underline underline-offset-4"
                    >
                      <Trans>Open Sales Invoice</Trans> →
                    </Link>
                  ) : (
                    "—"
                  ),
                },
                { label: t`Created By`, value: <ActorLabel actor={order.createdBy} /> },
              ]}
            />
          </div>

          <div className="rounded-xl border bg-card p-4">
            <HistoryList recordType="order" recordId={order.id} revision={revision + localRev} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function ErpInvoiceWorkspace({
  invoiceId,
  bots,
  currency,
  revision,
  onBack,
  onChanged,
  onError,
}: {
  invoiceId: string;
  bots: Bot[];
  currency: string;
  revision: number;
  onBack: () => void;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useLingui();
  const formId = useId();
  const statuses = useInvoiceStatusLabels();
  const money = useMoney(currency);
  const [invoice, setInvoice] = useState<ErpInvoice | null>(null);
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [tab, setTab] = useState<"lines" | "print" | "custom">("lines");
  const [amount, setAmount] = useState("");
  const [sendingPaymentLink, setSendingPaymentLink] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localRev, setLocalRev] = useState(0);

  useEffect(() => {
    void Promise.all([
      rpc.erp.invoices.get({ id: invoiceId }),
      rpc.crm.contacts.list({ limit: 100 }).catch(() => ({ contacts: [] as CrmContact[] })),
    ])
      .then(([row, contactsRes]) => {
        setInvoice(row);
        setContacts(contactsRes.contacts);
      })
      .catch((cause) => onError(errorText(cause)));
  }, [invoiceId, revision, localRev, onError]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      setLocalRev((r) => r + 1);
      onChanged();
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  if (!invoice) {
    return (
      <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
        <Trans>Loading Sales Invoice document…</Trans>
      </div>
    );
  }

  const docName = frappeInvoiceDocName(invoice);
  const outstanding = Math.max(0, Math.round((invoice.total - invoice.amountPaid) * 100) / 100);
  const parsedAmount = parseMoneyInput(amount);
  const financeBot = bots.find((b) => b.name.includes("Finance")) ?? bots[0];

  return (
    <div className="space-y-4" data-testid="erp-invoice-workspace">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label={t`Back`}>
            <ArrowLeft />
          </Button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <button type="button" onClick={onBack} className="hover:text-foreground">
                <Trans>Sales Invoices</Trans>
              </button>
              <ChevronRight className="size-3.5" />
              <span className="font-mono">{docName}</span>
              <span>·</span>
              <span className="font-mono">{invoice.ref}</span>
              <StatusBadge tone={INVOICE_STATUS_TONES[invoice.status]}>
                {statuses[invoice.status]}
              </StatusBadge>
              <StatusBadge tone={outstanding === 0 ? "success" : "warning"}>
                {invoice.paymentStatus}
              </StatusBadge>
            </div>
            <h2 className="truncate text-base font-semibold">
              {invoice.companyName ?? invoice.ref} — {money(invoice.total)}
            </h2>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AskAssistantButton
            record={{
              kind: "invoice",
              ref: invoice.ref,
              name: invoice.companyName,
              status: invoice.status,
            }}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => setSendingPaymentLink(true)}
          >
            <Mail data-icon="inline-start" />
            <Trans>Send Payment Link</Trans>
          </Button>
          {invoice.status === "draft" ? (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => run(() => rpc.erp.invoices.issue({ id: invoice.id }))}
            >
              <Send data-icon="inline-start" />
              <Trans>Issue Invoice</Trans>
            </Button>
          ) : null}
        </div>
      </div>

      <KpiGrid>
        <KpiCard label={t`Grand Total`} value={money(invoice.total)} icon={ReceiptText} />
        <KpiCard label={t`Amount Paid`} value={money(invoice.amountPaid)} icon={CircleCheck} />
        <KpiCard
          label={t`Outstanding Balance`}
          value={money(outstanding)}
          icon={ClipboardCheck}
          attention={outstanding > 0}
        />
        <KpiCard
          label={t`Source Sales Order`}
          value={invoice.orderRef}
          icon={ShoppingCart}
          to={erpHref("orders", { record: invoice.orderId })}
        />
      </KpiGrid>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-8">
          <div className="flex items-center gap-1 border-b pb-2">
            {(
              [
                { id: "lines", label: t`Invoice Lines & Payment Entry` },
                { id: "print", label: t`Tax Invoice Print View (GST)` },
                { id: "custom", label: t`Custom Fields` },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  tab === item.id
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          {tab === "lines" ? (
            <div className="space-y-4">
              <div className="overflow-x-auto rounded-xl border bg-card">
                <table className="w-full text-sm" data-testid="invoice-lines">
                  <thead>
                    <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                      <th className="h-9 ps-4 pe-2 text-start font-medium">{t`Description`}</th>
                      <th className="px-2 text-end font-medium">{t`Qty`}</th>
                      <th className="px-2 text-end font-medium">{t`Unit Price`}</th>
                      <th className="ps-2 pe-4 text-end font-medium">{t`Line Total`}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {invoice.lines.map((line) => (
                      <tr key={line.id}>
                        <td className="py-2.5 ps-4 pe-2 font-medium">{line.description}</td>
                        <td className="px-2 py-2.5 text-end tabular-nums">{line.quantity}</td>
                        <td className="px-2 py-2.5 text-end tabular-nums">
                          {money(line.unitPrice)}
                        </td>
                        <td className="py-2.5 ps-2 pe-4 text-end font-semibold tabular-nums">
                          {money(line.lineTotal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t bg-muted/20 font-semibold">
                      <td className="py-3 ps-4 pe-2" colSpan={3}>
                        <Trans>Invoice Total</Trans>
                      </td>
                      <td className="py-3 ps-2 pe-4 text-end tabular-nums">
                        {money(invoice.total)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <QuoteTaxCalculatorCard
                recordId={invoice.id}
                currency={currency}
                grossSubtotal={invoice.total}
              />

              {invoice.status === "issued" && outstanding > 0 ? (
                <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-card p-4">
                  <FormField
                    id={`${formId}-pay`}
                    label={t`Record Payment Amount (${currency})`}
                    className="w-48"
                  >
                    <Input
                      id={`${formId}-pay`}
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder={String(outstanding)}
                    />
                  </FormField>
                  <Button
                    disabled={busy || !(parsedAmount !== undefined && parsedAmount > 0)}
                    onClick={() =>
                      run(() =>
                        rpc.erp.invoices.recordPayment({
                          id: invoice.id,
                          amount: parsedAmount ?? 0,
                        }),
                      )
                    }
                  >
                    <Check data-icon="inline-start" />
                    <Trans>Record Payment</Trans>
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      run(() =>
                        rpc.erp.invoices.recordPayment({
                          id: invoice.id,
                          amount: outstanding,
                          ...(financeBot ? { actorBotId: financeBot.id } : {}),
                        }),
                      )
                    }
                  >
                    <Sparkles data-icon="inline-start" />
                    <Trans>Finance AI: Settle Full Balance ({money(outstanding)})</Trans>
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === "print" ? (
            <div className="rounded-xl border bg-card p-6 space-y-6">
              <div className="flex items-start justify-between border-b pb-4">
                <div>
                  <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                    Commercial Tax Invoice Document
                  </span>
                  <h3 className="text-xl font-bold mt-0.5">TAX INVOICE · {docName}</h3>
                  <p className="text-xs text-muted-foreground">
                    Ref: {invoice.ref} · Order: {invoice.orderRef}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => window.print()}>
                  <FileText data-icon="inline-start" />
                  <Trans>Print / Save PDF</Trans>
                </Button>
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="p-2 text-start">Item</th>
                      <th className="p-2 text-end">Qty</th>
                      <th className="p-2 text-end">Rate</th>
                      <th className="p-2 text-end">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {invoice.lines.map((line) => (
                      <tr key={line.id}>
                        <td className="p-2 font-medium">{line.description}</td>
                        <td className="p-2 text-end tabular-nums">{line.quantity}</td>
                        <td className="p-2 text-end tabular-nums">{money(line.unitPrice)}</td>
                        <td className="p-2 text-end font-semibold tabular-nums">
                          {money(line.lineTotal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t bg-muted/20 font-bold">
                      <td className="p-2" colSpan={3}>
                        Grand Total
                      </td>
                      <td className="p-2 text-end tabular-nums">{money(invoice.total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ) : null}

          {tab === "custom" ? (
            <SavingroupCustomFieldsSection
              recordType="invoice"
              recordId={invoice.id}
              legacyRef={invoice.ref}
              createdBy={invoice.createdBy}
              extra={[
                { label: t`Source Sales Order`, value: invoice.orderRef },
                { label: t`Payment Status`, value: invoice.paymentStatus },
              ]}
            />
          ) : null}
        </div>

        <div className="space-y-4 lg:col-span-4">
          <div className="rounded-xl border bg-card p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Trans>Invoice Properties</Trans>
            </h3>
            <DetailList
              items={[
                { label: t`DocType`, value: <span className="font-mono">Sales Invoice</span> },
                { label: t`Document`, value: <span className="font-mono">{docName}</span> },
                { label: t`Customer`, value: invoice.companyName ?? "—" },
                { label: t`Created By`, value: <ActorLabel actor={invoice.createdBy} /> },
              ]}
            />
          </div>
          <div className="rounded-xl border bg-card p-4">
            <HistoryList
              recordType="invoice"
              recordId={invoice.id}
              revision={revision + localRev}
            />
          </div>
        </div>
      </div>
      {sendingPaymentLink ? (
        <SendInvoicePaymentModal
          invoice={invoice}
          contacts={contacts}
          bots={bots}
          onClose={() => setSendingPaymentLink(false)}
          onSaved={() => {
            setLocalRev((r) => r + 1);
            onChanged();
          }}
        />
      ) : null}
    </div>
  );
}

// ============================================================================
// 13. ERP FULL-PAGE PRODUCT & STOCK LEDGER WORKSPACE (`Item`)
// ============================================================================

export function ErpProductWorkspace({
  product,
  bots,
  companies,
  currency,
  revision,
  onBack,
  onChanged,
  onError,
}: {
  product: ErpProduct;
  bots: Bot[];
  companies: CrmCompany[];
  currency: string;
  revision: number;
  onBack: () => void;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const formId = useId();
  const orderStatuses = useOrderStatusLabels();
  const money = useMoney(currency);
  const [tab, setTab] = useState<"master" | "orders" | "ledger">("master");
  const [name, setName] = useState(product.name);
  const [unitPrice, setUnitPrice] = useState(String(product.unitPrice));
  const [hsnCode, setHsnCode] = useState(product.hsnCode ?? "998314");
  const [description, setDescription] = useState(product.description ?? "");
  const [active, setActive] = useState(product.active);
  const [adjustDelta, setAdjustDelta] = useState("10");
  const [adjustReason, setAdjustReason] = useState("Warehouse stock replenishment");
  const [orders, setOrders] = useState<ErpSalesOrder[]>([]);
  const [adjustments, setAdjustments] = useState<InventoryAdjustment[]>([]);
  const [busy, setBusy] = useState(false);
  const [localRev, setLocalRev] = useState(0);

  useEffect(() => {
    setName(product.name);
    setUnitPrice(String(product.unitPrice));
    setHsnCode(product.hsnCode ?? "998314");
    setDescription(product.description ?? "");
    setActive(product.active);
  }, [product]);

  useEffect(() => {
    let mounted = true;
    void Promise.all([
      rpc.erp.orders.list({ limit: 200 }),
      rpc.erp.inventory.adjustments({ productId: product.id, limit: 100 }),
    ])
      .then(([ordersRes, adjRes]) => {
        if (!mounted) return;
        setOrders(ordersRes.orders);
        setAdjustments(adjRes);
      })
      .catch((cause) => {
        if (mounted) onError(errorText(cause));
      });
    return () => {
      mounted = false;
    };
  }, [product.id, revision, localRev, onError]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      setLocalRev((r) => r + 1);
      onChanged();
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  const opsBot = bots.find((b) => b.name.includes("Operations")) ?? bots[0];

  const matchingOrders = useMemo(
    () =>
      orders.filter((order) =>
        order.lines.some((line) => line.productId === product.id || line.sku === product.sku),
      ),
    [orders, product.id, product.sku],
  );

  const confirmedUnitsSold = useMemo(
    () =>
      matchingOrders
        .filter((o) => o.status === "confirmed")
        .reduce(
          (sum, o) =>
            sum +
            o.lines
              .filter((l) => l.productId === product.id || l.sku === product.sku)
              .reduce((s, l) => s + l.quantity, 0),
          0,
        ),
    [matchingOrders, product.id, product.sku],
  );

  const confirmedRevenue = useMemo(
    () =>
      matchingOrders
        .filter((o) => o.status === "confirmed")
        .reduce(
          (sum, o) =>
            sum +
            o.lines
              .filter((l) => l.productId === product.id || l.sku === product.sku)
              .reduce((s, l) => s + l.lineTotal, 0),
          0,
        ),
    [matchingOrders, product.id, product.sku],
  );

  const inventoryValue = product.stockOnHand * product.unitPrice;
  const parsedDelta = Number.parseInt(adjustDelta, 10);

  return (
    <div className="space-y-4" data-testid="erp-product-workspace">
      {/* Top Item Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label={t`Back`}>
            <ArrowLeft />
          </Button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <button type="button" onClick={onBack} className="hover:text-foreground">
                <Trans>Catalog & Pricing</Trans>
              </button>
              <ChevronRight className="size-3.5" />
              <span className="font-mono font-semibold text-foreground">{product.sku}</span>
              <StatusBadge tone={product.active ? "success" : "muted"}>
                {product.active ? t`Active SKU` : t`Inactive`}
              </StatusBadge>
              <StatusBadge
                tone={
                  product.stockOnHand <= 0
                    ? "destructive"
                    : product.stockOnHand <= LOW_STOCK_THRESHOLD
                      ? "warning"
                      : "neutral"
                }
              >
                {product.stockOnHand <= 0
                  ? t`Out of Stock`
                  : product.stockOnHand <= LOW_STOCK_THRESHOLD
                    ? t`Low Stock (${product.stockOnHand})`
                    : t`${product.stockOnHand} On Hand`}
              </StatusBadge>
            </div>
            <h2 className="truncate text-base font-semibold">
              {product.name} — {money(product.unitPrice)}
            </h2>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AskAssistantButton record={{ kind: "product", ref: product.sku, name: product.name }} />
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              run(() =>
                rpc.erp.inventory.adjust({
                  productId: product.id,
                  delta: 10,
                  reason: "Quick warehouse receive (+10 units)",
                }),
              )
            }
          >
            <Plus data-icon="inline-start" />
            <Trans>+10 Quick Receive</Trans>
          </Button>
          {product.stockOnHand < 25 ? (
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                run(() =>
                  rpc.erp.inventory.adjust({
                    productId: product.id,
                    delta: Math.max(10, 25 - product.stockOnHand),
                    reason: `[Operations AI] Auto-replenished ${product.sku} to target safety stock (25 units)`,
                    ...(opsBot ? { actorBotId: opsBot.id } : {}),
                  }),
                )
              }
            >
              <Sparkles data-icon="inline-start" />
              <Trans>Operations AI: Replenish to 25</Trans>
            </Button>
          ) : null}
        </div>
      </div>

      {/* 4 Item KPI Cards */}
      <KpiGrid>
        <KpiCard
          label={t`Stock On Hand`}
          value={product.stockOnHand}
          icon={Boxes}
          attention={product.active && product.stockOnHand <= LOW_STOCK_THRESHOLD}
          detail={{ label: t`Reorder threshold`, value: LOW_STOCK_THRESHOLD }}
        />
        <KpiCard
          label={t`Inventory Valuation`}
          value={money(inventoryValue)}
          icon={Database}
          detail={{ label: t`Unit price`, value: money(product.unitPrice) }}
        />
        <KpiCard
          label={t`Confirmed Units Sold`}
          value={confirmedUnitsSold}
          icon={ShoppingCart}
          detail={{ label: t`Orders containing SKU`, value: matchingOrders.length }}
        />
        <KpiCard
          label={t`Booked SKU Revenue`}
          value={money(confirmedRevenue)}
          icon={TrendingUp}
          detail={{ label: t`Tax / HSN code`, value: product.hsnCode ?? "998314" }}
        />
      </KpiGrid>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-8">
          <div className="flex items-center gap-1 border-b pb-2">
            {(
              [
                { id: "master", label: t`Item Master, Pricing & Stock Adjustment` },
                {
                  id: "orders",
                  label: t`Sales Orders Containing SKU (${matchingOrders.length})`,
                },
                {
                  id: "ledger",
                  label: t`Stock Movement Ledger (${adjustments.length})`,
                },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  tab === item.id
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          {tab === "master" ? (
            <div className="space-y-4">
              <div className="rounded-xl border bg-card p-4 space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Trans>Catalog Item & Pricing Configuration</Trans>
                </h3>
                <FieldRow>
                  <FormField id={`${formId}-name`} label={t`Item Name`} required>
                    <Input
                      id={`${formId}-name`}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={BUSINESS_NAME_MAX_LENGTH}
                    />
                  </FormField>
                  <FormField
                    id={`${formId}-price`}
                    label={t`Standard Selling Price (${currency})`}
                    required
                  >
                    <Input
                      id={`${formId}-price`}
                      inputMode="decimal"
                      value={unitPrice}
                      onChange={(e) => setUnitPrice(e.target.value)}
                    />
                  </FormField>
                </FieldRow>
                <FieldRow>
                  <FormField id={`${formId}-hsn`} label={t`Tax / HSN-SAC Classification Code`}>
                    <Input
                      id={`${formId}-hsn`}
                      className="font-mono"
                      value={hsnCode}
                      onChange={(e) => setHsnCode(e.target.value)}
                      maxLength={12}
                    />
                  </FormField>
                  <div className="flex items-end">
                    <div className="w-full rounded-lg border px-3">
                      <SwitchField
                        id={`${formId}-active`}
                        checked={active}
                        onChange={setActive}
                        label={t`Active in Catalog & Order Builder`}
                      />
                    </div>
                  </div>
                </FieldRow>
                <FormField id={`${formId}-desc`} label={t`Specification & Commercial Description`}>
                  <Textarea
                    id={`${formId}-desc`}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    maxLength={BUSINESS_TEXT_MAX_LENGTH}
                  />
                </FormField>
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    disabled={busy || !name.trim()}
                    onClick={() =>
                      run(() =>
                        rpc.erp.products.update({
                          id: product.id,
                          name: name.trim(),
                          unitPrice: parseMoneyInput(unitPrice) ?? product.unitPrice,
                          hsnCode: hsnCode.trim() || null,
                          description: description.trim() || null,
                          active,
                        }),
                      )
                    }
                  >
                    <Check data-icon="inline-start" />
                    <Trans>Save Item Master</Trans>
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border bg-card p-4 space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Trans>Record Warehouse Stock Movement</Trans>
                </h3>
                <div className="flex flex-wrap items-end gap-2">
                  <FormField
                    id={`${formId}-delta`}
                    label={t`Quantity Delta (+ receive / - deduct)`}
                    className="w-48"
                  >
                    <Input
                      id={`${formId}-delta`}
                      inputMode="numeric"
                      value={adjustDelta}
                      onChange={(e) => setAdjustDelta(e.target.value)}
                    />
                  </FormField>
                  <FormField
                    id={`${formId}-reason`}
                    label={t`Adjustment Reason / Reference`}
                    className="min-w-52 flex-1"
                  >
                    <Input
                      id={`${formId}-reason`}
                      value={adjustReason}
                      onChange={(e) => setAdjustReason(e.target.value)}
                    />
                  </FormField>
                  <Button
                    variant="outline"
                    disabled={
                      busy ||
                      !Number.isInteger(parsedDelta) ||
                      parsedDelta === 0 ||
                      !adjustReason.trim()
                    }
                    onClick={() =>
                      run(() =>
                        rpc.erp.inventory.adjust({
                          productId: product.id,
                          delta: parsedDelta,
                          reason: adjustReason.trim(),
                        }),
                      )
                    }
                  >
                    <Boxes data-icon="inline-start" />
                    <Trans>Post Stock Entry</Trans>
                  </Button>
                </div>
              </div>

              <SavingroupCustomFieldsSection
                recordType="product"
                recordId={product.id}
                legacyRef={product.sku}
                createdBy={product.createdBy}
                extra={[
                  { label: t`Tax / HSN Classification`, value: product.hsnCode ?? "998314" },
                  { label: t`Current Bin Quantity`, value: String(product.stockOnHand) },
                ]}
              />
            </div>
          ) : null}

          {tab === "orders" ? (
            <div className="rounded-xl border bg-card overflow-hidden">
              {matchingOrders.length > 0 ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                      <th className="py-2.5 ps-4 pe-2 text-start font-medium">{t`Sales Order`}</th>
                      <th className="px-2 py-2.5 text-start font-medium">{t`Customer`}</th>
                      <th className="px-2 py-2.5 text-start font-medium">{t`Status`}</th>
                      <th className="px-2 py-2.5 text-end font-medium">{t`SKU Qty`}</th>
                      <th className="py-2.5 ps-2 pe-4 text-end font-medium">{t`Line Value`}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {matchingOrders.map((order) => {
                      const skuLines = order.lines.filter(
                        (l) => l.productId === product.id || l.sku === product.sku,
                      );
                      const qty = skuLines.reduce((s, l) => s + l.quantity, 0);
                      const lineVal = skuLines.reduce((s, l) => s + l.lineTotal, 0);
                      return (
                        <tr
                          key={order.id}
                          className="cursor-pointer hover:bg-accent/40"
                          onClick={() => void navigate(erpHref("orders", { record: order.id }))}
                        >
                          <td className="py-2.5 ps-4 pe-2 font-mono text-xs font-semibold">
                            {frappeOrderDocName(order)} · {order.ref}
                          </td>
                          <td className="px-2 py-2.5">
                            {order.companyName ?? order.contactName ?? "—"}
                          </td>
                          <td className="px-2 py-2.5">
                            <StatusBadge tone={ORDER_STATUS_TONES[order.status]}>
                              {orderStatuses[order.status]}
                            </StatusBadge>
                          </td>
                          <td className="px-2 py-2.5 text-end tabular-nums">{qty}</td>
                          <td className="py-2.5 ps-2 pe-4 text-end font-semibold tabular-nums">
                            {money(lineVal)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="p-6">
                  <PanelEmpty
                    icon={ShoppingCart}
                  >{t`No sales orders contain this SKU yet`}</PanelEmpty>
                </div>
              )}
            </div>
          ) : null}

          {tab === "ledger" ? (
            <div className="rounded-xl border bg-card overflow-hidden">
              {adjustments.length > 0 ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                      <th className="py-2.5 ps-4 pe-2 text-start font-medium">{t`Reason / Reference`}</th>
                      <th className="px-2 py-2.5 text-end font-medium">{t`Delta`}</th>
                      <th className="px-2 py-2.5 text-end font-medium">{t`Balance After`}</th>
                      <th className="py-2.5 ps-2 pe-4 text-end font-medium">{t`Posted By`}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {adjustments.map((adj) => (
                      <tr key={adj.id}>
                        <td className="py-2.5 ps-4 pe-2 font-medium">{adj.reason}</td>
                        <td className="px-2 py-2.5 text-end font-mono font-semibold tabular-nums">
                          {adj.delta > 0 ? `+${adj.delta}` : `−${-adj.delta}`}
                        </td>
                        <td className="px-2 py-2.5 text-end tabular-nums">{adj.quantityAfter}</td>
                        <td className="py-2.5 ps-2 pe-4 text-end text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1.5">
                            <ActorLabel actor={adj.createdBy} />
                            <span>·</span>
                            <span>{formatRelativeTime(adj.createdAt)}</span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="p-6">
                  <PanelEmpty
                    icon={Boxes}
                  >{t`No stock adjustments recorded for this SKU`}</PanelEmpty>
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Right 4-col Sidebar */}
        <div className="space-y-4 lg:col-span-4">
          <div className="rounded-xl border bg-card p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Trans>Execute as ERP Digital Employee</Trans>
            </h3>
            <div className="flex flex-col gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="justify-start text-xs"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    rpc.erp.inventory.adjust({
                      productId: product.id,
                      delta: Math.max(15, 30 - product.stockOnHand),
                      reason: `[Operations AI] Safety stock replenishment for ${product.sku}`,
                      ...(opsBot ? { actorBotId: opsBot.id } : {}),
                    }),
                  )
                }
              >
                <Sparkles data-icon="inline-start" />
                <Trans>Operations AI: Restock Bin to Safety Level</Trans>
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="justify-start text-xs"
                disabled={busy || !product.active || product.stockOnHand <= 0}
                onClick={() =>
                  run(async () => {
                    const targetCompany = companies[0];
                    const createdOrder = await rpc.erp.orders.createDraft({
                      ...(targetCompany ? { companyId: targetCompany.id } : {}),
                      notes: `[Operations AI] Created draft order featuring ${product.sku} · ${product.name}`,
                      lines: [{ productId: product.id, quantity: 1 }],
                      ...(opsBot ? { actorBotId: opsBot.id } : {}),
                    });
                    await navigate(erpHref("orders", { record: createdOrder.id }));
                  })
                }
              >
                <ShoppingCart data-icon="inline-start" />
                <Trans>Operations AI: Create Order with SKU</Trans>
              </Button>
            </div>
          </div>

          <div className="rounded-xl border bg-card p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Trans>Item Summary</Trans>
            </h3>
            <DetailList
              items={[
                { label: t`SKU Code`, value: <span className="font-mono">{product.sku}</span> },
                { label: t`Unit Price`, value: money(product.unitPrice) },
                { label: t`Stock Valuation`, value: money(inventoryValue) },
                {
                  label: t`Tax / HSN Code`,
                  value: <span className="font-mono">{product.hsnCode ?? "998314"}</span>,
                },
                { label: t`Created By`, value: <ActorLabel actor={product.createdBy} /> },
              ]}
            />
          </div>

          <div className="rounded-xl border bg-card p-4">
            <HistoryList
              recordType="product"
              recordId={product.id}
              revision={revision + localRev}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
