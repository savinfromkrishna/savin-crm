// @vitest-environment jsdom

import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  business: {
    subscribe: vi.fn(),
    history: vi.fn(),
    settings: vi.fn(),
    environment: { get: vi.fn() },
  },
  bots: { list: vi.fn() },
  crm: {
    companies: { list: vi.fn() },
    contacts: { list: vi.fn() },
    deals: { list: vi.fn() },
  },
  erp: {
    overview: vi.fn(),
    products: { list: vi.fn() },
    inventory: { adjustments: vi.fn() },
    orders: { list: vi.fn(), get: vi.fn(), approve: vi.fn() },
    invoices: { list: vi.fn() },
  },
}));
vi.mock("../lib/rpc", () => ({ rpc: api }));
vi.mock("../lib/relative-time", () => ({ formatRelativeTime: () => "5m ago" }));
vi.mock("./WindowChrome", () => ({ WindowChrome: () => null }));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => text + part + String(values[index] ?? ""), "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});
vi.mock("@savingroup/ui-web", () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    BotAvatar: () => <span data-testid="bot-avatar" />,
    Button: (props: ComponentProps<"button"> & { render?: unknown }) => {
      const { render: _render, ...rest } = props;
      return <button type="button" {...rest} />;
    },
    cn: (...classes: unknown[]) => classes.filter(Boolean).join(" "),
    Dialog: Container,
    DialogContent: Container,
    DialogHeader: Container,
    DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
    Input: (props: ComponentProps<"input">) => <input {...props} />,
    Label: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
    NativeSelect: (props: ComponentProps<"select">) => <select {...props} />,
    NativeSelectOption: (props: ComponentProps<"option">) => <option {...props} />,
    Skeleton: () => <span data-testid="skeleton" />,
    Switch: () => null,
    Textarea: (props: ComponentProps<"textarea">) => <textarea {...props} />,
  };
});

import { ErpPage } from "./BusinessErp";

const operations = { userId: null, botId: "bot-ops", name: "Operations" };
const nobody = { userId: null, botId: null, name: null };
const now = new Date().toISOString();

const pendingOrder = {
  id: "order-2",
  spaceId: "space-1",
  number: 2,
  ref: "SO-2",
  status: "pending_approval",
  currency: "USD",
  subtotal: 77,
  notes: null,
  companyId: "company-1",
  companyName: "Acme",
  contactId: null,
  contactName: null,
  dealId: null,
  invoiceId: null,
  lines: [
    {
      id: "line-1",
      productId: "product-1",
      sku: "CTRL-200",
      description: "PLC controller",
      quantity: 2,
      unitPrice: 38.5,
      lineTotal: 77,
      position: 0,
    },
  ],
  approvalRequestedAt: now,
  approvedAt: null,
  approvedBy: nobody,
  confirmedAt: null,
  cancelledAt: null,
  createdBy: operations,
  createdAt: now,
  updatedAt: now,
};

function neverEnding() {
  return new Promise<AsyncIterable<unknown>>(() => {});
}

function mockPage() {
  api.business.subscribe.mockImplementation(neverEnding);
  api.business.history.mockResolvedValue([]);
  api.business.settings.mockResolvedValue({
    spaceId: "space-1",
    currency: "USD",
    allowNegativeStock: false,
    orderApprovalRequired: true,
    invoiceApprovalRequired: true,
    updatedAt: now,
  });
  api.business.environment.get.mockResolvedValue(null);
  api.bots.list.mockResolvedValue([{ id: "bot-ops", name: "Operations", color: "#F97316" }]);
  api.crm.companies.list.mockResolvedValue({ companies: [] });
  api.crm.contacts.list.mockResolvedValue({ contacts: [] });
  api.crm.deals.list.mockResolvedValue({ deals: [] });
  api.erp.products.list.mockResolvedValue({ products: [] });
  api.erp.overview.mockResolvedValue({
    products: 4,
    lowStockProducts: 1,
    draftOrders: 1,
    pendingApprovalOrders: 2,
    confirmedOrders: 3,
    confirmedOrderAmount: 1000,
    draftInvoices: 0,
    outstandingInvoiceAmount: 250,
    currency: "USD",
  });
  api.erp.orders.list.mockResolvedValue({ orders: [pendingOrder] });
  api.erp.orders.get.mockResolvedValue(pendingOrder);
  api.erp.orders.approve.mockResolvedValue({ ...pendingOrder, status: "approved" });
  api.erp.invoices.list.mockResolvedValue({ invoices: [] });
}

const confirmedOrder = {
  ...pendingOrder,
  id: "order-3",
  number: 3,
  ref: "SO-3",
  status: "confirmed",
  subtotal: 500,
  companyName: "Globex",
  lines: [{ ...pendingOrder.lines[0]!, quantity: 13, lineTotal: 500 }],
  confirmedAt: now,
};

const lowStockProduct = {
  id: "product-1",
  spaceId: "space-1",
  sku: "CTRL-200",
  name: "PLC controller",
  description: null,
  unitPrice: 38.5,
  currency: "USD",
  active: true,
  stockOnHand: 2,
  hsnCode: null,
  createdBy: operations,
  createdAt: now,
  updatedAt: now,
};

