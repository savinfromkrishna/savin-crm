import { describe, expect, it } from "vitest";
import { BUILTIN_TOOL_NAMES, isBuiltinToolName } from "./builtin-tools.js";
import {
  BUSINESS_ACTION_IDS,
  BUSINESS_CONSEQUENTIAL_TOOL_NAMES,
  BUSINESS_READ_TOOL_NAMES,
  BUSINESS_TOOL_NAMES,
  businessActionIdFromToolName,
  businessRef,
  businessToolName,
  isBusinessToolName,
  MoneySchema,
  moneyToDecimalString,
  parseBusinessRef,
  toMinorUnits,
} from "./business.js";
import { AssignLeadInput, ConvertLeadInput, CreateContactInput } from "./crm.js";
import { CreateOrderDraftInput, SkuSchema } from "./erp.js";

describe("business action vocabulary", () => {
  it("maps every action id to a unique built-in tool name and back", () => {
    const names = new Set<string>();
    for (const id of BUSINESS_ACTION_IDS) {
      const name = businessToolName(id);
      expect(name).toMatch(/^(crm|erp|admin)_[a-z_]+$/);
      expect(names.has(name)).toBe(false);
      names.add(name);
      expect(isBuiltinToolName(name)).toBe(true);
      expect(isBusinessToolName(name)).toBe(true);
      expect(businessActionIdFromToolName(name)).toBe(id);
    }
    expect(BUSINESS_TOOL_NAMES).toHaveLength(BUSINESS_ACTION_IDS.length);
    expect(businessActionIdFromToolName("ticket_create")).toBeUndefined();
    expect(BUILTIN_TOOL_NAMES.filter((name) => isBusinessToolName(name))).toHaveLength(
      BUSINESS_TOOL_NAMES.length,
    );
  });

  it("keeps reads and consequential writes disjoint", () => {
    const reads = new Set(BUSINESS_READ_TOOL_NAMES);
    for (const name of BUSINESS_CONSEQUENTIAL_TOOL_NAMES) {
      expect(reads.has(name), name).toBe(false);
    }
    expect(reads.has("erp_inventory_check")).toBe(true);
    expect(reads.has("admin_doctype_describe")).toBe(true);
    expect(BUSINESS_CONSEQUENTIAL_TOOL_NAMES).toContain("erp_order_confirm");
    expect(BUSINESS_CONSEQUENTIAL_TOOL_NAMES).toContain("admin_document_insert");
    expect(BUSINESS_CONSEQUENTIAL_TOOL_NAMES).toContain("admin_method_call");
    expect(BUSINESS_CONSEQUENTIAL_TOOL_NAMES).not.toContain("crm_lead_create");
  });

  it("formats and parses record refs", () => {
    expect(businessRef("SO", 12)).toBe("SO-12");
    expect(parseBusinessRef("so-12", "SO")).toBe(12);
    expect(parseBusinessRef("SO-0", "SO")).toBeNull();
    expect(parseBusinessRef("INV-3", "SO")).toBeNull();
  });

  it("accepts money with at most two decimals and keeps minor units exact", () => {
    expect(MoneySchema.safeParse(19.99).success).toBe(true);
    expect(MoneySchema.safeParse(19.999).success).toBe(false);
    expect(MoneySchema.safeParse(-1).success).toBe(false);
    expect(toMinorUnits(0.1 + 0.2)).toBe(30);
    expect(moneyToDecimalString(1299.5)).toBe("1299.50");
  });

  it("validates inputs the way a bot will send them", () => {
    expect(SkuSchema.parse(" sensor-x1 ")).toBe("SENSOR-X1");
    expect(SkuSchema.safeParse("bad sku!").success).toBe(false);
    expect(AssignLeadInput.safeParse({ ref: "L-1", assigneeBotId: "bot" }).success).toBe(true);
    expect(AssignLeadInput.safeParse({ ref: "L-1" }).success).toBe(false);
    expect(AssignLeadInput.safeParse({ assigneeBotId: "bot" }).success).toBe(false);
    expect(ConvertLeadInput.safeParse({ ref: "L-1" }).success).toBe(true);
    expect(CreateContactInput.safeParse({ firstName: "Dana", email: "nope" }).success).toBe(false);
    expect(CreateOrderDraftInput.parse({ dealRef: "D-1" })).toMatchObject({
      dealRef: "D-1",
      lines: [],
    });
  });
});
