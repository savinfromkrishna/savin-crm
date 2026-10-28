import { Trans, useLingui } from "@lingui/react/macro";
import type {
  Bot,
  BusinessEnvironment,
  BusinessSettings,
  CrmCompany,
  CrmContact,
  CrmDeal,
  ErpInvoice,
  ErpOverview,
  ErpProduct,
  ErpSalesOrder,
  InventoryAdjustment,
} from "@savingroup/contracts";
import {
  BUSINESS_NAME_MAX_LENGTH,
  BUSINESS_TEXT_MAX_LENGTH,
  LOW_STOCK_THRESHOLD,
  ORDER_STATUSES,
} from "@savingroup/contracts";
import {
  Button,
  cn,
  Input,
  NativeSelect,
  NativeSelectOption,
  Skeleton,
  Textarea,
} from "@savingroup/ui-web";
import {
  Boxes,
  Check,
  CircleCheck,
  ClipboardCheck,
  Database,
  Globe,
  LayoutGrid,
  Mail,
  PackageX,
  Plus,
  ReceiptText,
  Send,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  Truck,
  Upload,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AskRowButton } from "../components/business/assistant";
import {
  CsvExportButton,
  CsvImportModal,
  PurchaseRestockModal,
  SendInvoicePaymentModal,
} from "../components/business/commercial";
import {
  BarList,
  ColumnChart,
  ListSkeleton,
  monthlyTotals,
  Panel,
  PanelEmpty,
  PanelGrid,
  RecordList,
  RecordRow,
} from "../components/business/dashboard";
import {
  FieldRow,
  FormDialog,
  FormField,
  parseMoneyInput,
  SwitchField,
} from "../components/business/forms";
import {
  ErpInvoiceWorkspace,
  ErpOrderWorkspace,
  ErpProductWorkspace,
  frappeInvoiceDocName,
  frappeOrderDocName,
  SavingroupCustomFieldsSection,
} from "../components/business/frappe-crm";
import {
  LogisticsLoadPlannerSection,
  ProcurementSourcingSection,
} from "../components/business/procurement-logistics";
import type { Column } from "../components/business/records";
import {
  ActorLabel,
  BusinessBotsContext,
  FilterChips,
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
  crmHref,
  ERP_SECTIONS,
  erpHref,
  useBusinessList,
  useBusinessLive,
  useBusinessSection,
  useOpenRecord,
  useStatusFilter,
} from "../components/business/shell";
import {
  INVOICE_STATUS_TONES,
  ORDER_STATUS_TONES,
  paymentTone,
  useInvoiceStatusLabels,
  useOrderStatusLabels,
  usePaymentStatusLabels,
} from "../lib/business-labels";
import { formatRelativeTime } from "../lib/relative-time";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";

type Lookups = {
  products: ErpProduct[];
  orders: ErpSalesOrder[];
  companies: CrmCompany[];
  contacts: CrmContact[];
  deals: CrmDeal[];
  bots: Bot[];
  settings: BusinessSettings | null;
  /** The connected business site, when the organization has one. */
  environment: BusinessEnvironment | null;
};

export function ErpPage() {
  const { t } = useLingui();
  const section = useBusinessSection(ERP_SECTIONS);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lookups, setLookups] = useState<Lookups>({
    products: [],
    orders: [],
    companies: [],
    contacts: [],
    deals: [],
    bots: [],
    settings: null,
    environment: null,
  });
  const [lookupsLoaded, setLookupsLoaded] = useState(false);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((previous) => previous + 1), []);
  useBusinessLive(reload);

  useEffect(() => {
    let active = true;
    void Promise.all([
      rpc.erp.products.list({ includeInactive: true, limit: 200 }),
      rpc.erp.orders.list({ limit: 200 }),
      rpc.crm.companies.list({ limit: 200 }),
      rpc.crm.contacts.list({ limit: 200 }),
      rpc.crm.deals.list({ limit: 200 }),
      rpc.business.settings(),
      rpc.business.environment.get().catch(() => null),
    ])
      .then(([products, orders, companies, contacts, deals, settings, environment]) => {
        if (!active) return;
        setLookups((previous) => ({
          ...previous,
          products: products.products,
          orders: orders.orders,
          companies: companies.companies,
          contacts: contacts.contacts,
          deals: deals.deals,
          settings,
          environment,
        }));
        setError("");
      })
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

  // Bots load on their own: they draw avatars and answer in the assistant, which stays
  // reachable when records fail to load.
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
  }, []);

  const currency = lookups.settings?.currency ?? "USD";
  const shared = {
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
        app="erp"
        section={section}
        error={error}
        actions={
          <Button
            variant="ghost"
            size="icon"
            aria-label={t`Business settings`}
            title={t`Business settings`}
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 />
          </Button>
        }
      >
        {section === "overview" ? <OverviewSection {...shared} /> : null}
        {section === "procurement" ? (
          <ProcurementSourcingSection
            products={lookups.products}
            orders={lookups.orders}
            deals={lookups.deals}
            companies={lookups.companies}
            bots={lookups.bots}
            currency={currency}
            onReloadErp={reload}
            onError={setError}
          />
        ) : null}
        {section === "logistics" ? (
          <LogisticsLoadPlannerSection
            products={lookups.products}
            bots={lookups.bots}
            currency={currency}
            onReloadErp={reload}
            onError={setError}
          />
        ) : null}
        {section === "products" ? <ProductsSection {...shared} /> : null}
        {section === "inventory" ? <InventorySection {...shared} /> : null}
        {section === "orders" ? <OrdersSection {...shared} /> : null}
        {section === "invoices" ? <InvoicesSection {...shared} /> : null}
        {section === "compliance" ? <ComplianceSection {...shared} /> : null}
        {settingsOpen && lookups.settings ? (
          <SettingsDialog
            settings={lookups.settings}
            onClose={() => setSettingsOpen(false)}
            onSaved={reload}
          />
        ) : null}
      </BusinessPage>
    </BusinessBotsContext>
  );
}

