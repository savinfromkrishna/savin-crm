import { randomUUID } from "node:crypto";
import type {
  CrmDeal,
  CrmLead,
  ErpInvoice,
  ErpProduct,
  ErpSalesOrder,
} from "@savingroup/contracts";
import type { PrismaClient } from "@savingroup/db";
import { createDb } from "@savingroup/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BusinessDeps } from "./context.js";
import { seedBusinessDemo } from "./demo.js";
import { executeBusinessAction } from "./execute.js";
import { BUSINESS_TEAM, disabledToolsForRole } from "./team.js";
import { runBusinessTool } from "./tools.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE === "1" && databaseUrl ? describe.sequential : describe.skip;

describePostgres("business actions (PostgreSQL)", () => {
  let prisma: PrismaClient;
  let close: () => Promise<void>;
  let deps: BusinessDeps;
  const suffix = `${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const organizationId = `business-org-${suffix}`;
  const userId = `business-user-${suffix}`;
  const spaceA = `business-space-a-${suffix}`;
  const spaceB = `business-space-b-${suffix}`;
  let salesBotId = "";
  let opsBotId = "";

  const user = { userId };
  const asUser = <T>(
    spaceId: string,
    actionId: Parameters<typeof executeBusinessAction>[1],
    input: unknown,
  ) =>
    executeBusinessAction(deps, actionId, input, { spaceId, actor: user }) as Promise<
      | { ok: true; data: T; replayed: boolean }
      | { ok: false; error: { code: string; message: string } }
    >;
  const ok = async <T>(
    spaceId: string,
    actionId: Parameters<typeof executeBusinessAction>[1],
    input: unknown,
  ): Promise<T> => {
    const result = await asUser<T>(spaceId, actionId, input);
    if (!result.ok) throw new Error(`${actionId}: ${result.error.code} ${result.error.message}`);
    return result.data;
  };

  beforeAll(async () => {
    const db = createDb(databaseUrl!, { poolMax: 2 });
    prisma = db.prisma;
    close = async () => {
      await prisma.$disconnect();
      await db.pool.end();
    };
    deps = { prisma, enabled: true };
    await prisma.user.create({
      data: { id: userId, name: "Business tester", email: `${userId}@example.test` },
    });
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Business Org",
        slug: organizationId,
        createdAt: new Date(),
      },
    });
    await prisma.member.create({
      data: {
        id: `member-${suffix}`,
        organizationId,
        userId,
        role: "owner",
        createdAt: new Date(),
      },
    });
    for (const spaceId of [spaceA, spaceB]) {
      await prisma.space.create({ data: { id: spaceId, organizationId, name: spaceId } });
      await prisma.spaceMember.create({
        data: {
          id: `space-member-${spaceId}`,
          spaceId,
          organizationId,
          userId,
          role: "owner",
          createdAt: new Date(),
        },
      });
    }
    const sales = BUSINESS_TEAM.find((config) => config.name === "Sales Executive")!;
    const ops = BUSINESS_TEAM.find((config) => config.name === "Operations")!;
    salesBotId = (
      await prisma.bot.create({
        data: {
          spaceId: spaceA,
          userId,
          name: sales.name,
          color: "blue",
          disabledBuiltinTools: disabledToolsForRole(sales.allowedActions),
        },
      })
    ).id;
    opsBotId = (
      await prisma.bot.create({
        data: {
          spaceId: spaceA,
          userId,
          name: ops.name,
          color: "blue",
          disabledBuiltinTools: disabledToolsForRole(ops.allowedActions),
        },
      })
    ).id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await close();
  });

  it("runs lead → deal → order → invoice with stock, state and approval rules enforced", async () => {
    const company = await ok<{ id: string }>(spaceA, "crm.company.create", { name: "Acme" });
    const contact = await ok<{ id: string }>(spaceA, "crm.contact.create", {
      firstName: "Dana",
      lastName: "Reyes",
      email: "DANA@acme.example",
      companyId: company.id,
    });
    const product = await ok<ErpProduct>(spaceA, "erp.product.create", {
      sku: "widget-1",
      name: "Widget",
      unitPrice: 19.99,
      initialStock: 5,
    });
    expect(product.sku).toBe("WIDGET-1");
    expect(product.stockOnHand).toBe(5);

    const lead = await ok<CrmLead>(spaceA, "crm.lead.create", {
      title: "Acme wants widgets",
      companyId: company.id,
      contactId: contact.id,
      value: 100,
      assigneeBotId: salesBotId,
    });
    expect(lead.ref).toBe("L-1");
    expect(lead.assignee).toMatchObject({ botId: salesBotId, name: "Sales Executive" });

    // Business rule: only qualified leads convert.
    const early = await asUser(spaceA, "crm.lead.convert", { ref: "L-1" });
    expect(early).toMatchObject({ ok: false, error: { code: "invalid_state" } });

    await ok(spaceA, "crm.lead.qualify", { ref: "L-1", status: "qualified" });
    const converted = await ok<{ lead: CrmLead; deal: CrmDeal }>(spaceA, "crm.lead.convert", {
      ref: "L-1",
    });
    expect(converted.lead.status).toBe("converted");
    expect(converted.deal).toMatchObject({
      ref: "D-1",
      amount: 100,
      companyId: company.id,
      owner: { botId: salesBotId },
    });

    // Ten widgets on a five-widget shelf: approved, but confirmation must refuse.
    const order = await ok<ErpSalesOrder>(spaceA, "erp.order.create_draft", {
      dealRef: "D-1",
      lines: [{ sku: "WIDGET-1", quantity: 10 }],
    });
    expect(order).toMatchObject({ ref: "SO-1", companyId: company.id, subtotal: 199.9 });
    const premature = await asUser(spaceA, "erp.order.confirm", { ref: "SO-1" });
    expect(premature).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    await ok(spaceA, "erp.order.request_approval", { ref: "SO-1" });
    await ok(spaceA, "erp.order.approve", { ref: "SO-1" });
    const shortStock = await asUser(spaceA, "erp.order.confirm", { ref: "SO-1" });
    expect(shortStock).toMatchObject({ ok: false, error: { code: "insufficient_stock" } });
    expect(
      (await prisma.erpProduct.findUniqueOrThrow({ where: { id: product.id } })).stockOnHand,
    ).toBe(5);

    // Approved orders are frozen; fix the quantity through stock instead.
    await ok(spaceA, "erp.inventory.adjust", { sku: "WIDGET-1", delta: 7, reason: "Delivery" });
    const confirmed = await ok<ErpSalesOrder>(spaceA, "erp.order.confirm", { ref: "SO-1" });
    expect(confirmed.status).toBe("confirmed");
    expect(
      (await prisma.erpProduct.findUniqueOrThrow({ where: { id: product.id } })).stockOnHand,
    ).toBe(2);
    const dealAfter = await ok<{ deals: CrmDeal[] }>(spaceA, "crm.deal.search", { ref: "D-1" });
    expect(dealAfter.deals[0]?.stage).toBe("won");

    const draft = await ok<ErpInvoice>(spaceA, "erp.invoice.create_draft", { orderRef: "SO-1" });
    expect(draft).toMatchObject({ ref: "INV-1", status: "draft", total: 199.9 });
    const duplicateInvoice = await asUser(spaceA, "erp.invoice.create_draft", { orderRef: "SO-1" });
    expect(duplicateInvoice).toMatchObject({ ok: false, error: { code: "conflict" } });
    const unpaid = await asUser(spaceA, "erp.invoice.record_payment", { ref: "INV-1", amount: 10 });
    expect(unpaid).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    await ok(spaceA, "erp.invoice.issue", { ref: "INV-1" });
    const partial = await ok<ErpInvoice>(spaceA, "erp.invoice.record_payment", {
      ref: "INV-1",
      amount: 99.9,
    });
    expect(partial).toMatchObject({ paymentStatus: "partial", amountPaid: 99.9, status: "issued" });
    const paid = await ok<ErpInvoice>(spaceA, "erp.invoice.record_payment", {
      ref: "INV-1",
      amount: 100,
    });
    expect(paid).toMatchObject({ paymentStatus: "paid", status: "paid", amountPaid: 199.9 });

    const events = await prisma.businessEvent.findMany({
      where: { spaceId: spaceA },
      orderBy: { createdAt: "asc" },
      select: { type: true, publishedAt: true },
    });
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "crm.lead.created",
        "crm.lead.converted",
        "crm.deal.created",
        "erp.order.created",
        "erp.order.confirmed",
        "crm.deal.stage_changed",
        "erp.invoice.draft_created",
        "erp.invoice.payment_recorded",
      ]),
    );
    expect(events.every((event) => event.publishedAt !== null)).toBe(true);
  });

  it("isolates every record to its space, even by id", async () => {
    const [company] = (
      await ok<{ companies: Array<{ id: string }> }>(spaceA, "crm.company.search", {})
    ).companies;
    expect(company).toBeDefined();
    const fromB = await ok<{ companies: unknown[] }>(spaceB, "crm.company.search", {
      id: company!.id,
    });
    expect(fromB.companies).toEqual([]);
    expect(await asUser(spaceB, "erp.order.get", { ref: "SO-1" })).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
    expect(
      await asUser(spaceB, "crm.contact.create", { firstName: "X", companyId: company!.id }),
    ).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect((await ok<{ leads: unknown[] }>(spaceB, "crm.lead.search", {})).leads).toEqual([]);
  });

  it("returns the committed result for a repeated idempotency key and logs the actor", async () => {
    const input = { name: "Northwind", idempotencyKey: `create-northwind-${suffix}` };
    const first = await asUser<{ id: string }>(spaceA, "crm.company.create", input);
    const second = await asUser<{ id: string }>(spaceA, "crm.company.create", input);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("expected success");
    expect(second.data.id).toBe(first.data.id);
    expect(second.replayed).toBe(true);
    expect(await prisma.crmCompany.count({ where: { spaceId: spaceA, name: "Northwind" } })).toBe(
      1,
    );
    const log = await prisma.businessActionLog.findMany({
      where: { spaceId: spaceA, recordType: "company", recordId: first.data.id },
    });
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actorUserId: userId, actorBotId: null, outcome: "succeeded" });
  });

  it("enforces bot roles server-side and attributes bot writes to the bot", async () => {
    const denied = await runBusinessTool(deps, {
      toolName: "erp_order_confirm",
      args: { ref: "SO-1" },
      spaceId: spaceA,
      userId,
      botId: salesBotId,
      runId: `run-${suffix}`,
    });
    expect(denied).toMatchObject({ code: "permission_denied" });

    const created = await runBusinessTool(deps, {
      toolName: "crm_lead_create",
      args: { title: "Bot sourced lead", source: "chat" },
      spaceId: spaceA,
      userId,
      botId: salesBotId,
      runId: `run-${suffix}`,
    });
    expect(created).toMatchObject({
      ref: "L-2",
      createdBy: { botId: salesBotId, name: "Sales Executive" },
    });
    const again = await runBusinessTool(deps, {
      toolName: "crm_lead_create",
      args: { title: "Bot sourced lead", source: "chat" },
      spaceId: spaceA,
      userId,
      botId: salesBotId,
      runId: `run-${suffix}`,
    });
    // Same run, same call, same arguments: the replay returns L-2 instead of creating L-3.
    expect(again).toMatchObject({ ref: "L-2", replayed: true });

    const opsAdjust = await runBusinessTool(deps, {
      toolName: "erp_inventory_adjust",
      args: { sku: "WIDGET-1", delta: -1, reason: "Damaged" },
      spaceId: spaceA,
      userId,
      botId: opsBotId,
      runId: `run-ops-${suffix}`,
    });
    expect(opsAdjust).toMatchObject({
      delta: -1,
      quantityAfter: 1,
      createdBy: { botId: opsBotId },
    });
    const negative = await runBusinessTool(deps, {
      toolName: "erp_inventory_adjust",
      args: { sku: "WIDGET-1", delta: -5, reason: "Oops" },
      spaceId: spaceA,
      userId,
      botId: opsBotId,
      runId: `run-ops-${suffix}`,
    });
    expect(negative).toMatchObject({ code: "insufficient_stock" });
    const failedLog = await prisma.businessActionLog.findFirst({
      where: { spaceId: spaceA, actionId: "erp.inventory.adjust", outcome: "failed" },
    });
    expect(failedLog).toMatchObject({ actorBotId: opsBotId, errorCode: "insufficient_stock" });
  });

  it("rejects malformed input without a database write", async () => {
    const before = await prisma.businessActionLog.count({ where: { spaceId: spaceB } });
    expect(
      await asUser(spaceB, "erp.product.create", { sku: "ok", name: "", unitPrice: 1.234 }),
    ).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(
      await asUser(spaceB, "erp.inventory.adjust", { sku: "X", delta: 0, reason: "r" }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
    expect(await prisma.businessActionLog.count({ where: { spaceId: spaceB } })).toBe(before);
  });

  it("seeds the demo workspace idempotently through the public actions", async () => {
    const first = await seedBusinessDemo(deps, { spaceId: spaceB, userId });
    const second = await seedBusinessDemo(deps, { spaceId: spaceB, userId });
    expect(second).toEqual(first);
    expect(first.leadRefs).toEqual(["L-1", "L-2"]);
    expect(await prisma.erpProduct.count({ where: { spaceId: spaceB } })).toBe(3);
    expect(await prisma.crmCompany.count({ where: { spaceId: spaceB } })).toBe(2);
  });

  it("executes the human + AI CRM vertical slice: lead enrichment, qualification, follow-up completion, and duplicate detection", async () => {
    // 1. Human creates a lead and a duplicate company to test data hygiene
    const dupCompany = await ok<{ id: string }>(spaceA, "crm.company.create", {
      name: "Northwind",
      domain: "northwind.example",
    });
    expect(dupCompany.id).toBeDefined();

    const humanLead = await ok<CrmLead>(spaceA, "crm.lead.create", {
      title: "Inbound robotics inquiry",
      source: "website form",
      companyId: dupCompany.id,
      value: 4500,
    });

    // 2. AI Sales Executive bot enriches the lead, qualifies it, and schedules a follow-up task
    const updatedLead = await runBusinessTool(deps, {
      toolName: "crm_lead_update",
      args: {
        ref: humanLead.ref,
        title: "Northwind Automated Palletizer Line",
        notes: "AI enriched: 3 palletizer cells requested for Q3.",
        value: 18500,
      },
      spaceId: spaceA,
      userId,
      botId: salesBotId,
      runId: `run-slice-${suffix}`,
    });
    expect(updatedLead).toMatchObject({
      ref: humanLead.ref,
      title: "Northwind Automated Palletizer Line",
      value: 18500,
    });

    const qualifiedLead = await runBusinessTool(deps, {
      toolName: "crm_lead_qualify",
      args: {
        ref: humanLead.ref,
        status: "qualified",
      },
      spaceId: spaceA,
      userId,
      botId: salesBotId,
      runId: `run-slice-${suffix}`,
    });
    expect(qualifiedLead).toMatchObject({
      ref: humanLead.ref,
      status: "qualified",
    });

    const followUp = (await runBusinessTool(deps, {
      toolName: "crm_activity_create",
      args: {
        kind: "follow_up",
        subject: "Send palletizer layout proposal",
        leadId: humanLead.id,
        companyId: dupCompany.id,
        dueAt: new Date(Date.now() + 86400_000).toISOString(),
        assigneeBotId: salesBotId,
      },
      spaceId: spaceA,
      userId,
      botId: salesBotId,
      runId: `run-slice-${suffix}`,
    })) as { id: string; completedAt: string | null };
    expect(followUp.completedAt).toBeNull();

    // 3. AI bot detects duplicate Northwind company records
    const duplicates = (await runBusinessTool(deps, {
      toolName: "crm_company_find_duplicates",
      args: { limit: 10 },
      spaceId: spaceA,
      userId,
      botId: salesBotId,
      runId: `run-slice-${suffix}`,
    })) as { groups: Array<{ matchKey: string; companies: Array<{ id: string }> }> };
    expect(duplicates.groups.some((g) => g.matchKey === "northwind")).toBe(true);

    // 4. Human marks the follow-up task completed
    const completed = await ok<{ id: string; completedAt: string | null }>(
      spaceA,
      "crm.activity.complete",
      { id: followUp.id, completed: true },
    );
    expect(completed.completedAt).not.toBeNull();
  });
});
