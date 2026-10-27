import {
  BUSINESS_ACTION_IDS,
  BUSINESS_READ_TOOL_NAMES,
  businessToolName,
  isBusinessReadActionId,
} from "@savingroup/contracts";
import { describe, expect, it } from "vitest";
import { BUSINESS_ACTIONS, getBusinessAction, listBusinessActionDescriptors } from "./registry.js";
import { businessAgentTools } from "./tools.js";

describe("business action registry", () => {
  it("defines every action id from the contract exactly once", () => {
    const ids = BUSINESS_ACTIONS.map((action) => action.id);
    expect([...ids].sort()).toEqual([...BUSINESS_ACTION_IDS].sort());
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of BUSINESS_ACTION_IDS) expect(getBusinessAction(id).version).toBe(1);
  });

  it("agrees with the contract on which actions are reads", () => {
    for (const action of BUSINESS_ACTIONS) {
      expect(action.kind === "read", action.id).toBe(isBusinessReadActionId(action.id));
      if (action.kind === "write") {
        expect(action.recordType, action.id).toBeDefined();
        expect(action.recordId, action.id).toBeDefined();
      }
    }
  });

  it("derives the model-facing tools from the registry", () => {
    expect(businessAgentTools.map((tool) => tool.name)).toEqual(
      BUSINESS_ACTIONS.map((action) => businessToolName(action.id)),
    );
    for (const tool of businessAgentTools) {
      expect(tool.inputSchema).toMatchObject({ type: "object" });
      expect(tool.inputSchema).not.toHaveProperty("$schema");
      const properties = tool.inputSchema.properties as Record<string, unknown>;
      // Bots never pick idempotency keys; the executor derives one per run and call.
      expect(properties).not.toHaveProperty("idempotencyKey");
      expect(tool.readOnly ?? false).toBe(BUSINESS_READ_TOOL_NAMES.includes(tool.name as never));
      expect(tool.description.length).toBeGreaterThan(10);
    }
    const confirm = businessAgentTools.find((tool) => tool.name === "erp_order_confirm");
    expect(confirm?.inputSchema.properties).toMatchObject({
      ref: expect.objectContaining({ type: "string" }),
    });
  });

  it("publishes descriptors with the approval classification", () => {
    const descriptors = listBusinessActionDescriptors();
    expect(
      descriptors.find((entry) => entry.id === ("erp_order_confirm" as never)),
    ).toBeUndefined();
    expect(descriptors.find((entry) => entry.id === "erp.order.confirm")).toMatchObject({
      toolName: "erp_order_confirm",
      kind: "write",
      consequential: true,
    });
    expect(descriptors.find((entry) => entry.id === "crm.lead.create")).toMatchObject({
      kind: "write",
      consequential: false,
    });
    expect(descriptors.find((entry) => entry.id === "erp.inventory.check")).toMatchObject({
      kind: "read",
      consequential: false,
    });
    expect(descriptors.find((entry) => entry.id === "crm.company.find_duplicates")).toMatchObject({
      toolName: "crm_company_find_duplicates",
      kind: "read",
      consequential: false,
    });
    expect(descriptors.find((entry) => entry.id === "crm.contact.find_duplicates")).toMatchObject({
      toolName: "crm_contact_find_duplicates",
      kind: "read",
      consequential: false,
    });
    expect(descriptors.find((entry) => entry.id === "crm.lead.update")).toMatchObject({
      toolName: "crm_lead_update",
      kind: "write",
      consequential: false,
    });
    expect(descriptors.find((entry) => entry.id === "crm.activity.complete")).toMatchObject({
      toolName: "crm_activity_complete",
      kind: "write",
      consequential: false,
    });
  });
});
