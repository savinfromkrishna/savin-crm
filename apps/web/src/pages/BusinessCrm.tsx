import { Trans, useLingui } from "@lingui/react/macro";
import type {
  ActivityKind,
  Bot,
  BusinessEvent,
  BusinessSettings,
  CompanyDuplicateGroup,
  ContactDuplicateGroup,
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
  LeadStatus,
} from "@savingroup/contracts";
import {
  ACTIVITY_KINDS,
  BUSINESS_NAME_MAX_LENGTH,
  BUSINESS_TEAM_SPAWN_KEYS,
  BUSINESS_TEXT_MAX_LENGTH,
  DEAL_STAGES,
  LEAD_STATUSES,
} from "@savingroup/contracts";
import {
  BotAvatar,
  Button,
  cn,
  Input,
  NativeSelect,
  NativeSelectOption,
  Skeleton,
  Textarea,
} from "@savingroup/ui-web";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Building2,
  CalendarClock,
  CircleCheck,
  Contact,
  CopyCheck,
  Handshake,
  Kanban,
  LayoutGrid,
  List,
  Mail,
  Phone,
  Plus,
  RefreshCw,
  ShoppingCart,
  Sparkles,
  StickyNote,
  Target,
  TrendingUp,
  Trophy,
  Upload,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AskRowButton, orderAssistantBots, useAssistant } from "../components/business/assistant";
import { CsvExportButton, CsvImportModal } from "../components/business/commercial";
import {
  BarList,
  ColumnChart,
  Distribution,
  ListSkeleton,
  monthlyTotals,
  Panel,
  PanelEmpty,
  PanelGrid,
  RecordList,
  RecordRow,
} from "../components/business/dashboard";
import { FieldRow, FormDialog, FormField, parseMoneyInput } from "../components/business/forms";
import {
  AgenticWorkforceCommandCenter,
  FrappeCallsSection,
  FrappeContactWorkspace,
  FrappeDealWorkspace,
  FrappeLeadWorkspace,
  FrappeNotesSection,
  FrappeOrganizationWorkspace,
  frappeDealDocName,
  frappeLeadDocName,
  SavingroupCustomFieldsSection,
  SavingroupDeskWorkspace,
  SavingroupOperationsSection,
} from "../components/business/frappe-crm";
import type { Column } from "../components/business/records";
import {
  ActorAvatar,
  ActorLabel,
  actorName,
  BusinessBotsContext,
  DetailList,
  FilterChips,
  formatQuantity,
  KpiCard,
  KpiGrid,
  matchesQuery,
  PrimaryCell,
  RecordTable,
  SearchField,
  StatusBadge,
  Toolbar,
  useMoney,
  useShortMoney,
} from "../components/business/records";
import {
  BusinessPage,
  CRM_SECTIONS,
  crmHref,
  erpHref,
  useBusinessList,
  useBusinessLive,
  useBusinessSection,
  useOpenRecord,
  useStatusFilter,
} from "../components/business/shell";
import {
  DEAL_STAGE_TONES,
  LEAD_STATUS_TONES,
  useActivityKindLabels,
  useDealStageLabels,
  useLeadStatusLabels,
} from "../lib/business-labels";
import { formatRelativeTime } from "../lib/relative-time";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";

