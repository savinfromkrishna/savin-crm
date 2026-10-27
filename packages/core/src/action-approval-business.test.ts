import { describe, expect, it } from "vitest";
import { toolRequiresApproval, unattendedTriggerToolRequiresApproval } from "./action-approval.js";

describe("business tool approval classification", () => {
  it("asks before stock, order confirmation, invoicing and payment changes", () => {
    for (const name of [
      "erp_inventory_adjust",
      "erp_order_approve",
      "erp_order_confirm",
      "erp_order_cancel",
      "erp_invoice_issue",
      "erp_invoice_record_payment",
    ]) {
      expect(toolRequiresApproval(name, false), name).toBe(true);
    }
  });

  it("lets routine CRM upkeep run without an approval card by default", () => {
    for (const name of [
      "crm_lead_create",
      "crm_lead_qualify",
      "crm_deal_update_stage",
      "crm_activity_create",
      "erp_order_create_draft",
      "erp_order_request_approval",
      "erp_invoice_create_draft",
    ]) {
      expect(toolRequiresApproval(name, false), name).toBe(false);
    }
  });

  it("treats business reads as safe for unattended webhook runs and writes as not", () => {
    expect(unattendedTriggerToolRequiresApproval("webhook", "crm_lead_search", false)).toBe(false);
    expect(unattendedTriggerToolRequiresApproval("webhook", "erp_inventory_check", false)).toBe(
      false,
    );
    expect(unattendedTriggerToolRequiresApproval("webhook", "crm_lead_create", false)).toBe(true);
  });
});