type SectionProps = {
  lookups: Lookups;
  /** The shared product and customer lists have not arrived yet. */
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

function OverviewSection({ lookups, loading, revision, reload, onError }: SectionProps) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const orderStatuses = useOrderStatusLabels();
  const invoiceStatuses = useInvoiceStatusLabels();
  const payments = usePaymentStatusLabels();
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionBanner, setActionBanner] = useState<string | null>(null);
  const { value: overview } = useBusinessList<ErpOverview | null>(
    () => rpc.erp.overview(),
    [revision],
    onError,
    null,
  );
  const { value: orders, loading: ordersLoading } = useBusinessList(
    () => rpc.erp.orders.list({ limit: 200 }).then((result) => result.orders),
    [revision],
    onError,
    [] as ErpSalesOrder[],
  );
  const { value: invoices, loading: invoicesLoading } = useBusinessList(
    () => rpc.erp.invoices.list({ limit: 200 }).then((result) => result.invoices),
    [revision],
    onError,
    [] as ErpInvoice[],
  );
  const currency = overview?.currency ?? lookups.settings?.currency ?? "USD";
  const money = useMoney(currency);
  const short = useShortMoney(currency);
  const compact = useShortMoney(currency, 0);

  const opsBot = lookups.bots.find((b) => b.name.includes("Operations")) ?? lookups.bots[0];
  const financeBot = lookups.bots.find((b) => b.name.includes("Finance")) ?? lookups.bots[0];

  async function autoReplenishLowStock() {
    setBusyAction("replenish");
    setActionBanner(null);
    try {
      const lowItems = lookups.products.filter(
        (p) => p.active && p.stockOnHand <= LOW_STOCK_THRESHOLD,
      );
      const targets =
        lowItems.length > 0
          ? lowItems
          : lookups.products
              .filter((p) => p.active)
              .sort((a, b) => a.stockOnHand - b.stockOnHand)
              .slice(0, 2);
      let totalAdded = 0;
      for (const item of targets) {
        const delta = Math.max(10, 25 - item.stockOnHand);
        await rpc.erp.inventory.adjust({
          productId: item.id,
          delta,
          reason: `[Operations AI] Safety stock replenishment for ${item.sku}`,
          ...(opsBot ? { actorBotId: opsBot.id } : {}),
        });
        totalAdded += delta;
      }
      setActionBanner(
        `${opsBot?.name ?? "Operations AI"} replenished ${targets.length} SKU(s) (+${totalAdded} units total).`,
      );
      reload();
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setBusyAction(null);
    }
  }

  async function autoInvoiceConfirmedOrders() {
    setBusyAction("invoice");
    setActionBanner(null);
    try {
      const uninvoiced = orders.filter((o) => o.status === "confirmed" && !o.invoiceId);
      let issuedCount = 0;
      for (const order of uninvoiced) {
        const draft = await rpc.erp.invoices.createDraft({
          orderId: order.id,
          dueAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
          ...(financeBot ? { actorBotId: financeBot.id } : {}),
        });
        await rpc.erp.invoices.issue({
          id: draft.id,
          ...(financeBot ? { actorBotId: financeBot.id } : {}),
        });
        issuedCount += 1;
      }
      setActionBanner(
        issuedCount > 0
          ? `${financeBot?.name ?? "Finance AI"} generated and issued ${issuedCount} tax invoice(s).`
          : `All confirmed sales orders already have linked tax invoices.`,
      );
      reload();
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setBusyAction(null);
    }
  }

  const sales = useMemo(() => {
    const month = new Intl.DateTimeFormat(undefined, { month: "short" });
    return monthlyTotals(
      orders.filter((order) => order.status === "confirmed"),
      (order) => order.confirmedAt ?? order.updatedAt,
      (order) => order.subtotal,
      6,
    ).map((entry) => ({
      key: entry.start.toISOString(),
      label: month.format(entry.start),
      value: entry.total,
      display: compact(entry.total),
    }));
  }, [compact, orders]);
  const salesTotal = sales.reduce((sum, point) => sum + point.value, 0);

  // What the confirmed orders sold, by product.
  const topProducts = useMemo(() => {
    const totals = new Map<
      string,
      { key: string; name: string; quantity: number; amount: number }
    >();
    for (const order of orders) {
      if (order.status !== "confirmed") continue;
      for (const line of order.lines) {
        const key = line.productId ?? line.sku;
        const entry = totals.get(key) ?? {
          key,
          name:
            lookups.products.find((product) => product.id === line.productId)?.name ??
            line.description,
          quantity: 0,
          amount: 0,
        };
        entry.quantity += line.quantity;
        entry.amount += line.lineTotal;
        totals.set(key, entry);
      }
    }
    return [...totals.values()].sort((a, b) => b.amount - a.amount).slice(0, 5);
  }, [lookups.products, orders]);

  const recent = useMemo(
    () => [...orders].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 5),
    [orders],
  );

  const orderRow = (order: ErpSalesOrder, tone?: "warning") => {
    const customer = customerName(order);
    return (
      <RecordRow
        key={`order-${order.id}`}
        to={erpHref("orders", { record: order.id })}
        icon={ShoppingCart}
        tone={tone}
        title={customer || order.ref}
        meta={
          <>
            <span className="shrink-0 font-mono">{order.ref}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{orderStatuses[order.status]}</span>
          </>
        }
        end={short(order.subtotal)}
        action={
          <AskRowButton
            record={{ kind: "order", ref: order.ref, name: customer, status: order.status }}
          />
        }
      />
    );
  };
  const invoiceRow = (invoice: ErpInvoice) => {
    const outstanding = Math.max(0, invoice.total - invoice.amountPaid);
    const overdue =
      invoice.status === "issued" &&
      invoice.dueAt !== null &&
      Date.parse(invoice.dueAt) < Date.now();
    return (
      <RecordRow
        key={`invoice-${invoice.id}`}
        to={erpHref("invoices", { record: invoice.id })}
        icon={ReceiptText}
        tone={overdue ? "destructive" : invoice.status === "issued" ? "warning" : undefined}
        title={invoice.companyName ?? invoice.ref}
        meta={
          <>
            <span className="shrink-0 font-mono">{invoice.ref}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">
              {invoice.status === "issued"
                ? payments[invoice.paymentStatus]
                : invoiceStatuses[invoice.status]}
            </span>
          </>
        }
        end={short(invoice.status === "issued" ? outstanding : invoice.total)}
        action={
          <AskRowButton
            record={{
              kind: "invoice",
              ref: invoice.ref,
              name: invoice.companyName,
              status: invoice.status,
            }}
          />
        }
      />
    );
  };

  // Work waiting on a person, most pressing first: approvals, money owed, then stock.
  const unpaid = invoices
    .filter((invoice) => invoice.status === "issued" && invoice.total - invoice.amountPaid > 0)
    .sort(
      (a, b) => Date.parse(a.dueAt ?? a.issuedAt ?? "") - Date.parse(b.dueAt ?? b.issuedAt ?? ""),
    );
  const attention = [
    ...orders
      .filter((order) => order.status === "pending_approval")
      .map((order) => orderRow(order, "warning")),
    ...unpaid.map(invoiceRow),
    ...orders.filter((order) => order.status === "approved").map((order) => orderRow(order)),
    ...invoices.filter((invoice) => invoice.status === "draft").map(invoiceRow),
    ...lookups.products
      .filter((product) => product.active && product.stockOnHand <= LOW_STOCK_THRESHOLD)
      .sort((a, b) => a.stockOnHand - b.stockOnHand)
      .map((product) => (
        <RecordRow
          key={`product-${product.id}`}
          to={erpHref("inventory")}
          icon={Boxes}
          tone={product.stockOnHand <= 0 ? "destructive" : "warning"}
          title={product.name}
          meta={
            <>
              <span className="shrink-0 font-mono">{product.sku}</span>
              <span aria-hidden="true">·</span>
              <span className="truncate">{t`On hand`}</span>
            </>
          }
          end={<StockCount value={product.stockOnHand} />}
          action={
            <AskRowButton record={{ kind: "product", ref: product.sku, name: product.name }} />
          }
        />
      )),
  ].slice(0, 6);
  const attentionLoading = ordersLoading || invoicesLoading || loading;

  return (
    <>
      {/* Top ERP Autonomous Operations Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-success" />
            <h2 className="text-sm font-semibold">
              <Trans>Order-to-Cash & Supply Chain Command Center</Trans>
            </h2>
          </div>
          <p className="text-xs text-muted-foreground">
            <Trans>
              Manage catalog pricing, warehouse bins, sales orders, and tax invoices — or delegate
              fulfillment and billing to AI specialists.
            </Trans>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busyAction !== null}
            onClick={() => void autoReplenishLowStock()}
          >
            <Sparkles data-icon="inline-start" />
            {busyAction === "replenish" ? (
              <Trans>Replenishing Stock…</Trans>
            ) : (
              <Trans>Operations AI: Replenish Low Stock</Trans>
            )}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busyAction !== null}
            onClick={() => void autoInvoiceConfirmedOrders()}
          >
            <ReceiptText data-icon="inline-start" />
            {busyAction === "invoice" ? (
              <Trans>Generating Invoices…</Trans>
            ) : (
              <Trans>Finance AI: Auto-Invoice Confirmed Orders</Trans>
            )}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void navigate(erpHref("procurement"))}>
            <Globe data-icon="inline-start" />
            <Trans>Global Procurement & AI Sourcing</Trans>
          </Button>
          <Button size="sm" variant="outline" onClick={() => void navigate(erpHref("logistics"))}>
            <Truck data-icon="inline-start" />
            <Trans>Container & Truck Planner</Trans>
          </Button>
          <Button size="sm" onClick={() => void navigate(erpHref("orders"))}>
            <Plus data-icon="inline-start" />
            <Trans>Sales Orders</Trans>
          </Button>
        </div>
      </div>

      {actionBanner ? (
        <div className="flex items-center justify-between gap-2 rounded-xl border bg-muted/40 px-4 py-2.5 text-xs">
          <span className="font-medium">{actionBanner}</span>
          <Button variant="ghost" size="sm" onClick={() => setActionBanner(null)}>
            <Trans>Dismiss</Trans>
          </Button>
        </div>
      ) : null}

      {overview ? (
        <KpiGrid testId="erp-overview">
          <KpiCard
            label={t`Confirmed value`}
            value={short(overview.confirmedOrderAmount)}
            exact={money(overview.confirmedOrderAmount)}
            icon={TrendingUp}
            to={erpHref("orders", { status: "confirmed" })}
            detail={{ label: t`Confirmed orders`, value: overview.confirmedOrders }}
          />
          <KpiCard
            label={t`Outstanding`}
            value={short(overview.outstandingInvoiceAmount)}
            exact={money(overview.outstandingInvoiceAmount)}
            icon={ReceiptText}
            to={erpHref("invoices")}
            detail={{ label: t`Draft invoices`, value: overview.draftInvoices }}
          />
          <KpiCard
            label={t`Awaiting approval`}
            value={overview.pendingApprovalOrders}
            icon={ClipboardCheck}
            attention={overview.pendingApprovalOrders > 0}
            to={erpHref("orders", { status: "pending_approval" })}
            detail={{ label: t`Draft orders`, value: overview.draftOrders }}
          />
          <KpiCard
            label={t`Low stock`}
            value={overview.lowStockProducts}
            icon={PackageX}
            attention={overview.lowStockProducts > 0}
            to={erpHref("inventory")}
            detail={{ label: t`Products`, value: overview.products }}
          />
        </KpiGrid>
      ) : (
        <KpiGrid>
          {[0, 1, 2, 3].map((placeholder) => (
            <Skeleton key={placeholder} className="h-25.5 rounded-xl" />
          ))}
        </KpiGrid>
      )}
      {orders.length > 0 || invoices.length > 0 ? (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {[
            {
              key: "pending",
              step: "01",
              label: t`Pending Approval`,
              count: orders.filter((o) => o.status === "pending_approval" || o.status === "draft")
                .length,
              amount: orders
                .filter((o) => o.status === "pending_approval" || o.status === "draft")
                .reduce((sum, o) => sum + o.subtotal, 0),
              to: erpHref("orders", { status: "pending_approval" }),
            },
            {
              key: "confirmed",
              step: "02",
              label: t`Confirmed Orders`,
              count: orders.filter((o) => o.status === "confirmed").length,
              amount: orders
                .filter((o) => o.status === "confirmed")
                .reduce((sum, o) => sum + o.subtotal, 0),
              to: erpHref("orders", { status: "confirmed" }),
            },
            {
              key: "issued",
              step: "03",
              label: t`Issued Invoices`,
              count: invoices.filter((i) => i.status === "issued").length,
              amount: invoices
                .filter((i) => i.status === "issued")
                .reduce((sum, i) => sum + i.total, 0),
              to: erpHref("invoices"),
            },
            {
              key: "paid",
              step: "04",
              label: t`Collected Cash`,
              count: invoices.filter((i) => i.amountPaid > 0).length,
              amount: invoices.reduce((sum, i) => sum + i.amountPaid, 0),
              to: erpHref("invoices"),
            },
          ].map((stage) => (
            <Link
              key={stage.key}
              to={stage.to}
              className="group relative flex flex-col justify-between overflow-hidden rounded-xl border bg-card p-3.5 transition-all hover:border-foreground/30 hover:bg-accent/30"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] font-medium text-muted-foreground">
                  {stage.step} · {stage.label}
                </span>
                <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold">
                  {stage.count}
                </span>
              </div>
              <div className="mt-2 flex items-baseline justify-between gap-2">
                <span className="text-lg font-bold tracking-tight tabular-nums">
                  {short(stage.amount)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {stage.count} {stage.count === 1 ? t`doc` : t`docs`}
                </span>
              </div>
            </Link>
          ))}
        </div>
      ) : null}
      <PanelGrid>
        <Panel title={t`Needs attention`} testId="erp-attention">
          {attentionLoading && attention.length === 0 ? (
            <ListSkeleton />
          ) : attention.length > 0 ? (
            <RecordList label={t`Needs attention`}>{attention}</RecordList>
          ) : (
            <PanelEmpty icon={CircleCheck}>{t`All clear`}</PanelEmpty>
          )}
        </Panel>
        <Panel
          title={t`Sales`}
          to={erpHref("orders", { status: "confirmed" })}
          aside={ordersLoading ? undefined : compact(salesTotal)}
          testId="erp-sales"
        >
          <ColumnChart label={t`Sales`} points={sales} />
        </Panel>
        <Panel title={t`Recent orders`} to={erpHref("orders")} testId="erp-recent-orders">
          {ordersLoading && recent.length === 0 ? (
            <ListSkeleton />
          ) : recent.length > 0 ? (
            <RecordList label={t`Recent orders`}>
              {recent.map((order) => {
                const customer = customerName(order);
                return (
                  <RecordRow
                    key={order.id}
                    to={erpHref("orders", { record: order.id })}
                    icon={ShoppingCart}
                    title={customer || order.ref}
                    meta={
                      <>
                        <span className="shrink-0 font-mono">{order.ref}</span>
                        <span aria-hidden="true">·</span>
                        <span className="shrink-0">{formatRelativeTime(order.updatedAt)}</span>
                      </>
                    }
                    end={
                      <span className="flex items-center gap-3">
                        <span className="hidden @sm:inline">
                          <StatusBadge tone={ORDER_STATUS_TONES[order.status]}>
                            {orderStatuses[order.status]}
                          </StatusBadge>
                        </span>
                        {short(order.subtotal)}
                      </span>
                    }
                    action={
                      <AskRowButton
                        record={{
                          kind: "order",
                          ref: order.ref,
                          name: customer,
                          status: order.status,
                        }}
                      />
                    }
                  />
                );
              })}
            </RecordList>
          ) : (
            <PanelEmpty icon={ShoppingCart}>{t`No orders yet`}</PanelEmpty>
          )}
        </Panel>
        <Panel title={t`Top products`} to={erpHref("products")} testId="erp-top-products">
          {ordersLoading && topProducts.length === 0 ? (
            <ListSkeleton />
          ) : topProducts.length > 0 ? (
            <BarList
              label={t`Top products`}
              rows={topProducts.map((product) => ({
                key: product.key,
                label: product.name,
                note: `× ${product.quantity}`,
                value: product.amount,
                display: compact(product.amount),
              }))}
            />
          ) : (
            <PanelEmpty icon={Boxes}>{t`No sales yet`}</PanelEmpty>
          )}
        </Panel>
      </PanelGrid>
    </>
  );
}

// --- Settings ----------------------------------------------------------------

function SettingsDialog({
  settings,
  onClose,
  onSaved,
}: {
  settings: BusinessSettings;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLingui();
  const formId = useId();
  const [currency, setCurrency] = useState(settings.currency);
  const [allowNegativeStock, setAllowNegativeStock] = useState(settings.allowNegativeStock);
  const [orderApproval, setOrderApproval] = useState(settings.orderApprovalRequired);
  const [invoiceApproval, setInvoiceApproval] = useState(settings.invoiceApprovalRequired);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setBusy(true);
    setError("");
    try {
      await rpc.business.updateSettings({
        currency,
        allowNegativeStock,
        orderApprovalRequired: orderApproval,
        invoiceApprovalRequired: invoiceApproval,
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
      title={t`Business settings`}
      onClose={onClose}
      onSubmit={save}
      busy={busy}
      submitLabel={t`Save`}
      disabled={currency.trim().length !== 3}
      error={error}
    >
      <FormField id={`${formId}-currency`} label={t`Currency`} required className="sm:w-1/2">
        <Input
          id={`${formId}-currency`}
          value={currency}
          onChange={(event) => setCurrency(event.target.value.toUpperCase())}
          maxLength={3}
          required
        />
      </FormField>
      <div className="divide-y rounded-lg border px-3">
        <SwitchField
          id={`${formId}-negative`}
          checked={allowNegativeStock}
          onChange={setAllowNegativeStock}
          label={t`Allow negative stock`}
        />
        <SwitchField
          id={`${formId}-order-approval`}
          checked={orderApproval}
          onChange={setOrderApproval}
          label={t`Orders need approval before confirmation`}
        />
        <SwitchField
          id={`${formId}-invoice-approval`}
          checked={invoiceApproval}
          onChange={setInvoiceApproval}
          label={t`Invoices need approval before issuing`}
        />
      </div>
    </FormDialog>
  );
}

// --- Products ----------------------------------------------------------------

/** Stock on hand; an active product running out reads as a warning, none left as a problem. */
function StockCount({ value, active = true }: { value: number; active?: boolean }) {
  return (
    <span
      className={cn(
        active && value <= 0 && "font-medium text-destructive",
        active && value > 0 && value <= LOW_STOCK_THRESHOLD && "font-medium dark:text-warning",
      )}
    >
      {value}
    </span>
  );
}

function ProductsSection({ lookups, loading, currency, revision, reload, onError }: SectionProps) {
  const { t } = useLingui();
  const money = useMoney(currency);
  const short = useShortMoney(currency);
  const [query, setQuery] = useState("");
  const [stockFilter, setStockFilter] = useState("");
  const [openId, setOpenId] = useOpenRecord();
  const [creating, setCreating] = useState(false);
  const [importingCsv, setImportingCsv] = useState(false);
  const open = openId ? lookups.products.find((product) => product.id === openId) : undefined;

  const activeProducts = lookups.products.filter((p) => p.active);
  const totalValuation = activeProducts.reduce((sum, p) => sum + p.unitPrice * p.stockOnHand, 0);
  const totalUnits = activeProducts.reduce((sum, p) => sum + p.stockOnHand, 0);
  const lowStockCount = activeProducts.filter((p) => p.stockOnHand <= LOW_STOCK_THRESHOLD).length;

  const visibleProducts = lookups.products.filter((row) => {
    if (!matchesQuery(query, row.sku, row.name, row.description, row.hsnCode)) return false;
    if (stockFilter === "in_stock") return row.active && row.stockOnHand > LOW_STOCK_THRESHOLD;
    if (stockFilter === "low")
      return row.active && row.stockOnHand > 0 && row.stockOnHand <= LOW_STOCK_THRESHOLD;
    if (stockFilter === "out") return row.active && row.stockOnHand <= 0;
    if (stockFilter === "inactive") return !row.active;
    return true;
  });

  const columns: Column<ErpProduct>[] = [
    {
      key: "product",
      header: t`SKU · Item Name`,
      render: (row) => (
        <PrimaryCell
          refText={row.sku}
          title={
            <>
              {row.name}
              {row.active ? null : (
                <span className="ms-2 align-middle">
                  <StatusBadge tone="muted">
                    <Trans>Inactive</Trans>
                  </StatusBadge>
                </span>
              )}
            </>
          }
          detail={row.description}
        />
      ),
    },
    {
      key: "hsn",
      header: t`Tax / HSN Code`,
      hideBelow: "md",
      render: (row) => (
        <span className="font-mono text-xs text-muted-foreground">{row.hsnCode ?? "998314"}</span>
      ),
    },
    {
      key: "price",
      header: t`Unit Price`,
      align: "end",
      render: (row) => money(row.unitPrice),
    },
    {
      key: "stock",
      header: t`On Hand`,
      align: "end",
      render: (row) => (
        <span className="inline-flex items-center gap-2">
          <StockCount value={row.stockOnHand} active={row.active} />
          {row.active && row.stockOnHand <= 0 ? (
            <StatusBadge tone="destructive">{t`Out`}</StatusBadge>
          ) : row.active && row.stockOnHand <= LOW_STOCK_THRESHOLD ? (
            <StatusBadge tone="warning">{t`Low`}</StatusBadge>
          ) : null}
        </span>
      ),
    },
    {
      key: "valuation",
      header: t`Asset Value`,
      align: "end",
      hideBelow: "sm",
      render: (row) => (
        <span className="font-medium tabular-nums">
          {money(Math.max(0, row.stockOnHand) * row.unitPrice)}
        </span>
      ),
    },
  ];
  const hsnRequired =
    lookups.environment?.status === "active" && lookups.environment.blueprintId === "india-smb";
  const newProduct = (
    <NewButton onClick={() => setCreating(true)}>
      <Trans>New product</Trans>
    </NewButton>
  );

  if (open) {
    return (
      <ErpProductWorkspace
        key={open.id}
        product={open}
        bots={lookups.bots}
        companies={lookups.companies}
        currency={currency}
        revision={revision}
        onBack={() => setOpenId(null)}
        onChanged={reload}
        onError={onError}
      />
    );
  }

  return (
    <>
      <KpiGrid>
        <KpiCard
          label={t`Active Catalog SKUs`}
          value={activeProducts.length}
          icon={Boxes}
          detail={{ label: t`Total items`, value: lookups.products.length }}
        />
        <KpiCard
          label={t`Inventory Valuation`}
          value={short(totalValuation)}
          exact={money(totalValuation)}
          icon={Database}
          detail={{ label: t`Units on hand`, value: totalUnits }}
        />
        <KpiCard
          label={t`Total Units in Stock`}
          value={totalUnits}
          icon={TrendingUp}
          detail={{ label: t`Reorder threshold`, value: LOW_STOCK_THRESHOLD }}
        />
        <KpiCard
          label={t`Low / Out of Stock`}
          value={lowStockCount}
          icon={PackageX}
          attention={lowStockCount > 0}
          detail={{ label: t`Needs replenishment`, value: lowStockCount }}
        />
      </KpiGrid>
      <Toolbar
        action={
          <>
            <CsvExportButton
              filename="catalog-skus.csv"
              rows={visibleProducts}
              columns={[
                { header: "SKU", value: (r) => r.sku },
                { header: "Name", value: (r) => r.name },
                { header: "Unit Price", value: (r) => r.unitPrice },
                { header: "Stock On Hand", value: (r) => r.stockOnHand },
                { header: "HSN Code", value: (r) => r.hsnCode ?? "998314" },
                { header: "Active", value: (r) => r.active },
                { header: "Description", value: (r) => r.description },
              ]}
            />
            <Button variant="outline" size="sm" onClick={() => setImportingCsv(true)}>
              <Upload className="size-3.5" data-icon="inline-start" aria-hidden="true" />
              <Trans>Import CSV</Trans>
            </Button>
            {newProduct}
          </>
        }
        filters={
          <FilterChips
            label={t`Filter catalog`}
            value={stockFilter}
            onChange={setStockFilter}
            options={[
              { value: "", label: t`All items` },
              { value: "in_stock", label: t`In stock` },
              { value: "low", label: t`Low stock` },
              { value: "out", label: t`Out of stock` },
              { value: "inactive", label: t`Inactive` },
            ]}
          />
        }
      >
        <SearchField value={query} onChange={setQuery} />
      </Toolbar>
      <RecordTable
        testId="erp-products"
        columns={columns}
        rows={visibleProducts}
        loading={loading}
        onRowClick={(row) => setOpenId(row.id)}
        rowClassName={(row) => (row.active ? undefined : "text-muted-foreground")}
        rowAction={(row) => (
          <AskRowButton record={{ kind: "product", ref: row.sku, name: row.name }} />
        )}
        filtered={Boolean(query || stockFilter)}
        empty={t`No products yet`}
        emptyIcon={Boxes}
        emptyAction={newProduct}
      />
      {importingCsv ? (
        <CsvImportModal
          entity="products"
          bots={lookups.bots}
          companies={lookups.companies}
          onClose={() => setImportingCsv(false)}
          onImported={reload}
        />
      ) : null}
      {creating ? (
        <ProductDialog
          key="new"
          product={null}
          revision={revision}
          onClose={() => setCreating(false)}
          onSaved={reload}
          hsnRequired={hsnRequired}
        />
      ) : null}
    </>
  );
}

function ProductDialog({
  product,
  revision,
  onClose,
  onSaved,
  hsnRequired,
}: {
  product: ErpProduct | null;
  revision: number;
  onClose: () => void;
  onSaved: () => void;
  /** GST sites refuse an item without an HSN/SAC code; the field appears only there. */
  hsnRequired: boolean;
}) {
  const { t } = useLingui();
  const formId = useId();
  const [sku, setSku] = useState(product?.sku ?? "");
  const [name, setName] = useState(product?.name ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [unitPrice, setUnitPrice] = useState(product ? String(product.unitPrice) : "");
  const [initialStock, setInitialStock] = useState("0");
  const [hsnCode, setHsnCode] = useState(product?.hsnCode ?? "998314");
  const [active, setActive] = useState(product?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setBusy(true);
    setError("");
    try {
      const price = parseMoneyInput(unitPrice) ?? 0;
      if (product) {
        await rpc.erp.products.update({
          id: product.id,
          name,
          description: description || null,
          unitPrice: price,
          active,
          hsnCode: hsnCode.trim() || null,
        });
      } else {
        await rpc.erp.products.create({
          sku,
          name,
          ...(description ? { description } : {}),
          unitPrice: price,
          initialStock: Math.max(0, Math.floor(Number(initialStock) || 0)),
          ...(hsnCode.trim() ? { hsnCode: hsnCode.trim() } : {}),
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
  const hsnField = (
    <FormField id={`${formId}-hsn`} label={t`Tax / HSN-SAC Code`} required={hsnRequired}>
      <Input
        id={`${formId}-hsn`}
        value={hsnCode}
        onChange={(event) => setHsnCode(event.target.value)}
        maxLength={12}
        required={hsnRequired}
      />
    </FormField>
  );
  return (
    <FormDialog
      title={product ? `${product.sku} · ${product.name}` : t`New product`}
      meta={
        product ? (
          <>
            <StatusBadge tone={product.active ? "success" : "muted"}>
              {product.active ? t`Active` : t`Inactive`}
            </StatusBadge>
            <span>
              {t`On hand`} <StockCount value={product.stockOnHand} />
            </span>
          </>
        ) : undefined
      }
      onClose={onClose}
      onSubmit={save}
      busy={busy}
      submitLabel={product ? t`Save` : t`Create`}
      disabled={!name.trim() || (!product && !sku.trim()) || (hsnRequired && !hsnCode.trim())}
      error={error}
      history={product ? { recordType: "product", recordId: product.id, revision } : undefined}
      ask={product ? { kind: "product", ref: product.sku, name: product.name } : undefined}
      site={product ? { kind: "product", id: product.id } : undefined}
    >
      {!product ? (
        <FormField id={`${formId}-sku`} label={t`SKU`} required>
          <Input
            id={`${formId}-sku`}
            className="font-mono"
            value={sku}
            onChange={(event) => setSku(event.target.value.toUpperCase())}
            required
          />
        </FormField>
      ) : null}
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
        <FormField id={`${formId}-price`} label={t`Unit price`} required>
          <Input
            id={`${formId}-price`}
            inputMode="decimal"
            value={unitPrice}
            onChange={(event) => setUnitPrice(event.target.value)}
            required
          />
        </FormField>
        {!product ? (
          <FormField id={`${formId}-stock`} label={t`Opening stock`}>
            <Input
              id={`${formId}-stock`}
              inputMode="numeric"
              value={initialStock}
              onChange={(event) => setInitialStock(event.target.value)}
            />
          </FormField>
        ) : (
          hsnField
        )}
      </FieldRow>
      {!product ? hsnField : null}
      <FormField id={`${formId}-description`} label={t`Description`}>
        <Textarea
          id={`${formId}-description`}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={BUSINESS_TEXT_MAX_LENGTH}
        />
      </FormField>
      {product ? (
        <>
          <div className="rounded-lg border px-3">
            <SwitchField
              id={`${formId}-active`}
              checked={active}
              onChange={setActive}
              label={t`Active`}
            />
          </div>
          <SavingroupCustomFieldsSection
            recordType="product"
            recordId={product.id}
            legacyRef={product.sku}
            createdBy={product.createdBy}
          />
        </>
      ) : null}
    </FormDialog>
  );
}

// --- Inventory ---------------------------------------------------------------

function InventorySection({ lookups, loading, currency, revision, reload, onError }: SectionProps) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const money = useMoney(currency);
  const short = useShortMoney(currency);
  const [query, setQuery] = useState("");
  const [healthFilter, setHealthFilter] = useState("");
  const [adjusting, setAdjusting] = useState<ErpProduct | null>(null);
  const [receivingPo, setReceivingPo] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [replenishing, setReplenishing] = useState(false);
  const { value: adjustments } = useBusinessList(
    () => rpc.erp.inventory.adjustments({ limit: 50 }),
    [revision],
    onError,
    [] as InventoryAdjustment[],
  );

  const activeProducts = lookups.products.filter((product) => product.active);
  const totalValuation = activeProducts.reduce((sum, p) => sum + p.unitPrice * p.stockOnHand, 0);
  const totalUnits = activeProducts.reduce((sum, p) => sum + p.stockOnHand, 0);
  const lowStockItems = activeProducts.filter((p) => p.stockOnHand <= LOW_STOCK_THRESHOLD);
  const opsBot = lookups.bots.find((b) => b.name.includes("Operations")) ?? lookups.bots[0];

  async function quickReceive(product: ErpProduct, units: number) {
    setBusyId(product.id);
    try {
      await rpc.erp.inventory.adjust({
        productId: product.id,
        delta: units,
        reason: `Warehouse receipt (+${units} units)`,
      });
      reload();
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setBusyId(null);
    }
  }

  async function autoReplenishAll() {
    setReplenishing(true);
    try {
      const targets =
        lowStockItems.length > 0
          ? lowStockItems
          : [...activeProducts].sort((a, b) => a.stockOnHand - b.stockOnHand).slice(0, 2);
      for (const product of targets) {
        const delta = Math.max(10, 25 - product.stockOnHand);
        await rpc.erp.inventory.adjust({
          productId: product.id,
          delta,
          reason: `[Operations AI] Replenished ${product.sku} to target safety stock (25 units)`,
          ...(opsBot ? { actorBotId: opsBot.id } : {}),
        });
      }
      reload();
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setReplenishing(false);
    }
  }

  const visibleProducts = activeProducts.filter((product) => {
    if (!matchesQuery(query, product.sku, product.name, product.hsnCode)) return false;
    if (healthFilter === "healthy") return product.stockOnHand > LOW_STOCK_THRESHOLD;
    if (healthFilter === "low")
      return product.stockOnHand > 0 && product.stockOnHand <= LOW_STOCK_THRESHOLD;
    if (healthFilter === "depleted") return product.stockOnHand <= 0;
    return true;
  });

  const columns: Column<ErpProduct>[] = [
    {
      key: "product",
      header: t`SKU · Product`,
      render: (row) => <PrimaryCell refText={row.sku} title={row.name} detail={row.description} />,
    },
    {
      key: "health",
      header: t`Bin Health`,
      hideBelow: "sm",
      render: (row) =>
        row.stockOnHand <= 0 ? (
          <StatusBadge tone="destructive">{t`Depleted`}</StatusBadge>
        ) : row.stockOnHand <= LOW_STOCK_THRESHOLD ? (
          <StatusBadge tone="warning">{t`Reorder Alert`}</StatusBadge>
        ) : (
          <StatusBadge tone="success">{t`Healthy`}</StatusBadge>
        ),
    },
    {
      key: "unitPrice",
      header: t`Unit Cost`,
      align: "end",
      hideBelow: "md",
      render: (row) => money(row.unitPrice),
    },
    {
      key: "stock",
      header: t`On Hand`,
      align: "end",
      render: (row) => <StockCount value={row.stockOnHand} />,
    },
    {
      key: "valuation",
      header: t`Bin Valuation`,
      align: "end",
      hideBelow: "sm",
      render: (row) => (
        <span className="font-medium tabular-nums">
          {money(Math.max(0, row.stockOnHand) * row.unitPrice)}
        </span>
      ),
    },
    {
      key: "adjust",
      header: "",
      align: "end",
      className: "w-0",
      render: (row) => (
        <div className="flex items-center justify-end gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            disabled={busyId === row.id}
            onClick={(e) => {
              e.stopPropagation();
              void quickReceive(row, 10);
            }}
          >
            +10
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setAdjusting(row);
            }}
          >
            <Trans>Adjust</Trans>
          </Button>
        </div>
      ),
    },
  ];
  const historyColumns: Column<InventoryAdjustment>[] = [
    {
      key: "product",
      header: t`Product`,
      render: (row) => (
        <PrimaryCell refText={row.sku} title={row.productName} detail={row.reason} />
      ),
    },
    {
      key: "delta",
      header: t`Change`,
      align: "end",
      render: (row) => (
        <span className="font-medium">{row.delta > 0 ? `+${row.delta}` : `−${-row.delta}`}</span>
      ),
    },
    {
      key: "after",
      header: t`After`,
      align: "end",
      hideBelow: "sm",
      render: (row) => row.quantityAfter,
    },
    {
      key: "by",
      header: t`By`,
      hideBelow: "md",
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
      <KpiGrid>
        <KpiCard
          label={t`Warehouse Valuation`}
          value={short(totalValuation)}
          exact={money(totalValuation)}
          icon={Database}
          detail={{ label: t`Active SKUs`, value: activeProducts.length }}
        />
        <KpiCard
          label={t`Total Units in Bins`}
          value={totalUnits}
          icon={Boxes}
          detail={{ label: t`Safety threshold`, value: LOW_STOCK_THRESHOLD }}
        />
        <KpiCard
          label={t`Reorder Alerts`}
          value={lowStockItems.length}
          icon={PackageX}
          attention={lowStockItems.length > 0}
          detail={{ label: t`SKUs ≤ ${LOW_STOCK_THRESHOLD} units`, value: lowStockItems.length }}
        />
        <KpiCard
          label={t`Stock Ledger Entries`}
          value={adjustments.length}
          icon={ClipboardCheck}
          detail={{ label: t`Audited movements`, value: adjustments.length }}
        />
      </KpiGrid>
      <Toolbar
        action={
          <>
            <CsvExportButton
              filename="warehouse-stock.csv"
              rows={visibleProducts}
              columns={[
                { header: "SKU", value: (r) => r.sku },
                { header: "Name", value: (r) => r.name },
                { header: "Stock On Hand", value: (r) => r.stockOnHand },
                { header: "Unit Cost", value: (r) => r.unitPrice },
                { header: "Bin Valuation", value: (r) => Math.max(0, r.stockOnHand) * r.unitPrice },
              ]}
            />
            <Button variant="outline" size="sm" onClick={() => setReceivingPo(true)}>
              <Truck className="size-3.5" data-icon="inline-start" />
              <Trans>Receive Purchase Order</Trans>
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={replenishing}
              onClick={() => void autoReplenishAll()}
            >
              <Sparkles data-icon="inline-start" />
              {replenishing ? (
                <Trans>Replenishing Bins…</Trans>
              ) : (
                <Trans>Operations AI: Auto-Replenish</Trans>
              )}
            </Button>
          </>
        }
        filters={
          <FilterChips
            label={t`Filter bin health`}
            value={healthFilter}
            onChange={setHealthFilter}
            options={[
              { value: "", label: t`All bins` },
              { value: "healthy", label: t`Healthy` },
              { value: "low", label: t`Low stock` },
              { value: "depleted", label: t`Depleted` },
            ]}
          />
        }
      >
        <SearchField value={query} onChange={setQuery} />
      </Toolbar>
      <RecordTable
        testId="erp-inventory"
        columns={columns}
        rows={visibleProducts}
        loading={loading}
        onRowClick={(row) => void navigate(erpHref("products", { record: row.id }))}
        rowAction={(row) => (
          <AskRowButton record={{ kind: "product", ref: row.sku, name: row.name }} />
        )}
        filtered={Boolean(query || healthFilter)}
        empty={t`No products yet`}
        emptyIcon={Boxes}
      />
      {adjustments.length > 0 ? (
        <section className="space-y-2 pt-2">
          <h2 className="text-sm font-medium">
            <Trans>Recent adjustments</Trans>
          </h2>
          <RecordTable columns={historyColumns} rows={adjustments} empty="" />
        </section>
      ) : null}
      {receivingPo ? (
        <PurchaseRestockModal
          products={activeProducts}
          bots={lookups.bots}
          currency={currency}
          onClose={() => setReceivingPo(false)}
          onSaved={reload}
        />
      ) : null}
      {adjusting ? (
        <AdjustDialog product={adjusting} onClose={() => setAdjusting(null)} onSaved={reload} />
      ) : null}
    </>
  );
}

function AdjustDialog({
  product,
  onClose,
  onSaved,
}: {
  product: ErpProduct;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLingui();
  const formId = useId();
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const parsed = Number.parseInt(delta, 10);
  const valid = Number.isInteger(parsed) && parsed !== 0;
  async function save() {
    setBusy(true);
    setError("");
    try {
      await rpc.erp.inventory.adjust({ productId: product.id, delta: parsed, reason });
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
      title={`${product.sku} · ${product.name}`}
      meta={
        <span>
          {t`On hand`} <StockCount value={product.stockOnHand} />
          {valid ? (
            <>
              {" → "}
              <StockCount value={product.stockOnHand + parsed} />
            </>
          ) : null}
        </span>
      }
      onClose={onClose}
      onSubmit={save}
      busy={busy}
      submitLabel={t`Adjust`}
      disabled={!valid || !reason.trim()}
      error={error}
    >
      <FormField id={`${formId}-delta`} label={t`Change (negative removes stock)`} required>
        <Input
          id={`${formId}-delta`}
          inputMode="numeric"
          value={delta}
          onChange={(event) => setDelta(event.target.value)}
          required
        />
      </FormField>
      <FormField id={`${formId}-reason`} label={t`Reason`} required>
        <Input
          id={`${formId}-reason`}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          required
        />
      </FormField>
    </FormDialog>
  );
}

// --- Orders ------------------------------------------------------------------

function customerName(order: Pick<ErpSalesOrder, "companyName" | "contactName">) {
  return order.companyName ?? order.contactName ?? "";
}

function OrdersSection({ lookups, currency, revision, reload, onError }: SectionProps) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const statuses = useOrderStatusLabels();
  const money = useMoney(currency);
  const short = useShortMoney(currency);
  const [status, setStatus] = useStatusFilter(ORDER_STATUSES);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useOpenRecord();
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { value: orders, loading } = useBusinessList(
    () =>
      rpc.erp.orders
        .list({ ...(status ? { status } : {}), limit: 200 })
        .then((result) => result.orders),
    [revision, status],
    onError,
    [] as ErpSalesOrder[],
  );

  const opsBot = lookups.bots.find((b) => b.name.includes("Operations")) ?? lookups.bots[0];
  const operatorBot = lookups.bots.find((b) => b.name.includes("Operator")) ?? lookups.bots[0];
  const financeBot = lookups.bots.find((b) => b.name.includes("Finance")) ?? lookups.bots[0];

  const totalOrderValue = orders
    .filter((o) => o.status !== "cancelled")
    .reduce((sum, o) => sum + o.subtotal, 0);
  const pendingApprovalCount = orders.filter((o) => o.status === "pending_approval").length;
  const approvedCount = orders.filter((o) => o.status === "approved").length;
  const confirmedValue = orders
    .filter((o) => o.status === "confirmed")
    .reduce((sum, o) => sum + o.subtotal, 0);

  async function quickOrderAction(row: ErpSalesOrder, action: () => Promise<unknown>) {
    setBusyId(row.id);
    try {
      await action();
      reload();
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setBusyId(null);
    }
  }

  const columns: Column<ErpSalesOrder>[] = [
    {
      key: "order",
      header: t`Sales Order`,
      render: (row) => (
        <PrimaryCell
          refText={`${frappeOrderDocName(row)} · ${row.ref}`}
          title={customerName(row) || "—"}
          detail={`${row.lines.length} ${row.lines.length === 1 ? t`line` : t`lines`} · ${money(row.subtotal)}`}
          detailWhile="sm"
        />
      ),
    },
    {
      key: "status",
      header: t`Status`,
      render: (row) => (
        <div className="flex items-center gap-1.5">
          <StatusBadge tone={ORDER_STATUS_TONES[row.status]}>{statuses[row.status]}</StatusBadge>
          {row.invoiceId ? <StatusBadge tone="neutral">{t`Invoiced`}</StatusBadge> : null}
        </div>
      ),
    },
    {
      key: "subtotal",
      header: t`Subtotal`,
      align: "end",
      hideBelow: "sm",
      render: (row) => <span className="font-medium tabular-nums">{money(row.subtotal)}</span>,
    },
    {
      key: "actor",
      header: t`Prepared By`,
      hideBelow: "md",
      render: (row) => <ActorLabel actor={row.createdBy} />,
    },
    {
      key: "updated",
      header: t`Modified`,
      hideBelow: "md",
      render: (row) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {formatRelativeTime(row.updatedAt)}
        </span>
      ),
    },
    {
      key: "quick",
      header: "",
      align: "end",
      className: "w-0",
      render: (row) => (
        <div className="flex items-center justify-end gap-1.5">
          {row.status === "draft" && row.lines.length > 0 ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busyId === row.id}
              onClick={(e) => {
                e.stopPropagation();
                void quickOrderAction(row, () =>
                  rpc.erp.orders.requestApproval({
                    id: row.id,
                    ...(opsBot ? { actorBotId: opsBot.id } : {}),
                  }),
                );
              }}
            >
              <Trans>Submit</Trans>
            </Button>
          ) : row.status === "pending_approval" ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busyId === row.id}
              onClick={(e) => {
                e.stopPropagation();
                void quickOrderAction(row, () =>
                  rpc.erp.orders.approve({
                    id: row.id,
                    ...(operatorBot ? { actorBotId: operatorBot.id } : {}),
                  }),
                );
              }}
            >
              <Trans>Approve</Trans>
            </Button>
          ) : row.status === "approved" ? (
            <Button
              size="sm"
              disabled={busyId === row.id}
              onClick={(e) => {
                e.stopPropagation();
                void quickOrderAction(row, () =>
                  rpc.erp.orders.confirm({
                    id: row.id,
                    ...(opsBot ? { actorBotId: opsBot.id } : {}),
                  }),
                );
              }}
            >
              <Trans>Confirm</Trans>
            </Button>
          ) : row.status === "confirmed" && !row.invoiceId ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busyId === row.id}
              onClick={(e) => {
                e.stopPropagation();
                void quickOrderAction(row, async () => {
                  const inv = await rpc.erp.invoices.createDraft({
                    orderId: row.id,
                    dueAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
                    ...(financeBot ? { actorBotId: financeBot.id } : {}),
                  });
                  await navigate(erpHref("invoices", { record: inv.id }));
                });
              }}
            >
              <Trans>Invoice</Trans>
            </Button>
          ) : null}
        </div>
      ),
    },
  ];
  const newOrder = (
    <NewButton onClick={() => setCreating(true)}>
      <Trans>New order</Trans>
    </NewButton>
  );
  if (openId) {
    return (
      <ErpOrderWorkspace
        key={openId}
        orderId={openId}
        lookups={lookups}
        currency={currency}
        revision={revision}
        onBack={() => setOpenId(null)}
        onChanged={reload}
        onError={onError}
      />
    );
  }
  return (
    <>
      <KpiGrid>
        <KpiCard
          label={t`Active Order Pipeline`}
          value={short(totalOrderValue)}
          exact={money(totalOrderValue)}
          icon={ShoppingCart}
          detail={{ label: t`Total orders`, value: orders.length }}
        />
        <KpiCard
          label={t`Pending Approval`}
          value={pendingApprovalCount}
          icon={ClipboardCheck}
          attention={pendingApprovalCount > 0}
          detail={{
            label: t`Draft orders`,
            value: orders.filter((o) => o.status === "draft").length,
          }}
        />
        <KpiCard
          label={t`Approved & Ready`}
          value={approvedCount}
          icon={CircleCheck}
          detail={{ label: t`Ready to confirm`, value: approvedCount }}
        />
        <KpiCard
          label={t`Confirmed Revenue`}
          value={short(confirmedValue)}
          exact={money(confirmedValue)}
          icon={TrendingUp}
          detail={{
            label: t`Confirmed orders`,
            value: orders.filter((o) => o.status === "confirmed").length,
          }}
        />
      </KpiGrid>
      <Toolbar
        action={
          <>
            <CsvExportButton
              filename="sales-orders.csv"
              rows={orders}
              columns={[
                { header: "Ref", value: (r) => r.ref },
                { header: "Customer", value: (r) => customerName(r) },
                { header: "Status", value: (r) => r.status },
                { header: "Lines", value: (r) => r.lines.length },
                { header: "Subtotal", value: (r) => r.subtotal },
                { header: "Currency", value: (r) => r.currency },
              ]}
            />
            {newOrder}
          </>
        }
        filters={
          <FilterChips
            label={t`Filter by status`}
            value={status}
            onChange={setStatus}
            options={[
              { value: "", label: t`All statuses` },
              ...ORDER_STATUSES.map((value) => ({ value, label: statuses[value] })),
            ]}
          />
        }
      >
        <SearchField value={query} onChange={setQuery} />
      </Toolbar>
      <RecordTable
        testId="erp-orders"
        columns={columns}
        rows={orders.filter((row) =>
          matchesQuery(
            query,
            row.ref,
            frappeOrderDocName(row),
            row.companyName,
            row.contactName,
            row.notes,
          ),
        )}
        loading={loading}
        onRowClick={(row) => setOpenId(row.id)}
        rowAction={(row) => (
          <AskRowButton
            record={{
              kind: "order",
              ref: row.ref,
              name: customerName(row),
              status: row.status,
            }}
          />
        )}
        filtered={Boolean(query || status)}
        empty={t`No orders yet`}
        emptyIcon={ShoppingCart}
        emptyAction={newOrder}
      />
      {creating ? (
        <NewOrderDialog
          lookups={lookups}
          currency={currency}
          onClose={() => setCreating(false)}
          onSaved={reload}
        />
      ) : null}
    </>
  );
}