type Lookups = {
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

const STAGE_WEIGHTS: Record<DealStage, number> = {
  qualification: 0.25,
  proposal: 0.5,
  negotiation: 0.75,
  won: 1,
  lost: 0,
};

export function CrmPage() {
  const { t } = useLingui();
  const section = useBusinessSection(CRM_SECTIONS);
  const [error, setError] = useState("");
  const [busyAction, setBusyAction] = useState<"seed" | "team" | null>(null);
  const [lookups, setLookups] = useState<Lookups>({
    companies: [],
    contacts: [],
    deals: [],
    leads: [],
    activities: [],
    orders: [],
    invoices: [],
    products: [],
    settings: null,
    bots: [],
  });
  const [lookupsLoaded, setLookupsLoaded] = useState(false);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((previous) => previous + 1), []);
  useBusinessLive(reload);

  useEffect(() => {
    let active = true;
    void Promise.all([
      rpc.crm.companies.list({ limit: 200 }),
      rpc.crm.contacts.list({ limit: 200 }),
      rpc.crm.deals.list({ limit: 200 }),
      rpc.crm.leads.list({ limit: 200 }),
      rpc.crm.activities.list({ limit: 200 }),
      rpc.erp.orders.list({ limit: 200 }).catch(() => ({ orders: [] as ErpSalesOrder[] })),
      rpc.erp.invoices.list({ limit: 200 }).catch(() => ({ invoices: [] as ErpInvoice[] })),
      rpc.erp.products
        .list({ includeInactive: true, limit: 200 })
        .catch(() => ({ products: [] as ErpProduct[] })),
      rpc.business.settings().catch(() => null),
    ])
      .then(
        ([companies, contacts, deals, leads, activities, orders, invoices, products, settings]) => {
          if (!active) return;
          setLookups((previous) => ({
            ...previous,
            companies: companies.companies,
            contacts: contacts.contacts,
            deals: deals.deals,
            leads: leads.leads,
            activities: activities.activities,
            orders: orders.orders,
            invoices: invoices.invoices,
            products: products.products,
            settings,
          }));
          setError("");
        },
      )
      .catch((cause) => {
        if (active) setError(errorText(cause));
      })
      .finally(() => {
        if (active) setLookupsLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [revision]);

  // Bots load on their own, so the assistant stays reachable when records fail to load.
  useEffect(() => {
    let active = true;
    void rpc.bots
      .list()
      .then((bots) => {
        if (active) setLookups((previous) => ({ ...previous, bots }));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [revision]);

  async function handleSeedDemo() {
    setBusyAction("seed");
    setError("");
    try {
      await rpc.business.seedDemo({});
      reload();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSyncTeam() {
    setBusyAction("team");
    setError("");
    try {
      await rpc.business.provisionTeam({ operator: true });
      reload();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusyAction(null);
    }
  }

  const currency = lookups.settings?.currency ?? lookups.deals[0]?.currency ?? "USD";
  const shared: SectionProps = {
    lookups,
    loading: !lookupsLoaded,
    currency,
    revision,
    reload,
    onError: setError,
  };

  return (
    <BusinessBotsContext value={lookups.bots}>
      <BusinessPage
        app="crm"
        section={section}
        error={error}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={busyAction !== null}
              onClick={() => void handleSyncTeam()}
              title={t`Provision or sync the AI specialist team`}
            >
              <Sparkles data-icon="inline-start" aria-hidden="true" />
              <span className="hidden sm:inline">{t`Sync AI team`}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busyAction !== null}
              onClick={() => void handleSeedDemo()}
              title={t`Load sample CRM and ERP records`}
            >
              <RefreshCw data-icon="inline-start" aria-hidden="true" />
              <span className="hidden sm:inline">{t`Seed demo`}</span>
            </Button>
          </>
        }
      >
        {section === "overview" ? <OverviewSection {...shared} /> : null}
        {section === "workspace" ? <WorkspaceSection {...shared} /> : null}
        {section === "companies" ? <CompaniesSection {...shared} /> : null}
        {section === "contacts" ? <ContactsSection {...shared} /> : null}
        {section === "leads" ? <LeadsSection {...shared} /> : null}
        {section === "deals" ? <DealsSection {...shared} /> : null}
        {section === "activities" ? <ActivitiesSection {...shared} /> : null}
        {section === "notes" ? (
          <FrappeNotesSection lookups={lookups} reload={reload} onError={setError} />
        ) : null}
        {section === "calls" ? (
          <FrappeCallsSection lookups={lookups} reload={reload} onError={setError} />
        ) : null}
        {section === "operations" ? <OperationsSection {...shared} /> : null}
        {section === "analytics" ? <AnalyticsSection {...shared} /> : null}
        {section === "agents" ? <AgentsSection {...shared} /> : null}
      </BusinessPage>
    </BusinessBotsContext>
  );
}

type SectionProps = {
  lookups: Lookups;
  /** The shared company, contact and bot lists have not arrived yet. */
  loading: boolean;
  currency: string;
  revision: number;
  reload: () => void;
  onError: (message: string) => void;
};

function NewButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <Button onClick={onClick}>
      <Plus data-icon="inline-start" aria-hidden="true" />
      {children}
    </Button>
  );
}

// Leads move from light to full ink as they progress; outcomes keep their colors.
const LEAD_FILLS: Record<LeadStatus, string> = {
  new: "bg-muted-foreground/55",
  contacted: "bg-foreground/45",
  qualified: "bg-foreground/80",
  converted: "bg-success",
  unqualified: "bg-muted-foreground/25",
};

const STAGE_FILLS: Partial<Record<DealStage, string>> = {
  won: "bg-success",
  lost: "bg-destructive/60",
};

const dayFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

function isOpenDeal(deal: Pick<CrmDeal, "stage">) {
  return deal.stage !== "won" && deal.stage !== "lost";
}

function weightedDealAmount(deals: readonly CrmDeal[]): number {
  return deals.reduce((sum, deal) => {
    if (!isOpenDeal(deal)) return sum;
    return sum + deal.amount * STAGE_WEIGHTS[deal.stage];
  }, 0);
}

// --- Overview ----------------------------------------------------------------

function OverviewSection({
  lookups,
  currency: fallbackCurrency,
  revision,
  reload,
  onError,
}: SectionProps) {
  const { t } = useLingui();
  const stages = useDealStageLabels();
  const leadStatuses = useLeadStatusLabels();
  const kinds = useActivityKindLabels();
  const { value: overview } = useBusinessList<CrmOverview | null>(
    () => rpc.crm.overview(),
    [revision],
    onError,
    null,
  );
  const { value: events, loading: eventsLoading } = useBusinessList<BusinessEvent[]>(
    () => rpc.business.events({ limit: 6 }),
    [revision],
    onError,
    [],
  );

  const deals = lookups.deals;
  const leads = lookups.leads;
  const activities = lookups.activities;
  const currency = overview?.currency ?? fallbackCurrency;
  const money = useMoney(currency);
  const short = useShortMoney(currency);
  const compact = useShortMoney(currency, 0);
  const percent = useMemo(() => new Intl.NumberFormat(undefined, { style: "percent" }), []);
  const now = new Date();

  const won = deals.filter((deal) => deal.stage === "won").length;
  const lost = deals.filter((deal) => deal.stage === "lost").length;
  const weighted = useMemo(() => weightedDealAmount(deals), [deals]);
  const followUps = activities
    .filter((activity) => !activity.completedAt && activity.dueAt)
    .sort((a, b) => Date.parse(a.dueAt ?? "") - Date.parse(b.dueAt ?? ""));
  const overdue = followUps.filter((activity) => isOverdue(activity, now)).length;
  const topDeals = deals
    .filter(isOpenDeal)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);
  const accounts = useMemo(() => {
    const totals = new Map<string, { id: string; name: string; count: number; amount: number }>();
    for (const deal of deals) {
      if (!isOpenDeal(deal) || !deal.companyId) continue;
      const entry = totals.get(deal.companyId) ?? {
        id: deal.companyId,
        name: deal.companyName ?? deal.companyId,
        count: 0,
        amount: 0,
      };
      entry.count += 1;
      entry.amount += deal.amount;
      totals.set(deal.companyId, entry);
    }
    return [...totals.values()].sort((a, b) => b.amount - a.amount).slice(0, 5);
  }, [deals]);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card px-4 py-2.5 shadow-2xs">
        <div className="flex items-center gap-2.5 text-xs">
          <span className="grid size-6 place-items-center rounded-md border bg-muted/60 text-foreground">
            <Sparkles className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
          </span>
          <span className="font-semibold text-foreground">
            <Trans>Revenue OS · Autonomous Pipeline & Account Intelligence</Trans>
          </span>
          <span className="hidden text-muted-foreground md:inline">
            ·{" "}
            <Trans>
              Select any Lead, Deal, or Account to open its 2-pane interactive workspace
            </Trans>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to={crmHref("agents")}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg border bg-background px-2.5 text-xs font-medium transition-colors hover:bg-accent"
          >
            <Sparkles className="size-3.5 text-muted-foreground" aria-hidden="true" />
            <Trans>AI Workforce</Trans>
          </Link>
          <Link
            to={crmHref("workspace")}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg border bg-background px-2.5 text-xs font-medium transition-colors hover:bg-accent"
          >
            <LayoutGrid className="size-3.5 text-muted-foreground" aria-hidden="true" />
            <Trans>Cross-Suite Matrix</Trans>
          </Link>
          <Link
            to={crmHref("operations")}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg border bg-background px-2.5 text-xs font-medium transition-colors hover:bg-accent"
          >
            <Activity className="size-3.5 text-muted-foreground" aria-hidden="true" />
            <Trans>Audit Trail</Trans>
          </Link>
        </div>
      </div>
      {overview ? (
        <KpiGrid testId="crm-overview">
          <KpiCard
            label={t`Pipeline value`}
            value={short(overview.openDealAmount)}
            exact={money(overview.openDealAmount)}
            icon={Handshake}
            to={crmHref("deals")}
            detail={{ label: t`Weighted`, value: short(weighted) }}
          />
          <KpiCard
            label={t`Won`}
            value={short(overview.wonDealAmount)}
            exact={money(overview.wonDealAmount)}
            icon={Trophy}
            to={crmHref("deals", { status: "won" })}
            detail={{
              label: t`Win rate`,
              value: won + lost > 0 ? percent.format(won / (won + lost)) : "—",
            }}
          />
          <KpiCard
            label={t`Open leads`}
            value={overview.openLeads}
            icon={Target}
            to={crmHref("leads")}
            detail={{
              label: leadStatuses.qualified,
              value: leads.filter((lead) => lead.status === "qualified").length,
            }}
          />
          <KpiCard
            label={t`Open follow-ups`}
            value={overview.openFollowUps}
            icon={CalendarClock}
            attention={overdue > 0}
            to={crmHref("activities")}
            detail={{ label: t`Overdue`, value: overdue }}
          />
        </KpiGrid>
      ) : (
        <KpiGrid>
          {[0, 1, 2, 3].map((placeholder) => (
            <Skeleton key={placeholder} className="h-25.5 rounded-xl" />
          ))}
        </KpiGrid>
      )}

      {/* Interactive Frappe CRM / Twenty Pipeline Conversion Funnel & AI Operator Strip */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="rounded-xl border bg-card p-4 shadow-2xs lg:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
            <div>
              <h3 className="text-sm font-semibold">
                <Trans>Revenue Conversion Funnel</Trans>
              </h3>
              <p className="text-xs text-muted-foreground">
                <Trans>
                  Live stage velocity across Qualification, Proposal, Negotiation, and Won
                </Trans>
              </p>
            </div>
            <span className="rounded-full border bg-muted/50 px-2.5 py-0.5 text-xs font-medium tabular-nums">
              <Trans>Weighted Forecast:</Trans> {short(weighted)}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {(["qualification", "proposal", "negotiation", "won"] as const).map((stageKey, idx) => {
              const stageDeals = deals.filter((d) => d.stage === stageKey);
              const stageTotal = stageDeals.reduce((sum, d) => sum + d.amount, 0);
              const maxAmount = Math.max(
                1,
                ...(["qualification", "proposal", "negotiation", "won"] as const).map((sk) =>
                  deals.filter((d) => d.stage === sk).reduce((s, d) => s + d.amount, 0),
                ),
              );
              const pct = Math.max(12, Math.round((stageTotal / maxAmount) * 100));
              const probLabel = `${Math.round(STAGE_WEIGHTS[stageKey] * 100)}%`;
              return (
                <Link
                  key={stageKey}
                  to={crmHref("deals", { status: stageKey })}
                  className="group relative flex flex-col justify-between rounded-xl border bg-muted/20 p-3 transition-all hover:border-foreground/25 hover:bg-accent/30"
                >
                  <div className="flex items-center justify-between gap-1.5 text-xs">
                    <span className="font-mono text-[10px] text-muted-foreground">
                      0{idx + 1} · {probLabel}
                    </span>
                    <span className="rounded-full bg-background px-1.5 py-0.5 text-[11px] font-medium tabular-nums">
                      {stageDeals.length}
                    </span>
                  </div>
                  <div className="my-2">
                    <p className="truncate text-xs font-medium text-muted-foreground">
                      {stages[stageKey]}
                    </p>
                    <p className="mt-0.5 text-base font-semibold tabular-nums">
                      {short(stageTotal)}
                    </p>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        stageKey === "won" ? "bg-success" : "bg-foreground/80",
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col justify-between rounded-xl border bg-card p-4 shadow-2xs lg:col-span-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
                <Sparkles className="size-3.5 text-foreground" />
                <Trans>AI Operator Next-Best Actions</Trans>
              </span>
              <Link
                to={crmHref("agents")}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                <Trans>All Bots</Trans> →
              </Link>
            </div>
            <div className="space-y-1.5 pt-1 text-xs">
              {topDeals[0] ? (
                <Link
                  to={crmHref("deals", { record: topDeals[0].id })}
                  className="flex items-center justify-between gap-2 rounded-lg border bg-muted/25 px-2.5 py-2 transition-colors hover:bg-accent"
                >
                  <span className="truncate font-medium">
                    <Trans>Advance</Trans> {topDeals[0].title}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] font-semibold tabular-nums">
                    {short(topDeals[0].amount)}
                  </span>
                </Link>
              ) : null}
              {leads.find((l) => l.status === "qualified") ? (
                <Link
                  to={crmHref("leads", {
                    record: leads.find((l) => l.status === "qualified")!.id,
                  })}
                  className="flex items-center justify-between gap-2 rounded-lg border bg-muted/25 px-2.5 py-2 transition-colors hover:bg-accent"
                >
                  <span className="truncate font-medium">
                    <Trans>Convert qualified lead:</Trans>{" "}
                    {leads.find((l) => l.status === "qualified")!.title}
                  </span>
                  <span className="shrink-0 rounded bg-success/15 px-1.5 py-0.5 text-[10px] font-medium text-foreground">
                    Ready
                  </span>
                </Link>
              ) : null}
              <Link
                to={erpHref("orders")}
                className="flex items-center justify-between gap-2 rounded-lg border bg-muted/25 px-2.5 py-2 transition-colors hover:bg-accent"
              >
                <span className="truncate font-medium">
                  <Trans>Order-to-Cash & Invoices</Trans>
                </span>
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  {lookups.orders.length} Orders · {lookups.invoices.length} Invoices
                </span>
              </Link>
            </div>
          </div>
        </div>
      </div>

      <PanelGrid>
        <Panel title={t`Follow-ups`} to={crmHref("activities")} testId="crm-follow-ups">
          {followUps.length > 0 ? (
            <RecordList label={t`Follow-ups`}>
              {followUps.slice(0, 5).map((activity) => {
                const late = isOverdue(activity, now);
                const assigned = activity.assignee.botId || activity.assignee.userId;
                return (
                  <RecordRow
                    key={activity.id}
                    to={crmHref("activities", { record: activity.id })}
                    icon={ACTIVITY_ICONS[activity.kind]}
                    tone={late ? "destructive" : undefined}
                    title={activity.subject}
                    meta={
                      <>
                        <span className="shrink-0">{kinds[activity.kind]}</span>
                        <span aria-hidden="true">·</span>
                        <span className={cn("shrink-0", late && "font-medium text-destructive")}>
                          {dayFormat.format(new Date(activity.dueAt ?? ""))}
                        </span>
                      </>
                    }
                    end={
                      assigned ? (
                        <span title={actorName(activity.assignee)} className="flex">
                          <ActorAvatar actor={activity.assignee} size={20} />
                        </span>
                      ) : undefined
                    }
                    action={
                      <button
                        type="button"
                        aria-label={t`Mark done`}
                        title={t`Mark done`}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void rpc.crm.activities
                            .complete({ id: activity.id, completed: true })
                            .then(() => reload())
                            .catch((cause) => onError(errorText(cause)));
                        }}
                        className="grid size-7 place-items-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        <CircleCheck className="size-4" strokeWidth={1.75} aria-hidden="true" />
                      </button>
                    }
                  />
                );
              })}
            </RecordList>
          ) : (
            <PanelEmpty icon={CircleCheck}>{t`All clear`}</PanelEmpty>
          )}
        </Panel>
        <Panel
          title={t`Pipeline by stage`}
          to={crmHref("deals")}
          aside={overview ? compact(overview.openDealAmount) : undefined}
          testId="crm-stages"
        >
          <BarList
            label={t`Pipeline by stage`}
            rows={DEAL_STAGES.map((stage) => {
              const rows = deals.filter((deal) => deal.stage === stage);
              const amount = rows.reduce((sum, deal) => sum + deal.amount, 0);
              return {
                key: stage,
                label: stages[stage],
                note: rows.length,
                value: amount,
                display: compact(amount),
                fill: STAGE_FILLS[stage],
                to: crmHref("deals", { status: stage }),
              };
            })}
          />
        </Panel>
        <Panel title={t`Top open deals`} to={crmHref("deals")} testId="crm-top-deals">
          {topDeals.length > 0 ? (
            <RecordList label={t`Top open deals`}>
              {topDeals.map((deal) => (
                <RecordRow
                  key={deal.id}
                  to={crmHref("deals", { record: deal.id })}
                  icon={Handshake}
                  title={deal.title}
                  meta={
                    <>
                      <span className="shrink-0 font-mono">{deal.ref}</span>
                      <span aria-hidden="true">·</span>
                      <span className="shrink-0">{stages[deal.stage]}</span>
                      {deal.companyName ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">{deal.companyName}</span>
                        </>
                      ) : null}
                    </>
                  }
                  end={short(deal.amount)}
                  action={
                    <AskRowButton
                      record={{
                        kind: "deal",
                        ref: deal.ref,
                        name: deal.title,
                        status: deal.stage,
                      }}
                    />
                  }
                />
              ))}
            </RecordList>
          ) : (
            <PanelEmpty icon={Handshake}>{t`No open deals`}</PanelEmpty>
          )}
        </Panel>
        <Panel
          title={t`Leads by status`}
          to={crmHref("leads")}
          aside={leads.length}
          testId="crm-lead-statuses"
        >
          {leads.length > 0 ? (
            <Distribution
              label={t`Leads by status`}
              parts={LEAD_STATUSES.map((status) => ({
                key: status,
                label: leadStatuses[status],
                count: leads.filter((lead) => lead.status === status).length,
                fill: LEAD_FILLS[status],
                to: crmHref("leads", { status }),
              }))}
            />
          ) : (
            <PanelEmpty icon={Target}>{t`No leads yet`}</PanelEmpty>
          )}
        </Panel>
        <Panel
          title={t`Top accounts`}
          to={crmHref("companies")}
          aside={
            overview ? (
              <span className="flex items-baseline gap-1.5 text-xs font-normal text-muted-foreground">
                {t`Companies`}
                <span className="font-medium text-foreground/80">{overview.companies}</span>
                <span aria-hidden="true">·</span>
                {t`Contacts`}
                <span className="font-medium text-foreground/80">{overview.contacts}</span>
              </span>
            ) : undefined
          }
          testId="crm-accounts"
        >
          {accounts.length > 0 ? (
            <BarList
              label={t`Top accounts`}
              rows={accounts.map((account) => ({
                key: account.id,
                label: account.name,
                note: account.count,
                value: account.amount,
                display: compact(account.amount),
                to: lookups.companies.some((company) => company.id === account.id)
                  ? crmHref("companies", { record: account.id })
                  : crmHref("companies"),
              }))}
            />
          ) : (
            <PanelEmpty icon={Building2}>{t`No open deals`}</PanelEmpty>
          )}
        </Panel>
        <Panel
          title={t`Recent workspace & AI activity`}
          to={crmHref("agents")}
          testId="crm-recent-events"
        >
          {eventsLoading && events.length === 0 ? (
            <ListSkeleton />
          ) : events.length > 0 ? (
            <RecordList label={t`Recent workspace & AI activity`}>
              {events.map((event) => (
                <EventRow key={event.id} event={event} />
              ))}
            </RecordList>
          ) : (
            <PanelEmpty icon={Activity}>{t`No recent activity`}</PanelEmpty>
          )}
        </Panel>
      </PanelGrid>
    </>
  );
}

// --- Savingroup Desk Workspace (workspace.py) & Operations Ledger -----------

function WorkspaceSection({ lookups, currency, revision, onError }: SectionProps) {
  const { value: crmOverview } = useBusinessList<CrmOverview | null>(
    () => rpc.crm.overview(),
    [revision],
    onError,
    null,
  );
  const { value: erpOverview } = useBusinessList<ErpOverview | null>(
    () => rpc.erp.overview(),
    [revision],
    onError,
    null,
  );
  const { value: events } = useBusinessList<BusinessEvent[]>(
    () => rpc.business.events({ limit: 100 }),
    [revision],
    onError,
    [],
  );

  return (
    <SavingroupDeskWorkspace
      crmOverview={crmOverview}
      erpOverview={erpOverview}
      lookups={lookups}
      events={events}
      currency={crmOverview?.currency ?? erpOverview?.currency ?? currency}
    />
  );
}

function OperationsSection({ revision, onError }: SectionProps) {
  const { value: events, loading } = useBusinessList<BusinessEvent[]>(
    () => rpc.business.events({ limit: 100 }),
    [revision],
    onError,
    [],
  );
  return <SavingroupOperationsSection events={events} loading={loading} />;
}

function EventRow({ event }: { event: BusinessEvent }) {
  const to = eventRecordHref(event);
  const label = formatEventLabel(event.type);
  return (
    <RecordRow
      to={to}
      icon={eventRecordIcon(event.recordType)}
      title={label}
      meta={
        <>
          <span className="truncate">{actorName(event.actor)}</span>
          <span aria-hidden="true">·</span>
          <span className="shrink-0">{formatRelativeTime(event.createdAt)}</span>
        </>
      }
      end={
        event.actor.botId || event.actor.userId ? (
          <span title={actorName(event.actor)} className="flex">
            <ActorAvatar actor={event.actor} size={20} />
          </span>
        ) : undefined
      }
    />
  );
}

function eventRecordHref(event: BusinessEvent): string | undefined {
  switch (event.recordType) {
    case "company":
      return crmHref("companies", { record: event.recordId });
    case "contact":
      return crmHref("contacts", { record: event.recordId });
    case "lead":
      return crmHref("leads", { record: event.recordId });
    case "deal":
      return crmHref("deals", { record: event.recordId });
    case "activity":
      return crmHref("activities", { record: event.recordId });
    case "product":
      return erpHref("products", { record: event.recordId });
    case "order":
      return erpHref("orders", { record: event.recordId });
    case "invoice":
      return erpHref("invoices", { record: event.recordId });
    default:
      return undefined;
  }
}

function eventRecordIcon(recordType: BusinessEvent["recordType"]): LucideIcon {
  switch (recordType) {
    case "company":
      return Building2;
    case "contact":
      return Contact;
    case "lead":
      return Target;
    case "deal":
      return Handshake;
    case "activity":
      return CalendarClock;
    case "order":
    case "invoice":
    case "product":
      return ShoppingCart;
    default:
      return Activity;
  }
}

function formatEventLabel(type: string): string {
  return type
    .replace(/^(crm|erp)\./, "")
    .replaceAll(".", " · ")
    .replaceAll("_", " ");
}

// --- Shared 360° Record Activity Composer ------------------------------------

function QuickActivitySection({
  activities,
  companyId,
  contactId,
  leadId,
  dealId,
  onSaved,
  onError,
}: {
  activities: CrmActivity[];
  companyId?: string | null;
  contactId?: string | null;
  leadId?: string | null;
  dealId?: string | null;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useLingui();
  const kinds = useActivityKindLabels();
  const [kind, setKind] = useState<ActivityKind>("note");
  const [subject, setSubject] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [saving, setSaving] = useState(false);
  const now = new Date();

  async function addQuickActivity() {
    if (!subject.trim()) return;
    setSaving(true);
    try {
      await rpc.crm.activities.create({
        kind,
        subject: subject.trim(),
        ...(dueAt ? { dueAt: new Date(dueAt).toISOString() } : {}),
        ...(companyId ? { companyId } : {}),
        ...(contactId ? { contactId } : {}),
        ...(leadId ? { leadId } : {}),
        ...(dealId ? { dealId } : {}),
        completed: kind === "note" && !dueAt,
      });
      setSubject("");
      setDueAt("");
      onSaved();
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-2.5 border-t pt-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">
          <Trans>Activities & follow-ups</Trans> ({activities.length})
        </h3>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect
          aria-label={t`Activity kind`}
          value={kind}
          onChange={(event) => setKind(event.target.value as ActivityKind)}
          className="w-32 shrink-0"
        >
          {ACTIVITY_KINDS.map((value) => (
            <NativeSelectOption key={value} value={value}>
              {kinds[value]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Input
          placeholder={t`Log a call, note, or follow-up…`}
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void addQuickActivity();
            }
          }}
          className="min-w-44 flex-1"
        />
        <Input
          type="date"
          aria-label={t`Due date`}
          value={dueAt}
          onChange={(event) => setDueAt(event.target.value)}
          className="w-36 shrink-0"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={saving || !subject.trim()}
          onClick={() => void addQuickActivity()}
        >
          <Plus data-icon="inline-start" aria-hidden="true" />
          <Trans>Log</Trans>
        </Button>
      </div>
      {activities.length > 0 ? (
        <RecordList label={t`Activities`}>
          {activities.slice(0, 6).map((activity) => {
            const late = isOverdue(activity, now);
            return (
              <RecordRow
                key={activity.id}
                to={crmHref("activities", { record: activity.id })}
                icon={ACTIVITY_ICONS[activity.kind]}
                tone={late ? "destructive" : undefined}
                title={activity.subject}
                meta={
                  <>
                    <span className="shrink-0">{kinds[activity.kind]}</span>
                    {activity.dueAt ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className={cn("shrink-0", late && "font-medium text-destructive")}>
                          {dayFormat.format(new Date(activity.dueAt))}
                        </span>
                      </>
                    ) : null}
                    {activity.completedAt ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-success">{t`Done`}</span>
                      </>
                    ) : null}
                  </>
                }
                action={
                  <button
                    type="button"
                    aria-label={activity.completedAt ? t`Reopen` : t`Mark done`}
                    title={activity.completedAt ? t`Reopen` : t`Mark done`}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void rpc.crm.activities
                        .complete({ id: activity.id, completed: !activity.completedAt })
                        .then(() => onSaved())
                        .catch((cause) => onError(errorText(cause)));
                    }}
                    className={cn(
                      "grid size-7 place-items-center rounded-lg outline-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50",
                      activity.completedAt
                        ? "text-success"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <CircleCheck className="size-4" strokeWidth={1.75} aria-hidden="true" />
                  </button>
                }
              />
            );
          })}
        </RecordList>
      ) : null}
    </section>
  );
}

// --- Companies ---------------------------------------------------------------

function CompaniesSection({ lookups, loading, currency, revision, reload, onError }: SectionProps) {
  const { t } = useLingui();
  const shortMoney = useShortMoney(currency);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useOpenRecord();
  const [creating, setCreating] = useState(false);
  const [importingCsv, setImportingCsv] = useState(false);
  const [duplicates, setDuplicates] = useState<CompanyDuplicateGroup[] | null>(null);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const open = openId ? lookups.companies.find((company) => company.id === openId) : undefined;

  const statsByCompany = useMemo(() => {
    const map = new Map<string, { contacts: number; openPipeline: number }>();
    for (const contact of lookups.contacts) {
      if (!contact.companyId) continue;
      const entry = map.get(contact.companyId) ?? { contacts: 0, openPipeline: 0 };
      entry.contacts += 1;
      map.set(contact.companyId, entry);
    }
    for (const deal of lookups.deals) {
      if (!deal.companyId || !isOpenDeal(deal)) continue;
      const entry = map.get(deal.companyId) ?? { contacts: 0, openPipeline: 0 };
      entry.openPipeline += deal.amount;
      map.set(deal.companyId, entry);
    }
    return map;
  }, [lookups.contacts, lookups.deals]);

  async function checkDuplicates() {
    if (duplicates !== null) {
      setDuplicates(null);
      return;
    }
    setCheckingDuplicates(true);
    try {
      const result = await rpc.crm.companies.duplicates({ limit: 20 });
      setDuplicates(result.groups);
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setCheckingDuplicates(false);
    }
  }

  const columns: Column<CrmCompany>[] = [
    {
      key: "name",
      header: t`Name`,
      render: (row) => (
        <PrimaryCell
          avatar={{ name: row.name, shape: "square" }}
          title={row.name}
          detail={row.domain}
          detailWhile="md"
        />
      ),
    },
    {
      key: "domain",
      header: t`Domain`,
      hideBelow: "md",
      render: (row) => row.domain ?? "",
    },
    { key: "phone", header: t`Phone`, hideBelow: "lg", render: (row) => row.phone ?? "" },
    {
      key: "contacts",
      header: t`Contacts`,
      align: "end",
      hideBelow: "sm",
      render: (row) => {
        const count = statsByCompany.get(row.id)?.contacts ?? 0;
        return count > 0 ? formatQuantity(count) : "";
      },
    },
    {
      key: "pipeline",
      header: t`Open pipeline`,
      align: "end",
      hideBelow: "md",
      render: (row) => {
        const amount = statsByCompany.get(row.id)?.openPipeline ?? 0;
        return amount > 0 ? shortMoney(amount) : "";
      },
    },
    {
      key: "createdBy",
      header: t`Created by`,
      hideBelow: "lg",
      render: (row) => <ActorLabel actor={row.createdBy} className="text-muted-foreground" />,
    },
  ];
  const newCompany = (
    <NewButton onClick={() => setCreating(true)}>
      <Trans>New company</Trans>
    </NewButton>
  );
  if (open) {
    return (
      <FrappeOrganizationWorkspace
        key={open.id}
        company={open}
        lookups={lookups}
        currency={currency}
        revision={revision}
        onBack={() => setOpenId(null)}
        onSaved={reload}
        onError={onError}
      />
    );
  }
  return (
    <>
      <Toolbar
        action={
          <>
            <CsvExportButton
              filename="accounts-export.csv"
              rows={lookups.companies}
              columns={[
                { header: "Name", value: (r) => r.name },
                { header: "Domain", value: (r) => r.domain },
                { header: "Phone", value: (r) => r.phone },
                { header: "Contacts", value: (r) => statsByCompany.get(r.id)?.contacts ?? 0 },
                {
                  header: "Open Pipeline",
                  value: (r) => statsByCompany.get(r.id)?.openPipeline ?? 0,
                },
                { header: "Notes", value: (r) => r.notes },
              ]}
            />
            <Button variant="outline" size="sm" onClick={() => setImportingCsv(true)}>
              <Upload className="size-3.5" data-icon="inline-start" aria-hidden="true" />
              <Trans>Import CSV</Trans>
            </Button>
            <Button
              variant={duplicates !== null ? "secondary" : "outline"}
              onClick={() => void checkDuplicates()}
              disabled={checkingDuplicates}
            >
              <CopyCheck data-icon="inline-start" aria-hidden="true" />
              <Trans>Duplicates</Trans>
            </Button>
            {newCompany}
          </>
        }
      >
        <SearchField value={query} onChange={setQuery} />
      </Toolbar>
      {duplicates !== null ? (
        <Panel
          title={t`Duplicate company hygiene`}
          aside={`${duplicates.length}`}
          testId="crm-company-duplicates"
        >
          {duplicates.length === 0 ? (
            <PanelEmpty icon={CircleCheck}>{t`No duplicate companies found`}</PanelEmpty>
          ) : (
            <RecordList label={t`Duplicate companies`}>
              {duplicates.flatMap((group) =>
                group.companies.map((company) => (
                  <RecordRow
                    key={`${group.matchKey}-${company.id}`}
                    to={crmHref("companies", { record: company.id })}
                    icon={Building2}
                    title={company.name}
                    meta={
                      <>
                        <span className="shrink-0">{group.reason}</span>
                        <span aria-hidden="true">·</span>
                        <span className="truncate font-mono">{group.matchKey}</span>
                      </>
                    }
                    action={<AskRowButton record={{ kind: "company", ref: company.name }} />}
                  />
                )),
              )}
            </RecordList>
          )}
        </Panel>
      ) : null}
      <RecordTable
        testId="crm-companies"
        columns={columns}
        rows={lookups.companies.filter((row) =>
          matchesQuery(query, row.name, row.domain, row.phone, row.notes),
        )}
        loading={loading}
        onRowClick={(row) => setOpenId(row.id)}
        rowAction={(row) => <AskRowButton record={{ kind: "company", ref: row.name }} />}
        filtered={Boolean(query)}
        empty={t`No companies yet`}
        emptyIcon={Building2}
        emptyAction={newCompany}
      />
      {importingCsv ? (
        <CsvImportModal
          entity="companies"
          bots={lookups.bots}
          companies={lookups.companies}
          onClose={() => setImportingCsv(false)}
          onImported={reload}
        />
      ) : null}
      {creating ? (
        <CompanyDialog
          key="new"
          company={null}
          lookups={lookups}
          currency={currency}
          revision={revision}
          onClose={() => setCreating(false)}
          onSaved={reload}
        />
      ) : open ? (
        <CompanyDialog
          key={open.id}
          company={open}
          lookups={lookups}
          currency={currency}
          revision={revision}
          onClose={() => setOpenId(null)}
          onSaved={reload}
        />
      ) : null}
    </>
  );
}

function CompanyDialog({
  company,
  lookups,
  currency,
  revision,
  onClose,
  onSaved,
}: {
  company: CrmCompany | null;
  lookups: Lookups;
  currency: string;
  revision: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLingui();
  const formId = useId();
  const stages = useDealStageLabels();
  const leadStatuses = useLeadStatusLabels();
  const shortMoney = useShortMoney(currency);
  const [name, setName] = useState(company?.name ?? "");
  const [domain, setDomain] = useState(company?.domain ?? "");
  const [phone, setPhone] = useState(company?.phone ?? "");
  const [notes, setNotes] = useState(company?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const linkedContacts = useMemo(
    () => (company ? lookups.contacts.filter((contact) => contact.companyId === company.id) : []),
    [company, lookups.contacts],
  );
  const linkedDeals = useMemo(
    () => (company ? lookups.deals.filter((deal) => deal.companyId === company.id) : []),
    [company, lookups.deals],
  );
  const linkedLeads = useMemo(
    () => (company ? lookups.leads.filter((lead) => lead.companyId === company.id) : []),
    [company, lookups.leads],
  );
  const linkedActivities = useMemo(
    () =>
      company ? lookups.activities.filter((activity) => activity.companyId === company.id) : [],
    [company, lookups.activities],
  );

  async function save() {
    setBusy(true);
    setError("");
    try {
      if (company) {
        await rpc.crm.companies.update({
          id: company.id,
          name,
          domain: domain || null,
          phone: phone || null,
          notes: notes || null,
        });
      } else {
        await rpc.crm.companies.create({ name, domain, phone, notes });
      }
      onSaved();
      onClose();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <FormDialog
      title={company?.name ?? t`New company`}
      size={company ? "lg" : "md"}
      meta={
        company ? (
          <>
            {company.domain ? <span className="text-foreground/85">{company.domain}</span> : null}
            {company.phone ? <span>{company.phone}</span> : null}
            <span>
              {linkedContacts.length} {t`contacts`}
            </span>
            <span>
              {linkedDeals.length} {t`deals`}
            </span>
          </>
        ) : undefined
      }
      onClose={onClose}
      onSubmit={save}
      busy={busy}
      submitLabel={company ? t`Save` : t`Create`}
      disabled={!name.trim()}
      error={error}
      history={company ? { recordType: "company", recordId: company.id, revision } : undefined}
      ask={company ? { kind: "company", ref: company.name } : undefined}
      site={company ? { kind: "company", id: company.id } : undefined}
    >
      <FormField id={`${formId}-name`} label={t`Name`} required>
        <Input
          id={`${formId}-name`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={BUSINESS_NAME_MAX_LENGTH}
          required
        />
      </FormField>
      <FieldRow>
        <FormField id={`${formId}-domain`} label={t`Domain`}>
          <Input
            id={`${formId}-domain`}
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
          />
        </FormField>
        <FormField id={`${formId}-phone`} label={t`Phone`}>
          <Input
            id={`${formId}-phone`}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </FormField>
      </FieldRow>
      <FormField id={`${formId}-notes`} label={t`Notes`}>
        <Textarea
          id={`${formId}-notes`}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          maxLength={BUSINESS_TEXT_MAX_LENGTH}
        />
      </FormField>

      {company ? (
        <>
          {linkedContacts.length > 0 ? (
            <section className="space-y-2 border-t pt-4">
              <h3 className="text-xs font-medium text-muted-foreground">
                <Trans>Contacts</Trans> ({linkedContacts.length})
              </h3>
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
                            <span className="truncate">{contact.email}</span>
                          </>
                        ) : null}
                      </>
                    }
                  />
                ))}
              </RecordList>
            </section>
          ) : null}

          {linkedDeals.length > 0 || linkedLeads.length > 0 ? (
            <section className="space-y-2 border-t pt-4">
              <h3 className="text-xs font-medium text-muted-foreground">
                <Trans>Pipeline & leads</Trans> ({linkedDeals.length + linkedLeads.length})
              </h3>
              <RecordList label={t`Pipeline & leads`}>
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
                    end={shortMoney(deal.amount)}
                  />
                ))}
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
                    end={lead.value !== null ? shortMoney(lead.value) : undefined}
                  />
                ))}
              </RecordList>
            </section>
          ) : null}

          <QuickActivitySection
            activities={linkedActivities}
            companyId={company.id}
            onSaved={onSaved}
            onError={setError}
          />
          <SavingroupCustomFieldsSection
            recordType="company"
            recordId={company.id}
            legacyRef={company.name}
            createdBy={company.createdBy}
          />
        </>
      ) : null}
    </FormDialog>
  );
}

