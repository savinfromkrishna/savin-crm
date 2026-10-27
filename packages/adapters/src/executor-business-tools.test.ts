import { BUSINESS_TOOL_NAMES, isBusinessToolName } from "@savingroup/contracts";
import { describe, expect, it } from "vitest";
import { builtinAgentTools } from "./builtin-tools.js";
import {
  BUSINESS_APPS_INSTRUCTION,
  businessAppsClause,
  selectBuiltinToolsForRun,
} from "./executor.js";
import { BUSINESS_DEMO_SCRIPT, inferScript } from "./scripted-runtime.js";

const baseOptions = {
  graphicalToolsAllowed: false,
  groupId: null,
  trigger: "user",
  semanticMemoryEnabled: false,
  messagingChannelRun: false,
};

describe("business tools in a run", () => {
  it("registers every CRM OS and ERP OS action as a built-in tool", () => {
    const names = new Set(builtinAgentTools.map((tool) => tool.name));
    for (const name of BUSINESS_TOOL_NAMES) expect(names.has(name), name).toBe(true);
  });

  it("offers the tools only when the apps are enabled", () => {
    const off = selectBuiltinToolsForRun(baseOptions).map((tool) => tool.name);
    expect(off.some((name) => isBusinessToolName(name))).toBe(false);
    const on = selectBuiltinToolsForRun({ ...baseOptions, businessAppsEnabled: true }).map(
      (tool) => tool.name,
    );
    expect(on.filter((name) => isBusinessToolName(name)).sort()).toEqual(
      [...BUSINESS_TOOL_NAMES].sort(),
    );
  });

  it("honours a bot's disabled list so a sales bot never sees confirmation or payment tools", () => {
    const names = selectBuiltinToolsForRun({
      ...baseOptions,
      businessAppsEnabled: true,
      disabledBuiltinTools: [
        "erp_order_confirm",
        "erp_invoice_record_payment",
        "erp_inventory_adjust",
      ],
    }).map((tool) => tool.name);
    expect(names).toContain("crm_lead_create");
    expect(names).toContain("erp_inventory_check");
    expect(names).not.toContain("erp_order_confirm");
    expect(names).not.toContain("erp_invoice_record_payment");
    expect(names).not.toContain("erp_inventory_adjust");
  });

  it("keeps internal business records out of external messaging channel runs", () => {
    const names = selectBuiltinToolsForRun({
      ...baseOptions,
      businessAppsEnabled: true,
      messagingChannelRun: true,
    }).map((tool) => tool.name);
    expect(names.some((name) => isBusinessToolName(name))).toBe(false);
  });

  it("adds the systems-of-record guidance only when a business tool is actually offered", () => {
    expect(businessAppsClause(false)).toBeUndefined();
    expect(businessAppsClause(true)).toBe(BUSINESS_APPS_INSTRUCTION);
    expect(businessAppsClause(true, new Set(BUSINESS_TOOL_NAMES))).toBeUndefined();
    expect(businessAppsClause(true, new Set(["erp_order_confirm"]))).toBe(
      BUSINESS_APPS_INSTRUCTION,
    );
  });

  it("scripts the demo workflow through real tools, with the consequential steps in order", () => {
    expect(inferScript("Run the business demo workflow.")).toBe(BUSINESS_DEMO_SCRIPT);
    const calls = BUSINESS_DEMO_SCRIPT.flatMap((turn) => turn.toolCalls ?? []).map(
      (call) => call.name,
    );
    expect(calls.every((name) => isBusinessToolName(name))).toBe(true);
    expect(calls.indexOf("erp_order_request_approval")).toBeLessThan(
      calls.indexOf("erp_order_approve"),
    );
    expect(calls.indexOf("erp_order_confirm")).toBeLessThan(
      calls.indexOf("erp_invoice_create_draft"),
    );
    expect(BUSINESS_DEMO_SCRIPT.at(-1)).toMatchObject({ complete: true });
  });
});
