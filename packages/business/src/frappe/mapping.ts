import type {
  ActivityKind,
  BusinessActor,
  CrmActivity,
  CrmCompany,
  CrmContact,
  CrmDeal,
  CrmLead,
  DealStage,
  ErpInvoice,
  ErpProduct,
  ErpSalesOrder,
  InventoryLevel,
  InvoiceLine,
  LeadStatus,
  OrderLine,
  OrderStatus,
  PaymentStatus,
} from "@savingroup/contracts";
import { ACTIVITY_KINDS } from "@savingroup/contracts";
import type { AttributionResolver } from "../attribution.js";

/**
 * Frappe documents in, Savingroup contract records out. The shapes the UI and the
 * bots see do not change when an organization moves from the prototype tables
 * to its ERPNext + Frappe CRM site; only the ids become Frappe document names.
 *
 * Custom `savingroup_*` fields are created by the bridge app on install.
 */

export type RawDoc = Record<string, unknown>;

export function str(doc: RawDoc, field: string): string | null {
  const value = doc[field];
  if (value === null || value === undefined) return null;
  const text = typeof value === "string" ? value : String(value);
  return text.length ? text : null;
}

export function num(doc: RawDoc, field: string): number {
  const value = doc[field];
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function int(doc: RawDoc, field: string): number {
  return Math.round(num(doc, field));
}

export function bool(doc: RawDoc, field: string): boolean {
  const value = doc[field];
  return value === true || value === 1 || value === "1";
}

function requireName(doc: RawDoc): string {
  const name = str(doc, "name");
  if (!name) throw new Error("Frappe document without a name");
  return name;
}

/** Trailing digits of a naming-series name (CRM-LEAD-2026-00012 → 12). */
export function trailingNumber(name: string): number {
  const match = /(\d+)$/.exec(name);
  const value = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/**
 * Frappe stores naive local datetimes for the site's timezone. Convert one to
 * an ISO instant; dates (YYYY-MM-DD) become local midnight.
 */
export function frappeDateTimeToIso(value: string | null, timeZone: string): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?)?/.exec(
    value,
  );
  if (!match) return null;
  const [, y, mo, d, h = "0", mi = "0", s = "0", frac = "0"] = match;
  const millis = Math.round(Number(`0.${frac}`) * 1000);
  const asUtc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  const offset = timeZoneOffsetMs(new Date(asUtc), timeZone);
  return new Date(asUtc - offset + millis).toISOString();
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function timeZoneOffsetMs(at: Date, timeZone: string): number {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return 0;
    }
    formatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(at).map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  const local = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return local - at.getTime();
}

export interface MapContext {
  spaceId: string;
  currency: string;
  timeZone: string;
  attribution: AttributionResolver;
}

export function collectDocActors(doc: RawDoc, resolver: AttributionResolver): void {
  for (const prefix of [
    "savingroup_created_by",
    "savingroup_assignee",
    "savingroup_owner",
    "savingroup_approved_by",
  ]) {
    resolver.collect({ userId: str(doc, `${prefix}_user`), botId: str(doc, `${prefix}_bot`) });
  }
}

function actor(doc: RawDoc, prefix: string, map: MapContext): BusinessActor {
  return map.attribution.actor({
    userId: str(doc, `${prefix}_user`),
    botId: str(doc, `${prefix}_bot`),
  });
}

function stamps(doc: RawDoc, map: MapContext): { createdAt: string; updatedAt: string } {
  const createdAt =
    frappeDateTimeToIso(str(doc, "creation"), map.timeZone) ?? new Date(0).toISOString();
  const updatedAt = frappeDateTimeToIso(str(doc, "modified"), map.timeZone) ?? createdAt;
  return { createdAt, updatedAt };
}

// --- CRM ---------------------------------------------------------------------

export const LEAD_STATUS_TO_FRAPPE: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  unqualified: "Unqualified",
  converted: "Converted",
};

export function leadStatusFromFrappe(status: string | null, converted: boolean): LeadStatus {
  if (converted) return "converted";
  switch (status) {
    case "Contacted":
    case "Nurture":
      return "contacted";
    case "Qualified":
      return "qualified";
    case "Converted":
      return "converted";
    case "Unqualified":
    case "Junk":
      return "unqualified";
    default:
      return "new";
  }
}

