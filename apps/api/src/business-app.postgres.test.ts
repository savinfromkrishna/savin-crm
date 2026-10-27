import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { discardBotIntroRun } from "../../../packages/testkit/src/discard-bot-intro.js";
import { sessionCookieHeader } from "../../../packages/testkit/src/index.js";
import { createApp } from "./app.js";

const describePostgres =
  process.env.VERIFY_DATABASE === "1" && process.env.DATABASE_URL
    ? describe.sequential
    : describe.skip;
const origin = "http://127.0.0.1:5173";

type Handles = Awaited<ReturnType<typeof createApp>>;

async function startApp(enabled: boolean) {
  vi.stubEnv("BUSINESS_APPS_ENABLED", String(enabled));
  const dataDir = await mkdtemp(join(tmpdir(), "savingroup-business-test-"));
  const handles = await createApp({
    databaseUrl: process.env.DATABASE_URL!,
    dataDir,
    sandboxProvider: "fake",
    agentRuntime: "scripted",
    wakeupDriver: "memory",
    signupsEnabled: "true",
    webOrigin: origin,
    authUrl: origin,
  });
  const stop = async () => {
    await handles.stop();
    await rm(dataDir, { recursive: true, force: true });
  };
  return { handles, stop };
}

async function signUp(handles: Handles, label: string) {
  const response = await handles.app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({
      email: `${label}-${randomUUID()}@savingroup.test`,
      password: "test-password-123",
      name: `${label} tester`,
    }),
  });
  expect(response.status).toBeLessThan(400);
  return sessionCookieHeader(response);
}