// --- Contacts ----------------------------------------------------------------

function ContactsSection({ lookups, loading, currency, revision, reload, onError }: SectionProps) {
  const { t } = useLingui();
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useOpenRecord();
  const [creating, setCreating] = useState(false);
  const [importingCsv, setImportingCsv] = useState(false);
  const [duplicates, setDuplicates] = useState<ContactDuplicateGroup[] | null>(null);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const open = openId ? lookups.contacts.find((contact) => contact.id === openId) : undefined;

  const dealsByContact = useMemo(() => {
    const map = new Map<string, number>();
    for (const deal of lookups.deals) {
      if (!deal.contactId) continue;
      map.set(deal.contactId, (map.get(deal.contactId) ?? 0) + 1);
    }
    return map;
  }, [lookups.deals]);

  async function checkDuplicates() {
    if (duplicates !== null) {
      setDuplicates(null);
      return;
    }
    setCheckingDuplicates(true);
    try {
      const result = await rpc.crm.contacts.duplicates({ limit: 20 });
      setDuplicates(result.groups);
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setCheckingDuplicates(false);
    }
  }

  const columns: Column<CrmContact>[] = [
    {
      key: "name",
      header: t`Name`,
      render: (row) => (
        <PrimaryCell
          avatar={{ name: row.name }}
          title={row.name}
          detail={row.companyName ?? row.title}
          detailWhile="md"
        />
      ),
    },
    { key: "email", header: t`Email`, hideBelow: "sm", render: (row) => row.email ?? "" },
    { key: "phone", header: t`Phone`, hideBelow: "lg", render: (row) => row.phone ?? "" },
    { key: "company", header: t`Company`, hideBelow: "md", render: (row) => row.companyName ?? "" },
    {
      key: "title",
      header: t`Title`,
      hideBelow: "lg",
      render: (row) => <span className="text-muted-foreground">{row.title ?? ""}</span>,
    },
    {
      key: "deals",
      header: t`Deals`,
      align: "end",
      hideBelow: "md",
      render: (row) => {
        const count = dealsByContact.get(row.id) ?? 0;
        return count > 0 ? formatQuantity(count) : "";
      },
    },
  ];
  const newContact = (
    <NewButton onClick={() => setCreating(true)}>
      <Trans>New contact</Trans>
    </NewButton>
  );
  if (open) {
    return (
      <FrappeContactWorkspace
        key={open.id}
        contact={open}
        lookups={lookups}
        currency={currency}
        revision={revision}
        onBack={() => setOpenId(null)}
        onSaved={reload}
        onError={onError}
      />
    );
  }
  return (
    <>
      <Toolbar
        action={
          <>
            <CsvExportButton
              filename="contacts-export.csv"
              rows={lookups.contacts}
              columns={[
                { header: "Name", value: (r) => r.name },
                { header: "Email", value: (r) => r.email },
                { header: "Phone", value: (r) => r.phone },
                { header: "Title", value: (r) => r.title },
                { header: "Company", value: (r) => r.companyName },
              ]}
            />
            <Button variant="outline" size="sm" onClick={() => setImportingCsv(true)}>
              <Upload className="size-3.5" data-icon="inline-start" aria-hidden="true" />
              <Trans>Import CSV</Trans>
            </Button>
            <Button
              variant={duplicates !== null ? "secondary" : "outline"}
              onClick={() => void checkDuplicates()}
              disabled={checkingDuplicates}
            >
              <CopyCheck data-icon="inline-start" aria-hidden="true" />
              <Trans>Duplicates</Trans>
            </Button>
            {newContact}
          </>
        }
      >
        <SearchField value={query} onChange={setQuery} />
      </Toolbar>
      {duplicates !== null ? (
        <Panel
          title={t`Duplicate contact hygiene`}
          aside={`${duplicates.length}`}
          testId="crm-contact-duplicates"
        >
          {duplicates.length === 0 ? (
            <PanelEmpty icon={CircleCheck}>{t`No duplicate contacts found`}</PanelEmpty>
          ) : (
            <RecordList label={t`Duplicate contacts`}>
              {duplicates.flatMap((group) =>
                group.contacts.map((contact) => (
                  <RecordRow
                    key={`${group.matchKey}-${contact.id}`}
                    to={crmHref("contacts", { record: contact.id })}
                    icon={Contact}
                    title={contact.name}
                    meta={
                      <>
                        <span className="shrink-0">{group.reason}</span>
                        <span aria-hidden="true">·</span>
                        <span className="truncate font-mono">{group.matchKey}</span>
                      </>
                    }
                    action={
                      <AskRowButton
                        record={{ kind: "contact", ref: contact.name, name: contact.companyName }}
                      />
                    }
                  />
                )),
              )}
            </RecordList>
          )}
        </Panel>
      ) : null}
      <RecordTable
        testId="crm-contacts"
        columns={columns}
        rows={lookups.contacts.filter((row) =>
          matchesQuery(query, row.name, row.email, row.phone, row.companyName, row.title),
        )}
        loading={loading}
        onRowClick={(row) => setOpenId(row.id)}
        rowAction={(row) => (
          <AskRowButton record={{ kind: "contact", ref: row.name, name: row.companyName }} />
        )}
        filtered={Boolean(query)}
        empty={t`No contacts yet`}
        emptyIcon={Contact}
        emptyAction={newContact}
      />
      {importingCsv ? (
        <CsvImportModal
          entity="contacts"
          bots={lookups.bots}
          companies={lookups.companies}
          onClose={() => setImportingCsv(false)}
          onImported={reload}
        />
      ) : null}
      {creating ? (
        <ContactDialog
          key="new"
          contact={null}
          lookups={lookups}
          currency={currency}
          revision={revision}
          onClose={() => setCreating(false)}
          onSaved={reload}
        />
      ) : open ? (
        <ContactDialog
          key={open.id}
          contact={open}
          lookups={lookups}
          currency={currency}
          revision={revision}
          onClose={() => setOpenId(null)}
          onSaved={reload}
        />
      ) : null}
    </>
  );
}

