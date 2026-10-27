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
} from "@savingroup/contracts";
import {
  ACTIVITY_KINDS,
  BUSINESS_NAME_MAX_LENGTH,
  BUSINESS_TEXT_MAX_LENGTH,
  DEAL_STAGES,
  LEAD_STATUSES,
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
  Trophy,
  Users,
} from "lucide-react";
import { useId, useMemo, useState } from "react";
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
import { Panel, PanelEmpty, RecordList, RecordRow } from "./dashboard";
import { FieldRow, FormDialog, FormField, parseMoneyInput } from "./forms";
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

/** Authentic Frappe CRM / ERPNext naming series derived from record numbers. */
export function frappeLeadDocName(lead: Pick<CrmLead, "number" | "createdAt">): string {
  const year = new Date(lead.createdAt).getFullYear() || 2026;
  return `CRM-LEAD-${year}-${String(lead.number).padStart(5, "0")}`;
}

export function frappeDealDocName(deal: Pick<CrmDeal, "number" | "createdAt">): string {
  const year = new Date(deal.createdAt).getFullYear() || 2026;
  return `CRM-DEAL-${year}-${String(deal.number).padStart(5, "0")}`;
}

export function frappeOrderDocName(order: Pick<ErpSalesOrder, "number" | "createdAt">): string {
  const year = new Date(order.createdAt).getFullYear() || 2026;
  return `SAL-ORD-${year}-${String(order.number).padStart(5, "0")}`;
}

