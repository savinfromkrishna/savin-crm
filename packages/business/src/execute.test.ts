import type { PrismaClient } from "@savingroup/db";
import { describe, expect, it, vi } from "vitest";
import { executeBusinessAction } from "./execute.js";
import { runBusinessTool } from "./tools.js";

/**
 * The executor's own rules, with the database faked: these never reach a
 * service. Service behaviour against PostgreSQL lives in business.postgres.test.ts.
 */
function fakePrisma(overrides: Record<string, unknown> = {}) {
  return {
    bot: { findFirst: vi.fn(async () => ({ disabledBuiltinTools: [], archivedAt: null })) },
    businessActionLog: { findUnique: vi.fn(async () => null), create: vi.fn(async () => ({})) },
    businessEvent: { findMany: vi.fn(async () => []), update: vi.fn() },
    $transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) =>
      run({ businessActionLog: { create: vi.fn(async () => ({})) } }),
    ),
    ...overrides,
  } as unknown as PrismaClient;
}

const user = { userId: "user-1" };

describe("executeBusinessAction", () => {
  it("refuses everything while the apps are disabled", async () => {
    const result = await executeBusinessAction(
      { prisma: fakePrisma(), enabled: false },
      "crm.company.create",
      { name: "Acme" },
      { spaceId: "space-1", actor: user },
    );
    expect(result).toMatchObject({ ok: false, error: { code: "unavailable" } });
  });

  it("rejects invalid input with field-level issues before touching the database", async () => {
    const prisma = fakePrisma();
    const result = await executeBusinessAction(
      { prisma, enabled: true },
      "crm.lead.create",
      { title: "", value: -5 },
      { spaceId: "space-1", actor: user },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("invalid_input");
    expect(result.error.issues?.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(["title", "value"]),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("denies a bot whose role disabled the tool, from the stored bot row", async () => {
    const prisma = fakePrisma({
      bot: {
        findFirst: vi.fn(async () => ({
          disabledBuiltinTools: ["erp_order_confirm"],
          archivedAt: null,
        })),
      },
    });
    const result = await executeBusinessAction(
      { prisma, enabled: true },
      "erp.order.confirm",
      { ref: "SO-1" },
      { spaceId: "space-1", actor: { userId: "owner", botId: "bot-sales" }, runId: "run-1" },
    );
    expect(result).toMatchObject({ ok: false, error: { code: "permission_denied" } });
    expect(prisma.bot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "bot-sales", spaceId: "space-1" } }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("denies a bot that is not in the workspace even when the model names a valid action", async () => {
    const prisma = fakePrisma({ bot: { findFirst: vi.fn(async () => null) } });
    const result = await executeBusinessAction(
      { prisma, enabled: true },
      "crm.company.search",
      {},
      { spaceId: "space-1", actor: { userId: "owner", botId: "bot-foreign" } },
    );
    expect(result).toMatchObject({ ok: false, error: { code: "permission_denied" } });
  });

  it("replays a committed write for a repeated idempotency key instead of running again", async () => {
    const stored = { id: "company-1", name: "Acme" };
    const prisma = fakePrisma({
      businessActionLog: {
        findUnique: vi.fn(async () => ({
          outcome: "succeeded",
          result: stored,
          errorCode: null,
          actionId: "crm.company.create",
        })),
        create: vi.fn(),
      },
    });
    const result = await executeBusinessAction(
      { prisma, enabled: true },
      "crm.company.create",
      { name: "Acme", idempotencyKey: "req-1" },
      { spaceId: "space-1", actor: user },
    );
    expect(result).toEqual({ ok: true, replayed: true, data: stored });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("runBusinessTool", () => {
  it("derives a per-run idempotency key and never trusts one from the model", async () => {
    const transaction = vi.fn(async (run: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        crmCompany: {
          create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
            id: "company-1",
            spaceId: "space-1",
            name: data.name,
            domain: null,
            phone: null,
            notes: null,
            createdByUserId: data.createdByUserId,
            createdByBotId: data.createdByBotId,
            createdAt: new Date("2026-01-01T00:00:00Z"),
            updatedAt: new Date("2026-01-01T00:00:00Z"),
          })),
        },
        businessEvent: { create: vi.fn(async () => ({})) },
        businessActionLog: { create: vi.fn(async () => ({})) },
        user: { findMany: vi.fn(async () => []) },
        bot: { findMany: vi.fn(async () => [{ id: "bot-1", name: "Sales" }]) },
      };
      return run(tx);
    });
    const prisma = fakePrisma({ $transaction: transaction });
    const result = await runBusinessTool(
      { prisma, enabled: true },
      {
        toolName: "crm_company_create",
        args: { name: "Acme", idempotencyKey: "model-chosen" },
        spaceId: "space-1",
        userId: "owner",
        botId: "bot-1",
        runId: "run-1",
      },
    );
    expect(result).toMatchObject({ id: "company-1", name: "Acme", createdBy: { botId: "bot-1" } });
    expect(transaction).toHaveBeenCalledOnce();
    expect(prisma.businessActionLog.findUnique).toHaveBeenCalledWith({
      where: {
        spaceId_idempotencyKey: {
          spaceId: "space-1",
          idempotencyKey: expect.stringMatching(/^run-1:crm_company_create:[a-f0-9]{64}$/),
        },
      },
    });
  });

  it("has nothing to administer on the prototype tables", async () => {
    const result = await executeBusinessAction(
      { prisma: fakePrisma(), enabled: true },
      "admin.doctype.list",
      {},
      { spaceId: "space-1", actor: user },
    );
    expect(result).toMatchObject({ ok: false, error: { code: "unavailable" } });
  });

  it("turns failures into an error the model can act on", async () => {
    const result = await runBusinessTool(
      { prisma: fakePrisma(), enabled: true },
      {
        toolName: "erp_inventory_adjust",
        args: { sku: "X", delta: 0, reason: "" },
        spaceId: "space-1",
        userId: "owner",
        botId: "bot-1",
      },
    );
    expect(result).toMatchObject({
      code: "invalid_input",
      error: expect.stringContaining("delta"),
    });
    expect(
      await runBusinessTool(
        { prisma: fakePrisma(), enabled: true },
        {
          toolName: "not_a_tool",
          args: {},
          spaceId: "space-1",
          userId: "owner",
          botId: "bot-1",
        },
      ),
    ).toMatchObject({ error: expect.stringContaining("Unknown") });
  });
});