/** Every Frappe status that collapses onto one of ours, for list filters. */
export function frappeLeadStatuses(status: LeadStatus): string[] {
  switch (status) {
    case "new":
      return ["New"];
    case "contacted":
      return ["Contacted", "Nurture"];
    case "qualified":
      return ["Qualified"];
    case "unqualified":
      return ["Unqualified", "Junk"];
    case "converted":
      return ["Converted"];
  }
}

export const DEAL_STAGE_TO_FRAPPE: Record<DealStage, string> = {
  qualification: "Qualification",
  proposal: "Proposal/Quotation",
  negotiation: "Negotiation",
  won: "Won",
  lost: "Lost",
};

export function dealStageFromFrappe(status: string | null): DealStage {
  switch (status) {
    case "Proposal/Quotation":
      return "proposal";
    case "Negotiation":
    case "Ready to Close":
      return "negotiation";
    case "Won":
      return "won";
    case "Lost":
      return "lost";
    default:
      return "qualification";
  }
}

export function frappeDealStatuses(stage: DealStage): string[] {
  switch (stage) {
    case "qualification":
      return ["Qualification", "Demo/Making"];
    case "proposal":
      return ["Proposal/Quotation"];
    case "negotiation":
      return ["Negotiation", "Ready to Close"];
    case "won":
      return ["Won"];
    case "lost":
      return ["Lost"];
  }
}

export function mapCompany(doc: RawDoc, map: MapContext): CrmCompany {
  const name = requireName(doc);
  return {
    id: name,
    spaceId: map.spaceId,
    name: str(doc, "organization_name") ?? name,
    domain: str(doc, "website"),
    phone: str(doc, "savingroup_phone"),
    notes: str(doc, "savingroup_notes"),
    createdBy: actor(doc, "savingroup_created_by", map),
    ...stamps(doc, map),
  };
}

export function mapContact(doc: RawDoc, map: MapContext): CrmContact {
  const firstName = str(doc, "first_name") ?? "";
  const lastName = str(doc, "last_name") ?? "";
  return {
    id: requireName(doc),
    spaceId: map.spaceId,
    firstName,
    lastName,
    name: str(doc, "full_name") ?? `${firstName} ${lastName}`.trim(),
    email: str(doc, "email_id"),
    phone: str(doc, "mobile_no") ?? str(doc, "phone"),
    title: str(doc, "designation"),
    notes: str(doc, "savingroup_notes"),
    companyId: str(doc, "savingroup_organization"),
    companyName: str(doc, "company_name") ?? str(doc, "savingroup_organization"),
    createdBy: actor(doc, "savingroup_created_by", map),
    ...stamps(doc, map),
  };
}

export function mapLead(doc: RawDoc, map: MapContext): CrmLead {
  const name = requireName(doc);
  const organization = str(doc, "organization");
  const value =
    doc.savingroup_value === null || doc.savingroup_value === undefined
      ? null
      : num(doc, "savingroup_value");
  return {
    id: name,
    spaceId: map.spaceId,
    number: trailingNumber(name),
    ref: name,
    title: str(doc, "savingroup_title") ?? str(doc, "lead_name") ?? organization ?? name,
    status: leadStatusFromFrappe(str(doc, "status"), bool(doc, "converted")),
    source: str(doc, "source"),
    notes: str(doc, "savingroup_notes"),
    value,
    companyId: str(doc, "savingroup_organization") ?? organization,
    companyName: organization,
    contactId: str(doc, "savingroup_contact"),
    contactName: str(doc, "lead_name"),
    assignee: actor(doc, "savingroup_assignee", map),
    convertedDealId: str(doc, "savingroup_deal"),
    createdBy: actor(doc, "savingroup_created_by", map),
    ...stamps(doc, map),
  };
}

