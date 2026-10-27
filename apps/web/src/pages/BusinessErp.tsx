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
  OrderStatus,
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
  CircleCheck,
  ClipboardCheck,
  LayoutGrid,
  PackageX,
  Plus,
  ReceiptText,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  TrendingUp,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AskRowButton } from "../components/business/assistant";
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
import { EnvironmentCard } from "../components/business/environment";
import {
  FieldRow,
  FormDialog,
  FormField,
  parseMoneyInput,
  SwitchField,
} from "../components/business/forms";
import {
  frappeInvoiceDocName,
  frappeOrderDocName,
  SavingroupCustomFieldsSection,
} from "../components/business/frappe-crm";
import type { Column } from "../components/business/records";
import {
  ActorLabel,
  actorName,
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
      rpc.crm.companies.list({ limit: 200 }),
      rpc.crm.contacts.list({ limit: 200 }),
      rpc.crm.deals.list({ limit: 200 }),
      rpc.business.settings(),
      rpc.business.environment.get().catch(() => null),
    ])
      .then(([products, companies, contacts, deals, settings, environment]) => {
        if (!active) return;
        setLookups((previous) => ({
          ...previous,
          products: products.products,
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
  const orderStatuses = useOrderStatusLabels();
  const invoiceStatuses = useInvoiceStatusLabels();
  const payments = usePaymentStatusLabels();
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
  const currency = overview?.currency ?? "USD";
  const money = useMoney(currency);
  const short = useShortMoney(currency);
  const compact = useShortMoney(currency, 0);

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
      <EnvironmentCard onChanged={reload} />
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

function ProductsSection({ lookups, loading, currency, revision, reload }: SectionProps) {
  const { t } = useLingui();
  const money = useMoney(currency);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useOpenRecord();
  const [creating, setCreating] = useState(false);
  const open = openId ? lookups.products.find((product) => product.id === openId) : undefined;
  const columns: Column<ErpProduct>[] = [
    {
      key: "product",
      header: t`Item (Item Code · Name)`,
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
      header: t`HSN/SAC (gst_hsn_code)`,
      hideBelow: "md",
      render: (row) => (
        <span className="font-mono text-xs text-muted-foreground">{row.hsnCode ?? "998314"}</span>
      ),
    },
    {
      key: "price",
      header: t`Standard Selling`,
      align: "end",
      render: (row) => money(row.unitPrice),
    },
    {
      key: "stock",
      header: t`On hand (Bin)`,
      align: "end",
      render: (row) => <StockCount value={row.stockOnHand} active={row.active} />,
    },
  ];
  const hsnRequired =
    lookups.environment?.status === "active" && lookups.environment.blueprintId === "india-smb";
  const newProduct = (
    <NewButton onClick={() => setCreating(true)}>
      <Trans>New product</Trans>
    </NewButton>
  );
  return (
    <>
      <Toolbar action={newProduct}>
        <SearchField value={query} onChange={setQuery} />
      </Toolbar>
      <RecordTable
        testId="erp-products"
        columns={columns}
        rows={lookups.products.filter((row) =>
          matchesQuery(query, row.sku, row.name, row.description, row.hsnCode),
        )}
        loading={loading}
        onRowClick={(row) => setOpenId(row.id)}
        rowClassName={(row) => (row.active ? undefined : "text-muted-foreground")}
        rowAction={(row) => (
          <AskRowButton record={{ kind: "product", ref: row.sku, name: row.name }} />
        )}
        filtered={Boolean(query)}
        empty={t`No products yet`}
        emptyIcon={Boxes}
        emptyAction={newProduct}
      />
      {creating ? (
        <ProductDialog
          key="new"
          product={null}
          revision={revision}
          onClose={() => setCreating(false)}
          onSaved={reload}
          hsnRequired={hsnRequired}
        />
      ) : open ? (
        <ProductDialog
          key={open.id}
          product={open}
          revision={revision}
          onClose={() => setOpenId(null)}
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
    <FormField id={`${formId}-hsn`} label={t`HSN/SAC code (gst_hsn_code)`} required={hsnRequired}>
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

function InventorySection({ lookups, loading, revision, reload, onError }: SectionProps) {
  const { t } = useLingui();
  const [query, setQuery] = useState("");
  const [adjusting, setAdjusting] = useState<ErpProduct | null>(null);
  const { value: adjustments } = useBusinessList(
    () => rpc.erp.inventory.adjustments({ limit: 50 }),
    [revision],
    onError,
    [] as InventoryAdjustment[],
  );
  const columns: Column<ErpProduct>[] = [
    {
      key: "product",
      header: t`Product`,
      render: (row) => <PrimaryCell refText={row.sku} title={row.name} />,
    },
    {
      key: "stock",
      header: t`On hand`,
      align: "end",
      render: (row) => <StockCount value={row.stockOnHand} />,
    },
    {
      key: "adjust",
      header: "",
      align: "end",
      className: "w-0",
      render: (row) => (
        <Button variant="outline" size="sm" onClick={() => setAdjusting(row)}>
          <Trans>Adjust</Trans>
        </Button>
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
      <Toolbar>
        <SearchField value={query} onChange={setQuery} />
      </Toolbar>
      <RecordTable
        testId="erp-inventory"
        columns={columns}
        rows={lookups.products.filter(
          (product) => product.active && matchesQuery(query, product.sku, product.name),
        )}
        loading={loading}
        rowAction={(row) => (
          <AskRowButton record={{ kind: "product", ref: row.sku, name: row.name }} />
        )}
        filtered={Boolean(query)}
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
  const statuses = useOrderStatusLabels();
  const money = useMoney(currency);
  const [status, setStatus] = useStatusFilter(ORDER_STATUSES);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useOpenRecord();
  const [creating, setCreating] = useState(false);
  const { value: orders, loading } = useBusinessList(
    () =>
      rpc.erp.orders
        .list({ ...(status ? { status } : {}), limit: 200 })
        .then((result) => result.orders),
    [revision, status],
    onError,
    [] as ErpSalesOrder[],
  );
  const columns: Column<ErpSalesOrder>[] = [
    {
      key: "order",
      header: t`Sales Order`,
      render: (row) => (
        <PrimaryCell
          refText={`${frappeOrderDocName(row)} · ${row.ref}`}
          title={customerName(row) || "—"}
          detail={money(row.subtotal)}
          detailWhile="sm"
        />
      ),
    },
    {
      key: "status",
      header: t`Status`,
      render: (row) => (
        <StatusBadge tone={ORDER_STATUS_TONES[row.status]}>{statuses[row.status]}</StatusBadge>
      ),
    },
    {
      key: "subtotal",
      header: t`Subtotal`,
      align: "end",
      hideBelow: "sm",
      render: (row) => money(row.subtotal),
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
  ];
  const newOrder = (
    <NewButton onClick={() => setCreating(true)}>
      <Trans>New order</Trans>
    </NewButton>
  );
  return (
    <>
      <Toolbar
        action={newOrder}
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
        <NewOrderDialog lookups={lookups} onClose={() => setCreating(false)} onSaved={reload} />
      ) : openId ? (
        <OrderDialog
          key={openId}
          orderId={openId}
          lookups={lookups}
          currency={currency}
          revision={revision}
          onClose={() => setOpenId(null)}
          onChanged={reload}
        />
      ) : null}
    </>
  );
}

function NewOrderDialog({
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
  const [companyId, setCompanyId] = useState("");
  const [contactId, setContactId] = useState("");
  const [dealId, setDealId] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setBusy(true);
    setError("");
    try {
      await rpc.erp.orders.createDraft({
        ...(companyId ? { companyId } : {}),
        ...(contactId ? { contactId } : {}),
        ...(dealId ? { dealId } : {}),
        ...(notes ? { notes } : {}),
        lines: [],
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
      title={t`New order`}
      onClose={onClose}
      onSubmit={save}
      busy={busy}
      submitLabel={t`Create draft`}
      error={error}
    >
      <FieldRow>
        <FormField id={`${formId}-company`} label={t`Customer`}>
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
      <FormField id={`${formId}-deal`} label={t`Deal`}>
        <NativeSelect
          className="w-full"
          id={`${formId}-deal`}
          value={dealId}
          onChange={(event) => setDealId(event.target.value)}
        >
          <NativeSelectOption value="">{t`None`}</NativeSelectOption>
          {lookups.deals
            .filter((deal) => deal.stage !== "lost")
            .map((deal) => (
              <NativeSelectOption key={deal.id} value={deal.id}>
                {deal.ref} · {deal.title}
              </NativeSelectOption>
            ))}
        </NativeSelect>
      </FormField>
      <FormField id={`${formId}-notes`} label={t`Notes`}>
        <Textarea
          id={`${formId}-notes`}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          maxLength={BUSINESS_TEXT_MAX_LENGTH}
        />
      </FormField>
    </FormDialog>
  );
}

/** Where the order is in draft → approval → confirmation; skipped steps stay hollow. */
function OrderProgress({ order }: { order: ErpSalesOrder }) {
  const statuses = useOrderStatusLabels();
  const steps: { status: OrderStatus; reached: boolean }[] = [
    { status: "draft", reached: true },
    { status: "pending_approval", reached: Boolean(order.approvalRequestedAt) },
    { status: "approved", reached: Boolean(order.approvedAt) },
    { status: "confirmed", reached: Boolean(order.confirmedAt) },
  ];
  return (
    <ol aria-hidden="true" className="flex items-start">
      {steps.map((step, index) => {
        const current = step.status === order.status;
        return (
          <li
            key={step.status}
            className="relative flex min-w-0 flex-1 flex-col items-center gap-1.5"
          >
            {index > 0 ? (
              <span
                className={cn(
                  "absolute inset-e-1/2 top-1.25 h-px w-full",
                  step.reached ? "bg-foreground/40" : "bg-border",
                )}
              />
            ) : null}
            <span
              className={cn(
                "relative z-10 size-2.75 rounded-full border-2",
                step.reached ? "border-foreground bg-foreground" : "border-border bg-popover",
                current && "ring-4 ring-foreground/15",
              )}
            />
            <span
              className={cn(
                "px-1 text-center text-xs leading-tight",
                current ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {statuses[step.status]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

type Line = {
  id: string;
  sku?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

function LinesTable({
  testId,
  lines,
  money,
  totals,
  onRemove,
  busy = false,
}: {
  testId: string;
  lines: Line[];
  money: (amount: number) => string;
  totals: { label: string; amount: number; strong?: boolean }[];
  onRemove?: (line: Line) => void;
  busy?: boolean;
}) {
  const { t } = useLingui();
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm" data-testid={testId}>
        <thead>
          <tr className="border-b text-xs text-muted-foreground">
            <th scope="col" className="h-8 ps-3 pe-2 text-start font-medium">
              <Trans>Product</Trans>
            </th>
            <th scope="col" className="px-2 text-end font-medium">
              <Trans>Qty</Trans>
            </th>
            <th scope="col" className="hidden px-2 text-end font-medium sm:table-cell">
              <Trans>Unit price</Trans>
            </th>
            <th scope="col" className="ps-2 pe-3 text-end font-medium">
              <Trans>Total</Trans>
            </th>
            {onRemove ? <th scope="col" className="w-0" /> : null}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id} className="border-b">
              <td className="py-2 ps-3 pe-2">
                {line.sku ? (
                  <div className="font-mono text-xs text-muted-foreground">{line.sku}</div>
                ) : null}
                <div className="min-w-32">{line.description}</div>
                <div className="text-xs text-muted-foreground tabular-nums sm:hidden">
                  {money(line.unitPrice)}
                </div>
              </td>
              <td className="px-2 py-2 text-end tabular-nums">{line.quantity}</td>
              <td className="hidden px-2 py-2 text-end whitespace-nowrap tabular-nums sm:table-cell">
                {money(line.unitPrice)}
              </td>
              <td className="py-2 ps-2 pe-3 text-end font-medium whitespace-nowrap tabular-nums">
                {money(line.lineTotal)}
              </td>
              {onRemove ? (
                <td className="pe-2 text-end">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={busy}
                    aria-label={t`Remove`}
                    title={t`Remove`}
                    onClick={() => onRemove(line)}
                  >
                    <X />
                  </Button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
        <tfoot>
          {totals.map((total) => (
            <tr
              key={total.label}
              className={cn(total.strong ? "font-semibold" : "text-muted-foreground")}
            >
              <td className="py-2 ps-3 pe-2" colSpan={2}>
                {total.label}
              </td>
              <td className="hidden sm:table-cell" />
              <td className="py-2 ps-2 pe-3 text-end whitespace-nowrap tabular-nums">
                {money(total.amount)}
              </td>
              {onRemove ? <td /> : null}
            </tr>
          ))}
        </tfoot>
      </table>
    </div>
  );
}

function OrderDialog({
  orderId,
  lookups,
  currency,
  revision,
  onClose,
  onChanged,
}: {
  orderId: string;
  lookups: Lookups;
  currency: string;
  revision: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useLingui();
  const formId = useId();
  const statuses = useOrderStatusLabels();
  const money = useMoney(currency);
  const [order, setOrder] = useState<ErpSalesOrder | null>(null);
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [localRevision, setLocalRevision] = useState(0);

  useEffect(() => {
    let active = true;
    void rpc.erp.orders
      .get({ id: orderId })
      .then((row) => {
        if (active) setOrder(row);
      })
      .catch((cause) => {
        if (active) setError(errorText(cause));
      });
    return () => {
      active = false;
    };
  }, [orderId, revision, localRevision]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      setLocalRevision((previous) => previous + 1);
      onChanged();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  if (!order) {
    return (
      <FormDialog
        title={t`Order`}
        size="lg"
        onClose={onClose}
        busy={false}
        submitLabel=""
        error={error}
      >
        <div className="space-y-3">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-24 w-full" />
        </div>
      </FormDialog>
    );
  }
  const draft = order.status === "draft";
  const ref = { id: order.id };
  const open = order.status !== "confirmed" && order.status !== "cancelled";
  const canConfirm =
    order.status === "approved" ||
    (open && lookups.settings?.orderApprovalRequired === false && order.lines.length > 0);
  const quantityValue = Number.parseInt(quantity, 10);
  return (
    <FormDialog
      title={
        customerName(order)
          ? `${frappeOrderDocName(order)} · ${order.ref} · ${customerName(order)}`
          : `${frappeOrderDocName(order)} · ${order.ref}`
      }
      size="lg"
      meta={
        <>
          <StatusBadge tone={ORDER_STATUS_TONES[order.status]}>
            {statuses[order.status]}
          </StatusBadge>
          {order.invoiceId ? (
            <StatusBadge tone="neutral">
              <Trans>Invoiced</Trans>
            </StatusBadge>
          ) : null}
        </>
      }
      onClose={onClose}
      busy={busy}
      submitLabel=""
      error={error}
      history={{ recordType: "order", recordId: order.id, revision: revision + localRevision }}
      ask={{ kind: "order", ref: order.ref, name: customerName(order), status: order.status }}
      site={{ kind: "order", id: order.id }}
      actions={
        <>
          {open ? (
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => run(() => rpc.erp.orders.cancel(ref))}
            >
              <Trans>Cancel order</Trans>
            </Button>
          ) : null}
          {draft && order.lines.length > 0 ? (
            <Button disabled={busy} onClick={() => run(() => rpc.erp.orders.requestApproval(ref))}>
              <Trans>Request approval</Trans>
            </Button>
          ) : null}
          {order.status === "pending_approval" ? (
            <Button disabled={busy} onClick={() => run(() => rpc.erp.orders.approve(ref))}>
              <Trans>Approve</Trans>
            </Button>
          ) : null}
          {canConfirm ? (
            <Button disabled={busy} onClick={() => run(() => rpc.erp.orders.confirm(ref))}>
              <Trans>Confirm</Trans>
            </Button>
          ) : null}
          {order.status === "confirmed" && !order.invoiceId ? (
            <Button
              disabled={busy}
              onClick={() => run(() => rpc.erp.invoices.createDraft({ orderId: order.id }))}
            >
              <Trans>Create draft invoice</Trans>
            </Button>
          ) : null}
        </>
      }
    >
      {order.status !== "cancelled" ? <OrderProgress order={order} /> : null}
      {order.notes ? <p className="text-sm text-muted-foreground">{order.notes}</p> : null}
      <LinesTable
        testId="order-lines"
        lines={order.lines}
        money={money}
        busy={busy}
        totals={[{ label: t`Subtotal`, amount: order.subtotal, strong: true }]}
        onRemove={
          draft
            ? (line) => run(() => rpc.erp.orders.removeItem({ orderId: order.id, lineId: line.id }))
            : undefined
        }
      />
      {draft ? (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed p-3">
          <FormField id={`${formId}-product`} label={t`Product`} className="min-w-48 flex-1">
            <NativeSelect
              className="w-full"
              id={`${formId}-product`}
              value={productId}
              onChange={(event) => setProductId(event.target.value)}
            >
              <NativeSelectOption value="">{t`Choose…`}</NativeSelectOption>
              {lookups.products
                .filter((product) => product.active)
                .map((product) => (
                  <NativeSelectOption key={product.id} value={product.id}>
                    {product.sku} · {product.name}
                  </NativeSelectOption>
                ))}
            </NativeSelect>
          </FormField>
          <FormField id={`${formId}-qty`} label={t`Qty`} className="w-20">
            <Input
              id={`${formId}-qty`}
              inputMode="numeric"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </FormField>
          <Button
            variant="outline"
            disabled={busy || !productId || !(quantityValue > 0)}
            onClick={() =>
              run(() =>
                rpc.erp.orders.addItem({ orderId: order.id, productId, quantity: quantityValue }),
              )
            }
          >
            <Plus data-icon="inline-start" aria-hidden="true" />
            <Trans>Add line</Trans>
          </Button>
        </div>
      ) : null}
      <SavingroupCustomFieldsSection
        recordType="order"
        recordId={order.id}
        legacyRef={order.ref}
        createdBy={order.createdBy}
        extra={[
          { label: t`Approval status (savingroup_approval_status)`, value: order.status },
          { label: t`Source Deal (savingroup_deal)`, value: order.dealId ?? "—" },
        ]}
      />
      <p className="text-xs text-muted-foreground">
        {actorName(order.createdBy)} · {formatRelativeTime(order.createdAt)}
        {order.approvedAt ? ` · ${t`approved by`} ${actorName(order.approvedBy)}` : ""}
      </p>
    </FormDialog>
  );
}

// --- Invoices ----------------------------------------------------------------

function InvoicesSection({ currency, revision, reload, onError }: SectionProps) {
  const { t } = useLingui();
  const statuses = useInvoiceStatusLabels();
  const payments = usePaymentStatusLabels();
  const money = useMoney(currency);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useOpenRecord();
  const { value: invoices, loading } = useBusinessList(
    () => rpc.erp.invoices.list({ limit: 200 }).then((result) => result.invoices),
    [revision],
    onError,
    [] as ErpInvoice[],
  );
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
      key: "total",
      header: t`Grand Total`,
      align: "end",
      render: (row) => money(row.total),
    },
  ];
  return (
    <>
      <Toolbar>
        <SearchField value={query} onChange={setQuery} />
      </Toolbar>
      <RecordTable
        testId="erp-invoices"
        columns={columns}
        rows={invoices.filter((row) =>
          matchesQuery(query, row.ref, frappeInvoiceDocName(row), row.orderRef, row.companyName),
        )}
        loading={loading}
        onRowClick={(row) => setOpenId(row.id)}
        rowAction={(row) => (
          <AskRowButton
            record={{ kind: "invoice", ref: row.ref, name: row.companyName, status: row.status }}
          />
        )}
        filtered={Boolean(query)}
        empty={t`No invoices yet`}
        emptyIcon={ReceiptText}
      />
      {openId ? (
        <InvoiceDialog
          key={openId}
          invoiceId={openId}
          currency={currency}
          revision={revision}
          onClose={() => setOpenId(null)}
          onChanged={reload}
        />
      ) : null}
    </>
  );
}

function InvoiceDialog({
  invoiceId,
  currency,
  revision,
  onClose,
  onChanged,
}: {
  invoiceId: string;
  currency: string;
  revision: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useLingui();
  const formId = useId();
  const statuses = useInvoiceStatusLabels();
  const payments = usePaymentStatusLabels();
  const money = useMoney(currency);
  const [invoice, setInvoice] = useState<ErpInvoice | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [localRevision, setLocalRevision] = useState(0);
  useEffect(() => {
    let active = true;
    void rpc.erp.invoices
      .get({ id: invoiceId })
      .then((row) => {
        if (active) setInvoice(row);
      })
      .catch((cause) => {
        if (active) setError(errorText(cause));
      });
    return () => {
      active = false;
    };
  }, [invoiceId, revision, localRevision]);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      setLocalRevision((previous) => previous + 1);
      onChanged();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  if (!invoice) {
    return (
      <FormDialog
        title={t`Invoice`}
        size="lg"
        onClose={onClose}
        busy={false}
        submitLabel=""
        error={error}
      >
        <div className="space-y-3">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-24 w-full" />
        </div>
      </FormDialog>
    );
  }
  const outstanding = Math.round((invoice.total - invoice.amountPaid) * 100) / 100;
  const parsedAmount = parseMoneyInput(amount);
  const paidShare = invoice.total > 0 ? Math.min(1, invoice.amountPaid / invoice.total) : 0;
  return (
    <FormDialog
      title={
        invoice.companyName
          ? `${frappeInvoiceDocName(invoice)} · ${invoice.ref} · ${invoice.companyName}`
          : `${frappeInvoiceDocName(invoice)} · ${invoice.ref}`
      }
      size="lg"
      meta={
        <>
          <StatusBadge tone={INVOICE_STATUS_TONES[invoice.status]}>
            {statuses[invoice.status]}
          </StatusBadge>
          <StatusBadge tone={paymentTone(invoice)}>{payments[invoice.paymentStatus]}</StatusBadge>
          <span className="font-mono text-xs">{invoice.orderRef}</span>
        </>
      }
      onClose={onClose}
      busy={busy}
      submitLabel=""
      error={error}
      history={{ recordType: "invoice", recordId: invoice.id, revision: revision + localRevision }}
      site={{ kind: "invoice", id: invoice.id }}
      ask={{
        kind: "invoice",
        ref: invoice.ref,
        name: invoice.companyName,
        status: invoice.status,
      }}
      actions={
        invoice.status === "draft" ? (
          <Button
            disabled={busy}
            onClick={() => run(() => rpc.erp.invoices.issue({ id: invoice.id }))}
          >
            <Trans>Issue</Trans>
          </Button>
        ) : invoice.status === "issued" ? (
          <div className="flex w-full flex-wrap items-end justify-end gap-2">
            <FormField id={`${formId}-amount`} label={t`Payment amount`} className="w-36">
              <Input
                id={`${formId}-amount`}
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder={String(outstanding)}
              />
            </FormField>
            <Button
              disabled={busy || !(parsedAmount !== undefined && parsedAmount > 0)}
              onClick={() =>
                run(() =>
                  rpc.erp.invoices.recordPayment({ id: invoice.id, amount: parsedAmount ?? 0 }),
                )
              }
            >
              <Trans>Record payment</Trans>
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-2 rounded-lg border p-3">
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">
              <Trans>Total</Trans>
            </dt>
            <dd className="mt-0.5 truncate font-semibold tabular-nums">{money(invoice.total)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">
              <Trans>Paid</Trans>
            </dt>
            <dd className="mt-0.5 truncate tabular-nums">{money(invoice.amountPaid)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">
              <Trans>Outstanding</Trans>
            </dt>
            <dd
              className={cn(
                "mt-0.5 truncate tabular-nums",
                invoice.status === "issued" && outstanding > 0 && "font-medium dark:text-warning",
              )}
            >
              {money(Math.max(0, outstanding))}
            </dd>
          </div>
        </dl>
        <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-foreground/8">
          <div
            className="h-full rounded-full bg-success"
            style={{ width: `${paidShare * 100}%` }}
          />
        </div>
      </div>
      <LinesTable
        testId="invoice-lines"
        lines={invoice.lines}
        money={money}
        totals={[{ label: t`Total`, amount: invoice.total, strong: true }]}
      />
      <SavingroupCustomFieldsSection
        recordType="invoice"
        recordId={invoice.id}
        legacyRef={invoice.ref}
        createdBy={invoice.createdBy}
        extra={[
          { label: t`Sales Order (savingroup_order_ref)`, value: invoice.orderRef },
          { label: t`Payment Status`, value: invoice.paymentStatus },
        ]}
      />
      <p className="text-xs text-muted-foreground">
        {actorName(invoice.createdBy)} · {formatRelativeTime(invoice.createdAt)}
        {invoice.issuedAt ? ` · ${t`issued by`} ${actorName(invoice.approvedBy)}` : ""}
      </p>
    </FormDialog>
  );
}

// --- Gateway, Bridge Settings & India Compliance (GST / HSN) -----------------

function ComplianceSection({ lookups, currency, reload, onError }: SectionProps) {
  const { t } = useLingui();
  const money = useMoney(currency);
  const [editingHsn, setEditingHsn] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const settings = lookups.settings;

  async function saveItemHsn(product: ErpProduct) {
    const nextHsn = (editingHsn[product.id] ?? product.hsnCode ?? "998314").trim();
    setSavingId(product.id);
    try {
      await rpc.erp.products.update({
        id: product.id,
        hsnCode: nextHsn || null,
      });
      reload();
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setSavingId(null);
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
              <Trans>Savingroup Bridge Settings & India Compliance (GST / HSN)</Trans>
            </h2>
            <p className="text-xs text-muted-foreground">
              <Trans>
                ERPNext v16.51.1 · Frappe CRM v1.88.0 · India Compliance v16.10.1 ·
                savingroup_business_bridge v0.1.0 (100% Native Runtime — Zero Docker)
              </Trans>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to={crmHref("workspace")}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent"
          >
            <LayoutGrid className="size-3.5 text-muted-foreground" aria-hidden="true" />
            <Trans>Open Savingroup Desk</Trans>
          </Link>
        </div>
      </div>

      {/* Bridge Settings + Stock/Selling Governance */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            <Trans>Savingroup Bridge Settings (savingroup_bridge_settings)</Trans>
          </h3>
          <EnvironmentCard onChanged={reload} />
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            <Trans>ERPNext Selling & Stock Settings</Trans>
          </h3>
          {settings ? (
            <div className="divide-y rounded-xl border bg-card px-4 py-2 shadow-2xs">
              <div className="flex items-center justify-between py-2.5 text-sm">
                <div>
                  <div className="font-medium">
                    <Trans>Default Company Currency</Trans>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <Trans>Used across Price Lists, Quotations, Sales Orders, and Invoices</Trans>
                  </div>
                </div>
                <span className="rounded-md border bg-muted/50 px-2.5 py-1 font-mono text-xs font-semibold">
                  {settings.currency}
                </span>
              </div>
              <SwitchField
                id="erp-allow-negative"
                checked={settings.allowNegativeStock}
                onChange={(checked) => void toggleSetting({ allowNegativeStock: checked })}
                label={t`Allow negative stock (Stock Settings → allow_negative_stock)`}
              />
              <SwitchField
                id="erp-order-approval"
                checked={settings.orderApprovalRequired}
                onChange={(checked) => void toggleSetting({ orderApprovalRequired: checked })}
                label={t`Sales Orders require human approval before submit`}
              />
              <SwitchField
                id="erp-invoice-approval"
                checked={settings.invoiceApprovalRequired}
                onChange={(checked) => void toggleSetting({ invoiceApprovalRequired: checked })}
                label={t`Sales Invoices require human approval before issue`}
              />
            </div>
          ) : (
            <Skeleton className="h-44 rounded-xl" />
          )}
        </div>
      </div>

      {/* GST / HSN/SAC Item Master Table */}
      <section className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              <Trans>GST HSN/SAC Code Master (Item · gst_hsn_code)</Trans>
            </h3>
            <p className="text-xs text-muted-foreground">
              <Trans>
                Matches blueprints/india-smb.json & handlers/erp.py (_ensure_gst_hsn_code default
                998314)
              </Trans>
            </p>
          </div>
          <StatusBadge tone="success">
            <Trans>India Compliance Ready</Trans>
          </StatusBadge>
        </div>

        <div className="overflow-x-auto rounded-xl border bg-card shadow-2xs">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                <th className="py-2.5 ps-4 pe-2 text-start font-medium">
                  <Trans>Item Code (SKU)</Trans>
                </th>
                <th className="px-2 py-2.5 text-start font-medium">
                  <Trans>Item Name</Trans>
                </th>
                <th className="px-2 py-2.5 text-start font-medium">
                  <Trans>HSN/SAC Code (gst_hsn_code)</Trans>
                </th>
                <th className="px-2 py-2.5 text-start font-medium">
                  <Trans>Default Warehouse</Trans>
                </th>
                <th className="px-2 py-2.5 text-end font-medium">
                  <Trans>Standard Selling</Trans>
                </th>
                <th className="py-2.5 ps-2 pe-4 text-end font-medium">
                  <Trans>Action</Trans>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {lookups.products.map((product) => {
                const value = editingHsn[product.id] ?? product.hsnCode ?? "998314";
                return (
                  <tr key={product.id}>
                    <td className="py-2.5 ps-4 pe-2 font-mono text-xs font-medium">
                      {product.sku}
                    </td>
                    <td className="px-2 py-2.5 font-medium">{product.name}</td>
                    <td className="px-2 py-2.5">
                      <Input
                        value={value}
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
                    <td className="px-2 py-2.5 font-mono text-xs text-muted-foreground">
                      Stores - SG
                    </td>
                    <td className="px-2 py-2.5 text-end tabular-nums">
                      {money(product.unitPrice)}
                    </td>
                    <td className="py-2.5 ps-2 pe-4 text-end">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={savingId === product.id}
                        onClick={() => void saveItemHsn(product)}
                      >
                        <Trans>Save HSN</Trans>
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