function NewOrderDialog({
  lookups,
  currency,
  onClose,
  onSaved,
}: {
  lookups: Lookups;
  currency: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLingui();
  const formId = useId();
  const money = useMoney(currency);
  const activeProducts = useMemo(
    () => lookups.products.filter((p) => p.active),
    [lookups.products],
  );
  const [companyId, setCompanyId] = useState(lookups.companies[0]?.id ?? "");
  const [contactId, setContactId] = useState("");
  const [dealId, setDealId] = useState("");
  const [notes, setNotes] = useState("");
  const [draftLines, setDraftLines] = useState<{ productId: string; quantity: number }[]>(() =>
    activeProducts[0] ? [{ productId: activeProducts[0].id, quantity: 1 }] : [],
  );
  const [selectedProductId, setSelectedProductId] = useState(
    activeProducts[1]?.id ?? activeProducts[0]?.id ?? "",
  );
  const [selectedQty, setSelectedQty] = useState("1");
  const [submitForApproval, setSubmitForApproval] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function handleDealSelect(nextDealId: string) {
    setDealId(nextDealId);
    const deal = lookups.deals.find((d) => d.id === nextDealId);
    if (deal) {
      if (deal.companyId) setCompanyId(deal.companyId);
      if (deal.contactId) setContactId(deal.contactId);
      if (!notes.trim()) {
        setNotes(`Prepared from Deal ${deal.ref} · ${deal.title}`);
      }
    }
  }

  function addDraftLine() {
    const qty = Math.max(1, Math.floor(Number(selectedQty) || 1));
    if (!selectedProductId) return;
    setDraftLines((prev) => {
      const existing = prev.find((l) => l.productId === selectedProductId);
      if (existing) {
        return prev.map((l) =>
          l.productId === selectedProductId ? { ...l, quantity: l.quantity + qty } : l,
        );
      }
      return [...prev, { productId: selectedProductId, quantity: qty }];
    });
  }

  function autoPopulateLines() {
    const inStock = activeProducts.filter((p) => p.stockOnHand > 0);
    const picks = (inStock.length > 0 ? inStock : activeProducts).slice(0, 2);
    setDraftLines(picks.map((p) => ({ productId: p.id, quantity: 2 })));
  }

  const orderTotal = draftLines.reduce((sum, line) => {
    const prod = lookups.products.find((p) => p.id === line.productId);
    return sum + (prod?.unitPrice ?? 0) * line.quantity;
  }, 0);

  async function save() {
    setBusy(true);
    setError("");
    try {
      const created = await rpc.erp.orders.createDraft({
        ...(companyId ? { companyId } : {}),
        ...(contactId ? { contactId } : {}),
        ...(dealId ? { dealId } : {}),
        ...(notes ? { notes } : {}),
        lines: draftLines,
      });
      if (submitForApproval && draftLines.length > 0) {
        await rpc.erp.orders.requestApproval({ id: created.id });
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
      title={t`New Sales Order`}
      size="lg"
      onClose={onClose}
      onSubmit={save}
      busy={busy}
      submitLabel={
        submitForApproval && draftLines.length > 0
          ? t`Create & Request Approval`
          : t`Create Draft Order`
      }
      error={error}
    >
      <FormField id={`${formId}-deal`} label={t`Link to CRM Deal (auto-fills Customer & Contact)`}>
        <NativeSelect
          className="w-full"
          id={`${formId}-deal`}
          value={dealId}
          onChange={(event) => handleDealSelect(event.target.value)}
        >
          <NativeSelectOption value="">{t`No linked deal`}</NativeSelectOption>
          {lookups.deals
            .filter((deal) => deal.stage !== "lost")
            .map((deal) => (
              <NativeSelectOption key={deal.id} value={deal.id}>
                {deal.ref} · {deal.title} ({money(deal.amount)})
              </NativeSelectOption>
            ))}
        </NativeSelect>
      </FormField>

      <FieldRow>
        <FormField id={`${formId}-company`} label={t`Customer Organization`}>
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
        <FormField id={`${formId}-contact`} label={t`Primary Contact`}>
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

      {/* Multi-line Order Item Builder */}
      <div className="space-y-2.5 rounded-xl border bg-muted/15 p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Trans>Order Line Items ({draftLines.length})</Trans>
          </span>
          <Button type="button" size="sm" variant="ghost" onClick={autoPopulateLines}>
            <Sparkles data-icon="inline-start" />
            <Trans>AI Auto-Populate Standard Bundle</Trans>
          </Button>
        </div>

        {draftLines.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/30 text-muted-foreground">
                  <th className="py-2 ps-3 pe-2 text-start font-medium">{t`SKU · Item`}</th>
                  <th className="px-2 py-2 text-end font-medium">{t`Unit Price`}</th>
                  <th className="px-2 py-2 text-end font-medium">{t`Qty`}</th>
                  <th className="py-2 ps-2 pe-3 text-end font-medium">{t`Line Total`}</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {draftLines.map((line) => {
                  const prod = lookups.products.find((p) => p.id === line.productId);
                  if (!prod) return null;
                  return (
                    <tr key={line.productId}>
                      <td className="py-2 ps-3 pe-2">
                        <span className="font-mono font-semibold">{prod.sku}</span> · {prod.name}
                      </td>
                      <td className="px-2 py-2 text-end tabular-nums">{money(prod.unitPrice)}</td>
                      <td className="px-2 py-2 text-end tabular-nums">{line.quantity}</td>
                      <td className="py-2 ps-2 pe-3 text-end font-semibold tabular-nums">
                        {money(prod.unitPrice * line.quantity)}
                      </td>
                      <td className="pe-2 text-end">
                        <button
                          type="button"
                          onClick={() =>
                            setDraftLines((prev) =>
                              prev.filter((l) => l.productId !== line.productId),
                            )
                          }
                          className="text-muted-foreground hover:text-foreground"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/20 font-semibold">
                  <td className="py-2 ps-3 pe-2" colSpan={3}>
                    <Trans>Order Subtotal</Trans>
                  </td>
                  <td className="py-2 ps-2 pe-3 text-end tabular-nums">{money(orderTotal)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        ) : null}

        <div className="flex flex-wrap items-end gap-2">
          <FormField id={`${formId}-add-prod`} label={t`Catalog SKU`} className="min-w-44 flex-1">
            <NativeSelect
              id={`${formId}-add-prod`}
              className="w-full"
              value={selectedProductId}
              onChange={(e) => setSelectedProductId(e.target.value)}
            >
              <NativeSelectOption value="">{t`Choose item…`}</NativeSelectOption>
              {activeProducts.map((p) => (
                <NativeSelectOption key={p.id} value={p.id}>
                  {p.sku} · {p.name} ({money(p.unitPrice)} · {p.stockOnHand} in bin)
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </FormField>
          <FormField id={`${formId}-add-qty`} label={t`Qty`} className="w-20">
            <Input
              id={`${formId}-add-qty`}
              inputMode="numeric"
              value={selectedQty}
              onChange={(e) => setSelectedQty(e.target.value)}
            />
          </FormField>
          <Button
            type="button"
            variant="outline"
            disabled={!selectedProductId}
            onClick={addDraftLine}
          >
            <Plus data-icon="inline-start" />
            <Trans>Add SKU</Trans>
          </Button>
        </div>
      </div>

      <FormField id={`${formId}-notes`} label={t`Fulfillment & Commercial Notes`}>
        <Textarea
          id={`${formId}-notes`}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          maxLength={BUSINESS_TEXT_MAX_LENGTH}
        />
      </FormField>

      {draftLines.length > 0 ? (
        <div className="rounded-lg border px-3">
          <SwitchField
            id={`${formId}-submit-approval`}
            checked={submitForApproval}
            onChange={setSubmitForApproval}
            label={t`Submit order for approval immediately upon creation`}
          />
        </div>
      ) : null}
    </FormDialog>
  );
}

// --- Invoices ----------------------------------------------------------------

function InvoicesSection({ lookups, currency, revision, reload, onError }: SectionProps) {
  const { t } = useLingui();
  const statuses = useInvoiceStatusLabels();
  const payments = usePaymentStatusLabels();
  const money = useMoney(currency);
  const short = useShortMoney(currency);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [sendingInvoice, setSendingInvoice] = useState<ErpInvoice | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openId, setOpenId] = useOpenRecord();
  const { value: invoices, loading } = useBusinessList(
    () => rpc.erp.invoices.list({ limit: 200 }).then((result) => result.invoices),
    [revision],
    onError,
    [] as ErpInvoice[],
  );

  const financeBot = lookups.bots.find((b) => b.name.includes("Finance")) ?? lookups.bots[0];

  const totalInvoiced = invoices.reduce((sum, inv) => sum + inv.total, 0);
  const totalCollected = invoices.reduce((sum, inv) => sum + inv.amountPaid, 0);
  const totalOutstanding = invoices
    .filter((inv) => inv.status === "issued")
    .reduce((sum, inv) => sum + Math.max(0, inv.total - inv.amountPaid), 0);
  const draftCount = invoices.filter((inv) => inv.status === "draft").length;

  async function quickInvoiceAction(inv: ErpInvoice, action: () => Promise<unknown>) {
    setBusyId(inv.id);
    try {
      await action();
      reload();
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setBusyId(null);
    }
  }

  const visibleInvoices = invoices.filter((row) => {
    if (!matchesQuery(query, row.ref, frappeInvoiceDocName(row), row.orderRef, row.companyName)) {
      return false;
    }
    if (filter === "draft") return row.status === "draft";
    if (filter === "unpaid") return row.status === "issued" && row.paymentStatus === "unpaid";
    if (filter === "partial") return row.status === "issued" && row.paymentStatus === "partial";
    if (filter === "paid") return row.paymentStatus === "paid";
    return true;
  });

  const columns: Column<ErpInvoice>[] = [
    {
      key: "invoice",
      header: t`Sales Invoice`,
      render: (row) => (
        <PrimaryCell
          refText={`${frappeInvoiceDocName(row)} · ${row.ref}`}
          title={row.companyName ?? "—"}
          detail={row.orderRef}
          detailWhile="md"
        />
      ),
    },
    {
      key: "order",
      header: t`Sales Order`,
      hideBelow: "md",
      render: (row) => (
        <span className="font-mono text-xs text-muted-foreground">{row.orderRef}</span>
      ),
    },
    {
      key: "status",
      header: t`Status`,
      render: (row) => (
        <StatusBadge tone={INVOICE_STATUS_TONES[row.status]}>{statuses[row.status]}</StatusBadge>
      ),
    },
    {
      key: "payment",
      header: t`Payment`,
      hideBelow: "sm",
      render: (row) => (
        <StatusBadge tone={paymentTone(row)}>{payments[row.paymentStatus]}</StatusBadge>
      ),
    },
    {
      key: "actor",
      header: t`Issued By`,
      hideBelow: "md",
      render: (row) => <ActorLabel actor={row.createdBy} />,
    },
    {
      key: "total",
      header: t`Grand Total`,
      align: "end",
      render: (row) => (
        <div className="text-end tabular-nums">
          <div className="font-medium">{money(row.total)}</div>
          {row.status === "issued" && row.total - row.amountPaid > 0 ? (
            <div className="text-[11px] text-muted-foreground">
              {t`Due`} {money(Math.max(0, row.total - row.amountPaid))}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      key: "quick",
      header: "",
      align: "end",
      className: "w-0",
      render: (row) => {
        const balance = Math.max(0, Math.round((row.total - row.amountPaid) * 100) / 100);
        return (
          <div className="flex items-center justify-end gap-1.5">
            {row.status !== "void" ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  setSendingInvoice(row);
                }}
              >
                <Mail className="size-3.5" data-icon="inline-start" />
                <Trans>Send Link</Trans>
              </Button>
            ) : null}
            {row.status === "draft" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busyId === row.id}
                onClick={(e) => {
                  e.stopPropagation();
                  void quickInvoiceAction(row, () =>
                    rpc.erp.invoices.issue({
                      id: row.id,
                      ...(financeBot ? { actorBotId: financeBot.id } : {}),
                    }),
                  );
                }}
              >
                <Send data-icon="inline-start" />
                <Trans>Issue</Trans>
              </Button>
            ) : row.status === "issued" && balance > 0 ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busyId === row.id}
                onClick={(e) => {
                  e.stopPropagation();
                  void quickInvoiceAction(row, () =>
                    rpc.erp.invoices.recordPayment({
                      id: row.id,
                      amount: balance,
                      ...(financeBot ? { actorBotId: financeBot.id } : {}),
                    }),
                  );
                }}
              >
                <Check data-icon="inline-start" />
                <Trans>Pay Full</Trans>
              </Button>
            ) : null}
          </div>
        );
      },
    },
  ];

  const newInvoice = (
    <NewButton onClick={() => setCreating(true)}>
      <Trans>New invoice</Trans>
    </NewButton>
  );

  if (openId) {
    return (
      <ErpInvoiceWorkspace
        key={openId}
        invoiceId={openId}
        bots={lookups.bots}
        currency={currency}
        revision={revision}
        onBack={() => setOpenId(null)}
        onChanged={reload}
        onError={onError}
      />
    );
  }
  return (
    <>
      <KpiGrid>
        <KpiCard
          label={t`Total Invoiced`}
          value={short(totalInvoiced)}
          exact={money(totalInvoiced)}
          icon={ReceiptText}
          detail={{ label: t`Total invoices`, value: invoices.length }}
        />
        <KpiCard
          label={t`Collected Cash`}
          value={short(totalCollected)}
          exact={money(totalCollected)}
          icon={CircleCheck}
          detail={{
            label: t`Paid in full`,
            value: invoices.filter((i) => i.paymentStatus === "paid").length,
          }}
        />
        <KpiCard
          label={t`Accounts Receivable`}
          value={short(totalOutstanding)}
          exact={money(totalOutstanding)}
          icon={TrendingUp}
          attention={totalOutstanding > 0}
          detail={{
            label: t`Open balances`,
            value: invoices.filter((i) => i.status === "issued" && i.total - i.amountPaid > 0)
              .length,
          }}
        />
        <KpiCard
          label={t`Draft Invoices`}
          value={draftCount}
          icon={ClipboardCheck}
          attention={draftCount > 0}
          detail={{ label: t`Ready to issue`, value: draftCount }}
        />
      </KpiGrid>
      <Toolbar
        action={
          <>
            <CsvExportButton
              filename="invoices-ar.csv"
              rows={visibleInvoices}
              columns={[
                { header: "Ref", value: (r) => r.ref },
                { header: "Order Ref", value: (r) => r.orderRef },
                { header: "Customer", value: (r) => r.companyName },
                { header: "Status", value: (r) => r.status },
                { header: "Payment Status", value: (r) => r.paymentStatus },
                { header: "Total", value: (r) => r.total },
                { header: "Amount Paid", value: (r) => r.amountPaid },
                { header: "Balance Due", value: (r) => Math.max(0, r.total - r.amountPaid) },
              ]}
            />
            {newInvoice}
          </>
        }
        filters={
          <FilterChips
            label={t`Filter invoices`}
            value={filter}
            onChange={setFilter}
            options={[
              { value: "", label: t`All invoices` },
              { value: "draft", label: t`Draft` },
              { value: "unpaid", label: t`Unpaid` },
              { value: "partial", label: t`Partial` },
              { value: "paid", label: t`Paid` },
            ]}
          />
        }
      >
        <SearchField value={query} onChange={setQuery} />
      </Toolbar>
      <RecordTable
        testId="erp-invoices"
        columns={columns}
        rows={visibleInvoices}
        loading={loading}
        onRowClick={(row) => setOpenId(row.id)}
        rowAction={(row) => (
          <AskRowButton
            record={{ kind: "invoice", ref: row.ref, name: row.companyName, status: row.status }}
          />
        )}
        filtered={Boolean(query || filter)}
        empty={t`No invoices yet`}
        emptyIcon={ReceiptText}
        emptyAction={newInvoice}
      />
      {sendingInvoice ? (
        <SendInvoicePaymentModal
          invoice={sendingInvoice}
          contacts={lookups.contacts}
          bots={lookups.bots}
          onClose={() => setSendingInvoice(null)}
          onSaved={reload}
        />
      ) : null}
      {creating ? (
        <NewInvoiceDialog
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

function NewInvoiceDialog({
  lookups,
  currency,
  revision,
  onClose,
  onSaved,
}: {
  lookups: Lookups;
  currency: string;
  revision: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLingui();
  const formId = useId();
  const money = useMoney(currency);
  const [orders, setOrders] = useState<ErpSalesOrder[]>([]);
  const [orderId, setOrderId] = useState("");
  const [netDays, setNetDays] = useState("14");
  const [issueImmediately, setIssueImmediately] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void rpc.erp.orders
      .list({ limit: 200 })
      .then((res) => {
        const eligible = res.orders.filter(
          (o) => !o.invoiceId && o.status !== "cancelled" && o.lines.length > 0,
        );
        setOrders(eligible);
        if (eligible[0]) setOrderId(eligible[0].id);
      })
      .catch((cause) => setError(errorText(cause)));
  }, [revision]);

  const opsBot = lookups.bots.find((b) => b.name.includes("Operations")) ?? lookups.bots[0];
  const operatorBot = lookups.bots.find((b) => b.name.includes("Operator")) ?? lookups.bots[0];
  const financeBot = lookups.bots.find((b) => b.name.includes("Finance")) ?? lookups.bots[0];

  async function save() {
    if (!orderId) return;
    setBusy(true);
    setError("");
    try {
      const target = orders.find((o) => o.id === orderId);
      if (target && target.status !== "confirmed") {
        if (target.status === "draft") {
          await rpc.erp.orders.requestApproval({
            id: target.id,
            ...(opsBot ? { actorBotId: opsBot.id } : {}),
          });
        }
        if (target.status !== "approved") {
          await rpc.erp.orders.approve({
            id: target.id,
            ...(operatorBot ? { actorBotId: operatorBot.id } : {}),
          });
        }
        await rpc.erp.orders.confirm({
          id: target.id,
          ...(opsBot ? { actorBotId: opsBot.id } : {}),
        });
      }
      const days = Math.max(0, Number.parseInt(netDays, 10) || 14);
      const dueAt = new Date(Date.now() + days * 86_400_000).toISOString();
      const draft = await rpc.erp.invoices.createDraft({
        orderId,
        dueAt,
        ...(financeBot ? { actorBotId: financeBot.id } : {}),
      });
      if (issueImmediately) {
        await rpc.erp.invoices.issue({
          id: draft.id,
          ...(financeBot ? { actorBotId: financeBot.id } : {}),
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
      title={t`Generate Tax Invoice`}
      onClose={onClose}
      onSubmit={save}
      busy={busy}
      submitLabel={issueImmediately ? t`Create & Issue Invoice` : t`Create Draft Invoice`}
      disabled={!orderId}
      error={error}
    >
      <FormField id={`${formId}-order`} label={t`Source Sales Order`} required>
        <NativeSelect
          id={`${formId}-order`}
          className="w-full"
          value={orderId}
          onChange={(e) => setOrderId(e.target.value)}
        >
          <NativeSelectOption value="">{t`Select uninvoiced Sales Order…`}</NativeSelectOption>
          {orders.map((order) => (
            <NativeSelectOption key={order.id} value={order.id}>
              {order.ref} · {customerName(order) || t`Customer`} ({money(order.subtotal)} ·{" "}
              {order.status})
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </FormField>
      <FormField id={`${formId}-terms`} label={t`Payment Terms (Days Until Due)`}>
        <NativeSelect
          id={`${formId}-terms`}
          className="w-full"
          value={netDays}
          onChange={(e) => setNetDays(e.target.value)}
        >
          <NativeSelectOption value="0">{t`Due on Receipt`}</NativeSelectOption>
          <NativeSelectOption value="7">{t`Net 7 Days`}</NativeSelectOption>
          <NativeSelectOption value="14">{t`Net 14 Days`}</NativeSelectOption>
          <NativeSelectOption value="30">{t`Net 30 Days`}</NativeSelectOption>
          <NativeSelectOption value="45">{t`Net 45 Days`}</NativeSelectOption>
        </NativeSelect>
      </FormField>
      <div className="rounded-lg border px-3">
        <SwitchField
          id={`${formId}-issue-now`}
          checked={issueImmediately}
          onChange={setIssueImmediately}
          label={t`Issue invoice immediately to customer ledger`}
        />
      </div>
    </FormDialog>
  );
}

// --- Financial Governance, Currency & Tax Classification Master --------------

function ComplianceSection({ lookups, currency, reload, onError }: SectionProps) {
  const { t } = useLingui();
  const money = useMoney(currency);
  const [editingHsn, setEditingHsn] = useState<Record<string, string>>({});
  const [editingPrice, setEditingPrice] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [standardizing, setStandardizing] = useState(false);
  const settings = lookups.settings;

  const stewardBot =
    lookups.bots.find((b) => b.name.includes("Steward")) ??
    lookups.bots.find((b) => b.name.includes("Finance")) ??
    lookups.bots[0];

  async function saveItemRow(product: ErpProduct) {
    const nextHsn = (editingHsn[product.id] ?? product.hsnCode ?? "998314").trim();
    const rawPrice = editingPrice[product.id];
    const nextPrice =
      rawPrice !== undefined ? (parseMoneyInput(rawPrice) ?? product.unitPrice) : product.unitPrice;
    setSavingId(product.id);
    try {
      await rpc.erp.products.update({
        id: product.id,
        hsnCode: nextHsn || null,
        unitPrice: nextPrice,
      });
      reload();
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setSavingId(null);
    }
  }

  async function standardizeAllTaxCodes() {
    setStandardizing(true);
    try {
      for (const product of lookups.products) {
        if (!product.hsnCode || product.hsnCode.trim().length < 4) {
          await rpc.erp.products.update({
            id: product.id,
            hsnCode: "998314",
            ...(stewardBot ? { actorBotId: stewardBot.id } : {}),
          });
        }
      }
      reload();
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setStandardizing(false);
    }
  }

  async function toggleSetting(patch: Partial<BusinessSettings>) {
    if (!settings) return;
    try {
      await rpc.business.updateSettings(patch);
      reload();
    } catch (cause) {
      onError(errorText(cause));
    }
  }

  const classifiedCount = lookups.products.filter((p) =>
    Boolean(p.hsnCode && p.hsnCode.trim().length >= 4),
  ).length;

  return (
    <div className="space-y-6" data-testid="erp-compliance">
      {/* Top Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 shadow-2xs">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg border bg-muted/60 text-foreground">
            <ShieldCheck className="size-4" strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">
              <Trans>Financial Governance, Approval Policies & Tax Classification Master</Trans>
            </h2>
            <p className="text-xs text-muted-foreground">
              <Trans>
                Configure workspace currency, inventory guardrails, human-in-the-loop approval
                gates, and SKU tax classifications.
              </Trans>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={standardizing}
            onClick={() => void standardizeAllTaxCodes()}
          >
            <Sparkles data-icon="inline-start" />
            {standardizing ? (
              <Trans>Standardizing Tax Codes…</Trans>
            ) : (
              <Trans>AI Steward: Standardize Tax Codes</Trans>
            )}
          </Button>
          <Link
            to={crmHref("agents")}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent"
          >
            <LayoutGrid className="size-3.5 text-muted-foreground" aria-hidden="true" />
            <Trans>Agent Workforce & Approvals</Trans>
          </Link>
        </div>
      </div>

      {/* Governance Policies + Audit Readiness */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            <Trans>Selling, Billing & Inventory Governance</Trans>
          </h3>
          {settings ? (
            <div className="divide-y rounded-xl border bg-card px-4 py-2 shadow-2xs">
              <div className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <div>
                  <div className="font-medium">
                    <Trans>Operating Currency</Trans>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <Trans>Applied to Catalog Pricing, Deals, Sales Orders, and Invoices</Trans>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {(["USD", "EUR", "GBP", "INR"] as const).map((code) => (
                    <button
                      key={code}
                      type="button"
                      onClick={() => void toggleSetting({ currency: code })}
                      className={cn(
                        "rounded-md border px-2.5 py-1 font-mono text-xs font-semibold transition-colors",
                        settings.currency === code
                          ? "border-foreground bg-foreground text-background"
                          : "bg-muted/40 text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {code}
                    </button>
                  ))}
                </div>
              </div>
              <SwitchField
                id="erp-allow-negative"
                checked={settings.allowNegativeStock}
                onChange={(checked) => void toggleSetting({ allowNegativeStock: checked })}
                label={t`Allow negative warehouse stock balances on order confirmation`}
              />
              <SwitchField
                id="erp-order-approval"
                checked={settings.orderApprovalRequired}
                onChange={(checked) => void toggleSetting({ orderApprovalRequired: checked })}
                label={t`Require manager approval before confirming Sales Orders`}
              />
              <SwitchField
                id="erp-invoice-approval"
                checked={settings.invoiceApprovalRequired}
                onChange={(checked) => void toggleSetting({ invoiceApprovalRequired: checked })}
                label={t`Require manager approval before issuing customer Tax Invoices`}
              />
            </div>
          ) : (
            <Skeleton className="h-44 rounded-xl" />
          )}
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            <Trans>Digital Employee Guardrails & Compliance Summary</Trans>
          </h3>
          <div className="rounded-xl border bg-card p-4 space-y-3 shadow-2xs">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border bg-muted/20 p-3">
                <span className="block text-xs text-muted-foreground">
                  <Trans>Tax / HSN Coverage</Trans>
                </span>
                <span className="mt-1 block text-base font-semibold tabular-nums">
                  {classifiedCount} / {lookups.products.length} {t`SKUs`}
                </span>
              </div>
              <div className="rounded-lg border bg-muted/20 p-3">
                <span className="block text-xs text-muted-foreground">
                  <Trans>Provisioned AI Specialists</Trans>
                </span>
                <span className="mt-1 block text-base font-semibold tabular-nums">
                  {lookups.bots.length} {t`Active Bots`}
                </span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              <Trans>
                When approval gates are enabled above, AI Digital Employees (Operations and Finance)
                can draft Sales Orders and Tax Invoices autonomously, while final confirmation and
                issuance are routed to the Human-in-the-Loop Governance Queue.
              </Trans>
            </p>
          </div>
        </div>
      </div>

      {/* Catalog Tax Classification & Price Book Table */}
      <section className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              <Trans>Catalog Tax Classification & Standard Price Book</Trans>
            </h3>
            <p className="text-xs text-muted-foreground">
              <Trans>
                Inline master editor for SKU tax/HSN codes and standard selling prices across all
                active and inactive items.
              </Trans>
            </p>
          </div>
          <StatusBadge tone="success">
            <Trans>Tax & Price Book Active</Trans>
          </StatusBadge>
        </div>

        <div className="overflow-x-auto rounded-xl border bg-card shadow-2xs">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                <th className="py-2.5 ps-4 pe-2 text-start font-medium">
                  <Trans>SKU</Trans>
                </th>
                <th className="px-2 py-2.5 text-start font-medium">
                  <Trans>Item Name</Trans>
                </th>
                <th className="px-2 py-2.5 text-start font-medium">
                  <Trans>Tax / HSN-SAC Code</Trans>
                </th>
                <th className="px-2 py-2.5 text-end font-medium">
                  <Trans>On Hand</Trans>
                </th>
                <th className="px-2 py-2.5 text-end font-medium">
                  <Trans>Unit Selling Price ({currency})</Trans>
                </th>
                <th className="py-2.5 ps-2 pe-4 text-end font-medium">
                  <Trans>Save</Trans>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {lookups.products.map((product) => {
                const hsnValue = editingHsn[product.id] ?? product.hsnCode ?? "998314";
                const priceValue = editingPrice[product.id] ?? String(product.unitPrice);
                return (
                  <tr key={product.id}>
                    <td className="py-2.5 ps-4 pe-2 font-mono text-xs font-medium">
                      {product.sku}
                    </td>
                    <td className="px-2 py-2.5 font-medium">{product.name}</td>
                    <td className="px-2 py-2.5">
                      <Input
                        value={hsnValue}
                        onChange={(event) =>
                          setEditingHsn((prev) => ({
                            ...prev,
                            [product.id]: event.target.value,
                          }))
                        }
                        className="h-7 w-32 font-mono text-xs"
                        maxLength={12}
                      />
                    </td>
                    <td className="px-2 py-2.5 text-end tabular-nums">
                      <StockCount value={product.stockOnHand} active={product.active} />
                    </td>
                    <td className="px-2 py-2.5 text-end">
                      <div className="inline-flex items-center justify-end gap-2">
                        <Input
                          inputMode="decimal"
                          value={priceValue}
                          onChange={(event) =>
                            setEditingPrice((prev) => ({
                              ...prev,
                              [product.id]: event.target.value,
                            }))
                          }
                          className="h-7 w-28 text-end font-mono text-xs"
                        />
                        <span className="hidden text-xs text-muted-foreground sm:inline">
                          ({money(product.unitPrice)})
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 ps-2 pe-4 text-end">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={savingId === product.id}
                        onClick={() => void saveItemRow(product)}
                      >
                        <Trans>Save</Trans>
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
