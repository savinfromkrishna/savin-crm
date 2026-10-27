import { Trans, useLingui } from "@lingui/react/macro";
import { cn, Input } from "@savingroup/ui-web";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowUpRight,
  Boxes,
  Building2,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  Command,
  Contact,
  Database,
  ExternalLink,
  Factory,
  Handshake,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Phone,
  ReceiptText,
  Search,
  ShoppingCart,
  Sparkles,
  StickyNote,
  Target,
  TrendingUp,
  Users,
  Warehouse,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { desktopBridge } from "../../lib/desktop";
import { rpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";
import { WindowChrome } from "../../pages/WindowChrome";
import {
  AssistantButton,
  AssistantPanel,
  AssistantProvider,
  useBusinessAssistant,
} from "./assistant";
import { BusinessSiteContext, siteHref, useConnectedSite } from "./site";

export const CRM_SECTIONS = [
  "overview",
  "workspace",
  "leads",
  "deals",
  "companies",
  "contacts",
  "activities",
  "notes",
  "calls",
  "operations",
  "analytics",
  "agents",
] as const;
export type CrmSection = (typeof CRM_SECTIONS)[number];

export const ERP_SECTIONS = [
  "overview",
  "products",
  "inventory",
  "orders",
  "invoices",
  "compliance",
] as const;
export type ErpSection = (typeof ERP_SECTIONS)[number];

export type BusinessApp = "crm" | "erp";
type NavGroup = {
  app: BusinessApp;
  label: string;
  items: { section: string; label: string; icon: LucideIcon }[];
};

function sectionHref(app: BusinessApp, section: string, params?: Record<string, string>) {
  const query = new URLSearchParams(section === "overview" ? {} : { tab: section });
  for (const [key, value] of Object.entries(params ?? {})) query.set(key, value);
  const search = query.toString();
  return search ? `/app/${app}?${search}` : `/app/${app}`;
}

export const crmHref = (section: CrmSection, params?: Record<string, string>) =>
  sectionHref("crm", section, params);
export const erpHref = (section: ErpSection, params?: Record<string, string>) =>
  sectionHref("erp", section, params);

/** The section in `?tab=`, falling back to the overview. */
export function useBusinessSection<Section extends string>(sections: readonly Section[]): Section {
  const [params] = useSearchParams();
  const requested = params.get("tab") ?? "";
  return (sections as readonly string[]).includes(requested)
    ? (requested as Section)
    : (sections[0] as Section);
}

/** A list filter kept in `?status=` so overview cards and the back button land on it. */
export function useStatusFilter<Status extends string>(
  statuses: readonly Status[],
): [Status | "", (next: Status | "") => void] {
  const [params, setParams] = useSearchParams();
  const requested = params.get("status") ?? "";
  const status = (statuses as readonly string[]).includes(requested) ? (requested as Status) : "";
  const setStatus = useCallback(
    (next: Status | "") =>
      setParams(
        (previous) => {
          const updated = new URLSearchParams(previous);
          if (next) updated.set("status", next);
          else updated.delete("status");
          return updated;
        },
        { replace: true },
      ),
    [setParams],
  );
  return [status, setStatus];
}

/**
 * The record whose dialog is open, kept in `?record=` so overview links, the
 * address bar and a reload all land on it.
 */
export function useOpenRecord(): [string | null, (id: string | null) => void] {
  const [params, setParams] = useSearchParams();
  const id = params.get("record") || null;
  const setId = useCallback(
    (next: string | null) =>
      setParams(
        (previous) => {
          const updated = new URLSearchParams(previous);
          if (next) updated.set("record", next);
          else updated.delete("record");
          return updated;
        },
        { replace: true },
      ),
    [setParams],
  );
  return [id, setId];
}

function useBusinessNav(): NavGroup[] {
  const { t } = useLingui();
  return useMemo(
    () => [
      {
        app: "crm",
        label: t`Frappe CRM`,
        items: [
          { section: "overview", label: t`Dashboard`, icon: LayoutDashboard },
          { section: "workspace", label: t`Savingroup Desk`, icon: Factory },
          { section: "leads", label: t`Leads`, icon: Target },
          { section: "deals", label: t`Deals`, icon: Handshake },
          { section: "companies", label: t`Organizations`, icon: Building2 },
          { section: "contacts", label: t`Contacts`, icon: Contact },
          { section: "activities", label: t`Tasks`, icon: CalendarCheck },
          { section: "notes", label: t`Notes`, icon: StickyNote },
          { section: "calls", label: t`Call Logs`, icon: Phone },
          { section: "operations", label: t`Operations Ledger`, icon: Activity },
          { section: "analytics", label: t`Analytics`, icon: TrendingUp },
          { section: "agents", label: t`AI Operators`, icon: Sparkles },
        ],
      },
      {
        app: "erp",
        label: t`ERPNext`,
        items: [
          { section: "overview", label: t`Savingroup Workspace`, icon: LayoutDashboard },
          { section: "products", label: t`Items & Prices`, icon: Boxes },
          { section: "inventory", label: t`Stock & Bin`, icon: Warehouse },
          { section: "orders", label: t`Sales Orders`, icon: ShoppingCart },
          { section: "invoices", label: t`Sales Invoices`, icon: ReceiptText },
          { section: "compliance", label: t`Gateway & GST`, icon: Database },
        ],
      },
    ],
    [t],
  );
}

const NAV_COLLAPSED_KEY = "savingroup.business.navCollapsed";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(NAV_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean) {
  try {
    window.localStorage.setItem(NAV_COLLAPSED_KEY, String(collapsed));
  } catch {
    // The preference only lasts this visit when storage is unavailable.
  }
}

const backLinkClass =
  "flex shrink-0 items-center gap-0.5 rounded-lg py-1 pe-1.5 text-[13px] font-medium text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * Frame shared by CRM OS and ERP OS: one sidebar for both apps on wide screens,
 * an app switch and a scrolling section strip on narrow ones.
 */
export function BusinessPage({
  app,
  section,
  actions,
  error,
  children,
}: {
  app: BusinessApp;
  section: string;
  /** Page-level controls next to the title. */
  actions?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const groups = useBusinessNav();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [commandOpen, setCommandOpen] = useState(false);
  const group = groups.find((entry) => entry.app === app) ?? groups[0]!;
  const title = group.items.find((item) => item.section === section)?.label ?? group.label;
  const assistant = useBusinessAssistant(app, section);
  const site = useConnectedSite();
  const siteApps = site
    ? [
        { label: t`Savingroup ERP`, path: "/desk", icon: Factory },
        { label: t`Savingroup CRM`, path: "/crm", icon: Users },
      ]
    : [];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((previous) => !previous);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function toggleCollapsed() {
    setCollapsed(!collapsed);
    writeCollapsed(!collapsed);
  }

  return (
    <AssistantProvider value={assistant}>
      <BusinessSiteContext value={site}>
        <div className="flex h-screen min-w-0 flex-col overflow-hidden bg-background text-foreground">
          {/* Electron draws its window controls above the page; the web needs no spacer. */}
          {desktopBridge() ? <WindowChrome /> : null}
          <div className="relative flex min-h-0 flex-1">
            <aside
              data-testid="business-nav"
              data-collapsed={collapsed ? "true" : "false"}
              className={cn(
                "hidden shrink-0 flex-col border-e border-sidebar-border bg-sidebar text-sidebar-foreground md:flex",
                collapsed ? "w-14" : "w-60",
              )}
            >
              <div
                className={cn(
                  "flex h-14 shrink-0 items-center justify-between gap-2 border-b border-sidebar-border px-3",
                  collapsed && "justify-center px-0",
                )}
              >
                <Link
                  to="/app"
                  className={backLinkClass}
                  aria-label={collapsed ? t`Bots` : undefined}
                  title={collapsed ? t`Bots` : undefined}
                >
                  <ChevronLeft className="size-4" strokeWidth={1.9} aria-hidden="true" />
                  {collapsed ? null : <Trans>Bots</Trans>}
                </Link>
                {collapsed ? null : (
                  <span className="inline-flex items-center gap-1.5 rounded-full border bg-background/80 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
                    <Trans>Live OS</Trans>
                  </span>
                )}
              </div>
              {collapsed ? null : (
                <div className="border-b border-sidebar-border px-2.5 py-2">
                  <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted/60 p-0.5">
                    <Link
                      to={crmHref("overview")}
                      className={cn(
                        "rounded-md py-1 text-center text-[11px] font-medium transition-colors",
                        app === "crm" && section !== "workspace"
                          ? "bg-background text-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Trans>CRM</Trans>
                    </Link>
                    <Link
                      to={erpHref("overview")}
                      className={cn(
                        "rounded-md py-1 text-center text-[11px] font-medium transition-colors",
                        app === "erp"
                          ? "bg-background text-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Trans>ERPNext</Trans>
                    </Link>
                    <Link
                      to={crmHref("workspace")}
                      className={cn(
                        "rounded-md py-1 text-center text-[11px] font-medium transition-colors",
                        app === "crm" && section === "workspace"
                          ? "bg-background text-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Trans>Desk</Trans>
                    </Link>
                  </div>
                </div>
              )}
              <nav
                aria-label={t`Sections`}
                className="rk-scroll min-h-0 flex-1 overflow-y-auto p-2"
              >
                {groups.map((entry) => (
                  <div key={entry.app} className="mb-4 last:mb-0">
                    <p
                      className={cn(
                        "mb-1 px-2.5 pt-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase",
                        collapsed && "px-0 text-center text-[10px]",
                      )}
                    >
                      {entry.label}
                    </p>
                    <ul className="space-y-0.5">
                      {entry.items.map((item) => {
                        const active = entry.app === app && item.section === section;
                        const Icon = item.icon;
                        return (
                          <li key={item.section}>
                            <Link
                              to={sectionHref(entry.app, item.section)}
                              aria-current={active ? "page" : undefined}
                              aria-label={collapsed ? `${entry.label} ${item.label}` : undefined}
                              title={collapsed ? `${entry.label} · ${item.label}` : undefined}
                              className={cn(
                                "flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                                collapsed && "justify-center px-0",
                                active
                                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground shadow-2xs"
                                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                              )}
                            >
                              <Icon
                                className="size-4 shrink-0"
                                strokeWidth={1.75}
                                aria-hidden="true"
                              />
                              {collapsed ? null : <span className="truncate">{item.label}</span>}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
                {site ? (
                  <div className="mb-4 last:mb-0">
                    <p
                      title={site.name}
                      className={cn(
                        "mb-1 truncate px-2.5 pt-1 text-xs font-medium text-muted-foreground",
                        collapsed && "px-0 text-center text-[10px]",
                      )}
                    >
                      {site.name}
                    </p>
                    <ul className="space-y-0.5">
                      {siteApps.map(({ label, path, icon: Icon }) => (
                        <li key={path}>
                          {/* The site's own apps open in a tab of their own. */}
                          <a
                            href={siteHref(site, path)}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={collapsed ? label : undefined}
                            title={collapsed ? label : undefined}
                            className={cn(
                              "flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] text-muted-foreground outline-none transition-colors hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                              collapsed && "justify-center px-0",
                            )}
                          >
                            <Icon
                              className="size-4 shrink-0"
                              strokeWidth={1.75}
                              aria-hidden="true"
                            />
                            {collapsed ? null : (
                              <>
                                <span className="truncate">{label}</span>
                                <ExternalLink
                                  className="ms-auto size-3.5 shrink-0 opacity-60"
                                  strokeWidth={1.75}
                                  aria-hidden="true"
                                />
                              </>
                            )}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </nav>
              <div
                className={cn(
                  "flex items-center justify-between border-t border-sidebar-border p-2",
                  collapsed && "justify-center",
                )}
              >
                <button
                  type="button"
                  onClick={toggleCollapsed}
                  aria-label={collapsed ? t`Expand sidebar` : t`Collapse sidebar`}
                  title={collapsed ? t`Expand sidebar` : t`Collapse sidebar`}
                  className="grid size-8 place-items-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {collapsed ? (
                    <PanelLeftOpen className="size-4" strokeWidth={1.75} aria-hidden="true" />
                  ) : (
                    <PanelLeftClose className="size-4" strokeWidth={1.75} aria-hidden="true" />
                  )}
                </button>
                {collapsed ? null : (
                  <button
                    type="button"
                    onClick={() => setCommandOpen(true)}
                    className="inline-flex h-7 items-center gap-1.5 rounded-lg border bg-background/60 px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <Command className="size-3" />
                    <span>Ctrl+K</span>
                  </button>
                )}
              </div>
            </aside>

            <div className="flex min-w-0 flex-1 flex-col">
              <header className="shrink-0 border-b bg-card/40 backdrop-blur-xs">
                <div className="flex min-h-14 items-center gap-3 px-4 py-2 md:px-6">
                  <Link to="/app" className={cn(backLinkClass, "md:hidden")}>
                    <ChevronLeft className="size-4" strokeWidth={1.9} aria-hidden="true" />
                    <Trans>Bots</Trans>
                  </Link>
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <Link
                      to={sectionHref(app, "overview")}
                      className="hidden shrink-0 rounded text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 md:inline"
                    >
                      {group.label}
                    </Link>
                    <ChevronRight
                      className="hidden size-3.5 shrink-0 text-muted-foreground/70 md:block"
                      aria-hidden="true"
                    />
                    <h1 className="truncate text-[15px] font-semibold">{title}</h1>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCommandOpen(true)}
                    data-testid="business-awesomebar"
                    className="hidden h-8 w-64 items-center gap-2 rounded-lg border bg-muted/40 px-2.5 text-xs text-muted-foreground transition-colors hover:border-foreground/20 hover:bg-muted/70 hover:text-foreground lg:flex"
                  >
                    <Search className="size-3.5 shrink-0" />
                    <span className="truncate">
                      <Trans>Search or jump to…</Trans>
                    </span>
                    <kbd className="ms-auto rounded border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      Ctrl+K
                    </kbd>
                  </button>
                  <div className="flex shrink-0 items-center gap-0.5 rounded-lg border p-0.5 md:hidden">
                    {groups.map((entry) => (
                      <Link
                        key={entry.app}
                        to={sectionHref(entry.app, "overview")}
                        aria-current={entry.app === app ? "page" : undefined}
                        className={cn(
                          "rounded-md px-2.5 py-1 text-xs font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                          entry.app === app
                            ? "bg-accent text-foreground"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {entry.label}
                      </Link>
                    ))}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {actions}
                    <AssistantButton assistant={assistant} />
                  </div>
                </div>
                <nav
                  aria-label={t`Sections`}
                  className="flex gap-1 overflow-x-auto px-3 pb-2 scrollbar-none md:hidden"
                >
                  {group.items.map((item) => {
                    const active = item.section === section;
                    return (
                      <Link
                        key={item.section}
                        to={sectionHref(app, item.section)}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "shrink-0 rounded-full px-3 py-1 text-[13px] font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                          active
                            ? "bg-accent text-foreground"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </nav>
              </header>
              {error ? (
                <p
                  role="alert"
                  className="shrink-0 border-b bg-destructive/10 px-4 py-2 text-sm text-destructive md:px-6"
                >
                  {error}
                </p>
              ) : null}
              <main className="rk-scroll min-h-0 min-w-0 flex-1 overflow-auto">
                <div className="@container mx-auto w-full max-w-350 space-y-4 px-4 py-4 md:px-6 md:py-5">
                  {children}
                </div>
              </main>
            </div>
            <AssistantPanel assistant={assistant} app={app} section={section} />
          </div>
          {commandOpen ? (
            <CommandPaletteModal
              groups={groups}
              onClose={() => setCommandOpen(false)}
              onNavigate={(href) => {
                setCommandOpen(false);
                navigate(href);
              }}
              onOpenAssistant={() => {
                setCommandOpen(false);
                assistant.openWith();
              }}
            />
          ) : null}
        </div>
      </BusinessSiteContext>
    </AssistantProvider>
  );
}

type CommandHit = {
  id: string;
  category: string;
  title: string;
  subtitle: string;
  href?: string;
  action?: () => void;
};

function CommandPaletteModal({
  groups,
  onClose,
  onNavigate,
  onOpenAssistant,
}: {
  groups: NavGroup[];
  onClose: () => void;
  onNavigate: (href: string) => void;
  onOpenAssistant: () => void;
}) {
  const { t } = useLingui();
  const [query, setQuery] = useState("");
  const [recordHits, setRecordHits] = useState<CommandHit[]>([]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      rpc.crm.leads.list({ limit: 50 }),
      rpc.crm.deals.list({ limit: 50 }),
      rpc.crm.companies.list({ limit: 50 }),
      rpc.crm.contacts.list({ limit: 50 }),
      rpc.erp.orders.list({ limit: 30 }).catch(() => ({ orders: [] })),
      rpc.erp.invoices.list({ limit: 30 }).catch(() => ({ invoices: [] })),
    ])
      .then(([leadsRes, dealsRes, companiesRes, contactsRes, ordersRes, invoicesRes]) => {
        if (!active) return;
        const hits: CommandHit[] = [
          ...leadsRes.leads.map((lead) => ({
            id: `lead-${lead.id}`,
            category: t`Leads`,
            title: lead.title,
            subtitle: `${lead.ref} · ${lead.companyName ?? lead.contactName ?? lead.status}`,
            href: crmHref("leads", { record: lead.id }),
          })),
          ...dealsRes.deals.map((deal) => ({
            id: `deal-${deal.id}`,
            category: t`Deals`,
            title: deal.title,
            subtitle: `${deal.ref} · ${deal.stage} · ${deal.amount} ${deal.currency}`,
            href: crmHref("deals", { record: deal.id }),
          })),
          ...companiesRes.companies.map((company) => ({
            id: `company-${company.id}`,
            category: t`Organizations`,
            title: company.name,
            subtitle: `${company.domain ?? company.phone ?? "CRM Organization"}`,
            href: crmHref("companies", { record: company.id }),
          })),
          ...contactsRes.contacts.map((contact) => ({
            id: `contact-${contact.id}`,
            category: t`Contacts`,
            title: contact.name,
            subtitle: `${contact.companyName ?? contact.title ?? contact.email ?? "Contact"}`,
            href: crmHref("contacts", { record: contact.id }),
          })),
          ...ordersRes.orders.map((order) => ({
            id: `order-${order.id}`,
            category: t`Sales Orders`,
            title: `${order.ref} · ${order.companyName ?? "Order"}`,
            subtitle: `${order.status} · ${order.subtotal} ${order.currency}`,
            href: erpHref("orders", { record: order.id }),
          })),
          ...invoicesRes.invoices.map((invoice) => ({
            id: `invoice-${invoice.id}`,
            category: t`Sales Invoices`,
            title: `${invoice.ref} · ${invoice.companyName ?? "Invoice"}`,
            subtitle: `${invoice.status} · ${invoice.total} ${invoice.currency}`,
            href: erpHref("invoices", { record: invoice.id }),
          })),
        ];
        setRecordHits(hits);
      })
      .catch(() => {
        // Keep navigation items available even if record prefetch fails.
      });
    return () => {
      active = false;
    };
  }, [t]);

  const navHits = useMemo<CommandHit[]>(() => {
    const items: CommandHit[] = [
      {
        id: "action-assistant",
        category: t`Quick Actions`,
        title: t`Ask AI CRM Operator`,
        subtitle: t`Run pipeline inspection, draft follow-ups, or qualify leads`,
        action: onOpenAssistant,
      },
      {
        id: "action-desk",
        category: t`Quick Actions`,
        title: t`Open Savingroup Desk Workspace`,
        subtitle: t`Unified Frappe CRM + ERPNext Doctype Command Center`,
        href: crmHref("workspace"),
      },
    ];
    for (const group of groups) {
      for (const item of group.items) {
        items.push({
          id: `nav-${group.app}-${item.section}`,
          category: group.label,
          title: item.label,
          subtitle: `${group.label} · /app/${group.app}?tab=${item.section}`,
          href: sectionHref(group.app, item.section),
        });
      }
    }
    return items;
  }, [groups, onOpenAssistant, t]);

  const filtered = useMemo(() => {
    const all = [...navHits, ...recordHits];
    const needle = query.trim().toLowerCase();
    if (!needle) return all.slice(0, 18);
    return all
      .filter(
        (item) =>
          item.title.toLowerCase().includes(needle) ||
          item.subtitle.toLowerCase().includes(needle) ||
          item.category.toLowerCase().includes(needle),
      )
      .slice(0, 24);
  }, [navHits, query, recordHits]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-16">
      <button
        type="button"
        aria-label={t`Close command palette`}
        onClick={onClose}
        className="fixed inset-0 bg-background/75 backdrop-blur-xs"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t`Command Palette`}
        className="relative z-10 w-full max-w-xl overflow-hidden rounded-2xl border bg-card shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b px-3.5 py-2.5">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
            }}
            placeholder={t`Type a command, doctype, lead, deal, organization, or order…`}
            className="h-8 border-0 bg-transparent px-1 text-sm shadow-none focus-visible:ring-0"
          />
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={t`Close`}
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="rk-scroll max-h-96 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              <Trans>No matching commands or records</Trans>
            </p>
          ) : (
            <div className="space-y-1">
              {filtered.map((hit) => (
                <button
                  key={hit.id}
                  type="button"
                  onClick={() => {
                    if (hit.action) hit.action();
                    else if (hit.href) onNavigate(hit.href);
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-start text-sm transition-colors hover:bg-accent"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {hit.category}
                      </span>
                      <span className="truncate font-medium">{hit.title}</span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{hit.subtitle}</p>
                  </div>
                  <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between border-t bg-muted/30 px-3.5 py-2 text-[11px] text-muted-foreground">
          <span>
            <Trans>Frappe Awesomebar · Search across CRM & ERPNext</Trans>
          </span>
          <span>ESC</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Refetch whenever the space's business records change. The stream carries no
 * payload worth rendering; it is a hint, so the page reloads its own queries.
 */
export function useBusinessLive(onChange: () => void): { revision: number } {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    let controller: AbortController | undefined;
    let cancelRetry: (() => void) | undefined;
    void (async () => {
      while (active) {
        controller = new AbortController();
        try {
          const stream = await rpc.business.subscribe(undefined, { signal: controller.signal });
          for await (const _event of stream) {
            if (!active) return;
            setRevision((previous) => previous + 1);
            onChange();
          }
        } catch {
          // Reconnect below; the page already shows the last loaded data.
        } finally {
          controller.abort();
        }
        if (!active) return;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 1_000);
          cancelRetry = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        cancelRetry = undefined;
      }
    })();
    return () => {
      active = false;
      controller?.abort();
      cancelRetry?.();
    };
  }, [onChange]);
  return { revision };
}

/** Load a list for a section; `loading` stays true until the first answer. */
export function useBusinessList<T>(
  load: () => Promise<T>,
  deps: unknown[],
  onError: (message: string) => void,
  initial: T,
): { value: T; loading: boolean } {
  const [state, setState] = useState<{ value: T; loading: boolean }>({
    value: initial,
    loading: true,
  });
  useEffect(() => {
    let active = true;
    void load()
      .then((result) => {
        if (active) setState({ value: result, loading: false });
      })
      .catch((cause) => {
        if (!active) return;
        setState((previous) => ({ ...previous, loading: false }));
        onError(errorText(cause));
      });
    return () => {
      active = false;
    };
  }, deps);
  return state;
}