export function mapDeal(doc: RawDoc, map: MapContext): CrmDeal {
  const name = requireName(doc);
  const organization = str(doc, "organization");
  const contacts = Array.isArray(doc.contacts) ? (doc.contacts as RawDoc[]) : [];
  const primary = contacts.find((row) => bool(row, "is_primary")) ?? contacts[0];
  return {
    id: name,
    spaceId: map.spaceId,
    number: trailingNumber(name),
    ref: name,
    title: str(doc, "savingroup_title") ?? organization ?? name,
    stage: dealStageFromFrappe(str(doc, "status")),
    amount: num(doc, "deal_value"),
    currency: str(doc, "currency") ?? map.currency,
    expectedCloseAt: frappeDateTimeToIso(str(doc, "expected_closure_date"), map.timeZone),
    closedAt: frappeDateTimeToIso(str(doc, "closed_date"), map.timeZone),
    notes: str(doc, "savingroup_notes"),
    companyId: organization,
    companyName: organization,
    contactId: primary ? str(primary, "contact") : str(doc, "contact"),
    contactName: str(doc, "lead_name"),
    sourceLeadId: str(doc, "lead"),
    owner: actor(doc, "savingroup_owner", map),
    createdBy: actor(doc, "savingroup_created_by", map),
    ...stamps(doc, map),
  };
}

function activityKind(value: string | null): ActivityKind {
  return (ACTIVITY_KINDS as readonly string[]).includes(value ?? "")
    ? (value as ActivityKind)
    : "note";
}

export function mapActivity(doc: RawDoc, map: MapContext): CrmActivity {
  const referenceType = str(doc, "reference_doctype");
  const referenceName = str(doc, "reference_docname");
  const done = str(doc, "status") === "Done";
  return {
    id: requireName(doc),
    spaceId: map.spaceId,
    kind: activityKind(str(doc, "savingroup_kind")),
    subject: str(doc, "title") ?? "",
    body: str(doc, "description"),
    dueAt: frappeDateTimeToIso(str(doc, "due_date"), map.timeZone),
    completedAt: done
      ? (frappeDateTimeToIso(str(doc, "savingroup_completed_at"), map.timeZone) ??
        frappeDateTimeToIso(str(doc, "modified"), map.timeZone))
      : null,
    companyId: str(doc, "savingroup_organization"),
    contactId: str(doc, "savingroup_contact"),
    leadId: referenceType === "CRM Lead" ? referenceName : null,
    dealId: referenceType === "CRM Deal" ? referenceName : null,
    assignee: actor(doc, "savingroup_assignee", map),
    createdBy: actor(doc, "savingroup_created_by", map),
    ...stamps(doc, map),
  };
}

// --- ERP ---------------------------------------------------------------------

/** A product row as the bridge's `products` query returns it: Item + price + stock. */
export function mapProduct(doc: RawDoc, map: MapContext): ErpProduct {
  const code = str(doc, "item_code") ?? requireName(doc);
  const listed = doc.price_list_rate;
  return {
    id: code,
    spaceId: map.spaceId,
    sku: code,
    name: str(doc, "item_name") ?? code,
    description: str(doc, "description"),
    unitPrice:
      listed === null || listed === undefined
        ? num(doc, "standard_rate")
        : num(doc, "price_list_rate"),
    currency: map.currency,
    active: !bool(doc, "disabled"),
    stockOnHand: int(doc, "actual_qty"),
    hsnCode: str(doc, "gst_hsn_code"),
    createdBy: actor(doc, "savingroup_created_by", map),
    ...stamps(doc, map),
  };
}

export function mapInventoryLevel(doc: RawDoc, allowNegativeStock: boolean): InventoryLevel {
  const code = str(doc, "item_code") ?? requireName(doc);
  const onHand = int(doc, "actual_qty");
  const reserved = int(doc, "reserved_qty");
  return {
    productId: code,
    sku: code,
    name: str(doc, "item_name") ?? code,
    onHand,
    available: onHand - reserved,
    allowNegativeStock,
  };
}

export function orderStatusFromFrappe(doc: RawDoc): OrderStatus {
  const docstatus = int(doc, "docstatus");
  if (docstatus === 2) return "cancelled";
  if (docstatus === 1) return "confirmed";
  const approval = str(doc, "savingroup_approval_status");
  if (approval === "pending_approval" || approval === "approved" || approval === "cancelled") {
    return approval;
  }
  return "draft";
}

