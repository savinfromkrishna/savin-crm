import type { PrismaClient } from "@savingroup/db";
import { describe, expect, it, vi } from "vitest";
import { executeBusinessAction } from "../execute.js";
import { runBusinessTool } from "../tools.js";

function createFakeCrmDb() {
  const companies = [
    {
      id: "comp-1",
      spaceId: "space-1",
      name: "Acme Robotics Inc.",
      domain: "https://www.acme-robotics.example/about",
      phone: "+1 (555) 010-9900",
      notes: null,
      createdByUserId: "user-1",
      createdByBotId: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-02T00:00:00Z"),
    },
    {
      id: "comp-2",
      spaceId: "space-1",
      name: "Acme Robotics",
      domain: "acme-robotics.example",
      phone: "15550109900",
      notes: "Duplicate entry from trade show",
      createdByUserId: null,
      createdByBotId: "bot-sales",
      createdAt: new Date("2026-01-03T00:00:00Z"),
      updatedAt: new Date("2026-01-03T00:00:00Z"),
    },
    {
      id: "comp-3",
      spaceId: "space-1",
      name: "Northwind Traders",
      domain: "northwind.example",
      phone: "+1 555 0199",
      notes: null,
      createdByUserId: "user-1",
      createdByBotId: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    },
  ];

  const contacts = [
    {
      id: "cont-1",
      spaceId: "space-1",
      firstName: "Dana",
      lastName: "Reyes",
      email: "Dana@Acme-Robotics.example",
      phone: "+1 555 010 1111",
      title: "VP Procurement",
      notes: null,
      companyId: "comp-1",
      company: { name: "Acme Robotics Inc." },
      createdByUserId: "user-1",
      createdByBotId: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    },
    {
      id: "cont-2",
      spaceId: "space-1",
      firstName: "Dana",
      lastName: "M. Reyes",
      email: "dana@acme-robotics.example",
      phone: null,
      title: "Head of Procurement",
      notes: null,
      companyId: "comp-2",
      company: { name: "Acme Robotics" },
      createdByUserId: null,
      createdByBotId: "bot-sales",
      createdAt: new Date("2026-01-02T00:00:00Z"),
      updatedAt: new Date("2026-01-02T00:00:00Z"),
    },
  ];

  const tx = {
    crmCompany: {
      findMany: vi.fn(async () => companies),
    },
    crmContact: {
      findMany: vi.fn(async () => contacts),
    },
    crmLead: {
      findFirst: vi.fn(async () => ({
        id: "lead-1",
        spaceId: "space-1",
        number: 1,
        title: "Initial Lead",
        status: "new",
        source: "web",
        notes: null,
        value: null,
        companyId: "comp-1",
        contactId: "cont-1",
        assigneeUserId: null,
        assigneeBotId: "bot-sales",
        convertedDealId: null,
        createdByUserId: "user-1",
        createdByBotId: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "lead-1",
        spaceId: "space-1",
        number: 1,
        title: (data.title as string) ?? "Initial Lead",
        status: "new",
        source: (data.source as string | null) ?? "web",
        notes: (data.notes as string | null) ?? null,
        value: data.value ?? null,
        companyId: "comp-1",
        company: { name: "Acme Robotics Inc." },
        contactId: "cont-1",
        contact: { firstName: "Dana", lastName: "Reyes" },
        assigneeUserId: null,
        assigneeBotId: "bot-sales",
        convertedDealId: null,
        createdByUserId: "user-1",
        createdByBotId: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-04T00:00:00Z"),
      })),
    },
    crmActivity: {
      findFirst: vi.fn(async () => ({
        id: "act-1",
        spaceId: "space-1",
        kind: "follow_up",
        subject: "Send technical spec",
        body: null,
        dueAt: new Date("2026-01-05T00:00:00Z"),
        completedAt: null,
        companyId: "comp-1",
        contactId: "cont-1",
        leadId: "lead-1",
        dealId: null,
        assigneeUserId: null,
        assigneeBotId: "bot-sales",
        createdByUserId: null,
        createdByBotId: "bot-sales",
        createdAt: new Date("2026-01-02T00:00:00Z"),
        updatedAt: new Date("2026-01-02T00:00:00Z"),
      })),
      update: vi.fn(async ({ data }: { data: { completedAt: Date | null } }) => ({
        id: "act-1",
        spaceId: "space-1",
        kind: "follow_up",
        subject: "Send technical spec",
        body: null,
        dueAt: new Date("2026-01-05T00:00:00Z"),
        completedAt: data.completedAt,
        companyId: "comp-1",
        contactId: "cont-1",
        leadId: "lead-1",
        dealId: null,
        assigneeUserId: null,
        assigneeBotId: "bot-sales",
        createdByUserId: null,
        createdByBotId: "bot-sales",
        createdAt: new Date("2026-01-02T00:00:00Z"),
        updatedAt: new Date("2026-01-04T00:00:00Z"),
      })),
    },
    businessEvent: {
      create: vi.fn(async () => ({})),
      findMany: vi.fn(async () => []),
      update: vi.fn(async () => ({})),
    },
    businessActionLog: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
    },
    user: {
      findMany: vi.fn(async () => [{ id: "user-1", name: "Alex" }]),
    },
    bot: {
      findFirst: vi.fn(async () => ({ disabledBuiltinTools: [], archivedAt: null })),
      findMany: vi.fn(async () => [
        { id: "bot-sales", name: "Sales Executive" },
        { id: "bot-steward", name: "CRM Data Steward" },
      ]),
    },
  };

  const prisma = {
    ...tx,
    $transaction: vi.fn(async (run: (client: unknown) => Promise<unknown>) => run(tx)),
  } as unknown as PrismaClient;

  return { prisma, tx };
}