async function renderAt(path: string) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <ErpPage />
      </MemoryRouter>,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
  return {
    container,
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

it("links each overview number to the list behind it", async () => {
  mockPage();
  const view = await renderAt("/app/erp");

  const cards = [...view.container.querySelectorAll('[data-testid="erp-overview"] a')];
  const awaiting = cards.find((card) => card.textContent?.includes("Awaiting approval"));
  expect(awaiting?.getAttribute("href")).toBe("/app/erp?tab=orders&status=pending_approval");
  expect(awaiting?.textContent).toContain("2");
  const lowStock = cards.find((card) => card.textContent?.includes("Low stock"));
  expect(lowStock?.getAttribute("href")).toBe("/app/erp?tab=inventory");
  // The built-in backend shows where records live and offers the connection.
  expect(view.container.textContent).toContain("Connect Savingroup ERP");

  await view.unmount();
});

it("puts the work waiting on a person, sales and top products on the overview", async () => {
  mockPage();
  api.erp.orders.list.mockResolvedValue({ orders: [pendingOrder, confirmedOrder] });
  api.erp.products.list.mockResolvedValue({ products: [lowStockProduct] });
  const view = await renderAt("/app/erp");

  const attention = view.container.querySelector('[data-testid="erp-attention"]');
  const links = [...(attention?.querySelectorAll("a") ?? [])];
  // The approval comes first and opens the order itself; the low product follows.
  expect(links[0]?.getAttribute("href")).toBe("/app/erp?tab=orders&record=order-2");
  expect(links[0]?.textContent).toContain("Acme");
  expect(links[0]?.textContent).toContain("SO-2");
  expect(links[1]?.textContent).toContain("PLC controller");
  expect(links[1]?.getAttribute("href")).toBe("/app/erp?tab=inventory");
  // Each item can go to the assistant without opening it.
  expect(attention?.querySelectorAll('[data-testid="assistant-ask-row"]')).toHaveLength(2);

  // This month's confirmed sales, and what they sold.
  expect(view.container.querySelector('[data-testid="erp-sales"]')?.textContent).toContain("$500");
  const top = view.container.querySelector('[data-testid="erp-top-products"]');
  expect(top?.textContent).toContain("PLC controller");
  expect(top?.textContent).toContain("× 13");

  await view.unmount();
});

it("opens the order named in the URL", async () => {
  mockPage();
  const view = await renderAt("/app/erp?tab=orders&record=order-2");
  await act(async () => {
    await Promise.resolve();
  });
  expect(api.erp.orders.get).toHaveBeenCalledWith({ id: "order-2" });
  expect(view.container.querySelector('[data-testid="order-lines"]')?.textContent).toContain(
    "CTRL-200",
  );
  await view.unmount();
});

it("opens orders filtered by the status in the URL and approves from the order", async () => {
  mockPage();
  const view = await renderAt("/app/erp?tab=orders&status=pending_approval");
  expect(api.erp.orders.list).toHaveBeenCalledWith({ status: "pending_approval", limit: 200 });

  const row = view.container.querySelector<HTMLElement>('[data-testid="erp-orders-row"]');
  expect(row?.textContent).toContain("SO-2");
  expect(row?.textContent).toContain("Pending approval");
  await act(async () => {
    row!.click();
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(api.erp.orders.get).toHaveBeenCalledWith({ id: "order-2" });
  expect(view.container.querySelector('[data-testid="order-lines"]')?.textContent).toContain(
    "CTRL-200",
  );

  const buttons = [...view.container.querySelectorAll("button")];
  expect(buttons.some((button) => button.textContent === "Cancel order")).toBe(true);
  expect(buttons.some((button) => button.textContent === "Confirm")).toBe(false);
  const approve = buttons.find((button) => button.textContent === "Approve");
  await act(async () => {
    approve!.click();
  });
  expect(api.erp.orders.approve).toHaveBeenCalledWith({ id: "order-2" });

  await view.unmount();
});

it("links the connected site's apps, and each record to its document there", async () => {
  mockPage();
  api.business.environment.get.mockResolvedValue({
    id: "env-1",
    organizationId: "org-1",
    provider: "frappe",
    blueprintId: "india-smb",
    blueprintVersion: 1,
    siteUrl: "http://erp.example.test/",
    siteName: "erp.example.test",
    companyName: "Acme",
    companyAbbr: "AC",
    country: "India",
    currency: "INR",
    status: "active",
    installedApps: [],
    lastVerifiedAt: now,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  });
  const view = await renderAt("/app/erp?tab=orders&status=pending_approval");

  const nav = view.container.querySelector('[data-testid="business-nav"]');
  expect(
    [...(nav?.querySelectorAll('a[target="_blank"]') ?? [])].map((link) =>
      link.getAttribute("href"),
    ),
  ).toEqual([
    "http://erp.example.test/login?redirect-to=%2Fdesk",
    "http://erp.example.test/login?redirect-to=%2Fcrm",
  ]);

  await act(async () => {
    view.container.querySelector<HTMLElement>('[data-testid="erp-orders-row"]')!.click();
  });
  await act(async () => {
    await Promise.resolve();
  });
  const record = [...view.container.querySelectorAll("a")].find(
    (link) => link.textContent === "Open in Savingroup ERP",
  );
  // Through the site's sign-in, which sends a signed-in person straight to the order.
  expect(record?.getAttribute("href")).toBe(
    "http://erp.example.test/login?redirect-to=%2Fdesk%2Fsales-order%2Forder-2",
  );

  await view.unmount();
});
