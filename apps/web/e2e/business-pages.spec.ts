import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { captureScreenshot } from "./helpers";

const fixture = (path: string, theme?: "light") =>
  `/e2e/fixtures/business.html?path=${encodeURIComponent(path)}${theme ? `&theme=${theme}` : ""}`;

async function expectNoPageScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

test("CRM leads, pipeline and navigation between CRM and ERP", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(fixture("/app/crm?tab=leads"));

  const nav = page.getByTestId("business-nav");
  await expect(nav.getByRole("link", { name: "Leads" })).toHaveAttribute("aria-current", "page");
  const rows = page.getByTestId("crm-leads-row");
  await expect(rows).toHaveCount(5);
  await expect(rows.first()).toContainText("Acme line upgrade");
  await expect(rows.first()).toContainText("Qualified");
  await captureScreenshot(page, testInfo, "business-crm-leads");

  await page.getByRole("button", { name: "Converted", exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Sahyadri cold-chain monitoring");
  await page.getByRole("button", { name: "All statuses", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search" }).fill("kaveri");
  await expect(rows).toHaveCount(1);

  // Rows open from the keyboard as well as the pointer.
  await rows.first().focus();
  await page.keyboard.press("Enter");
  const lead = page.getByRole("dialog", { name: "L-2 · Kaveri dyeing sensors" });
  await expect(lead).toBeVisible();
  await expect(lead.getByRole("button", { name: "Qualified", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(lead).toBeHidden();

  await nav.getByRole("link", { name: "Deals" }).click();
  const pipeline = page.getByTestId("crm-pipeline");
  await expect(pipeline.getByRole("region")).toHaveCount(5);
  await expect(pipeline.getByRole("region", { name: "Won" })).toContainText("Northwind retrofit");
  await captureScreenshot(page, testInfo, "business-crm-pipeline");

  await nav.getByRole("link", { name: "Products" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Products" })).toBeVisible();
  await expect(page.getByTestId("erp-products-row")).toHaveCount(6);

  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(nav).toHaveAttribute("data-collapsed", "true");
  await expect(nav.getByRole("link", { name: "ERP Products" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(nav).toHaveAttribute("data-collapsed", "false");
});

test("CRM overview charts the pipeline and opens a deal from it", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(fixture("/app/crm"));

  await expect(page.getByTestId("crm-overview")).toContainText("Pipeline value");
  await expect(page.getByTestId("crm-stages")).toContainText("Negotiation");
  await expect(page.getByTestId("crm-follow-ups")).toContainText("Share CTRL-200 datasheet");
  await expect(page.getByTestId("crm-lead-statuses")).toContainText("Converted");
  await captureScreenshot(page, testInfo, "business-crm-overview");

  await page
    .getByTestId("crm-top-deals")
    .getByRole("link", { name: /Acme line upgrade/ })
    .click();
  await expect(page.getByRole("dialog", { name: "D-1 · Acme line upgrade" })).toBeVisible();
});

test("ERP overview cards open the work waiting on a person", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(fixture("/app/erp"));

  await expect(page.getByTestId("erp-overview")).toBeVisible();
  await expect(page.getByTestId("erp-attention")).toContainText("Sahyadri Agro Foods");
  await expect(page.getByTestId("erp-top-products")).toContainText("PLC controller, 200 series");
  await expect(page.getByRole("region", { name: "Business system" })).toContainText("Active");
  // The connected site's own apps are a click away, through its sign-in.
  await expect(
    page.getByTestId("business-nav").getByRole("link", { name: "Savingroup CRM" }),
  ).toHaveAttribute("href", "http://erp.example.test/login?redirect-to=%2Fcrm");
  await captureScreenshot(page, testInfo, "business-erp-overview");

  await page.getByRole("link", { name: /Awaiting approval/ }).click();
  await expect(page.getByRole("button", { name: "Pending approval", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const rows = page.getByTestId("erp-orders-row");
  await expect(rows).toHaveCount(1);
  await rows.first().click();

  const order = page.getByRole("dialog", { name: "SO-2 · Sahyadri Agro Foods" });
  await expect(order.getByTestId("order-lines")).toContainText("CTRL-200");
  await expect(order.getByRole("button", { name: "Approve", exact: true })).toBeVisible();
  await expect(order.getByRole("button", { name: "Cancel order", exact: true })).toBeVisible();
  await expect(order.getByTestId("business-history")).toContainText("Approval requested");
  // The same order in the ERPNext desk, through the site's sign-in.
  await expect(order.getByRole("link", { name: "Open in Savingroup ERP" })).toHaveAttribute(
    "href",
    "http://erp.example.test/login?redirect-to=%2Fdesk%2Fsales-order%2Forder-2",
  );
  await captureScreenshot(page, testInfo, "business-erp-order");

  // An item waiting on a person opens that record straight from the overview.
  await page.keyboard.press("Escape");
  await page.getByTestId("business-nav").getByRole("link", { name: "Overview" }).last().click();
  await page
    .getByTestId("erp-attention")
    .getByRole("link", { name: /Northwind Pumps/ })
    .click();
  await expect(page.getByRole("dialog", { name: "INV-1 · Northwind Pumps" })).toContainText(
    "Outstanding",
  );
});

test("business pages fit a phone without sideways scrolling", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/app/crm", "/app/crm?tab=leads", "/app/erp", "/app/erp?tab=orders"]) {
    await page.goto(fixture(path));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("business-nav")).toBeHidden();
    await expectNoPageScroll(page);
  }
  await captureScreenshot(page, testInfo, "business-erp-orders-phone");

  await page.goto(fixture("/app/erp?tab=invoices", "light"));
  await page.getByTestId("erp-invoices-row").first().click();
  await expect(page.getByRole("dialog")).toContainText("Outstanding");
  await expectNoPageScroll(page);
  await captureScreenshot(page, testInfo, "business-erp-invoice-phone-light");
});