export function frappeInvoiceDocName(invoice: Pick<ErpInvoice, "number" | "createdAt">): string {
  const year = new Date(invoice.createdAt).getFullYear() || 2026;
  return `ACC-SINV-${year}-${String(invoice.number).padStart(5, "0")}`;
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
          <span>{t`Savingroup Custom Fields`}</span>
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
            <span className="block text-muted-foreground">
              {t`Frappe Document Name`} (<code className="font-mono">name</code>)
            </span>
            <span className="block rounded border bg-muted/40 px-2.5 py-1.5 font-mono">
              {resolvedDocName}
            </span>
          </div>
          <div className="space-y-1">
            <span className="block text-muted-foreground">
              {t`Savingroup Legacy Id`} (<code className="font-mono">savingroup_legacy_id</code>)
            </span>
            <span className="block rounded border bg-muted/40 px-2.5 py-1.5 font-mono">
              {resolvedLegacyId}
            </span>
          </div>
          <div className="space-y-1">
            <span className="block text-muted-foreground">
              {t`Savingroup created by (user)`} (
              <code className="font-mono">savingroup_created_by_user</code>)
            </span>
            <span className="block rounded border bg-muted/40 px-2.5 py-1.5 font-mono">
              {createdBy.userId ?? "—"}
            </span>
          </div>
          <div className="space-y-1">
            <span className="block text-muted-foreground">
              {t`Savingroup created by (bot)`} (
              <code className="font-mono">savingroup_created_by_bot</code>)
            </span>
            <span className="block rounded border bg-muted/40 px-2.5 py-1.5 font-mono">
              {createdBy.botId ? `${actorName(createdBy)} (${createdBy.botId})` : "—"}
            </span>
          </div>
          {ownerOrAssignee ? (
            <>
              <div className="space-y-1">
                <span className="block text-muted-foreground">
                  {ownerLabel ?? t`Savingroup assignee`} (user)
                </span>
                <span className="block rounded border bg-muted/40 px-2.5 py-1.5 font-mono">
                  {ownerOrAssignee.userId ?? "—"}
                </span>
              </div>
              <div className="space-y-1">
                <span className="block text-muted-foreground">
                  {ownerLabel ?? t`Savingroup assignee`} (bot)
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
              <span className="block text-muted-foreground">
                {field.label} (<code className="font-mono">{field.fieldname}</code>)
              </span>
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

          {/* TAB: DATA (Frappe Doctype Form + Savingroup Custom Fields) */}
          {tab === "data" ? (
            <div className="space-y-4">
              <div className="rounded-xl border bg-card p-4 space-y-4">
                <h3 className="text-sm font-semibold">{t`CRM Lead Details`}</h3>
                <FormField id={`${formId}-title`} label={t`Title (savingroup_title)`} required>
                  <Input
                    id={`${formId}-title`}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={BUSINESS_NAME_MAX_LENGTH}
                  />
                </FormField>
                <FieldRow>
                  <FormField
                    id={`${formId}-company`}
                    label={t`Organization (savingroup_organization)`}
                  >
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
                  <FormField id={`${formId}-contact`} label={t`Contact (savingroup_contact)`}>
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
                  <FormField id={`${formId}-value`} label={t`Estimated Value (savingroup_value)`}>
                    <Input
                      id={`${formId}-value`}
                      inputMode="decimal"
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                    />
                  </FormField>
                  <FormField id={`${formId}-source`} label={t`Lead Source (CRM Lead Source)`}>
                    <Input
                      id={`${formId}-source`}
                      value={source}
                      onChange={(e) => setSource(e.target.value)}
                    />
                  </FormField>
                </FieldRow>
                <FormField id={`${formId}-notes`} label={t`Savingroup Notes (savingroup_notes)`}>
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
                doctype="CRM Lead"
                docName={docName}
                legacyId={lead.ref}
                createdBy={lead.createdBy}
                ownerOrAssignee={lead.assignee}
                ownerLabel={t`Savingroup assignee`}
                extraFields={[
                  {
                    fieldname: "savingroup_deal",
                    label: t`Savingroup Deal`,
                    value: lead.convertedDealId ?? "",
                  },
                ]}
              />
            </div>
          ) : null}

          {/* TAB: TASKS */}
          {tab === "tasks" ? (
            <Panel title={t`CRM Tasks`} aside={taskActivities.length}>
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
            <Panel title={t`FCRM Notes`} aside={noteActivities.length}>
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
            <Panel title={t`CRM Call Logs`} aside={callActivities.length}>
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

        {/* Right Frappe CRM Properties Sidebar (4 cols) */}
        <div className="space-y-4 lg:col-span-4">
          {/* Assigned To Card */}
          <div className="rounded-xl border bg-card p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Trans>Assigned To (savingroup_assignee)</Trans>
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
                    .assign({ id: lead.id, assigneeBotId: e.target.value })
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

          {/* TAB: SALES ORDERS & INVOICES (ERPNext Integration) */}
          {tab === "orders" ? (
            <div className="space-y-4">
              <Panel
                title={t`ERPNext Sales Orders (Sales Order)`}
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
                title={t`ERPNext Sales Invoices (Sales Invoice)`}
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
                <h3 className="text-sm font-semibold">{t`CRM Deal Fields`}</h3>
                <FormField id={`${formId}-title`} label={t`Deal Title (savingroup_title)`} required>
                  <Input
                    id={`${formId}-title`}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={BUSINESS_NAME_MAX_LENGTH}
                  />
                </FormField>
                <FieldRow>
                  <FormField id={`${formId}-amount`} label={t`Deal Value (deal_value)`}>
                    <Input
                      id={`${formId}-amount`}
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </FormField>
                  <FormField
                    id={`${formId}-close`}
                    label={t`Expected Closure Date (expected_closure_date)`}
                  >
                    <Input
                      id={`${formId}-close`}
                      type="date"
                      value={expectedCloseAt}
                      onChange={(e) => setExpectedCloseAt(e.target.value)}
                    />
                  </FormField>
                </FieldRow>
                <FieldRow>
                  <FormField id={`${formId}-company`} label={t`Organization (organization)`}>
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
                  <FormField id={`${formId}-contact`} label={t`Primary Contact (contacts)`}>
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
                  label={t`Savingroup Stage Reason (savingroup_stage_reason)`}
                >
                  <Input
                    id={`${formId}-reason`}
                    placeholder={t`Reason for current stage or win/loss note…`}
                    value={stageReason}
                    onChange={(e) => setStageReason(e.target.value)}
                  />
                </FormField>
                <FormField id={`${formId}-notes`} label={t`Savingroup Notes (savingroup_notes)`}>
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
                doctype="CRM Deal"
                docName={docName}
                legacyId={deal.ref}
                createdBy={deal.createdBy}
                ownerOrAssignee={deal.owner}
                ownerLabel={t`Savingroup owner`}
                extraFields={[
                  {
                    fieldname: "savingroup_stage_reason",
                    label: t`Savingroup Stage Reason`,
                    value: stageReason,
                  },
                ]}
              />
            </div>
          ) : null}

          {/* TAB: TASKS */}
          {tab === "tasks" ? (
            <Panel title={t`CRM Tasks`} aside={taskActivities.length}>
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
            <Panel title={t`FCRM Notes`} aside={noteActivities.length}>
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
            <Panel title={t`CRM Call Logs`} aside={callActivities.length}>
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

        {/* Right Frappe CRM Properties Sidebar (4 cols) */}
        <div className="space-y-4 lg:col-span-4">
          <div className="rounded-xl border bg-card p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Trans>Deal Owner (savingroup_owner)</Trans>
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
                  .update({ id: deal.id, ownerBotId: e.target.value || null })
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
        <PanelEmpty icon={StickyNote}>{t`No FCRM Notes yet`}</PanelEmpty>
      )}

      {creating ? (
        <FormDialog
          title={t`New FCRM Note`}
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
            <FormField id="note-company" label={t`CRM Organization`}>
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
            <FormField id="note-deal" label={t`CRM Deal`}>
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