function ContactDialog({
  contact,
  lookups,
  currency,
  revision,
  onClose,
  onSaved,
}: {
  contact: CrmContact | null;
  lookups: Lookups;
  currency: string;
  revision: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLingui();
  const formId = useId();
  const stages = useDealStageLabels();
  const leadStatuses = useLeadStatusLabels();
  const shortMoney = useShortMoney(currency);
  const [firstName, setFirstName] = useState(contact?.firstName ?? "");
  const [lastName, setLastName] = useState(contact?.lastName ?? "");
  const [email, setEmail] = useState(contact?.email ?? "");
  const [phone, setPhone] = useState(contact?.phone ?? "");
  const [title, setTitle] = useState(contact?.title ?? "");
  const [companyId, setCompanyId] = useState(contact?.companyId ?? "");
  const [notes, setNotes] = useState(contact?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const linkedDeals = useMemo(
    () => (contact ? lookups.deals.filter((deal) => deal.contactId === contact.id) : []),
    [contact, lookups.deals],
  );
  const linkedLeads = useMemo(
    () => (contact ? lookups.leads.filter((lead) => lead.contactId === contact.id) : []),
    [contact, lookups.leads],
  );
  const linkedActivities = useMemo(
    () =>
      contact ? lookups.activities.filter((activity) => activity.contactId === contact.id) : [],
    [contact, lookups.activities],
  );

  async function save() {
    setBusy(true);
    setError("");
    try {
      if (contact) {
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
      } else {
        await rpc.crm.contacts.create({
          firstName,
          lastName,
          ...(email ? { email } : {}),
          ...(phone ? { phone } : {}),
          ...(title ? { title } : {}),
          ...(notes ? { notes } : {}),
          ...(companyId ? { companyId } : {}),
        });
      }
      onSaved();
      onClose();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <FormDialog
      title={contact?.name ?? t`New contact`}
      size={contact ? "lg" : "md"}
      meta={
        contact ? (
          <>
            {contact.companyName ? (
              <span className="text-foreground/85">{contact.companyName}</span>
            ) : null}
            {contact.title ? <span>{contact.title}</span> : null}
            {contact.email ? <span>{contact.email}</span> : null}
          </>
        ) : undefined
      }
      onClose={onClose}
      onSubmit={save}
      busy={busy}
      submitLabel={contact ? t`Save` : t`Create`}
      disabled={!firstName.trim()}
      error={error}
      history={contact ? { recordType: "contact", recordId: contact.id, revision } : undefined}
      ask={contact ? { kind: "contact", ref: contact.name, name: contact.companyName } : undefined}
      site={contact ? { kind: "contact", id: contact.id } : undefined}
    >
      <FieldRow>
        <FormField id={`${formId}-first`} label={t`First name`} required>
          <Input
            id={`${formId}-first`}
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            required
          />
        </FormField>
        <FormField id={`${formId}-last`} label={t`Last name`}>
          <Input
            id={`${formId}-last`}
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
          />
        </FormField>
      </FieldRow>
      <FieldRow>
        <FormField id={`${formId}-email`} label={t`Email`}>
          <Input
            id={`${formId}-email`}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </FormField>
        <FormField id={`${formId}-phone`} label={t`Phone`}>
          <Input
            id={`${formId}-phone`}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </FormField>
      </FieldRow>
      <FieldRow>
        <FormField id={`${formId}-title`} label={t`Title`}>
          <Input
            id={`${formId}-title`}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </FormField>
        <FormField id={`${formId}-company`} label={t`Company`}>
          <NativeSelect
            className="w-full"
            id={`${formId}-company`}
            value={companyId}
            onChange={(event) => setCompanyId(event.target.value)}
          >
            <NativeSelectOption value="">{t`None`}</NativeSelectOption>
            {lookups.companies.map((company) => (
              <NativeSelectOption key={company.id} value={company.id}>
                {company.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
      </FieldRow>
      <FormField id={`${formId}-notes`} label={t`Notes`}>
        <Textarea
          id={`${formId}-notes`}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          maxLength={BUSINESS_TEXT_MAX_LENGTH}
        />
      </FormField>

      {contact ? (
        <>
          {linkedDeals.length > 0 || linkedLeads.length > 0 ? (
            <section className="space-y-2 border-t pt-4">
              <h3 className="text-xs font-medium text-muted-foreground">
                <Trans>Deals & leads</Trans> ({linkedDeals.length + linkedLeads.length})
              </h3>
              <RecordList label={t`Deals & leads`}>
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
                    end={shortMoney(deal.amount)}
                  />
                ))}
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
                    end={lead.value !== null ? shortMoney(lead.value) : undefined}
                  />
                ))}
              </RecordList>
            </section>
          ) : null}

          <QuickActivitySection
            activities={linkedActivities}
            companyId={contact.companyId}
            contactId={contact.id}
            onSaved={onSaved}
            onError={setError}
          />
          <SavingroupCustomFieldsSection
            recordType="contact"
            recordId={contact.id}
            legacyRef={contact.name}
            createdBy={contact.createdBy}
          />
        </>
      ) : null}
    </FormDialog>
  );
}

// --- Leads -------------------------------------------------------------------

type LeadsView = "list" | "pipeline";
const LEADS_VIEW_KEY = "savingroup.business.leadsView";

function readLeadsView(): LeadsView {
  try {
    return window.localStorage.getItem(LEADS_VIEW_KEY) === "pipeline" ? "pipeline" : "list";
  } catch {
    return "list";
  }
}

function LeadsSection({ lookups, currency, revision, reload, onError }: SectionProps) {
  const { t } = useLingui();
  const statuses = useLeadStatusLabels();
  const money = useMoney(currency);
  const [status, setStatus] = useStatusFilter(LEAD_STATUSES);
  const [view, setView] = useState<LeadsView>(readLeadsView);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useOpenRecord();
  const [creating, setCreating] = useState(false);
  const [importingCsv, setImportingCsv] = useState(false);
  const { value: leads, loading } = useBusinessList(
    () =>
      rpc.crm.leads
        .list({ ...(status ? { status } : {}), limit: 200 })
        .then((result) => result.leads),
    [revision, status],
    onError,
    [] as CrmLead[],
  );

  const visible = leads.filter((row) =>
    matchesQuery(
      query,
      row.ref,
      frappeLeadDocName(row),
      row.title,
      row.companyName,
      row.contactName,
      row.source,
    ),
  );
  const open = openId
    ? (leads.find((lead) => lead.id === openId) ?? lookups.leads.find((lead) => lead.id === openId))
    : undefined;

  if (open) {
    return (
      <FrappeLeadWorkspace
        key={open.id}
        lead={open}
        lookups={lookups}
        currency={currency}
        revision={revision}
        onBack={() => setOpenId(null)}
        onSaved={reload}
        onError={onError}
      />
    );
  }

  function chooseView(next: LeadsView) {
    setView(next);
    try {
      window.localStorage.setItem(LEADS_VIEW_KEY, next);
    } catch {
      // Remembered for this visit only.
    }
  }

  async function moveLead(lead: CrmLead, nextStatus: "contacted" | "qualified" | "unqualified") {
    try {
      await rpc.crm.leads.qualify({ id: lead.id, status: nextStatus });
      reload();
    } catch (cause) {
      onError(errorText(cause));
    }
  }

  const columns: Column<CrmLead>[] = [
    {
      key: "lead",
      header: t`Inbound Lead`,
      render: (row) => (
        <PrimaryCell
          refText={`${frappeLeadDocName(row)} · ${row.ref}`}
          title={row.title}
          detail={row.companyName}
          detailWhile="md"
        />
      ),
    },
    {
      key: "status",
      header: t`Status`,
      render: (row) => (
        <StatusBadge tone={LEAD_STATUS_TONES[row.status]}>{statuses[row.status]}</StatusBadge>
      ),
    },
    {
      key: "company",
      header: t`Organization`,
      hideBelow: "md",
      render: (row) => row.companyName ?? "",
    },
    {
      key: "source",
      header: t`Source`,
      hideBelow: "lg",
      render: (row) => <span className="text-muted-foreground">{row.source ?? ""}</span>,
    },
    {
      key: "value",
      header: t`Value`,
      align: "end",
      hideBelow: "sm",
      render: (row) => (row.value === null ? "" : money(row.value)),
    },
    {
      key: "assignee",
      header: t`Assigned To`,
      hideBelow: "lg",
      render: (row) => <ActorLabel actor={row.assignee} />,
    },
    {
      key: "updated",
      header: t`Modified`,
      hideBelow: "lg",
      render: (row) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {formatRelativeTime(row.updatedAt)}
        </span>
      ),
    },
  ];
  const newLead = (
    <NewButton onClick={() => setCreating(true)}>
      <Trans>New lead</Trans>
    </NewButton>
  );
  return (
    <>
      <Toolbar
        action={
          <>
            <CsvExportButton
              filename="leads-export.csv"
              rows={visible}
              columns={[
                { header: "Ref", value: (r) => r.ref },
                { header: "Title", value: (r) => r.title },
                { header: "Status", value: (r) => r.status },
                { header: "Company", value: (r) => r.companyName },
                { header: "Value", value: (r) => r.value },
                { header: "Source", value: (r) => r.source },
                { header: "Assignee", value: (r) => actorName(r.assignee) },
              ]}
            />
            <Button variant="outline" size="sm" onClick={() => setImportingCsv(true)}>
              <Upload className="size-3.5" data-icon="inline-start" aria-hidden="true" />
              <Trans>Import CSV</Trans>
            </Button>
            <div className="flex items-center rounded-lg border p-0.5">
              <ViewButton
                active={view === "list"}
                label={t`List view`}
                icon={List}
                onClick={() => chooseView("list")}
              />
              <ViewButton
                active={view === "pipeline"}
                label={t`Board view`}
                icon={Kanban}
                onClick={() => chooseView("pipeline")}
              />
            </div>
            {newLead}
          </>
        }
        filters={
          <FilterChips
            label={t`Filter by status`}
            value={status}
            onChange={setStatus}
            options={[
              { value: "", label: t`All statuses` },
              ...LEAD_STATUSES.map((value) => ({ value, label: statuses[value] })),
            ]}
          />
        }
      >
        <SearchField value={query} onChange={setQuery} />
      </Toolbar>
      {view === "pipeline" ? (
        <LeadPipeline
          leads={visible}
          currency={currency}
          loading={loading}
          onOpen={(lead) => setOpenId(lead.id)}
          onMove={moveLead}
        />
      ) : (
        <RecordTable
          testId="crm-leads"
          columns={columns}
          rows={visible}
          loading={loading}
          onRowClick={(row) => setOpenId(row.id)}
          rowAction={(row) => (
            <AskRowButton
              record={{ kind: "lead", ref: row.ref, name: row.title, status: row.status }}
            />
          )}
          filtered={Boolean(query || status)}
          empty={t`No leads yet`}
          emptyIcon={Target}
          emptyAction={newLead}
        />
      )}
      {importingCsv ? (
        <CsvImportModal
          entity="leads"
          bots={lookups.bots}
          companies={lookups.companies}
          onClose={() => setImportingCsv(false)}
          onImported={reload}
        />
      ) : null}
      {creating ? (
        <LeadDialog
          key="new"
          lead={null}
          lookups={lookups}
          currency={currency}
          revision={revision}
          onClose={() => setCreating(false)}
          onSaved={reload}
        />
      ) : null}
    </>
  );
}

const LEAD_DOTS: Record<LeadStatus, string> = {
  new: "bg-muted-foreground/60",
  contacted: "bg-foreground/50",
  qualified: "bg-foreground/85",
  converted: "bg-success",
  unqualified: "bg-muted-foreground/35",
};

