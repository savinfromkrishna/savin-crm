import type { Actor } from "@savingroup/contracts";
import {
  BUSINESS_ACTION_IDS,
  BUSINESS_CONSEQUENTIAL_TOOL_NAMES,
  BUSINESS_TOOL_NAMES,
} from "@savingroup/contracts";
import type { PrismaClient } from "@savingroup/db";
import { describe, expect, it, vi } from "vitest";
import {
  BUSINESS_OPERATOR_ROLE,
  BUSINESS_TEAM,
  businessAutonomyToolNames,
  disabledToolsForRole,
  grantBusinessAutonomy,
} from "./team.js";

const ADMIN_TOOLS = BUSINESS_TOOL_NAMES.filter((name) => name.startsWith("admin_"));

describe("business team roles", () => {
  it("gives the Operator every business tool and keeps site administration from the specialists", () => {
    expect(disabledToolsForRole(BUSINESS_OPERATOR_ROLE.allowedActions)).toEqual([]);
    expect(BUSINESS_OPERATOR_ROLE.allowedActions).toHaveLength(BUSINESS_ACTION_IDS.length);
    expect(ADMIN_TOOLS.length).toBeGreaterThan(0);
    for (const role of BUSINESS_TEAM) {
      expect(disabledToolsForRole(role.allowedActions), role.name).toEqual(
        expect.arrayContaining(ADMIN_TOOLS),
      );
    }
  });

  it("tells the Operator to decide within policy instead of pausing for a person", () => {
    expect(BUSINESS_OPERATOR_ROLE.instructions).toContain("admin_doctype_describe");
    expect(BUSINESS_OPERATOR_ROLE.instructions).not.toContain("ask one short question");
    expect(BUSINESS_OPERATOR_ROLE.spawnKey).toBe("business:operator");
  });

  it("includes the CRM Data Steward role with duplicate detection and hygiene tools", () => {
    const steward = BUSINESS_TEAM.find((role) => role.spawnKey === "business:steward");
    expect(steward).toBeDefined();
    expect(steward?.name).toBe("CRM Data Steward");
    expect(steward?.allowedActions).toEqual(
      expect.arrayContaining([
        "crm.company.find_duplicates",
        "crm.contact.find_duplicates",
        "crm.company.update",
        "crm.contact.update",
        "crm.lead.update",
        "crm.activity.create",
        "crm.activity.complete",
      ]),
    );
  });
});

describe("autonomy grant", () => {
  it("lets every consequential tool run unattended, except deletion unless asked", () => {
    const allowed = businessAutonomyToolNames({});
    for (const name of BUSINESS_CONSEQUENTIAL_TOOL_NAMES) {
      expect(allowed.includes(name), name).toBe(name !== "admin_document_delete");
    }
    expect(allowed).toContain("archive_bot");
    expect(businessAutonomyToolNames({ allowDelete: true })).toContain("admin_document_delete");
  });

  it("replaces the owner's pause rules with always-allow rules in that space", async () => {
    const deleteMany = vi.fn(async () => ({ count: 1 }));
    const createMany = vi.fn(async () => ({ count: 1 }));
    const prisma = { actionApprovalRule: { deleteMany, createMany } } as unknown as PrismaClient;
    const actor: Actor = {
      userId: "owner",
      spaceId: "space-1",
      email: "owner@example.com",
      isDeploymentOwner: true,
    };
    const outcome = await grantBusinessAutonomy(prisma, actor);
    expect(outcome.stillGated).toEqual(["admin_document_delete"]);
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        spaceId: "space-1",
        createdByUserId: "owner",
        effect: "require_approval",
        matchKind: "tool",
        matchValue: { in: outcome.allowed },
      },
    });
    const call = createMany.mock.calls[0]?.[0] as unknown as {
      data: Array<{ effect: string; matchKind: string; matchValue: string }>;
      skipDuplicates: boolean;
    };
    expect(call.skipDuplicates).toBe(true);
    expect(
      call.data.every((row) => row.effect === "always_allow" && row.matchKind === "tool"),
    ).toBe(true);
    expect(call.data.map((row) => row.matchValue)).toEqual(outcome.allowed);
  });
});