async function call<T = unknown>(
  handles: Handles,
  cookie: string,
  procedure: string,
  input: unknown = {},
): Promise<{ status: number; json?: T; error?: { code?: string; message?: string } }> {
  const response = await handles.app.request(`/rpc/${procedure}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, origin },
    body: JSON.stringify({ json: input }),
  });
  // oRPC puts both results and errors under `json`; the status says which it is.
  const body = (await response.json()) as { json?: unknown };
  if (response.status >= 400) {
    return { status: response.status, error: body.json as { code?: string; message?: string } };
  }
  return { status: response.status, json: body.json as T };
}

async function must<T>(handles: Handles, cookie: string, procedure: string, input: unknown = {}) {
  const result = await call<T>(handles, cookie, procedure, input);
  if (result.status >= 400 || result.error) {
    throw new Error(`${procedure}: ${result.status} ${result.error?.message ?? ""}`);
  }
  return result.json as T;
}

describePostgres("business apps over HTTP", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("stays hidden until BUSINESS_APPS_ENABLED is true", async () => {
    const { handles, stop } = await startApp(false);
    try {
      const cookie = await signUp(handles, "business-off");
      const me = await call(handles, cookie, "me");
      expect(me.json).toMatchObject({ businessAppsEnabled: false });
      const companies = await call(handles, cookie, "crm/companies/list", {});
      expect(companies.status).toBe(404);
      expect(companies.error).toMatchObject({ code: "NOT_FOUND" });
    } finally {
      await stop();
    }
  });

  it("runs the workflow for a person, with isolation, approval and stock rules", async () => {
    const { handles, stop } = await startApp(true);
    try {
      const cookie = await signUp(handles, "business-owner");
      const me = await must<{ businessAppsEnabled: boolean }>(handles, cookie, "me");
      expect(me.businessAppsEnabled).toBe(true);
      const actions = await must<Array<{ id: string }>>(handles, cookie, "business/actions");
      expect(actions.map((action) => action.id)).toContain("erp.order.confirm");

      const acme = await must<{ id: string }>(handles, cookie, "crm/companies/create", {
        name: "Acme",
        idempotencyKey: "acme-once",
      });
      const acmeAgain = await must<{ id: string }>(handles, cookie, "crm/companies/create", {
        name: "Acme",
        idempotencyKey: "acme-once",
      });
      expect(acmeAgain.id).toBe(acme.id);

      const product = await must<{ id: string; stockOnHand: number }>(
        handles,
        cookie,
        "erp/products/create",
        { sku: "W-1", name: "Widget", unitPrice: 10, initialStock: 3 },
      );
      expect(product.stockOnHand).toBe(3);
      const lead = await must<{ id: string; ref: string }>(handles, cookie, "crm/leads/create", {
        title: "Widgets for Acme",
        companyId: acme.id,
        value: 40,
      });
      await must(handles, cookie, "crm/leads/qualify", { id: lead.id, status: "qualified" });
      const converted = await must<{ deal: { id: string; ref: string } }>(
        handles,
        cookie,
        "crm/leads/convert",
        { id: lead.id },
      );
      expect(converted.deal.ref).toBe("D-1");

      const order = await must<{ id: string; ref: string; status: string }>(
        handles,
        cookie,
        "erp/orders/createDraft",
        { dealId: converted.deal.id, lines: [{ productId: product.id, quantity: 4 }] },
      );
      await must(handles, cookie, "erp/orders/requestApproval", { id: order.id });
      await must(handles, cookie, "erp/orders/approve", { id: order.id });
      const shortStock = await call(handles, cookie, "erp/orders/confirm", { id: order.id });
      expect(shortStock.status).toBe(409);
      expect(shortStock.error).toMatchObject({
        code: "CONFLICT",
        message: expect.stringContaining("Insufficient stock"),
      });
      await must(handles, cookie, "erp/inventory/adjust", {
        productId: product.id,
        delta: 1,
        reason: "Restock",
      });
      const confirmed = await must<{ status: string }>(handles, cookie, "erp/orders/confirm", {
        id: order.id,
      });
      expect(confirmed.status).toBe("confirmed");
      const level = await must<{ onHand: number }>(handles, cookie, "erp/inventory/check", {
        productId: product.id,
      });
      expect(level.onHand).toBe(0);
      const deals = await must<{ deals: Array<{ stage: string }> }>(
        handles,
        cookie,
        "crm/deals/list",
        {
          id: converted.deal.id,
        },
      );
      expect(deals.deals[0]?.stage).toBe("won");
      const invoice = await must<{ id: string; ref: string; status: string }>(
        handles,
        cookie,
        "erp/invoices/createDraft",
        { orderId: order.id },
      );
      expect(invoice).toMatchObject({ ref: "INV-1", status: "draft" });
      const history = await must<Array<{ actionId: string; actor: { name: string | null } }>>(
        handles,
        cookie,
        "business/history",
        { recordType: "order", recordId: order.id, limit: 50 },
      );
      expect(history.map((entry) => entry.actionId)).toEqual(
        expect.arrayContaining([
          "erp.order.create_draft",
          "erp.order.approve",
          "erp.order.confirm",
        ]),
      );
      expect(history.every((entry) => entry.actor.name === "business-owner tester")).toBe(true);

      // Settings are the space owner's; this user owns the default space.
      await must(handles, cookie, "business/updateSettings", { allowNegativeStock: true });
      expect(await must(handles, cookie, "business/settings")).toMatchObject({
        allowNegativeStock: true,
      });

      // Another account sees nothing of this workspace, by list or by id.
      const outsider = await signUp(handles, "business-outsider");
      const theirCompanies = await must<{ companies: unknown[] }>(
        handles,
        outsider,
        "crm/companies/list",
        {},
      );
      expect(theirCompanies.companies).toEqual([]);
      const theirView = await call(handles, outsider, "erp/orders/get", { id: order.id });
      expect(theirView.status).toBe(404);
      const theirWrite = await call(handles, outsider, "erp/orders/confirm", { id: order.id });
      expect(theirWrite.status).toBe(404);
    } finally {
      await stop();
    }
  });

  it("lets a bot run the whole workflow through the agent executor, pausing for approval", async () => {
    const { handles, stop } = await startApp(true);
    try {
      const cookie = await signUp(handles, "business-bot");
      const bot = await must<{ id: string; spaceId: string }>(handles, cookie, "bots/create", {
        name: "Operations",
        title: "Operations",
        description: "Runs the business demo.",
        instructions: "Run business workflows through CRM OS and ERP OS.",
        notifyOnFinish: false,
      });
      await discardBotIntroRun(handles, cookie, bot.id);
      // The owner's approval policy: approving and confirming orders need a person each time.
      // Consequential business tools run without a card until a rule like this exists.
      const storedBot = await handles.prisma.bot.findUniqueOrThrow({ where: { id: bot.id } });
      for (const tool of ["erp_order_approve", "erp_order_confirm"]) {
        await handles.prisma.actionApprovalRule.create({
          data: {
            spaceId: storedBot.spaceId,
            createdByUserId: storedBot.userId,
            effect: "require_approval",
            matchKind: "tool",
            matchValue: tool,
          },
        });
      }

      const sent = await must<{ runId: string }>(handles, cookie, "threads/send", {
        botId: bot.id,
        text: "Run the business demo workflow.",
      });
      const waitForRun = async (status: string) => {
        await expect
          .poll(
            async () =>
              (await handles.prisma.run.findUniqueOrThrow({ where: { id: sent.runId } })).status,
            { timeout: 20_000, interval: 100 },
          )
          .toBe(status);
      };
      const approve = async () => {
        const card = await handles.prisma.message.findFirstOrThrow({
          where: { runId: sent.runId, role: "bot" },
          orderBy: { seq: "desc" },
        });
        expect(JSON.stringify(card.blocks)).toContain('"kind":"ask"');
        await must(handles, cookie, "threads/answer", {
          botId: bot.id,
          runId: sent.runId,
          messageId: card.id,
          answer: "allow",
        });
      };

      // erp_order_approve is consequential: the run stops and asks the owner.
      await waitForRun("waiting_input");
      const spaceId = bot.spaceId;
      expect(
        await handles.prisma.erpSalesOrder.findFirst({
          where: { spaceId },
          select: { status: true },
        }),
      ).toMatchObject({ status: "pending_approval" });
      await approve();
      // ...and so is erp_order_confirm.
      await waitForRun("waiting_input");
      expect(
        await handles.prisma.erpSalesOrder.findFirst({
          where: { spaceId },
          select: { status: true },
        }),
      ).toMatchObject({ status: "approved" });
      await approve();
      await waitForRun("completed");

      const lead = await handles.prisma.crmLead.findFirstOrThrow({ where: { spaceId } });
      expect(lead).toMatchObject({ number: 1, status: "converted", createdByBotId: bot.id });
      const deal = await handles.prisma.crmDeal.findFirstOrThrow({ where: { spaceId } });
      expect(deal).toMatchObject({ number: 1, stage: "won" });
      const order = await handles.prisma.erpSalesOrder.findFirstOrThrow({ where: { spaceId } });
      expect(order).toMatchObject({
        number: 1,
        status: "confirmed",
        companyId: null,
        approvedByBotId: bot.id,
      });
      const product = await handles.prisma.erpProduct.findFirstOrThrow({ where: { spaceId } });
      expect(product).toMatchObject({ sku: "DEMO-SENSOR", stockOnHand: 3 });
      const invoice = await handles.prisma.erpInvoice.findFirstOrThrow({ where: { spaceId } });
      expect(invoice).toMatchObject({ number: 1, status: "draft", orderId: order.id });
      // Every write was performed exactly once, by the bot, under this run.
      const log = await handles.prisma.businessActionLog.findMany({
        where: { spaceId, outcome: "succeeded" },
      });
      expect(log.map((entry) => entry.actionId).sort()).toEqual(
        [
          "crm.company.create",
          "crm.lead.convert",
          "crm.lead.create",
          "crm.lead.qualify",
          "erp.invoice.create_draft",
          "erp.order.approve",
          "erp.order.confirm",
          "erp.order.create_draft",
          "erp.order.request_approval",
          "erp.product.create",
        ].sort(),
      );
      expect(log.every((entry) => entry.actorBotId === bot.id && entry.runId === sent.runId)).toBe(
        true,
      );
      const effects = await handles.prisma.externalEffect.findMany({
        where: { runId: sent.runId, kind: { in: ["erp_order_approve", "erp_order_confirm"] } },
      });
      expect(effects.map((effect) => effect.status).sort()).toEqual(["completed", "completed"]);
    } finally {
      await stop();
    }
  }, 60_000);
});