function LeadPipeline({
  leads,
  currency,
  loading,
  onOpen,
  onMove,
}: {
  leads: CrmLead[];
  currency: string;
  loading: boolean;
  onOpen: (lead: CrmLead) => void;
  onMove: (lead: CrmLead, status: "contacted" | "qualified" | "unqualified") => void;
}) {
  const statuses = useLeadStatusLabels();
  const short = useShortMoney(currency);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [target, setTarget] = useState<LeadStatus | null>(null);
  const dragging = draggingId ? leads.find((lead) => lead.id === draggingId) : undefined;
  const byStatus = useMemo(() => {
    const groups = new Map<LeadStatus, CrmLead[]>(LEAD_STATUSES.map((status) => [status, []]));
    for (const lead of leads) groups.get(lead.status)?.push(lead);
    return groups;
  }, [leads]);

  function endDrag() {
    setDraggingId(null);
    setTarget(null);
  }

  return (
    <div
      data-testid="crm-lead-pipeline"
      className="rk-scroll -mx-4 snap-x scroll-px-4 overflow-x-auto px-4 pb-3 md:-mx-6 md:scroll-px-6 md:px-6"
    >
      <div className="grid min-w-260 grid-cols-5 gap-3">
        {LEAD_STATUSES.map((status) => {
          const rows = byStatus.get(status) ?? [];
          const total = rows.reduce((sum, row) => sum + (row.value ?? 0), 0);
          const canDropStatus =
            status === "contacted" || status === "qualified" || status === "unqualified";
          const droppable = Boolean(
            canDropStatus &&
              dragging &&
              dragging.status !== "converted" &&
              dragging.status !== status,
          );
          return (
            <section
              key={status}
              aria-label={statuses[status]}
              onDragOver={(event) => {
                if (!droppable) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setTarget(status);
              }}
              onDragLeave={(event) => {
                if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                setTarget((current) => (current === status ? null : current));
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (
                  droppable &&
                  dragging &&
                  (status === "contacted" || status === "qualified" || status === "unqualified")
                ) {
                  onMove(dragging, status);
                }
                endDrag();
              }}
              className={cn(
                "flex min-w-0 snap-start flex-col rounded-xl bg-muted/50 p-2 transition-colors",
                droppable && "ring-1 ring-border ring-inset",
                target === status && "bg-accent ring-2 ring-ring/50",
              )}
            >
              <div className="flex items-center gap-2 px-1.5 pt-1">
                <span
                  aria-hidden="true"
                  className={cn("size-2 shrink-0 rounded-full", LEAD_DOTS[status])}
                />
                <h3 className="truncate text-[13px] font-semibold">{statuses[status]}</h3>
                <span className="ms-auto rounded-full bg-background px-1.5 text-xs font-medium text-muted-foreground tabular-nums">
                  {rows.length}
                </span>
              </div>
              <div className="px-1.5 pt-1 pb-2.5">
                <p className="text-xs font-medium text-muted-foreground tabular-nums">
                  {short(total)}
                </p>
              </div>
              <ul className="flex min-h-20 flex-1 flex-col gap-2">
                {loading && leads.length === 0 ? (
                  <li>
                    <Skeleton className="h-24 rounded-lg" />
                  </li>
                ) : null}
                {rows.map((lead) => (
                  <li key={lead.id}>
                    <button
                      type="button"
                      draggable={lead.status !== "converted"}
                      onClick={() => onOpen(lead)}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", lead.ref);
                        setDraggingId(lead.id);
                      }}
                      onDragEnd={endDrag}
                      className={cn(
                        "w-full cursor-grab space-y-2 rounded-xl border bg-card p-3 text-start text-sm shadow-2xs outline-none transition-all hover:-translate-y-0.5 hover:border-foreground/25 hover:shadow-sm focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing",
                        draggingId === lead.id && "opacity-40",
                      )}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="truncate font-mono text-[10px] text-muted-foreground">
                          {frappeLeadDocName(lead)}
                        </span>
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
                          {lead.ref}
                        </span>
                      </div>
                      <span className="line-clamp-2 font-medium leading-snug">{lead.title}</span>
                      <span className="flex min-w-0 items-center gap-1.5 overflow-hidden text-xs text-muted-foreground">
                        {lead.companyName ? (
                          <>
                            <Building2
                              className="size-3.5 shrink-0"
                              strokeWidth={1.75}
                              aria-hidden="true"
                            />
                            <span className="truncate font-medium text-foreground/80">
                              {lead.companyName}
                            </span>
                          </>
                        ) : (
                          <span>{lead.contactName ?? "—"}</span>
                        )}
                      </span>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t pt-2 text-xs">
                        <span className="me-auto text-[13px] font-semibold tabular-nums">
                          {lead.value !== null ? short(lead.value) : "—"}
                        </span>
                        {lead.source ? (
                          <span className="truncate rounded bg-muted/60 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                            {lead.source}
                          </span>
                        ) : null}
                        {lead.assignee.botId || lead.assignee.userId ? (
                          <span title={actorName(lead.assignee)} className="flex shrink-0">
                            <ActorAvatar actor={lead.assignee} />
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function LeadDialog({
  lead,
  lookups,
  currency,
  revision,
  onClose,
  onSaved,
}: {
  lead: CrmLead | null;
  lookups: Lookups;
  currency: string;
  revision: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const formId = useId();
  const statuses = useLeadStatusLabels();
  const money = useMoney(currency);
  const [title, setTitle] = useState(lead?.title ?? "");
  const [companyId, setCompanyId] = useState(lead?.companyId ?? "");
  const [contactId, setContactId] = useState(lead?.contactId ?? "");
  const [value, setValue] = useState(lead?.value === null || !lead ? "" : String(lead.value));
  const [source, setSource] = useState(lead?.source ?? "");
  const [notes, setNotes] = useState(lead?.notes ?? "");
  const [assigneeBotId, setAssigneeBotId] = useState(lead?.assignee.botId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const linkedActivities = useMemo(
    () => (lead ? lookups.activities.filter((activity) => activity.leadId === lead.id) : []),
    [lead, lookups.activities],
  );

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      onSaved();
      onClose();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  const create = () =>
    run(() =>
      rpc.crm.leads.create({
        title,
        ...(companyId ? { companyId } : {}),
        ...(contactId ? { contactId } : {}),
        ...(source ? { source } : {}),
        ...(notes ? { notes } : {}),
        ...(parseMoneyInput(value) !== undefined ? { value: parseMoneyInput(value) } : {}),
        ...(assigneeBotId ? { assigneeBotId } : {}),
      }),
    );
  const saveLead = () =>
    run(() => {
      const parsedValue = parseMoneyInput(value);
      return rpc.crm.leads.update({
        id: lead!.id,
        title,
        source: source || null,
        notes: notes || null,
        value: value.trim() === "" ? null : (parsedValue ?? lead!.value),
        companyId: companyId || null,
        contactId: contactId || null,
      });
    });
  const qualify = (status: "contacted" | "qualified" | "unqualified") =>
    run(() => rpc.crm.leads.qualify({ id: lead!.id, status }));
  const assign = (botId: string) =>
    run(() => rpc.crm.leads.assign({ id: lead!.id, assigneeBotId: botId }));
  const convert = async () => {
    setBusy(true);
    setError("");
    try {
      if (lead!.status !== "qualified") {
        await rpc.crm.leads.qualify({ id: lead!.id, status: "qualified" });
      }
      const deal = await rpc.crm.leads.convert({ id: lead!.id });
      onSaved();
      onClose();
      void navigate(crmHref("deals", { record: deal.id }));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };
  const contacts = lookups.contacts.filter(
    (contact) => !companyId || contact.companyId === companyId,
  );

  if (lead) {
    const open = lead.status !== "converted";
    return (
      <FormDialog
        title={`${lead.ref} · ${lead.title}`}
        size="lg"
        meta={
          <>
            <StatusBadge tone={LEAD_STATUS_TONES[lead.status]}>{statuses[lead.status]}</StatusBadge>
            {lead.value !== null ? (
              <span className="text-foreground/85 tabular-nums">{money(lead.value)}</span>
            ) : null}
            {lead.companyName ? (
              <span className="text-foreground/85">{lead.companyName}</span>
            ) : null}
            {lead.contactName ? <span>{lead.contactName}</span> : null}
          </>
        }
        onClose={onClose}
        onSubmit={open ? saveLead : undefined}
        busy={busy}
        submitLabel={open ? t`Save` : ""}
        disabled={!title.trim()}
        error={error}
        history={{ recordType: "lead", recordId: lead.id, revision }}
        ask={{ kind: "lead", ref: lead.ref, name: lead.title, status: lead.status }}
        site={{ kind: "lead", id: lead.id }}
        actions={
          open ? (
            <>
              {(["contacted", "qualified", "unqualified"] as const)
                .filter((next) => next !== lead.status)
                .map((next) => (
                  <Button
                    key={next}
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void qualify(next)}
                  >
                    {statuses[next]}
                  </Button>
                ))}
              {lead.status !== "unqualified" ? (
                <Button size="sm" disabled={busy} onClick={() => void convert()}>
                  <Handshake data-icon="inline-start" aria-hidden="true" />
                  <Trans>Convert to deal</Trans>
                </Button>
              ) : null}
            </>
          ) : lead.convertedDealId ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onClose();
                void navigate(crmHref("deals", { record: lead.convertedDealId! }));
              }}
            >
              <Handshake data-icon="inline-start" aria-hidden="true" />
              <Trans>Open converted deal</Trans>
            </Button>
          ) : undefined
        }
      >
        {open ? (
          <>
            <FormField id={`${formId}-title`} label={t`Title`} required>
              <Input
                id={`${formId}-title`}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={BUSINESS_NAME_MAX_LENGTH}
                required
              />
            </FormField>
            <FieldRow>
              <FormField id={`${formId}-company`} label={t`Company`}>
                <NativeSelect
                  className="w-full"
                  id={`${formId}-company`}
                  value={companyId}
                  onChange={(event) => {
                    setCompanyId(event.target.value);
                    setContactId("");
                  }}
                >
                  <NativeSelectOption value="">{t`None`}</NativeSelectOption>
                  {lookups.companies.map((company) => (
                    <NativeSelectOption key={company.id} value={company.id}>
                      {company.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField id={`${formId}-contact`} label={t`Contact`}>
                <NativeSelect
                  className="w-full"
                  id={`${formId}-contact`}
                  value={contactId}
                  onChange={(event) => setContactId(event.target.value)}
                >
                  <NativeSelectOption value="">{t`None`}</NativeSelectOption>
                  {contacts.map((contact) => (
                    <NativeSelectOption key={contact.id} value={contact.id}>
                      {contact.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </FormField>
            </FieldRow>
            <FieldRow>
              <FormField id={`${formId}-value`} label={t`Value`}>
                <Input
                  id={`${formId}-value`}
                  inputMode="decimal"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                />
              </FormField>
              <FormField id={`${formId}-source`} label={t`Source`}>
                <Input
                  id={`${formId}-source`}
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                />
              </FormField>
            </FieldRow>
            <FormField id={`${formId}-notes`} label={t`Notes`}>
              <Textarea
                id={`${formId}-notes`}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                maxLength={BUSINESS_TEXT_MAX_LENGTH}
              />
            </FormField>
            <FormField id={`${formId}-assignee`} label={t`Assigned bot`}>
              <NativeSelect
                className="w-full"
                id={`${formId}-assignee`}
                value={assigneeBotId}
                onChange={(event) => {
                  setAssigneeBotId(event.target.value);
                  if (event.target.value) void assign(event.target.value);
                }}
              >
                <NativeSelectOption value="">
                  {lead.assignee.name ?? t`Unassigned`}
                </NativeSelectOption>
                {lookups.bots.map((bot) => (
                  <NativeSelectOption key={bot.id} value={bot.id}>
                    {bot.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FormField>
          </>
        ) : (
          <DetailList
            items={[
              {
                label: t`Value`,
                value: lead.value === null ? "—" : money(lead.value),
              },
              { label: t`Source`, value: lead.source ?? "—" },
              { label: t`Assignee`, value: <ActorLabel actor={lead.assignee} /> },
            ]}
          />
        )}

        <QuickActivitySection
          activities={linkedActivities}
          companyId={lead.companyId}
          contactId={lead.contactId}
          leadId={lead.id}
          onSaved={onSaved}
          onError={setError}
        />
      </FormDialog>
    );
  }

  return (
    <FormDialog
      title={t`New lead`}
      onClose={onClose}
      onSubmit={create}
      busy={busy}
      submitLabel={t`Create`}
      disabled={!title.trim()}
      error={error}
    >
      <FormField id={`${formId}-title`} label={t`Title`} required>
        <Input
          id={`${formId}-title`}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={BUSINESS_NAME_MAX_LENGTH}
          required
        />
      </FormField>
      <FieldRow>
        <FormField id={`${formId}-company`} label={t`Company`}>
          <NativeSelect
            className="w-full"
            id={`${formId}-company`}
            value={companyId}
            onChange={(event) => {
              setCompanyId(event.target.value);
              setContactId("");
            }}
          >
            <NativeSelectOption value="">{t`None`}</NativeSelectOption>
            {lookups.companies.map((company) => (
              <NativeSelectOption key={company.id} value={company.id}>
                {company.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
        <FormField id={`${formId}-contact`} label={t`Contact`}>
          <NativeSelect
            className="w-full"
            id={`${formId}-contact`}
            value={contactId}
            onChange={(event) => setContactId(event.target.value)}
          >
            <NativeSelectOption value="">{t`None`}</NativeSelectOption>
            {contacts.map((contact) => (
              <NativeSelectOption key={contact.id} value={contact.id}>
                {contact.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
      </FieldRow>
      <FieldRow>
        <FormField id={`${formId}-value`} label={t`Value`}>
          <Input
            id={`${formId}-value`}
            inputMode="decimal"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </FormField>
        <FormField id={`${formId}-source`} label={t`Source`}>
          <Input
            id={`${formId}-source`}
            value={source}
            onChange={(event) => setSource(event.target.value)}
          />
        </FormField>
      </FieldRow>
      <FormField id={`${formId}-notes`} label={t`Notes`}>
        <Textarea
          id={`${formId}-notes`}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          maxLength={BUSINESS_TEXT_MAX_LENGTH}
        />
      </FormField>
      <FormField id={`${formId}-bot`} label={t`Assigned bot`}>
        <NativeSelect
          className="w-full"
          id={`${formId}-bot`}
          value={assigneeBotId}
          onChange={(event) => setAssigneeBotId(event.target.value)}
        >
          <NativeSelectOption value="">{t`Unassigned`}</NativeSelectOption>
          {lookups.bots.map((bot) => (
            <NativeSelectOption key={bot.id} value={bot.id}>
              {bot.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </FormField>
    </FormDialog>
  );
}

// --- Deals -------------------------------------------------------------------

type DealsView = "pipeline" | "list";
const DEALS_VIEW_KEY = "savingroup.business.dealsView";

function readDealsView(): DealsView {
  try {
    return window.localStorage.getItem(DEALS_VIEW_KEY) === "list" ? "list" : "pipeline";
  } catch {
    return "pipeline";
  }
}

function DealsSection({ lookups, currency, revision, reload, onError }: SectionProps) {
  const { t } = useLingui();
  const stages = useDealStageLabels();
  const [stageFilter, setStageFilter] = useStatusFilter(DEAL_STAGES);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<DealsView>(readDealsView);
  const [openId, setOpenId] = useOpenRecord();
  const [creating, setCreating] = useState(false);
  const { value: deals, loading } = useBusinessList(
    () =>
      rpc.crm.deals
        .list({ ...(stageFilter ? { stage: stageFilter } : {}), limit: 200 })
        .then((result) => result.deals),
    [revision, stageFilter],
    onError,
    [] as CrmDeal[],
  );
  // A dragged deal shows in its new stage while the change saves; the next list replaces it.
  const [moved, setMoved] = useState<{ list: CrmDeal[]; stages: Record<string, DealStage> }>({
    list: [],
    stages: {},
  });
  const movedStages = moved.list === deals ? moved.stages : {};
  const money = useMoney(deals[0]?.currency ?? currency);
  const visible = deals
    .filter((row) =>
      matchesQuery(
        query,
        row.ref,
        frappeDealDocName(row),
        row.title,
        row.companyName,
        row.contactName,
        row.notes,
      ),
    )
    .map((row) => {
      const stage = movedStages[row.id];
      return stage ? { ...row, stage } : row;
    });
  const open = openId
    ? (deals.find((deal) => deal.id === openId) ?? lookups.deals.find((deal) => deal.id === openId))
    : undefined;

  if (open) {
    return (
      <FrappeDealWorkspace
        key={open.id}
        deal={open}
        lookups={lookups}
        currency={currency}
        revision={revision}
        onBack={() => setOpenId(null)}
        onSaved={reload}
        onError={onError}
      />
    );
  }

  async function move(deal: CrmDeal, stage: DealStage) {
    setMoved((current) => ({
      list: deals,
      stages: { ...(current.list === deals ? current.stages : {}), [deal.id]: stage },
    }));
    try {
      await rpc.crm.deals.updateStage({ id: deal.id, stage });
      reload();
    } catch (cause) {
      setMoved((current) => {
        const { [deal.id]: _undone, ...stages } = current.stages;
        return { ...current, stages };
      });
      onError(errorText(cause));
    }
  }

  function chooseView(next: DealsView) {
    setView(next);
    try {
      window.localStorage.setItem(DEALS_VIEW_KEY, next);
    } catch {
      // Remembered for this visit only.
    }
  }

  const columns: Column<CrmDeal>[] = [
    {
      key: "deal",
      header: t`Active Deal`,
      render: (row) => (
        <PrimaryCell
          refText={`${frappeDealDocName(row)} · ${row.ref}`}
          title={row.title}
          detail={row.companyName}
          detailWhile="md"
        />
      ),
    },
    {
      key: "stage",
      header: t`Stage`,
      render: (row) => (
        <StatusBadge tone={DEAL_STAGE_TONES[row.stage]}>{stages[row.stage]}</StatusBadge>
      ),
    },
    {
      key: "company",
      header: t`Organization`,
      hideBelow: "md",
      render: (row) => row.companyName ?? "",
    },
    {
      key: "close",
      header: t`Expected close`,
      hideBelow: "md",
      render: (row) =>
        row.expectedCloseAt ? (
          <span className="whitespace-nowrap text-muted-foreground tabular-nums">
            {dayFormat.format(new Date(row.expectedCloseAt))}
          </span>
        ) : (
          ""
        ),
    },
    {
      key: "amount",
      header: t`Deal Value`,
      align: "end",
      render: (row) => money(row.amount),
    },
    {
      key: "owner",
      header: t`Deal Owner`,
      hideBelow: "lg",
      render: (row) => <ActorLabel actor={row.owner} />,
    },
  ];
  return (
    <>
      <Toolbar
        action={
          <>
            <CsvExportButton
              filename="deals-export.csv"
              rows={visible}
              columns={[
                { header: "Ref", value: (r) => r.ref },
                { header: "Title", value: (r) => r.title },
                { header: "Stage", value: (r) => r.stage },
                { header: "Company", value: (r) => r.companyName },
                { header: "Amount", value: (r) => r.amount },
                { header: "Currency", value: (r) => r.currency },
                { header: "Expected Close", value: (r) => r.expectedCloseAt },
                { header: "Owner", value: (r) => actorName(r.owner) },
              ]}
            />
            <div className="flex items-center rounded-lg border p-0.5">
              <ViewButton
                active={view === "pipeline"}
                label={t`Pipeline view`}
                icon={Kanban}
                onClick={() => chooseView("pipeline")}
              />
              <ViewButton
                active={view === "list"}
                label={t`List view`}
                icon={List}
                onClick={() => chooseView("list")}
              />
            </div>
            <NewButton onClick={() => setCreating(true)}>
              <Trans>New deal</Trans>
            </NewButton>
          </>
        }
        filters={
          view === "list" ? (
            <FilterChips
              label={t`Filter by stage`}
              value={stageFilter}
              onChange={setStageFilter}
              options={[
                { value: "", label: t`All stages` },
                ...DEAL_STAGES.map((value) => ({ value, label: stages[value] })),
              ]}
            />
          ) : undefined
        }
      >
        <SearchField value={query} onChange={setQuery} />
      </Toolbar>
      {view === "pipeline" ? (
        <DealPipeline
          deals={visible}
          loading={loading}
          onOpen={(deal) => setOpenId(deal.id)}
          onMove={move}
        />
      ) : (
        <RecordTable
          testId="crm-deals"
          columns={columns}
          rows={visible}
          loading={loading}
          onRowClick={(row) => setOpenId(row.id)}
          rowAction={(row) => (
            <AskRowButton
              record={{ kind: "deal", ref: row.ref, name: row.title, status: row.stage }}
            />
          )}
          filtered={Boolean(query || stageFilter)}
          empty={t`No deals yet`}
          emptyIcon={Handshake}
        />
      )}
      {creating ? (
        <DealDialog
          key="new"
          deal={null}
          lookups={lookups}
          revision={revision}
          onClose={() => setCreating(false)}
          onSaved={reload}
        />
      ) : null}
    </>
  );
}

function ViewButton({
  active,
  label,
  icon: Icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={cn(
        "grid size-7 place-items-center rounded-md outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-4" strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}

const STAGE_DOTS: Record<DealStage, string> = {
  qualification: "bg-muted-foreground/60",
  proposal: "bg-foreground/50",
  negotiation: "bg-foreground/85",
  won: "bg-success",
  lost: "bg-destructive",
};

/**
 * One column per stage, with how many deals sit there and what they are worth.
 * Dragging a card to another column moves the deal to that stage; the deal's
 * dialog does the same from the keyboard.
 */
function DealPipeline({
  deals,
  loading,
  onOpen,
  onMove,
}: {
  deals: CrmDeal[];
  loading: boolean;
  onOpen: (deal: CrmDeal) => void;
  onMove: (deal: CrmDeal, stage: DealStage) => void;
}) {
  const stages = useDealStageLabels();
  const short = useShortMoney(deals[0]?.currency ?? "USD");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [target, setTarget] = useState<DealStage | null>(null);
  const dragging = draggingId ? deals.find((deal) => deal.id === draggingId) : undefined;
  const byStage = useMemo(() => {
    const groups = new Map<DealStage, CrmDeal[]>(DEAL_STAGES.map((stage) => [stage, []]));
    for (const deal of deals) groups.get(deal.stage)?.push(deal);
    return groups;
  }, [deals]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function endDrag() {
    setDraggingId(null);
    setTarget(null);
  }

  return (
    <div
      data-testid="crm-pipeline"
      className="rk-scroll -mx-4 snap-x scroll-px-4 overflow-x-auto px-4 pb-3 md:-mx-6 md:scroll-px-6 md:px-6"
    >
      <div className="grid min-w-260 grid-cols-5 gap-3">
        {DEAL_STAGES.map((stage) => {
          const rows = byStage.get(stage) ?? [];
          const total = rows.reduce((sum, row) => sum + row.amount, 0);
          const droppable = Boolean(dragging && dragging.stage !== stage);
          return (
            <section
              key={stage}
              aria-label={stages[stage]}
              data-drop-target={target === stage ? "true" : undefined}
              onDragOver={(event) => {
                if (!droppable) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setTarget(stage);
              }}
              onDragLeave={(event) => {
                if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                setTarget((current) => (current === stage ? null : current));
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragging && dragging.stage !== stage) onMove(dragging, stage);
                endDrag();
              }}
              className={cn(
                "flex min-w-0 snap-start flex-col rounded-xl bg-muted/50 p-2 transition-colors",
                droppable && "ring-1 ring-border ring-inset",
                target === stage && "bg-accent ring-2 ring-ring/50",
              )}
            >
              <div className="flex items-center gap-2 px-1.5 pt-1">
                <span
                  aria-hidden="true"
                  className={cn("size-2 shrink-0 rounded-full", STAGE_DOTS[stage])}
                />
                <h3 className="truncate text-[13px] font-semibold">{stages[stage]}</h3>
                <span className="ms-auto rounded-full bg-background px-1.5 text-xs font-medium text-muted-foreground tabular-nums">
                  {rows.length}
                </span>
              </div>
              <div className="flex items-center justify-between px-1.5 pt-1 pb-2.5 text-xs text-muted-foreground tabular-nums">
                <span className="font-medium">{short(total)}</span>
                <span className="font-mono text-[10px]">
                  {Math.round(STAGE_WEIGHTS[stage] * 100)}%
                </span>
              </div>
              <ul className="flex min-h-20 flex-1 flex-col gap-2">
                {loading && deals.length === 0 ? (
                  <li>
                    <Skeleton className="h-24 rounded-lg" />
                  </li>
                ) : null}
                {rows.map((deal) => {
                  const closing =
                    isOpenDeal(deal) && deal.expectedCloseAt
                      ? new Date(deal.expectedCloseAt)
                      : null;
                  const late = closing !== null && closing < today;
                  return (
                    <li key={deal.id}>
                      <button
                        type="button"
                        draggable
                        data-testid="crm-pipeline-card"
                        onClick={() => onOpen(deal)}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", deal.ref);
                          setDraggingId(deal.id);
                        }}
                        onDragEnd={endDrag}
                        className={cn(
                          "w-full cursor-grab space-y-2 rounded-xl border bg-card p-3 text-start text-sm shadow-2xs outline-none transition-all hover:-translate-y-0.5 hover:border-foreground/25 hover:shadow-sm focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing",
                          draggingId === deal.id && "opacity-40",
                        )}
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="truncate font-mono text-[10px] text-muted-foreground">
                            {frappeDealDocName(deal)}
                          </span>
                          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
                            {Math.round(STAGE_WEIGHTS[deal.stage] * 100)}%
                          </span>
                        </div>
                        <span className="line-clamp-2 font-medium leading-snug">{deal.title}</span>
                        {/* Site refs run long, so the ref gives way before the company. */}
                        <span className="flex min-w-0 items-center gap-1.5 overflow-hidden text-xs text-muted-foreground">
                          {deal.companyName ? (
                            <>
                              <Building2
                                className="size-3.5 shrink-0"
                                strokeWidth={1.75}
                                aria-hidden="true"
                              />
                              <span className="max-w-3/4 shrink-0 truncate font-medium text-foreground/80">
                                {deal.companyName}
                              </span>
                              <span aria-hidden="true">·</span>
                            </>
                          ) : null}
                          <span className="min-w-0 truncate font-mono text-[11px]">{deal.ref}</span>
                        </span>
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t pt-2 text-xs">
                          <span className="me-auto text-[13px] font-semibold tabular-nums">
                            {short(deal.amount)}
                          </span>
                          {closing ? (
                            <span
                              className={cn(
                                "flex shrink-0 items-center gap-1 text-muted-foreground",
                                late && "font-medium text-destructive",
                              )}
                            >
                              <CalendarClock
                                className="size-3 shrink-0"
                                strokeWidth={1.9}
                                aria-hidden="true"
                              />
                              {dayFormat.format(closing)}
                            </span>
                          ) : null}
                          {deal.owner.botId || deal.owner.userId ? (
                            <span title={actorName(deal.owner)} className="flex shrink-0">
                              <ActorAvatar actor={deal.owner} />
                              <span className="sr-only">{actorName(deal.owner)}</span>
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function DealDialog({
  deal,
  lookups,
  revision,
  onClose,
  onSaved,
}: {
  deal: CrmDeal | null;
  lookups: Lookups;
  revision: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const formId = useId();
  const stages = useDealStageLabels();
  const [title, setTitle] = useState(deal?.title ?? "");
  const [amount, setAmount] = useState(deal ? String(deal.amount) : "");
  const [stage, setStage] = useState<DealStage>(deal?.stage ?? "qualification");
  const [expectedCloseAt, setExpectedCloseAt] = useState(
    deal?.expectedCloseAt ? deal.expectedCloseAt.slice(0, 10) : "",
  );
  const [companyId, setCompanyId] = useState(deal?.companyId ?? "");
  const [contactId, setContactId] = useState(deal?.contactId ?? "");
  const [ownerBotId, setOwnerBotId] = useState(deal?.owner.botId ?? "");
  const [notes, setNotes] = useState(deal?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const money = useMoney(deal?.currency ?? lookups.settings?.currency ?? "USD");

  const linkedActivities = useMemo(
    () => (deal ? lookups.activities.filter((activity) => activity.dealId === deal.id) : []),
    [deal, lookups.activities],
  );

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      onSaved();
      onClose();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  const save = () =>
    run(async () => {
      const parsedAmount = parseMoneyInput(amount);
      const nextClose = expectedCloseAt ? new Date(expectedCloseAt).toISOString() : null;
      if (deal) {
        await rpc.crm.deals.update({
          id: deal.id,
          ...(title !== deal.title ? { title } : {}),
          ...(parsedAmount !== undefined && parsedAmount !== deal.amount
            ? { amount: parsedAmount }
            : {}),
          expectedCloseAt: nextClose,
          notes: notes || null,
          ...(companyId !== (deal.companyId ?? "") ? { companyId: companyId || null } : {}),
          ...(contactId !== (deal.contactId ?? "") ? { contactId: contactId || null } : {}),
          ...(ownerBotId !== (deal.owner.botId ?? "") ? { ownerBotId: ownerBotId || null } : {}),
        });
        if (stage !== deal.stage) await rpc.crm.deals.updateStage({ id: deal.id, stage });
      } else {
        await rpc.crm.deals.create({
          title,
          amount: parsedAmount ?? 0,
          stage,
          ...(nextClose ? { expectedCloseAt: nextClose } : {}),
          ...(notes ? { notes } : {}),
          ...(companyId ? { companyId } : {}),
          ...(contactId ? { contactId } : {}),
          ...(ownerBotId ? { ownerBotId } : {}),
        });
      }
    });

  async function createOrderDraft() {
    if (!deal) return;
    setBusy(true);
    setError("");
    try {
      const order = await rpc.erp.orders.createDraft({
        dealId: deal.id,
        ...(deal.companyId ? { companyId: deal.companyId } : {}),
        ...(deal.contactId ? { contactId: deal.contactId } : {}),
        notes: `${deal.ref} · ${deal.title}`,
        lines: [],
      });
      onSaved();
      onClose();
      void navigate(erpHref("orders", { record: order.id }));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormDialog
      title={deal ? `${deal.ref} · ${deal.title}` : t`New deal`}
      size={deal ? "lg" : "md"}
      meta={
        deal ? (
          <>
            <StatusBadge tone={DEAL_STAGE_TONES[deal.stage]}>{stages[deal.stage]}</StatusBadge>
            <span className="text-foreground/85 tabular-nums">{money(deal.amount)}</span>
            {deal.owner.botId || deal.owner.userId ? <ActorLabel actor={deal.owner} /> : null}
            {deal.closedAt ? <span>{formatRelativeTime(deal.closedAt)}</span> : null}
          </>
        ) : undefined
      }
      onClose={onClose}
      onSubmit={save}
      busy={busy}
      submitLabel={deal ? t`Save` : t`Create`}
      disabled={!title.trim()}
      error={error}
      history={deal ? { recordType: "deal", recordId: deal.id, revision } : undefined}
      ask={deal ? { kind: "deal", ref: deal.ref, name: deal.title, status: deal.stage } : undefined}
      site={deal ? { kind: "deal", id: deal.id } : undefined}
      actions={
        deal ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void createOrderDraft()}
          >
            <ShoppingCart data-icon="inline-start" aria-hidden="true" />
            <Trans>Create sales order</Trans>
          </Button>
        ) : undefined
      }
    >
      <FormField id={`${formId}-title`} label={t`Title`} required>
        <Input
          id={`${formId}-title`}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={BUSINESS_NAME_MAX_LENGTH}
          required
        />
      </FormField>
      <FieldRow>
        <FormField id={`${formId}-amount`} label={t`Amount`}>
          <Input
            id={`${formId}-amount`}
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </FormField>
        <FormField id={`${formId}-stage`} label={t`Stage`}>
          <NativeSelect
            className="w-full"
            id={`${formId}-stage`}
            value={stage}
            onChange={(event) => setStage(event.target.value as DealStage)}
          >
            {DEAL_STAGES.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {stages[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
      </FieldRow>
      <FieldRow>
        <FormField id={`${formId}-company`} label={t`Company`}>
          <NativeSelect
            className="w-full"
            id={`${formId}-company`}
            value={companyId}
            onChange={(event) => setCompanyId(event.target.value)}
          >
            <NativeSelectOption value="">{t`None`}</NativeSelectOption>
            {lookups.companies.map((company) => (
              <NativeSelectOption key={company.id} value={company.id}>
                {company.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
        <FormField id={`${formId}-contact`} label={t`Contact`}>
          <NativeSelect
            className="w-full"
            id={`${formId}-contact`}
            value={contactId}
            onChange={(event) => setContactId(event.target.value)}
          >
            <NativeSelectOption value="">{t`None`}</NativeSelectOption>
            {lookups.contacts
              .filter((contact) => !companyId || contact.companyId === companyId)
              .map((contact) => (
                <NativeSelectOption key={contact.id} value={contact.id}>
                  {contact.name}
                </NativeSelectOption>
              ))}
          </NativeSelect>
        </FormField>
      </FieldRow>
      <FieldRow>
        <FormField id={`${formId}-close`} label={t`Expected close`}>
          <Input
            id={`${formId}-close`}
            type="date"
            value={expectedCloseAt}
            onChange={(event) => setExpectedCloseAt(event.target.value)}
          />
        </FormField>
        <FormField id={`${formId}-owner`} label={t`Owner bot`}>
          <NativeSelect
            className="w-full"
            id={`${formId}-owner`}
            value={ownerBotId}
            onChange={(event) => setOwnerBotId(event.target.value)}
          >
            <NativeSelectOption value="">{deal?.owner.name ?? t`Current user`}</NativeSelectOption>
            {lookups.bots.map((bot) => (
              <NativeSelectOption key={bot.id} value={bot.id}>
                {bot.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
      </FieldRow>
      <FormField id={`${formId}-notes`} label={t`Notes`}>
        <Textarea
          id={`${formId}-notes`}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          maxLength={BUSINESS_TEXT_MAX_LENGTH}
        />
      </FormField>

      {deal ? (
        <QuickActivitySection
          activities={linkedActivities}
          companyId={deal.companyId}
          contactId={deal.contactId}
          dealId={deal.id}
          onSaved={onSaved}
          onError={setError}
        />
      ) : null}
    </FormDialog>
  );
}

// --- Activities --------------------------------------------------------------

const ACTIVITY_ICONS: Record<ActivityKind, LucideIcon> = {
  call: Phone,
  email: Mail,
  meeting: Users,
  note: StickyNote,
  follow_up: CalendarClock,
};

function isOverdue(activity: CrmActivity, now: Date): boolean {
  if (activity.completedAt || !activity.dueAt) return false;
  const due = new Date(activity.dueAt);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return due < today;
}

type ActivityStateFilter = "" | "open" | "overdue" | "done";

function ActivitiesSection({ lookups, revision, reload, onError }: SectionProps) {
  const { t } = useLingui();
  const kinds = useActivityKindLabels();
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<ActivityStateFilter>("");
  const [kindFilter, setKindFilter] = useState<ActivityKind | "">("");
  const [openId, setOpenId] = useOpenRecord();
  const [creating, setCreating] = useState(false);
  const { value: activities, loading } = useBusinessList(
    () =>
      rpc.crm.activities
        .list({ ...(kindFilter ? { kind: kindFilter } : {}), limit: 200 })
        .then((result) => result.activities),
    [revision, kindFilter],
    onError,
    [] as CrmActivity[],
  );
  const now = new Date();

  const resolveRecordLabel = useCallback(
    (row: CrmActivity): string => {
      if (row.dealId) {
        const deal = lookups.deals.find((candidate) => candidate.id === row.dealId);
        if (deal) return `${deal.ref} · ${deal.title}`;
      }
      if (row.leadId) {
        const lead = lookups.leads.find((candidate) => candidate.id === row.leadId);
        if (lead) return `${lead.ref} · ${lead.title}`;
      }
      if (row.companyId) {
        const company = lookups.companies.find((candidate) => candidate.id === row.companyId);
        if (company) return company.name;
      }
      if (row.contactId) {
        const contact = lookups.contacts.find((candidate) => candidate.id === row.contactId);
        if (contact) return contact.name;
      }
      return "";
    },
    [lookups.companies, lookups.contacts, lookups.deals, lookups.leads],
  );

  const visible = activities.filter((row) => {
    if (stateFilter === "open" && row.completedAt) return false;
    if (stateFilter === "done" && !row.completedAt) return false;
    if (stateFilter === "overdue" && !isOverdue(row, now)) return false;
    return matchesQuery(query, row.subject, row.body, resolveRecordLabel(row));
  });

  const open = openId ? activities.find((activity) => activity.id === openId) : undefined;

  const columns: Column<CrmActivity>[] = [
    {
      key: "kind",
      header: t`Kind`,
      hideBelow: "sm",
      render: (row) => {
        const Icon = ACTIVITY_ICONS[row.kind];
        return (
          <span className="inline-flex items-center gap-2 whitespace-nowrap text-muted-foreground">
            <Icon className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            {kinds[row.kind]}
          </span>
        );
      },
    },
    {
      key: "subject",
      header: t`Subject`,
      render: (row) => (
        <PrimaryCell title={row.subject} detail={kinds[row.kind]} detailWhile="sm" />
      ),
    },
    {
      key: "linked",
      header: t`Linked to`,
      hideBelow: "md",
      render: (row) => (
        <span className="truncate text-muted-foreground">{resolveRecordLabel(row)}</span>
      ),
    },
    {
      key: "due",
      header: t`Due`,
      render: (row) =>
        row.completedAt ? (
          <StatusBadge tone="success">
            <Trans>Done</Trans>
          </StatusBadge>
        ) : row.dueAt ? (
          <span
            className={cn(
              "whitespace-nowrap tabular-nums",
              isOverdue(row, now) && "font-medium text-destructive",
            )}
          >
            {new Date(row.dueAt).toLocaleDateString()}
          </span>
        ) : (
          ""
        ),
    },
    {
      key: "assignee",
      header: t`Assignee`,
      hideBelow: "md",
      render: (row) => <ActorLabel actor={row.assignee} />,
    },
    {
      key: "by",
      header: t`Logged by`,
      hideBelow: "lg",
      render: (row) => (
        <span className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground">
          <ActorLabel actor={row.createdBy} />
          <span aria-hidden="true">·</span>
          <span className="whitespace-nowrap">{formatRelativeTime(row.createdAt)}</span>
        </span>
      ),
    },
  ];
  return (
    <>
      <Toolbar
        action={
          <NewButton onClick={() => setCreating(true)}>
            <Trans>Log activity</Trans>
          </NewButton>
        }
        filters={
          <div className="flex flex-wrap items-center gap-2">
            <FilterChips
              label={t`Filter by state`}
              value={stateFilter}
              onChange={setStateFilter}
              options={[
                { value: "", label: t`All` },
                { value: "open", label: t`Open` },
                { value: "overdue", label: t`Overdue` },
                { value: "done", label: t`Done` },
              ]}
            />
            <FilterChips
              label={t`Filter by kind`}
              value={kindFilter}
              onChange={setKindFilter}
              options={[
                { value: "", label: t`All kinds` },
                ...ACTIVITY_KINDS.map((value) => ({ value, label: kinds[value] })),
              ]}
            />
          </div>
        }
      >
        <SearchField value={query} onChange={setQuery} />
      </Toolbar>
      <RecordTable
        testId="crm-activities"
        columns={columns}
        rows={visible}
        loading={loading}
        onRowClick={(row) => setOpenId(row.id)}
        rowClassName={(row) => (row.completedAt ? "text-muted-foreground" : undefined)}
        rowAction={(row) => (
          <button
            type="button"
            aria-label={row.completedAt ? t`Reopen` : t`Mark done`}
            title={row.completedAt ? t`Reopen` : t`Mark done`}
            onClick={(event) => {
              event.stopPropagation();
              void rpc.crm.activities
                .complete({ id: row.id, completed: !row.completedAt })
                .then(() => reload())
                .catch((cause) => onError(errorText(cause)));
            }}
            className={cn(
              "grid size-7 place-items-center rounded-lg outline-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50",
              row.completedAt ? "text-success" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <CircleCheck className="size-4" strokeWidth={1.75} aria-hidden="true" />
          </button>
        )}
        filtered={Boolean(query || stateFilter || kindFilter)}
        empty={t`No activities yet`}
      />
      {creating ? (
        <ActivityDialog lookups={lookups} onClose={() => setCreating(false)} onSaved={reload} />
      ) : open ? (
        <ActivityDetailDialog
          activity={open}
          lookups={lookups}
          revision={revision}
          onClose={() => setOpenId(null)}
          onSaved={reload}
        />
      ) : null}
    </>
  );
}

function ActivityDetailDialog({
  activity,
  lookups,
  revision,
  onClose,
  onSaved,
}: {
  activity: CrmActivity;
  lookups: Lookups;
  revision: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLingui();
  const kinds = useActivityKindLabels();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const company = activity.companyId
    ? lookups.companies.find((item) => item.id === activity.companyId)
    : undefined;
  const contact = activity.contactId
    ? lookups.contacts.find((item) => item.id === activity.contactId)
    : undefined;
  const lead = activity.leadId
    ? lookups.leads.find((item) => item.id === activity.leadId)
    : undefined;
  const deal = activity.dealId
    ? lookups.deals.find((item) => item.id === activity.dealId)
    : undefined;

  async function toggleComplete() {
    setBusy(true);
    setError("");
    try {
      await rpc.crm.activities.complete({
        id: activity.id,
        completed: !activity.completedAt,
      });
      onSaved();
      onClose();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormDialog
      title={activity.subject}
      meta={
        <>
          <StatusBadge tone={activity.completedAt ? "success" : "neutral"}>
            {activity.completedAt ? t`Done` : kinds[activity.kind]}
          </StatusBadge>
          {activity.dueAt ? (
            <span>
              {t`Due`} {new Date(activity.dueAt).toLocaleDateString()}
            </span>
          ) : null}
        </>
      }
      onClose={onClose}
      busy={busy}
      error={error}
      history={{ recordType: "activity", recordId: activity.id, revision }}
      actions={
        <Button size="sm" disabled={busy} onClick={() => void toggleComplete()}>
          <CircleCheck data-icon="inline-start" aria-hidden="true" />
          {activity.completedAt ? t`Reopen` : t`Mark done`}
        </Button>
      }
    >
      <DetailList
        items={[
          { label: t`Kind`, value: kinds[activity.kind] },
          {
            label: t`Status`,
            value: activity.completedAt
              ? `${t`Completed`} ${formatRelativeTime(activity.completedAt)}`
              : t`Open`,
          },
          {
            label: t`Assignee`,
            value:
              activity.assignee.botId || activity.assignee.userId ? (
                <ActorLabel actor={activity.assignee} />
              ) : (
                "—"
              ),
          },
          { label: t`Logged by`, value: <ActorLabel actor={activity.createdBy} /> },
          { label: t`Company`, value: company?.name ?? "—" },
          { label: t`Contact`, value: contact?.name ?? "—" },
          { label: t`Deal`, value: deal ? `${deal.ref} · ${deal.title}` : "—" },
          { label: t`Lead`, value: lead ? `${lead.ref} · ${lead.title}` : "—" },
        ]}
      />
      {activity.body ? (
        <div className="rounded-lg border bg-muted/30 p-3 text-sm whitespace-pre-wrap">
          {activity.body}
        </div>
      ) : null}
    </FormDialog>
  );
}

function ActivityDialog({
  lookups,
  onClose,
  onSaved,
}: {
  lookups: Lookups;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLingui();
  const formId = useId();
  const kinds = useActivityKindLabels();
  const [kind, setKind] = useState<ActivityKind>("note");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [contactId, setContactId] = useState("");
  const [dealId, setDealId] = useState("");
  const [leadId, setLeadId] = useState("");
  const [assigneeBotId, setAssigneeBotId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setBusy(true);
    setError("");
    try {
      await rpc.crm.activities.create({
        kind,
        subject,
        ...(body ? { body } : {}),
        ...(dueAt ? { dueAt: new Date(dueAt).toISOString() } : {}),
        ...(companyId ? { companyId } : {}),
        ...(contactId ? { contactId } : {}),
        ...(dealId ? { dealId } : {}),
        ...(leadId ? { leadId } : {}),
        ...(assigneeBotId ? { assigneeBotId } : {}),
        completed: false,
      });
      onSaved();
      onClose();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <FormDialog
      title={t`Log activity`}
      onClose={onClose}
      onSubmit={save}
      busy={busy}
      submitLabel={t`Save`}
      disabled={!subject.trim() || (!companyId && !contactId && !dealId && !leadId)}
      error={error}
    >
      <FieldRow>
        <FormField id={`${formId}-kind`} label={t`Kind`}>
          <NativeSelect
            className="w-full"
            id={`${formId}-kind`}
            value={kind}
            onChange={(event) => setKind(event.target.value as ActivityKind)}
          >
            {ACTIVITY_KINDS.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {kinds[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
        <FormField id={`${formId}-due`} label={t`Due`}>
          <Input
            id={`${formId}-due`}
            type="date"
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
          />
        </FormField>
      </FieldRow>
      <FormField id={`${formId}-subject`} label={t`Subject`} required>
        <Input
          id={`${formId}-subject`}
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          maxLength={BUSINESS_NAME_MAX_LENGTH}
          required
        />
      </FormField>
      <FormField id={`${formId}-body`} label={t`Notes`}>
        <Textarea
          id={`${formId}-body`}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={BUSINESS_TEXT_MAX_LENGTH}
        />
      </FormField>
      <FieldRow>
        <FormField id={`${formId}-company`} label={t`Company`}>
          <NativeSelect
            className="w-full"
            id={`${formId}-company`}
            value={companyId}
            onChange={(event) => {
              setCompanyId(event.target.value);
              setContactId("");
            }}
          >
            <NativeSelectOption value="">{t`None`}</NativeSelectOption>
            {lookups.companies.map((company) => (
              <NativeSelectOption key={company.id} value={company.id}>
                {company.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
        <FormField id={`${formId}-contact`} label={t`Contact`}>
          <NativeSelect
            className="w-full"
            id={`${formId}-contact`}
            value={contactId}
            onChange={(event) => setContactId(event.target.value)}
          >
            <NativeSelectOption value="">{t`None`}</NativeSelectOption>
            {lookups.contacts
              .filter((contact) => !companyId || contact.companyId === companyId)
              .map((contact) => (
                <NativeSelectOption key={contact.id} value={contact.id}>
                  {contact.name}
                </NativeSelectOption>
              ))}
          </NativeSelect>
        </FormField>
      </FieldRow>
      <FieldRow>
        <FormField id={`${formId}-deal`} label={t`Deal`}>
          <NativeSelect
            className="w-full"
            id={`${formId}-deal`}
            value={dealId}
            onChange={(event) => setDealId(event.target.value)}
          >
            <NativeSelectOption value="">{t`None`}</NativeSelectOption>
            {lookups.deals.map((deal) => (
              <NativeSelectOption key={deal.id} value={deal.id}>
                {deal.ref} · {deal.title}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
        <FormField id={`${formId}-lead`} label={t`Lead`}>
          <NativeSelect
            className="w-full"
            id={`${formId}-lead`}
            value={leadId}
            onChange={(event) => setLeadId(event.target.value)}
          >
            <NativeSelectOption value="">{t`None`}</NativeSelectOption>
            {lookups.leads.map((lead) => (
              <NativeSelectOption key={lead.id} value={lead.id}>
                {lead.ref} · {lead.title}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
      </FieldRow>
      <FormField id={`${formId}-bot`} label={t`Assigned bot`}>
        <NativeSelect
          className="w-full"
          id={`${formId}-bot`}
          value={assigneeBotId}
          onChange={(event) => setAssigneeBotId(event.target.value)}
        >
          <NativeSelectOption value="">{t`Unassigned`}</NativeSelectOption>
          {lookups.bots.map((bot) => (
            <NativeSelectOption key={bot.id} value={bot.id}>
              {bot.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </FormField>
    </FormDialog>
  );
}

// --- Analytics (Revenue Intelligence & Hygiene) ------------------------------

function AnalyticsSection({ lookups, currency }: SectionProps) {
  const { t } = useLingui();
  const stages = useDealStageLabels();
  const leadStatuses = useLeadStatusLabels();
  const activityKinds = useActivityKindLabels();
  const money = useMoney(currency);
  const short = useShortMoney(currency);
  const compact = useShortMoney(currency, 0);
  const percent = useMemo(() => new Intl.NumberFormat(undefined, { style: "percent" }), []);

  const { deals, leads, activities, companies, contacts } = lookups;
  const openDeals = deals.filter(isOpenDeal);
  const wonDeals = deals.filter((deal) => deal.stage === "won");
  const weighted = useMemo(() => weightedDealAmount(deals), [deals]);
  const activeAndWon = [...openDeals, ...wonDeals];
  const avgDealSize =
    activeAndWon.length > 0
      ? activeAndWon.reduce((sum, deal) => sum + deal.amount, 0) / activeAndWon.length
      : 0;
  const convertedLeads = leads.filter((lead) => lead.status === "converted").length;
  const leadConversionRate = leads.length > 0 ? convertedLeads / leads.length : 0;
  const completedActivities = activities.filter((activity) => Boolean(activity.completedAt)).length;
  const completionRate = activities.length > 0 ? completedActivities / activities.length : 0;

  const monthlyPipeline = useMemo(() => {
    const month = new Intl.DateTimeFormat(undefined, { month: "short" });
    return monthlyTotals(
      deals.filter((deal) => deal.stage !== "lost"),
      (deal) => deal.expectedCloseAt ?? deal.closedAt ?? deal.updatedAt,
      (deal) => deal.amount,
      6,
    ).map((entry) => ({
      key: entry.start.toISOString(),
      label: month.format(entry.start),
      value: entry.total,
      display: compact(entry.total),
    }));
  }, [compact, deals]);

  const byOwner = useMemo(() => {
    const map = new Map<string, { key: string; name: string; count: number; amount: number }>();
    for (const deal of deals) {
      if (deal.stage === "lost") continue;
      const key = deal.owner.botId ?? deal.owner.userId ?? "unassigned";
      const name = actorName(deal.owner) || t`Unassigned`;
      const entry = map.get(key) ?? { key, name, count: 0, amount: 0 };
      entry.count += 1;
      entry.amount += deal.amount;
      map.set(key, entry);
    }
    return [...map.values()].sort((a, b) => b.amount - a.amount);
  }, [deals, t]);

  const bySource = useMemo(() => {
    const map = new Map<string, { key: string; label: string; count: number; value: number }>();
    for (const lead of leads) {
      const source = lead.source?.trim() || t`Direct / Unspecified`;
      const entry = map.get(source) ?? { key: source, label: source, count: 0, value: 0 };
      entry.count += 1;
      entry.value += lead.value ?? 0;
      map.set(source, entry);
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [leads, t]);

  const companiesWithDomain = companies.filter((company) => Boolean(company.domain)).length;
  const contactsWithEmail = contacts.filter((contact) => Boolean(contact.email)).length;
  const dealsWithCloseDate = openDeals.filter((deal) => Boolean(deal.expectedCloseAt)).length;

  return (
    <>
      <KpiGrid testId="crm-analytics-kpis">
        <KpiCard
          label={t`Weighted forecast`}
          value={short(weighted)}
          exact={money(weighted)}
          icon={TrendingUp}
          to={crmHref("deals")}
          detail={{ label: t`Open deals`, value: openDeals.length }}
        />
        <KpiCard
          label={t`Average deal size`}
          value={short(avgDealSize)}
          exact={money(avgDealSize)}
          icon={Handshake}
          to={crmHref("deals")}
          detail={{ label: t`Won deals`, value: wonDeals.length }}
        />
        <KpiCard
          label={t`Lead conversion`}
          value={leads.length > 0 ? percent.format(leadConversionRate) : "—"}
          icon={Target}
          to={crmHref("leads")}
          detail={{ label: t`Converted`, value: `${convertedLeads} / ${leads.length}` }}
        />
        <KpiCard
          label={t`Activity completion`}
          value={activities.length > 0 ? percent.format(completionRate) : "—"}
          icon={CircleCheck}
          to={crmHref("activities")}
          detail={{ label: t`Completed`, value: `${completedActivities} / ${activities.length}` }}
        />
      </KpiGrid>

      <PanelGrid>
        <Panel
          title={t`Pipeline & revenue by month`}
          aside={compact(monthlyPipeline.reduce((sum, item) => sum + item.value, 0))}
          testId="crm-analytics-monthly"
        >
          <ColumnChart label={t`Pipeline & revenue by month`} points={monthlyPipeline} />
        </Panel>

        <Panel
          title={t`Stage-weighted forecast`}
          aside={compact(weighted)}
          testId="crm-analytics-weighted"
        >
          <BarList
            label={t`Stage-weighted forecast`}
            rows={DEAL_STAGES.filter((stage) => stage !== "lost").map((stage) => {
              const stageDeals = deals.filter((deal) => deal.stage === stage);
              const raw = stageDeals.reduce((sum, deal) => sum + deal.amount, 0);
              const weightedValue = raw * STAGE_WEIGHTS[stage];
              return {
                key: stage,
                label: `${stages[stage]} (${Math.round(STAGE_WEIGHTS[stage] * 100)}%)`,
                note: stageDeals.length,
                value: weightedValue,
                display: compact(weightedValue),
                fill: STAGE_FILLS[stage],
                to: crmHref("deals", { status: stage }),
              };
            })}
          />
        </Panel>

        <Panel
          title={t`Lead qualification funnel`}
          aside={leads.length}
          testId="crm-analytics-funnel"
        >
          <BarList
            label={t`Lead qualification funnel`}
            rows={LEAD_STATUSES.map((status) => {
              const count = leads.filter((lead) => lead.status === status).length;
              return {
                key: status,
                label: leadStatuses[status],
                value: count,
                display: String(count),
                fill: LEAD_FILLS[status],
                to: crmHref("leads", { status }),
              };
            })}
          />
        </Panel>

        <Panel
          title={t`Pipeline by owner & AI operator`}
          to={crmHref("deals")}
          testId="crm-analytics-owners"
        >
          {byOwner.length > 0 ? (
            <BarList
              label={t`Pipeline by owner & AI operator`}
              rows={byOwner.map((entry) => ({
                key: entry.key,
                label: entry.name,
                note: entry.count,
                value: entry.amount,
                display: compact(entry.amount),
              }))}
            />
          ) : (
            <PanelEmpty icon={Handshake}>{t`No deals yet`}</PanelEmpty>
          )}
        </Panel>

        <Panel
          title={t`Leads by acquisition source`}
          to={crmHref("leads")}
          testId="crm-analytics-sources"
        >
          {bySource.length > 0 ? (
            <BarList
              label={t`Leads by acquisition source`}
              rows={bySource.map((entry) => ({
                key: entry.key,
                label: entry.label,
                note: entry.value > 0 ? compact(entry.value) : undefined,
                value: entry.count,
                display: String(entry.count),
              }))}
            />
          ) : (
            <PanelEmpty icon={Target}>{t`No leads yet`}</PanelEmpty>
          )}
        </Panel>

        <Panel
          title={t`Activity mix & data hygiene`}
          to={crmHref("activities")}
          testId="crm-analytics-hygiene"
        >
          <div className="space-y-4">
            <Distribution
              label={t`Activity mix`}
              parts={ACTIVITY_KINDS.map((kind) => ({
                key: kind,
                label: activityKinds[kind],
                count: activities.filter((activity) => activity.kind === kind).length,
              }))}
            />
            <BarList
              label={t`Data hygiene completeness`}
              rows={[
                {
                  key: "domains",
                  label: t`Companies with domain`,
                  value: companies.length > 0 ? companiesWithDomain / companies.length : 0,
                  display: `${companiesWithDomain} / ${companies.length}`,
                  to: crmHref("companies"),
                },
                {
                  key: "emails",
                  label: t`Contacts with email`,
                  value: contacts.length > 0 ? contactsWithEmail / contacts.length : 0,
                  display: `${contactsWithEmail} / ${contacts.length}`,
                  to: crmHref("contacts"),
                },
                {
                  key: "closeDates",
                  label: t`Open deals with close date`,
                  value: openDeals.length > 0 ? dealsWithCloseDate / openDeals.length : 0,
                  display: `${dealsWithCloseDate} / ${openDeals.length}`,
                  to: crmHref("deals"),
                },
              ]}
            />
          </div>
        </Panel>
      </PanelGrid>
    </>
  );
}

// --- AI Operators & Governance (`?tab=agents`) -------------------------------

type OperatorRow = {
  bot: Bot;
  roleLabel: string;
  leadsCount: number;
  dealsCount: number;
  pipelineAmount: number;
  followUpsCount: number;
};

function AgentsSection({ lookups, currency, revision, reload, onError }: SectionProps) {
  const { t } = useLingui();
  const assistant = useAssistant();
  const short = useShortMoney(currency);
  const stages = useDealStageLabels();
  const leadStatuses = useLeadStatusLabels();
  const { value: events, loading: eventsLoading } = useBusinessList<BusinessEvent[]>(
    () => rpc.business.events({ limit: 12 }),
    [revision],
    onError,
    [],
  );

  const orderedBots = useMemo(() => orderAssistantBots(lookups.bots), [lookups.bots]);
  const roleNames = useMemo<Record<string, string>>(
    () => ({
      [BUSINESS_TEAM_SPAWN_KEYS.operator]: t`Chief CRM & ERP Operator`,
      [BUSINESS_TEAM_SPAWN_KEYS.sales]: t`Lead Qualification & Deal Progression`,
      [BUSINESS_TEAM_SPAWN_KEYS.operations]: t`Order Fulfillment & Stock Control`,
      [BUSINESS_TEAM_SPAWN_KEYS.finance]: t`Invoicing & Collections`,
      [BUSINESS_TEAM_SPAWN_KEYS.analyst]: t`Pipeline Forecasting & BI`,
      [BUSINESS_TEAM_SPAWN_KEYS.steward]: t`Deduplication & Data Hygiene`,
    }),
    [t],
  );

  const rows: OperatorRow[] = useMemo(
    () =>
      orderedBots.map((bot) => {
        const botLeads = lookups.leads.filter(
          (lead) => lead.assignee.botId === bot.id && lead.status !== "converted",
        );
        const botDeals = lookups.deals.filter(
          (deal) => deal.owner.botId === bot.id && isOpenDeal(deal),
        );
        const botFollowUps = lookups.activities.filter(
          (activity) => activity.assignee.botId === bot.id && !activity.completedAt,
        );
        return {
          bot,
          roleLabel: (bot.spawnKey && roleNames[bot.spawnKey]) || t`Workspace Specialist Bot`,
          leadsCount: botLeads.length,
          dealsCount: botDeals.length,
          pipelineAmount: botDeals.reduce((sum, deal) => sum + deal.amount, 0),
          followUpsCount: botFollowUps.length,
        };
      }),
    [lookups.activities, lookups.deals, lookups.leads, orderedBots, roleNames, t],
  );

  const botAssignedLeads = lookups.leads.filter(
    (lead) => Boolean(lead.assignee.botId) && lead.status !== "converted",
  );
  const botOwnedDeals = lookups.deals.filter(
    (deal) => Boolean(deal.owner.botId) && isOpenDeal(deal),
  );
  const botPipeline = botOwnedDeals.reduce((sum, deal) => sum + deal.amount, 0);

  const columns: Column<OperatorRow>[] = [
    {
      key: "operator",
      header: t`AI Operator`,
      render: (row) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <BotAvatar bot={row.bot} size={28} />
          <span className="min-w-0">
            <span className="block truncate font-medium">{row.bot.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{row.roleLabel}</span>
          </span>
        </span>
      ),
    },
    {
      key: "leads",
      header: t`Open leads`,
      align: "end",
      hideBelow: "sm",
      render: (row) => (row.leadsCount > 0 ? formatQuantity(row.leadsCount) : "—"),
    },
    {
      key: "deals",
      header: t`Open deals`,
      align: "end",
      hideBelow: "md",
      render: (row) => (row.dealsCount > 0 ? formatQuantity(row.dealsCount) : "—"),
    },
    {
      key: "pipeline",
      header: t`Owned pipeline`,
      align: "end",
      hideBelow: "sm",
      render: (row) => (row.pipelineAmount > 0 ? short(row.pipelineAmount) : "—"),
    },
    {
      key: "followUps",
      header: t`Follow-ups`,
      align: "end",
      hideBelow: "lg",
      render: (row) => (row.followUpsCount > 0 ? formatQuantity(row.followUpsCount) : "—"),
    },
  ];

  return (
    <div className="space-y-6">
      <AgenticWorkforceCommandCenter
        lookups={lookups}
        currency={currency}
        onReload={reload}
        onError={onError}
      />

      <KpiGrid testId="crm-agents-kpis">
        <KpiCard
          label={t`AI operators`}
          value={orderedBots.length}
          icon={Sparkles}
          detail={{ label: t`Active roster`, value: orderedBots.length }}
        />
        <KpiCard
          label={t`Delegated leads`}
          value={botAssignedLeads.length}
          icon={Target}
          to={crmHref("leads")}
          detail={{ label: t`Total leads`, value: lookups.leads.length }}
        />
        <KpiCard
          label={t`Bot-owned pipeline`}
          value={short(botPipeline)}
          icon={Handshake}
          to={crmHref("deals")}
          detail={{ label: t`Open deals`, value: botOwnedDeals.length }}
        />
        <KpiCard
          label={t`Audited events`}
          value={events.length}
          icon={Activity}
          detail={{ label: t`Consequential gates`, value: t`Enforced` }}
        />
      </KpiGrid>

      <RecordTable
        testId="crm-agents-roster"
        columns={columns}
        rows={rows}
        loading={false}
        onRowClick={(row) => {
          assistant?.pickBot(row.bot.id);
          assistant?.ask();
        }}
        rowAction={(row) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              assistant?.pickBot(row.bot.id);
              assistant?.ask();
            }}
          >
            <Sparkles data-icon="inline-start" aria-hidden="true" />
            <Trans>Delegate</Trans>
          </Button>
        )}
        empty={t`No AI operators provisioned yet`}
        emptyIcon={Sparkles}
      />

      <PanelGrid>
        <Panel
          title={t`Active delegated workload`}
          aside={botAssignedLeads.length + botOwnedDeals.length}
          testId="crm-agents-workload"
        >
          {botOwnedDeals.length > 0 || botAssignedLeads.length > 0 ? (
            <RecordList label={t`Active delegated workload`}>
              {botOwnedDeals.slice(0, 5).map((deal) => (
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
                      <span aria-hidden="true">·</span>
                      <span className="truncate">{actorName(deal.owner)}</span>
                    </>
                  }
                  end={short(deal.amount)}
                />
              ))}
              {botAssignedLeads.slice(0, 5).map((lead) => (
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
                      <span aria-hidden="true">·</span>
                      <span className="truncate">{actorName(lead.assignee)}</span>
                    </>
                  }
                  end={lead.value !== null ? short(lead.value) : undefined}
                />
              ))}
            </RecordList>
          ) : (
            <PanelEmpty icon={Sparkles}>{t`No records currently delegated to bots`}</PanelEmpty>
          )}
        </Panel>

        <Panel title={t`Governance & audit log`} aside={events.length} testId="crm-agents-audit">
          {eventsLoading && events.length === 0 ? (
            <ListSkeleton />
          ) : events.length > 0 ? (
            <RecordList label={t`Governance & audit log`}>
              {events.map((event) => (
                <EventRow key={event.id} event={event} />
              ))}
            </RecordList>
          ) : (
            <PanelEmpty icon={Activity}>{t`No audited events yet`}</PanelEmpty>
          )}
        </Panel>
      </PanelGrid>
    </div>
  );
}
