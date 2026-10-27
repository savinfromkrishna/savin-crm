// @vitest-environment jsdom

import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  business: { subscribe: vi.fn(), history: vi.fn() },
  bots: { list: vi.fn() },
  crm: {
    overview: vi.fn(),
    companies: { list: vi.fn(), create: vi.fn(), update: vi.fn() },
    contacts: { list: vi.fn() },
    leads: { list: vi.fn(), create: vi.fn() },
    deals: { list: vi.fn(), updateStage: vi.fn() },
    activities: { list: vi.fn() },
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

import { CrmPage } from "./BusinessCrm";

const actor = { userId: "user-1", botId: null, name: "Owner" };
const botActor = { userId: null, botId: "bot-1", name: "Sales Executive" };
const now = new Date().toISOString();

function neverEnding() {
  return new Promise<AsyncIterable<unknown>>(() => {});
}

function lead(id: string, ref: string, title: string, status: string) {
  return {
    id,
    spaceId: "space-1",
    number: Number(ref.slice(2)),
    ref,
    title,
    status,
    source: null,
    notes: null,
    value: 8500,
    companyId: "company-1",
    companyName: "Acme",
    contactId: null,
    contactName: null,
    assignee: botActor,
    convertedDealId: null,
    createdBy: actor,
    createdAt: now,
    updatedAt: now,
  };
}

function deal(id: string, ref: string, title: string, stage: string, amount: number) {
  return {
    id,
    spaceId: "space-1",
    number: Number(ref.slice(2)),
    ref,
    title,
    stage,
    amount,
    currency: "USD",
    expectedCloseAt: null,
    closedAt: null,
    notes: null,
    companyId: "company-1",
    companyName: "Acme",
    contactId: null,
    contactName: null,
    sourceLeadId: null,
    owner: botActor,
    createdBy: actor,
    createdAt: now,
    updatedAt: now,
  };
}

function mockLookups() {
  api.business.subscribe.mockImplementation(neverEnding);
  api.business.history.mockResolvedValue([]);
  api.bots.list.mockResolvedValue([{ id: "bot-1", name: "Sales Executive", color: "#8B5CF6" }]);
  api.crm.companies.list.mockResolvedValue({
    companies: [
      {
        id: "company-1",
        spaceId: "space-1",
        name: "Acme",
        domain: null,
        phone: null,
        notes: null,
        createdBy: actor,
        createdAt: now,
        updatedAt: now,
      },
    ],
  });
  api.crm.contacts.list.mockResolvedValue({ contacts: [] });
}

async function renderAt(path: string) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <CrmPage />
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

function buttonNamed(container: HTMLElement, name: string) {
  return [...container.querySelectorAll("button")].find(
    (button) => button.textContent === name || button.getAttribute("aria-label") === name,
  );
}

afterEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

it("lists leads with their refs, attribution and status, and opens the create dialog", async () => {
  mockLookups();
  api.crm.leads.list.mockResolvedValue({
    leads: [lead("lead-1", "L-1", "Acme line upgrade", "qualified")],
  });
  const view = await renderAt("/app/crm?tab=leads");

  const table = view.container.querySelector('[data-testid="crm-leads"]');
  expect(table?.textContent).toContain("L-1");
  expect(table?.textContent).toContain("Acme line upgrade");
  expect(table?.textContent).toContain("Qualified");
  expect(table?.textContent).toContain("Sales Executive");
  expect(api.crm.leads.list).toHaveBeenCalledWith({ limit: 200 });

  const newLead = buttonNamed(view.container, "New lead");
  expect(newLead).toBeDefined();
  await act(async () => {
    newLead!.click();
  });
  expect(view.container.querySelector("h2")?.textContent).toBe("New lead");
  // The company select is populated from the shared lookups.
  expect(
    [...view.container.querySelectorAll("option")].map((option) => option.textContent),
  ).toContain("Acme");

  await view.unmount();
});

it("filters leads by status and narrows the loaded list with search", async () => {
  mockLookups();
  api.crm.leads.list.mockResolvedValue({
    leads: [
      lead("lead-1", "L-1", "Acme line upgrade", "qualified"),
      lead("lead-2", "L-2", "Dye house sensors", "contacted"),
    ],
  });
  const view = await renderAt("/app/crm?tab=leads");

  await act(async () => {
    buttonNamed(view.container, "Qualified")!.click();
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(api.crm.leads.list).toHaveBeenLastCalledWith({ status: "qualified", limit: 200 });
  expect(buttonNamed(view.container, "Qualified")?.getAttribute("aria-pressed")).toBe("true");

  const search = view.container.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(search, "dye");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const rows = view.container.querySelectorAll('[data-testid="crm-leads-row"]');
  expect(rows).toHaveLength(1);
  expect(rows[0]?.textContent).toContain("Dye house sensors");

  await view.unmount();
});

it("groups deals into a pipeline by stage and switches to the list", async () => {
  mockLookups();
  api.crm.deals.list.mockResolvedValue({
    deals: [
      deal("deal-1", "D-1", "Line upgrade", "proposal", 1200),
      deal("deal-2", "D-2", "Retrofit", "proposal", 800),
      deal("deal-3", "D-3", "Pilot", "won", 500),
    ],
  });
  const view = await renderAt("/app/crm?tab=deals");

  const proposal = view.container.querySelector('section[aria-label="Proposal"]');
  expect(proposal?.querySelectorAll('[data-testid="crm-pipeline-card"]')).toHaveLength(2);
  expect(proposal?.textContent).toContain("Line upgrade");
  expect(
    view.container
      .querySelector('section[aria-label="Won"]')
      ?.querySelectorAll('[data-testid="crm-pipeline-card"]'),
  ).toHaveLength(1);

  await act(async () => {
    buttonNamed(view.container, "List view")!.click();
  });
  expect(view.container.querySelector('[data-testid="crm-pipeline"]')).toBeNull();
  expect(view.container.querySelectorAll('[data-testid="crm-deals-row"]')).toHaveLength(3);
  expect(window.localStorage.getItem("savingroup.business.dealsView")).toBe("list");

  await view.unmount();
});

it("shows follow-ups, the pipeline, top deals and lead statuses on the overview", async () => {
  mockLookups();
  api.crm.overview.mockResolvedValue({
    companies: 1,
    contacts: 0,
    openLeads: 2,
    openDeals: 2,
    openDealAmount: 2000,
    wonDealAmount: 500,
    openFollowUps: 1,
    currency: "USD",
  });
  api.crm.deals.list.mockResolvedValue({
    deals: [
      deal("deal-1", "D-1", "Line upgrade", "proposal", 1200),
      deal("deal-2", "D-2", "Retrofit", "negotiation", 800),
      deal("deal-3", "D-3", "Pilot", "won", 500),
    ],
  });
  api.crm.leads.list.mockResolvedValue({
    leads: [
      lead("lead-1", "L-1", "Acme line upgrade", "qualified"),
      lead("lead-2", "L-2", "Dye house sensors", "contacted"),
    ],
  });
  api.crm.activities.list.mockResolvedValue({
    activities: [
      {
        id: "activity-1",
        spaceId: "space-1",
        kind: "follow_up",
        subject: "Send the revised quote",
        body: null,
        dueAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
        completedAt: null,
        companyId: "company-1",
        contactId: null,
        leadId: null,
        dealId: null,
        assignee: botActor,
        createdBy: actor,
        createdAt: now,
        updatedAt: now,
      },
    ],
  });
  const view = await renderAt("/app/crm");

  const kpis = view.container.querySelector('[data-testid="crm-overview"]');
  // One won, none lost.
  expect(kpis?.textContent).toContain("Win rate");
  expect(kpis?.textContent).toContain("100%");

  const followUps = view.container.querySelector('[data-testid="crm-follow-ups"]');
  expect(followUps?.textContent).toContain("Send the revised quote");

  // The largest open deal first, opening the deal itself.
  const topDeals = [
    ...(view.container.querySelector('[data-testid="crm-top-deals"]')?.querySelectorAll("li a") ??
      []),
  ];
  expect(topDeals.map((link) => link.getAttribute("href"))).toEqual([
    "/app/crm?tab=deals&record=deal-1",
    "/app/crm?tab=deals&record=deal-2",
  ]);

  const qualified = [
    ...(view.container
      .querySelector('[data-testid="crm-lead-statuses"]')
      ?.querySelectorAll("a[href]") ?? []),
  ].find((link) => link.getAttribute("href") === "/app/crm?tab=leads&status=qualified");
  expect(qualified?.textContent).toContain("1");

  await view.unmount();
});

it("opens the deal named in the URL", async () => {
  mockLookups();
  api.crm.deals.list.mockResolvedValue({
    deals: [
      deal("deal-1", "D-1", "Line upgrade", "proposal", 1200),
      deal("deal-2", "D-2", "Retrofit", "proposal", 800),
    ],
  });
  const view = await renderAt("/app/crm?tab=deals&record=deal-2");
  expect(view.container.querySelector("h2")?.textContent).toBe("D-2 · Retrofit");
  await view.unmount();
});

it("moves a deal to the stage its card is dropped on", async () => {
  mockLookups();
  api.crm.deals.list.mockResolvedValue({
    deals: [deal("deal-1", "D-1", "Line upgrade", "proposal", 1200)],
  });
  let saved: (value: unknown) => void = () => {};
  api.crm.deals.updateStage.mockImplementation(
    () =>
      new Promise((resolve) => {
        saved = resolve;
      }),
  );
  const view = await renderAt("/app/crm?tab=deals");

  const dataTransfer = { effectAllowed: "", dropEffect: "", setData() {} };
  const drag = (target: Element | null | undefined, type: string) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
    target?.dispatchEvent(event);
  };
  const card = view.container.querySelector('[data-testid="crm-pipeline-card"]');
  const won = view.container.querySelector('section[aria-label="Won"]');
  await act(async () => drag(card, "dragstart"));
  await act(async () => drag(won, "dragover"));
  expect(won?.getAttribute("data-drop-target")).toBe("true");
  await act(async () => drag(won, "drop"));

  expect(api.crm.deals.updateStage).toHaveBeenCalledWith({ id: "deal-1", stage: "won" });
  // The card shows in its new stage while the change saves, then the list reloads.
  expect(won?.textContent).toContain("Line upgrade");
  const loads = api.crm.deals.list.mock.calls.length;
  await act(async () => saved({}));
  expect(api.crm.deals.list.mock.calls.length).toBeGreaterThan(loads);

  await view.unmount();
});
