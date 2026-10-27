import { expect, test } from "@playwright/test";
import { captureScreenshot } from "./helpers";

const fixture = (path: string, extra = "") =>
  `/e2e/fixtures/business.html?path=${encodeURIComponent(path)}${extra}`;

test("the Operator approves an order from the ERP assistant and the list updates live", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(fixture("/app/erp?tab=orders", "&assistant=approval"));

  const pending = page.getByTestId("erp-orders-row").filter({ hasText: "SO-2" });
  await expect(pending).toContainText("Pending approval");

  // A first visit on a wide screen opens the Operator beside the records.
  const toggle = page.getByTestId("assistant-toggle");
  await expect(toggle).toContainText("Ask Operator");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  const assistant = page.getByTestId("business-assistant");
  await expect(assistant).toContainText("What needs my approval today?");
  await expect(assistant).toContainText("Review before erp_order_approve");
  await captureScreenshot(page, testInfo, "business-assistant-approval");

  await assistant.getByRole("button", { name: "Allow once" }).click();
  await expect(assistant).toContainText("SO-2 is approved.");
  // The bot's change reaches the open list through the live business stream.
  await expect(pending).toContainText("Approved");
  await expect(pending).not.toContainText("Pending approval");
  await captureScreenshot(page, testInfo, "business-assistant-approved");
});

test("asks the assistant about a lead from its dialog", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(fixture("/app/crm?tab=leads"));

  await page.getByTestId("crm-leads-row").filter({ hasText: "L-2" }).click();
  const lead = page.getByRole("dialog", { name: "L-2 · Kaveri dyeing sensors" });
  await lead.getByTestId("assistant-ask").click();
  await expect(lead).toBeHidden();

  const assistant = page.getByTestId("business-assistant");
  await expect(assistant.getByTestId("assistant-record")).toContainText("L-2");
  await expect(assistant.getByTestId("assistant-record")).toContainText("Kaveri dyeing sensors");
  await expect(assistant.getByRole("combobox", { name: "Message Operator" })).toBeFocused();
  await assistant.getByRole("button", { name: "Draft a follow-up email" }).click();

  await expect(assistant).toContainText(
    "Lead L-2 (Kaveri dyeing sensors): Draft a follow-up email",
  );
  await expect(assistant).toContainText("Here is a follow-up for L-2");
  await expect(assistant.getByTestId("assistant-record")).toBeHidden();
  await captureScreenshot(page, testInfo, "business-assistant-lead");

  // The panel stays open across sections; the conversation is the bot's own.
  await page.getByTestId("business-nav").getByRole("link", { name: "Invoices" }).click();
  await expect(assistant).toContainText("Here is a follow-up for L-2");
  await assistant.getByRole("button", { name: "Close" }).click();
  await expect(assistant).toBeHidden();
  // Closing is remembered.
  await page.reload();
  await expect(page.getByTestId("crm-leads-row").first()).toBeVisible();
  await expect(page.getByTestId("assistant-toggle")).toHaveAttribute("aria-pressed", "false");
  await expect(assistant).toBeHidden();
});

test("the assistant covers the page on a phone without sideways scrolling", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(fixture("/app/erp?tab=invoices", "&theme=light"));

  await page.getByTestId("assistant-toggle").click();
  const assistant = page.getByTestId("business-assistant");
  await expect(assistant).toBeVisible();
  await expect(assistant.getByRole("button", { name: "Which invoices are unpaid?" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await captureScreenshot(page, testInfo, "business-assistant-phone-light");

  await assistant.getByRole("button", { name: "Close" }).click();
  await expect(assistant).toBeHidden();
});
