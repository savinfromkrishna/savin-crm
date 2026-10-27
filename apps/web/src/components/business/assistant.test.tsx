// @vitest-environment jsdom

import { i18n } from "@lingui/core";
import type { Bot, ThreadSnapshot } from "@savingroup/contracts";
import { BUSINESS_TEAM_SPAWN_KEYS } from "@savingroup/contracts";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  threads: {
    get: vi.fn(),
    head: vi.fn(),
    subscribe: vi.fn(),
    send: vi.fn(),
    markRead: vi.fn(),
  },
}));
vi.mock("../../lib/rpc", () => ({ rpc: api, selectedSpaceId: () => null }));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});

import {
  AskAssistantButton,
  AskRowButton,
  defaultAssistantBot,
  orderAssistantBots,
} from "./assistant";
import { BusinessBotsContext } from "./records";
import { BusinessPage } from "./shell";

const now = new Date().toISOString();

function bot(
  id: string,
  name: string,
  spawnKey: string | null,
  disabledBuiltinTools: string[] = [],
) {
  return {
    id,
    spaceId: "space-1",
    name,
    title: "",
    description: `${name} description`,
    instructions: "",
    color: "#8B5CF6",
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
    computerAccess: "full",
    updatedAt: now,
    createdAt: now,
    voiceId: null,
    autoSpeak: false,
    modelProvider: null,
    modelId: null,
    thinkingLevel: null,
    teamChatAmbientEnabled: false,
    teamChatRules: "",
    disabledBuiltinTools,
    webhookConfigured: false,
    spawnKey,
  } satisfies Bot;
}

const sales = bot("bot-sales", "Sales Executive", BUSINESS_TEAM_SPAWN_KEYS.sales);
const operations = bot("bot-ops", "Operations", BUSINESS_TEAM_SPAWN_KEYS.operations);
const finance = bot("bot-finance", "Finance", BUSINESS_TEAM_SPAWN_KEYS.finance);
const operator = bot("bot-operator", "Operator", BUSINESS_TEAM_SPAWN_KEYS.operator);
const helper = bot("bot-helper", "Helper", null);

function thread(botId: string, messages: ThreadSnapshot["messages"] = []): ThreadSnapshot {
  return { threadId: `thread-${botId}`, cursor: 2, botId, messages, olderCursor: null, run: null };
}

/** Width queries answer for a phone unless a test widens the window. */
let wideWindow = false;