function mapOrderLine(row: RawDoc, index: number): OrderLine {
  const code = str(row, "item_code") ?? "";
  return {
    id: str(row, "name") ?? `${code}-${index}`,
    productId: code,
    sku: code,
    description: str(row, "item_name") ?? str(row, "description") ?? code,
    quantity: int(row, "qty"),
    unitPrice: num(row, "rate"),
    lineTotal: num(row, "amount"),
    position: int(row, "idx") || index + 1,
  };
}

export function mapOrder(doc: RawDoc, map: MapContext): ErpSalesOrder {
  const name = requireName(doc);
  const items = Array.isArray(doc.items) ? (doc.items as RawDoc[]) : [];
  return {
    id: name,
    spaceId: map.spaceId,
    number: trailingNumber(name),
    ref: name,
    status: orderStatusFromFrappe(doc),
    currency: str(doc, "currency") ?? map.currency,
    subtotal: num(doc, "total"),
    notes: str(doc, "savingroup_notes"),
    companyId: str(doc, "customer"),
    companyName: str(doc, "customer_name") ?? str(doc, "customer"),
    contactId: str(doc, "savingroup_contact"),
    contactName: str(doc, "contact_display"),
    dealId: str(doc, "savingroup_deal"),
    invoiceId: str(doc, "savingroup_invoice"),
    lines: items.map(mapOrderLine),
    approvalRequestedAt: frappeDateTimeToIso(
      str(doc, "savingroup_approval_requested_at"),
      map.timeZone,
    ),
    approvedAt: frappeDateTimeToIso(str(doc, "savingroup_approved_at"), map.timeZone),
    approvedBy: actor(doc, "savingroup_approved_by", map),
    confirmedAt: frappeDateTimeToIso(str(doc, "savingroup_confirmed_at"), map.timeZone),
    cancelledAt: frappeDateTimeToIso(str(doc, "savingroup_cancelled_at"), map.timeZone),
    createdBy: actor(doc, "savingroup_created_by", map),
    ...stamps(doc, map),
  };
}

function mapInvoiceLine(row: RawDoc, index: number): InvoiceLine {
  const code = str(row, "item_code");
  return {
    id: str(row, "name") ?? `${code ?? "line"}-${index}`,
    productId: code,
    description: str(row, "item_name") ?? str(row, "description") ?? code ?? "",
    quantity: int(row, "qty"),
    unitPrice: num(row, "rate"),
    lineTotal: num(row, "amount"),
    position: int(row, "idx") || index + 1,
  };
}

export function mapInvoice(doc: RawDoc, map: MapContext): ErpInvoice {
  const name = requireName(doc);
  const items = Array.isArray(doc.items) ? (doc.items as RawDoc[]) : [];
  const docstatus = int(doc, "docstatus");
  const total = num(doc, "grand_total");
  const outstanding = docstatus === 1 ? num(doc, "outstanding_amount") : total;
  const paid = docstatus === 1 && outstanding <= 0.005;
  const paymentStatus: PaymentStatus = paid ? "paid" : outstanding < total ? "partial" : "unpaid";
  const orderId = items.map((row) => str(row, "sales_order")).find(Boolean) ?? "";
  return {
    id: name,
    spaceId: map.spaceId,
    number: trailingNumber(name),
    ref: name,
    status: docstatus === 1 ? (paid ? "paid" : "issued") : "draft",
    paymentStatus,
    currency: str(doc, "currency") ?? map.currency,
    subtotal: num(doc, "total"),
    total,
    amountPaid: docstatus === 1 ? Math.max(0, total - outstanding) : 0,
    notes: str(doc, "savingroup_notes"),
    orderId,
    orderRef: orderId,
    companyId: str(doc, "customer"),
    companyName: str(doc, "customer_name") ?? str(doc, "customer"),
    lines: items.map(mapInvoiceLine),
    issuedAt: docstatus === 1 ? frappeDateTimeToIso(str(doc, "posting_date"), map.timeZone) : null,
    dueAt: frappeDateTimeToIso(str(doc, "due_date"), map.timeZone),
    paidAt: paid ? frappeDateTimeToIso(str(doc, "modified"), map.timeZone) : null,
    approvedBy: actor(doc, "savingroup_approved_by", map),
    createdBy: actor(doc, "savingroup_created_by", map),
    ...stamps(doc, map),
  };
}