describe("CRM duplicate detection & vertical slice unit tests", () => {
  it("detects duplicate companies by normalized domain and phone", async () => {
    const { prisma } = createFakeCrmDb();
    const res = await runBusinessTool(
      { prisma, enabled: true },
      {
        toolName: "crm_company_find_duplicates",
        args: { limit: 20 },
        spaceId: "space-1",
        userId: "user-1",
        botId: "bot-steward",
        runId: "run-steward-1",
      },
    );
    expect(res).toMatchObject({
      groups: [
        {
          reason: "Matching domain: acme-robotics.example",
          matchKey: "acme-robotics.example",
          companies: expect.arrayContaining([
            expect.objectContaining({ id: "comp-1" }),
            expect.objectContaining({ id: "comp-2" }),
          ]),
        },
      ],
    });
  });

  it("detects duplicate contacts by normalized email", async () => {
    const { prisma } = createFakeCrmDb();
    const res = await runBusinessTool(
      { prisma, enabled: true },
      {
        toolName: "crm_contact_find_duplicates",
        args: { limit: 20 },
        spaceId: "space-1",
        userId: "user-1",
        botId: "bot-steward",
        runId: "run-steward-1",
      },
    );
    expect(res).toMatchObject({
      groups: [
        {
          reason: "Matching email address: dana@acme-robotics.example",
          matchKey: "dana@acme-robotics.example",
          contacts: expect.arrayContaining([
            expect.objectContaining({ id: "cont-1" }),
            expect.objectContaining({ id: "cont-2" }),
          ]),
        },
      ],
    });
  });

  it("updates a lead via crm.lead.update and emits crm.lead.updated", async () => {
    const { prisma, tx } = createFakeCrmDb();
    const result = await executeBusinessAction(
      { prisma, enabled: true },
      "crm.lead.update",
      {
        ref: "L-1",
        title: "Acme Line 4 Expansion",
        source: "partner referral",
        notes: "Validated budget with procurement.",
        value: 14500,
      },
      { spaceId: "space-1", actor: { userId: "user-1", botId: "bot-sales" }, runId: "run-sales-1" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.data).toMatchObject({
      id: "lead-1",
      ref: "L-1",
      title: "Acme Line 4 Expansion",
      source: "partner referral",
      notes: "Validated budget with procurement.",
      value: 14500,
    });
    expect(tx.businessEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "crm.lead.updated",
          recordType: "lead",
          recordId: "lead-1",
        }),
      }),
    );
  });

  it("completes and reopens a follow-up activity via crm.activity.complete", async () => {
    const { prisma, tx } = createFakeCrmDb();
    const completed = await executeBusinessAction(
      { prisma, enabled: true },
      "crm.activity.complete",
      { id: "act-1", completed: true },
      { spaceId: "space-1", actor: { userId: "user-1" } },
    );
    expect(completed.ok).toBe(true);
    if (!completed.ok) throw new Error("expected success");
    expect(completed.data).toMatchObject({
      id: "act-1",
      completedAt: expect.any(String),
    });
    expect(tx.businessEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "crm.activity.completed",
          recordType: "activity",
          recordId: "act-1",
        }),
      }),
    );
  });
});