beforeEach(() => {
  i18n.load("en", {});
  i18n.activate("en");
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  wideWindow = false;
  // Reduced motion skips the composer's resize animation, which jsdom cannot run.
  window.matchMedia = (query: string) =>
    ({
      matches: query.includes("min-width") ? wideWindow : true,
      addEventListener() {},
      removeEventListener() {},
    }) as unknown as MediaQueryList;
  // The transcript follows new messages with scrollTo, which jsdom lacks.
  Element.prototype.scrollTo ??= () => {};
  api.threads.head.mockImplementation(async ({ botId }: { botId: string }) => ({
    threadId: `thread-${botId}`,
    cursor: 2,
  }));
  // The live stream stays open and quiet.
  api.threads.subscribe.mockImplementation(() => new Promise(() => {}));
  api.threads.send.mockResolvedValue({ taskId: "task-1", runId: "run-1", seq: 3 });
  api.threads.markRead.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

async function renderPage(
  bots: Bot[],
  section: string,
  children: ReactNode = null,
  app: "crm" | "erp" = "crm",
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const page = (current: string) => (
    <MemoryRouter initialEntries={[`/app/${app}?tab=${current}`]}>
      <BusinessBotsContext value={bots}>
        <BusinessPage app={app} section={current}>
          {children}
        </BusinessPage>
      </BusinessBotsContext>
    </MemoryRouter>
  );
  await act(async () => {
    root.render(page(section));
  });
  return {
    container,
    toggle() {
      return container.querySelector('[data-testid="assistant-toggle"]');
    },
    async showSection(next: string) {
      await act(async () => {
        root.render(page(next));
      });
    },
    async click(element: Element | null | undefined) {
      if (!element) throw new Error("element not found");
      await act(async () => {
        (element as HTMLElement).click();
      });
      await act(async () => {
        await Promise.resolve();
      });
    },
    prompts() {
      return [...container.querySelectorAll('[data-testid="assistant-prompts"] button')].map(
        (button) => button.textContent,
      );
    },
    async unmount() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

function type(textarea: HTMLTextAreaElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("picks the Operator, then the role that owns the section, then any bot", () => {
  expect(defaultAssistantBot([sales, operations, operator], "erp", "orders")?.id).toBe(
    "bot-operator",
  );
  expect(defaultAssistantBot([sales, operations, finance], "erp", "invoices")?.id).toBe(
    "bot-finance",
  );
  expect(defaultAssistantBot([sales, operations, finance], "erp", "orders")?.id).toBe("bot-ops");
  expect(defaultAssistantBot([operations, sales], "crm", "leads")?.id).toBe("bot-sales");
  expect(defaultAssistantBot([helper], "crm", "overview")?.id).toBe("bot-helper");
  expect(defaultAssistantBot([], "crm", "overview")).toBeNull();
  expect(orderAssistantBots([helper, finance, operator, sales]).map((entry) => entry.id)).toEqual([
    "bot-operator",
    "bot-sales",
    "bot-finance",
    "bot-helper",
  ]);
});

it("opens the bot's own thread from the header and starts from a prompt", async () => {
  api.threads.get.mockResolvedValue(
    thread("bot-operator", [
      {
        id: "message-1",
        threadId: "thread-bot-operator",
        seq: 1,
        role: "user",
        blocks: [{ kind: "text", text: "How is the pipeline?" }],
        createdAt: now,
      },
      {
        id: "message-2",
        threadId: "thread-bot-operator",
        seq: 2,
        role: "bot",
        botId: "bot-operator",
        blocks: [{ kind: "text", text: "Two deals are in proposal." }],
        createdAt: now,
      },
    ]),
  );
  const view = await renderPage([sales, operator], "leads");

  const toggle = view.container.querySelector('[data-testid="assistant-toggle"]');
  expect(toggle?.textContent).toContain("Ask Operator");
  // Nothing connects until the panel is opened.
  expect(api.threads.get).not.toHaveBeenCalled();
  await view.click(toggle);

  expect(api.threads.get).toHaveBeenCalledWith({ botId: "bot-operator" }, expect.anything());
  const panel = view.container.querySelector('[data-testid="business-assistant"]');
  expect(panel?.textContent).toContain("How is the pipeline?");
  expect(panel?.textContent).toContain("Two deals are in proposal.");
  expect(view.prompts()).toEqual(["Which leads should I work on first?", "Qualify the new leads"]);

  await view.click(
    view.container.querySelector('[data-testid="assistant-prompts"] button') ?? undefined,
  );
  expect(api.threads.send).toHaveBeenCalledWith({
    botId: "bot-operator",
    clientNonce: expect.any(String),
    text: "Which leads should I work on first?",
  });
  // Prompts are for starting; they step aside once something is sent.
  expect(view.container.querySelector('[data-testid="assistant-prompts"]')).toBeNull();

  await view.unmount();
});

it("asks about a record by its ref and offers only what the bot may do", async () => {
  const limitedSales = bot("bot-sales", "Sales Executive", BUSINESS_TEAM_SPAWN_KEYS.sales, [
    "crm_lead_qualify",
  ]);
  api.threads.get.mockResolvedValue(thread("bot-sales"));
  const view = await renderPage(
    [limitedSales],
    "leads",
    <AskAssistantButton
      record={{ kind: "lead", ref: "L-3", name: "Line upgrade", status: "new" }}
    />,
  );

  await view.click(view.container.querySelector('[data-testid="assistant-toggle"]'));
  // The section offers no step the bot is not allowed to take.
  expect(view.prompts()).toEqual(["Which leads should I work on first?"]);
  // An empty thread introduces the bot instead of an empty transcript.
  expect(view.container.querySelector('[data-testid="business-assistant"]')?.textContent).toContain(
    "Sales Executive description",
  );

  await view.click(view.container.querySelector('[data-testid="assistant-ask"]'));
  const chip = view.container.querySelector('[data-testid="assistant-record"]');
  expect(chip?.textContent).toContain("L-3");
  expect(chip?.textContent).toContain("Line upgrade");
  expect(view.prompts()).toEqual(["Suggest the next step", "Draft a follow-up email"]);

  const textarea = view.container.querySelector<HTMLTextAreaElement>(
    '[data-testid="business-assistant"] textarea',
  );
  if (!textarea) throw new Error("composer not found");
  type(textarea, "Who signs off on it?");
  await view.click(
    view.container.querySelector('[data-testid="business-assistant"] button[aria-label="Send"]'),
  );
  expect(api.threads.send).toHaveBeenCalledWith({
    botId: "bot-sales",
    clientNonce: expect.any(String),
    text: "Lead L-3 (Line upgrade): Who signs off on it?",
  });
  // The record went with that message; what follows is the conversation.
  expect(view.container.querySelector('[data-testid="assistant-record"]')).toBeNull();

  await view.unmount();
});

it("keeps the bot that answered while moving between sections", async () => {
  api.threads.get.mockImplementation(async ({ botId }: { botId: string }) => thread(botId));
  const view = await renderPage([operations, finance], "orders", null, "erp");
  expect(view.toggle()?.textContent).toContain("Ask Operations");
  await view.click(view.toggle());
  await view.showSection("invoices");
  expect(view.toggle()?.textContent).toContain("Ask Operations");
  expect(api.threads.get).not.toHaveBeenCalledWith({ botId: "bot-finance" }, expect.anything());
  await view.unmount();

  // Before the panel opens, the default follows the section.
  const fresh = await renderPage([operations, finance], "invoices", null, "erp");
  expect(fresh.toggle()?.textContent).toContain("Ask Finance");
  await fresh.unmount();
});

it("opens beside the records on a wide screen until it is closed", async () => {
  wideWindow = true;
  api.threads.get.mockResolvedValue(thread("bot-operator"));
  const view = await renderPage([operator], "overview");
  await act(async () => {
    await Promise.resolve();
  });
  expect(view.toggle()?.getAttribute("aria-pressed")).toBe("true");
  expect(view.container.querySelector('[data-testid="business-assistant"]')).not.toBeNull();
  expect(api.threads.get).toHaveBeenCalledWith({ botId: "bot-operator" }, expect.anything());

  await view.click(view.container.querySelector('button[aria-label="Close"]'));
  expect(view.container.querySelector('[data-testid="business-assistant"]')).toBeNull();
  await view.unmount();

  // Closing is remembered for the next visit.
  const next = await renderPage([operator], "overview");
  expect(next.toggle()?.getAttribute("aria-pressed")).toBe("false");
  await next.unmount();
});

it("asks about a record from its row without opening the record", async () => {
  api.threads.get.mockResolvedValue(thread("bot-operator"));
  const view = await renderPage(
    [operator],
    "orders",
    <AskRowButton
      record={{ kind: "order", ref: "SO-2", name: "Acme", status: "pending_approval" }}
    />,
    "erp",
  );
  // A row that opens its record on click sits around the button; the click stays with the button.
  const openRow = vi.fn();
  document.body.addEventListener("click", openRow);

  const ask = view.container.querySelector('[data-testid="assistant-ask-row"]');
  expect(ask?.getAttribute("aria-label")).toBe("Ask Operator");
  await view.click(ask);
  document.body.removeEventListener("click", openRow);
  expect(openRow).not.toHaveBeenCalled();
  const chip = view.container.querySelector('[data-testid="assistant-record"]');
  expect(chip?.textContent).toContain("SO-2");
  expect(view.prompts()).toEqual(["Summarize it for approval"]);

  await view.unmount();
});
