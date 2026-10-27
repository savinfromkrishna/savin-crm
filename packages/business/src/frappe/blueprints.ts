import type { BusinessBlueprintId } from "@savingroup/contracts";

/**
 * A blueprint is the versioned recipe a business environment is built from:
 * which Frappe apps, the company's country defaults, fiscal year and chart.
 * They are code, not rows, so a deployment cannot drift from what was tested.
 *
 * India is the first standard target. The generic blueprint proves the same
 * machinery with a different country, currency and fiscal year; nothing in
 * the gateway assumes GST or an April fiscal year.
 */
export interface BusinessBlueprint {
  id: BusinessBlueprintId;
  version: number;
  label: string;
  /** Frappe app names installed on the site, in install order. */
  apps: readonly string[];
  country: string;
  currency: string;
  timezone: string;
  language: string;
  /** ERPNext chart template name; "Standard" is the country-neutral template. */
  chartOfAccounts: string;
  /** Month (1-12) the fiscal year starts on the 1st of. */
  fiscalYearStartMonth: number;
  /** Defaults for the site's selling and stock settings. */
  defaultWarehouse: string;
  defaultItemGroup: string;
  defaultUom: string;
  defaultCustomerGroup: string;
  defaultTerritory: string;
  defaultPriceList: string;
}

export const BUSINESS_BLUEPRINTS: Record<BusinessBlueprintId, BusinessBlueprint> = {
  "india-smb": {
    id: "india-smb",
    version: 1,
    label: "India SMB",
    apps: ["frappe", "erpnext", "crm", "india_compliance", "savingroup_business_bridge"],
    country: "India",
    currency: "INR",
    timezone: "Asia/Kolkata",
    language: "English",
    chartOfAccounts: "Standard",
    fiscalYearStartMonth: 4,
    defaultWarehouse: "Stores",
    defaultItemGroup: "Products",
    defaultUom: "Nos",
    defaultCustomerGroup: "Commercial",
    defaultTerritory: "India",
    defaultPriceList: "Standard Selling",
  },
  generic: {
    id: "generic",
    version: 1,
    label: "Generic",
    apps: ["frappe", "erpnext", "crm", "savingroup_business_bridge"],
    country: "United States",
    currency: "USD",
    timezone: "America/New_York",
    language: "English",
    chartOfAccounts: "Standard",
    fiscalYearStartMonth: 1,
    defaultWarehouse: "Stores",
    defaultItemGroup: "Products",
    defaultUom: "Nos",
    defaultCustomerGroup: "Commercial",
    defaultTerritory: "All Territories",
    defaultPriceList: "Standard Selling",
  },
};

export function getBusinessBlueprint(id: BusinessBlueprintId): BusinessBlueprint {
  return BUSINESS_BLUEPRINTS[id];
}

/** The fiscal year containing `now`, as ERPNext's setup wizard wants it. */
export function fiscalYearBounds(
  blueprint: Pick<BusinessBlueprint, "fiscalYearStartMonth">,
  now: Date,
): { start: string; end: string; label: string } {
  const month = blueprint.fiscalYearStartMonth;
  const year = now.getUTCMonth() + 1 >= month ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year + 1, month - 1, 0));
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  const label = month === 1 ? String(year) : `${year}-${String(year + 1).slice(2)}`;
  return { start: iso(start), end: iso(end), label };
}
