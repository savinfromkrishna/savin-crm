import type {
  AddOrderItemInput,
  AdjustInventoryInput,
  AdminDeleteResult,
  AdminDoctypeDescription,
  AdminDoctypeSummary,
  AdminDocument,
  AdminDocumentResult,
  AdminMethodResult,
  AssignLeadInput,
  BusinessActionId,
  BusinessEventType,
  BusinessRecordType,
  CallMethodInput,
  CheckInventoryInput,
  CompleteActivityInput,
  ConvertLeadInput,
  CreateActivityInput,
  CreateCompanyInput,
  CreateContactInput,
  CreateDealInput,
  CreateInvoiceDraftInput,
  CreateLeadInput,
  CreateOrderDraftInput,
  CreateProductInput,
  CrmActivity,
  CrmCompany,
  CrmContact,
  CrmDeal,
  CrmLead,
  CrmOverview,
  DescribeDoctypeInput,
  DocumentRefInput,
  ErpInvoice,
  ErpOverview,
  ErpProduct,
  ErpSalesOrder,
  FindCompanyDuplicatesOutput,
  FindContactDuplicatesOutput,
  FindDuplicatesInput,
  GetDocumentInput,
  InsertDocumentInput,
  InventoryAdjustment,
  InventoryLevel,
  InvoiceRefInput,
  IssueInvoiceInput,
  ListActivitiesInput,
  ListDoctypesInput,
  ListDocumentsInput,
  ListInventoryAdjustmentsInput,
  OrderRefInput,
  OrderTransitionInput,
  QualifyLeadInput,
  RecordInvoicePaymentInput,
  RemoveOrderItemInput,
  SearchCompaniesInput,
  SearchContactsInput,
  SearchDealsInput,
  SearchInvoicesInput,
  SearchLeadsInput,
  SearchOrdersInput,
  SearchProductsInput,
  UpdateCompanyInput,
  UpdateContactInput,
  UpdateDealInput,
  UpdateDealStageInput,
  UpdateDocumentInput,
  UpdateLeadInput,
  UpdateProductInput,
} from "@savingroup/contracts";
import { adminDocumentRecordId } from "@savingroup/contracts";
import type { PrismaClient } from "@savingroup/db";
import { AttributionResolver } from "../attribution.js";
import type { BusinessContext } from "../context.js";
import { notFound } from "../errors.js";
import { ensureBusinessSettings } from "../settings.js";
import type { FrappeClient, FrappeFilter } from "./client.js";
import { isFrappeRequestError } from "./client.js";
import type { MapContext, RawDoc } from "./mapping.js";
import {
  collectDocActors,
  frappeDateTimeToIso,
  frappeDealStatuses,
  frappeLeadStatuses,
  int,
  mapActivity,
  mapCompany,
  mapContact,
  mapDeal,
  mapInventoryLevel,
  mapInvoice,
  mapLead,
  mapOrder,
  mapProduct,
  num,
  str,
} from "./mapping.js";
import type { ResolvedEnvironment } from "./types.js";
import { BRIDGE_METHODS } from "./types.js";

/**
 * How each business action runs against an organization's Frappe site.
 *
 * Reads go straight to the site's REST API (single lists) or to the bridge's
 * `query` method (composite reads such as items with stock and price). Writes
 * send a payload to the bridge's idempotent `execute` method and map the
 * returned documents back into the contract shapes. The gateway's ledger wraps
 * every write; handlers never talk to the ledger themselves.
 */

export interface FrappeReadContext {
  client: FrappeClient;
  env: ResolvedEnvironment;
  prisma: PrismaClient;
  spaceId: string;
}

export interface FrappeWriteContext extends FrappeReadContext {
  ctx: BusinessContext;
  settings: {
    allowNegativeStock: boolean;
    orderApprovalRequired: boolean;
    invoiceApprovalRequired: boolean;
  };
}

export interface FrappeWriteSpec<Input, Output> {
  recordType: BusinessRecordType;
  event: BusinessEventType;
  payload: (wc: FrappeWriteContext, input: Input) => Record<string, unknown>;
  map: (rc: FrappeReadContext, result: RawDoc) => Promise<Output>;
  recordId: (output: Output) => string;
}

export interface FrappeActionHandler<Input = unknown, Output = unknown> {
  read?: (rc: FrappeReadContext, input: Input) => Promise<Output>;
  write?: FrappeWriteSpec<Input, Output>;
}

// --- helpers -----------------------------------------------------------------

async function mapContext(rc: FrappeReadContext, docs: RawDoc[]): Promise<MapContext> {
  const attribution = new AttributionResolver(rc.prisma, rc.spaceId);
  for (const doc of docs) collectDocActors(doc, attribution);
  await attribution.load();
  return {
    spaceId: rc.spaceId,
    currency: rc.env.currency,
    timeZone: rc.env.timezone,
    attribution,
  };
}

async function mapOne<T>(
  rc: FrappeReadContext,
  doc: RawDoc,
  mapper: (doc: RawDoc, map: MapContext) => T,
): Promise<T> {
  return mapper(doc, await mapContext(rc, [doc]));
}

async function mapMany<T>(
  rc: FrappeReadContext,
  docs: RawDoc[],
  mapper: (doc: RawDoc, map: MapContext) => T,
): Promise<T[]> {
  const map = await mapContext(rc, docs);
  return docs.map((doc) => mapper(doc, map));
}

function docOf(result: RawDoc, key: string): RawDoc {
  const value = result[key];
  if (!value || typeof value !== "object") {
    throw new Error(`Bridge result is missing "${key}".`);
  }
  return value as RawDoc;
}

/** A 404 on a direct lookup is an empty result, as in the prototype. */
async function getDocOrNull(rc: FrappeReadContext, doctype: string, name: string) {
  try {
    return await rc.client.getDoc(doctype, name);
  } catch (error) {
    if (isFrappeRequestError(error) && error.status === 404) return null;
    throw error;
  }
}

function like(value: string): string {
  return `%${value.replace(/[%_]/g, "")}%`;
}

function withoutKey(input: Record<string, unknown>): Record<string, unknown> {
  const { idempotencyKey: _ignored, ...rest } = input;
  return rest;
}

function query<T = RawDoc[]>(rc: FrappeReadContext, kind: string, params: Record<string, unknown>) {
  return rc.client.call<T>(BRIDGE_METHODS.query, { kind, params, company: rc.env.companyName });
}

const ALL = ["*"];

// --- CRM: companies ----------------------------------------------------------

const companySearch: FrappeActionHandler<SearchCompaniesInput, { companies: CrmCompany[] }> = {
  async read(rc, input) {
    if (input.id) {
      const doc = await getDocOrNull(rc, "CRM Organization", input.id);
      return { companies: doc ? [await mapOne(rc, doc, mapCompany)] : [] };
    }
    const docs = await rc.client.getList("CRM Organization", {
      fields: ALL,
      limit: input.limit,
      orderBy: "modified desc",
      ...(input.q
        ? {
            orFilters: [
              ["organization_name", "like", like(input.q)],
              ["website", "like", like(input.q)],
            ] satisfies FrappeFilter[],
          }
        : {}),
    });
    return { companies: await mapMany(rc, docs, mapCompany) };
  },
};

const companyCreate: FrappeActionHandler<CreateCompanyInput, CrmCompany> = {
  write: {
    recordType: "company",
    event: "crm.company.created",
    payload: (_wc, input) => withoutKey(input),
    map: (rc, result) => mapOne(rc, docOf(result, "organization"), mapCompany),
    recordId: (output) => output.id,
  },
};

const companyUpdate: FrappeActionHandler<UpdateCompanyInput, CrmCompany> = {
  write: {
    recordType: "company",
    event: "crm.company.updated",
    payload: (_wc, input) => withoutKey(input),
    map: (rc, result) => mapOne(rc, docOf(result, "organization"), mapCompany),
    recordId: (output) => output.id,
  },
};

const companyFindDuplicates: FrappeActionHandler<FindDuplicatesInput, FindCompanyDuplicatesOutput> =
  {
    async read(rc, input) {
      const { companies } = await companySearch.read!(rc, { limit: 200 });
      const byDomain = new Map<string, CrmCompany[]>();
      const byName = new Map<string, CrmCompany[]>();
      for (const c of companies) {
        const domain = c.domain?.trim().toLowerCase();
        if (domain) {
          const list = byDomain.get(domain) ?? [];
          list.push(c);
          byDomain.set(domain, list);
        }
        const name = c.name.trim().toLowerCase();
        if (name) {
          const list = byName.get(name) ?? [];
          list.push(c);
          byName.set(name, list);
        }
      }
      const groups: FindCompanyDuplicatesOutput["groups"] = [];
      for (const [key, members] of byDomain) {
        if (members.length >= 2) {
          groups.push({ reason: `Matching domain: ${key}`, matchKey: key, companies: members });
        }
      }
      for (const [key, members] of byName) {
        if (members.length >= 2) {
          groups.push({
            reason: `Matching normalized company name: ${key}`,
            matchKey: key,
            companies: members,
          });
        }
      }
      return { groups: groups.slice(0, input.limit) };
    },
  };

// --- CRM: contacts -----------------------------------------------------------

const contactSearch: FrappeActionHandler<SearchContactsInput, { contacts: CrmContact[] }> = {
  async read(rc, input) {
    if (input.id) {
      const doc = await getDocOrNull(rc, "Contact", input.id);
      return { contacts: doc ? [await mapOne(rc, doc, mapContact)] : [] };
    }
    const filters: FrappeFilter[] = [];
    if (input.email) filters.push(["email_id", "=", input.email.toLowerCase()]);
    if (input.companyId) filters.push(["savingroup_organization", "=", input.companyId]);
    const docs = await rc.client.getList("Contact", {
      fields: ALL,
      limit: input.limit,
      orderBy: "modified desc",
      filters,
      ...(input.q
        ? {
            orFilters: [
              ["full_name", "like", like(input.q)],
              ["email_id", "like", like(input.q)],
              ["company_name", "like", like(input.q)],
            ] satisfies FrappeFilter[],
          }
        : {}),
    });
    return { contacts: await mapMany(rc, docs, mapContact) };
  },
};

const contactCreate: FrappeActionHandler<CreateContactInput, CrmContact> = {
  write: {
    recordType: "contact",
    event: "crm.contact.created",
    payload: (_wc, input) => withoutKey(input),
    map: (rc, result) => mapOne(rc, docOf(result, "contact"), mapContact),
    recordId: (output) => output.id,
  },
};

const contactUpdate: FrappeActionHandler<UpdateContactInput, CrmContact> = {
  write: {
    recordType: "contact",
    event: "crm.contact.updated",
    payload: (_wc, input) => withoutKey(input),
    map: (rc, result) => mapOne(rc, docOf(result, "contact"), mapContact),
    recordId: (output) => output.id,
  },
};

const contactFindDuplicates: FrappeActionHandler<FindDuplicatesInput, FindContactDuplicatesOutput> =
  {
    async read(rc, input) {
      const { contacts } = await contactSearch.read!(rc, { limit: 200 });
      const byEmail = new Map<string, CrmContact[]>();
      for (const c of contacts) {
        const email = c.email?.trim().toLowerCase();
        if (email) {
          const list = byEmail.get(email) ?? [];
          list.push(c);
          byEmail.set(email, list);
        }
      }
      const groups: FindContactDuplicatesOutput["groups"] = [];
      for (const [key, members] of byEmail) {
        if (members.length >= 2) {
          groups.push({
            reason: `Matching email address: ${key}`,
            matchKey: key,
            contacts: members,
          });
        }
      }
      return { groups: groups.slice(0, input.limit) };
    },
  };

// --- CRM: leads --------------------------------------------------------------

const leadSearch: FrappeActionHandler<SearchLeadsInput, { leads: CrmLead[] }> = {
  async read(rc, input) {
    const direct = input.id ?? input.ref;
    if (direct) {
      const doc = await getDocOrNull(rc, "CRM Lead", direct);
      return { leads: doc ? [await mapOne(rc, doc, mapLead)] : [] };
    }
    const filters: FrappeFilter[] = [];
    if (input.status) filters.push(["status", "in", frappeLeadStatuses(input.status)]);
    if (input.assigneeBotId) filters.push(["savingroup_assignee_bot", "=", input.assigneeBotId]);
    if (input.assigneeUserId) filters.push(["savingroup_assignee_user", "=", input.assigneeUserId]);
    if (input.companyId) filters.push(["organization", "=", input.companyId]);
    const docs = await rc.client.getList("CRM Lead", {
      fields: ALL,
      limit: input.limit,
      orderBy: "modified desc",
      filters,
      ...(input.q
        ? {
            orFilters: [
              ["savingroup_title", "like", like(input.q)],
              ["lead_name", "like", like(input.q)],
              ["organization", "like", like(input.q)],
              ["email", "like", like(input.q)],
            ] satisfies FrappeFilter[],
          }
        : {}),
    });
    return { leads: await mapMany(rc, docs, mapLead) };
  },
};

const leadWrite = (
  event: BusinessEventType,
): FrappeWriteSpec<Record<string, unknown>, CrmLead> => ({
  recordType: "lead",
  event,
  payload: (_wc, input) => withoutKey(input),
  map: (rc, result) => mapOne(rc, docOf(result, "lead"), mapLead),
  recordId: (output) => output.id,
});

const leadCreate: FrappeActionHandler<CreateLeadInput, CrmLead> = {
  write: leadWrite("crm.lead.created") as FrappeWriteSpec<CreateLeadInput, CrmLead>,
};
const leadUpdate: FrappeActionHandler<UpdateLeadInput, CrmLead> = {
  write: leadWrite("crm.lead.updated") as FrappeWriteSpec<UpdateLeadInput, CrmLead>,
};
const leadAssign: FrappeActionHandler<AssignLeadInput, CrmLead> = {
  write: leadWrite("crm.lead.assigned") as FrappeWriteSpec<AssignLeadInput, CrmLead>,
};
const leadQualify: FrappeActionHandler<QualifyLeadInput, CrmLead> = {
  write: leadWrite("crm.lead.status_changed") as FrappeWriteSpec<QualifyLeadInput, CrmLead>,
};

const leadConvert: FrappeActionHandler<ConvertLeadInput, { lead: CrmLead; deal: CrmDeal }> = {
  write: {
    recordType: "lead",
    event: "crm.lead.converted",
    payload: (_wc, input) => withoutKey(input),
    async map(rc, result) {
      const leadDoc = docOf(result, "lead");
      const dealDoc = docOf(result, "deal");
      const map = await mapContext(rc, [leadDoc, dealDoc]);
      return { lead: mapLead(leadDoc, map), deal: mapDeal(dealDoc, map) };
    },
    recordId: (output) => output.lead.id,
  },
};

// --- CRM: deals --------------------------------------------------------------

const dealSearch: FrappeActionHandler<SearchDealsInput, { deals: CrmDeal[] }> = {
  async read(rc, input) {
    const direct = input.id ?? input.ref;
    if (direct) {
      const doc = await getDocOrNull(rc, "CRM Deal", direct);
      return { deals: doc ? [await mapOne(rc, doc, mapDeal)] : [] };
    }
    const filters: FrappeFilter[] = [];
    if (input.stage) filters.push(["status", "in", frappeDealStatuses(input.stage)]);
    if (input.companyId) filters.push(["organization", "=", input.companyId]);
    if (input.ownerBotId) filters.push(["savingroup_owner_bot", "=", input.ownerBotId]);
    if (input.ownerUserId) filters.push(["savingroup_owner_user", "=", input.ownerUserId]);
    const docs = await rc.client.getList("CRM Deal", {
      fields: ALL,
      limit: input.limit,
      orderBy: "modified desc",
      filters,
      ...(input.q
        ? {
            orFilters: [
              ["savingroup_title", "like", like(input.q)],
              ["organization", "like", like(input.q)],
              ["lead_name", "like", like(input.q)],
            ] satisfies FrappeFilter[],
          }
        : {}),
    });
    // Lists do not carry child tables; the primary contact comes with the full doc.
    return { deals: await mapMany(rc, docs, mapDeal) };
  },
};

const dealWrite = (
  event: BusinessEventType,
): FrappeWriteSpec<Record<string, unknown>, CrmDeal> => ({
  recordType: "deal",
  event,
  payload: (_wc, input) => withoutKey(input),
  map: (rc, result) => mapOne(rc, docOf(result, "deal"), mapDeal),
  recordId: (output) => output.id,
});

const dealCreate: FrappeActionHandler<CreateDealInput, CrmDeal> = {
  write: dealWrite("crm.deal.created") as FrappeWriteSpec<CreateDealInput, CrmDeal>,
};
const dealUpdate: FrappeActionHandler<UpdateDealInput, CrmDeal> = {
  write: dealWrite("crm.deal.updated") as FrappeWriteSpec<UpdateDealInput, CrmDeal>,
};
const dealUpdateStage: FrappeActionHandler<UpdateDealStageInput, CrmDeal> = {
  write: dealWrite("crm.deal.stage_changed") as FrappeWriteSpec<UpdateDealStageInput, CrmDeal>,
};

// --- CRM: activities ---------------------------------------------------------

const activityList: FrappeActionHandler<ListActivitiesInput, { activities: CrmActivity[] }> = {
  async read(rc, input) {
    const filters: FrappeFilter[] = [];
    if (input.leadId) {
      filters.push(
        ["reference_doctype", "=", "CRM Lead"],
        ["reference_docname", "=", input.leadId],
      );
    } else if (input.dealId) {
      filters.push(
        ["reference_doctype", "=", "CRM Deal"],
        ["reference_docname", "=", input.dealId],
      );
    }
    if (input.contactId) filters.push(["savingroup_contact", "=", input.contactId]);
    if (input.companyId) filters.push(["savingroup_organization", "=", input.companyId]);
    if (input.kind) filters.push(["savingroup_kind", "=", input.kind]);
    if (input.assigneeBotId) filters.push(["savingroup_assignee_bot", "=", input.assigneeBotId]);
    if (input.assigneeUserId) filters.push(["savingroup_assignee_user", "=", input.assigneeUserId]);
    if (input.openOnly) filters.push(["status", "!=", "Done"]);
    const docs = await rc.client.getList("CRM Task", {
      fields: ALL,
      limit: input.limit,
      orderBy: "creation desc",
      filters,
    });
    return { activities: await mapMany(rc, docs, mapActivity) };
  },
};

const activityCreate: FrappeActionHandler<CreateActivityInput, CrmActivity> = {
  write: {
    recordType: "activity",
    event: "crm.activity.created",
    payload: (_wc, input) => withoutKey(input),
    map: (rc, result) => mapOne(rc, docOf(result, "task"), mapActivity),
    recordId: (output) => output.id,
  },
};

const activityComplete: FrappeActionHandler<CompleteActivityInput, CrmActivity> = {
  write: {
    recordType: "activity",
    event: "crm.activity.completed",
    payload: (_wc, input) => withoutKey(input),
    map: (rc, result) => mapOne(rc, docOf(result, "task"), mapActivity),
    recordId: (output) => output.id,
  },
};

// --- ERP: products and inventory --------------------------------------------

const productSearch: FrappeActionHandler<SearchProductsInput, { products: ErpProduct[] }> = {
  async read(rc, input) {
    const rows = await query(rc, "products", {
      id: input.id ?? null,
      sku: input.sku ?? null,
      q: input.q ?? null,
      include_inactive: input.includeInactive,
      limit: input.limit,
    });
    return { products: await mapMany(rc, rows, mapProduct) };
  },
};

const productCreate: FrappeActionHandler<CreateProductInput, ErpProduct> = {
  write: {
    recordType: "product",
    event: "erp.product.created",
    payload: (_wc, input) => withoutKey(input),
    map: (rc, result) => mapOne(rc, docOf(result, "product"), mapProduct),
    recordId: (output) => output.id,
  },
};

const productUpdate: FrappeActionHandler<UpdateProductInput, ErpProduct> = {
  write: {
    recordType: "product",
    event: "erp.product.updated",
    payload: (_wc, input) => withoutKey(input),
    map: (rc, result) => mapOne(rc, docOf(result, "product"), mapProduct),
    recordId: (output) => output.id,
  },
};

const inventoryCheck: FrappeActionHandler<CheckInventoryInput, InventoryLevel> = {
  async read(rc, input) {
    const row = await query<RawDoc | null>(rc, "inventory", {
      item_code: input.sku ?? input.productId ?? null,
    });
    if (!row) throw notFound("Product");
    const settings = await ensureBusinessSettings(rc.prisma, rc.spaceId);
    return mapInventoryLevel(row, settings.allowNegativeStock);
  },
};

function mapAdjustment(doc: RawDoc, map: MapContext): InventoryAdjustment {
  const code = str(doc, "item_code") ?? "";
  return {
    id: str(doc, "name") ?? code,
    productId: code,
    sku: code,
    productName: str(doc, "item_name") ?? code,
    delta: int(doc, "delta"),
    quantityAfter: int(doc, "quantity_after"),
    reason: str(doc, "reason") ?? str(doc, "savingroup_reason") ?? "",
    orderId: str(doc, "sales_order"),
    createdBy: map.attribution.actor({
      userId: str(doc, "savingroup_created_by_user"),
      botId: str(doc, "savingroup_created_by_bot"),
    }),
    createdAt: frappeDateTimeToIso(str(doc, "creation"), map.timeZone) ?? new Date(0).toISOString(),
  };
}

const inventoryAdjust: FrappeActionHandler<AdjustInventoryInput, InventoryAdjustment> = {
  write: {
    recordType: "product",
    event: "erp.inventory.adjusted",
    payload: (_wc, input) => withoutKey(input),
    map: (rc, result) => mapOne(rc, docOf(result, "adjustment"), mapAdjustment),
    recordId: (output) => output.productId,
  },
};

export async function frappeListInventoryAdjustments(
  rc: FrappeReadContext,
  input: ListInventoryAdjustmentsInput,
): Promise<InventoryAdjustment[]> {
  const rows = await query(rc, "adjustments", {
    item_code: input.productId ?? null,
    limit: input.limit,
  });
  return mapMany(rc, rows, mapAdjustment);
}

// --- ERP: sales orders -------------------------------------------------------

const orderWrite = (
  event: BusinessEventType,
): FrappeWriteSpec<Record<string, unknown>, ErpSalesOrder> => ({
  recordType: "order",
  event,
  payload: (_wc, input) => withoutKey(input),
  map: (rc, result) => mapOne(rc, docOf(result, "sales_order"), mapOrder),
  recordId: (output) => output.id,
});

const orderCreateDraft: FrappeActionHandler<CreateOrderDraftInput, ErpSalesOrder> = {
  write: orderWrite("erp.order.created") as FrappeWriteSpec<CreateOrderDraftInput, ErpSalesOrder>,
};
const orderAddItem: FrappeActionHandler<AddOrderItemInput, ErpSalesOrder> = {
  write: orderWrite("erp.order.updated") as FrappeWriteSpec<AddOrderItemInput, ErpSalesOrder>,
};
const orderRemoveItem: FrappeActionHandler<RemoveOrderItemInput, ErpSalesOrder> = {
  write: orderWrite("erp.order.updated") as FrappeWriteSpec<RemoveOrderItemInput, ErpSalesOrder>,
};
const orderRequestApproval: FrappeActionHandler<OrderRefInput, ErpSalesOrder> = {
  write: orderWrite("erp.order.approval_requested") as FrappeWriteSpec<
    OrderRefInput,
    ErpSalesOrder
  >,
};
const orderApprove: FrappeActionHandler<OrderTransitionInput, ErpSalesOrder> = {
  write: orderWrite("erp.order.approved") as FrappeWriteSpec<OrderTransitionInput, ErpSalesOrder>,
};
const orderConfirm: FrappeActionHandler<OrderTransitionInput, ErpSalesOrder> = {
  write: orderWrite("erp.order.confirmed") as FrappeWriteSpec<OrderTransitionInput, ErpSalesOrder>,
};
const orderCancel: FrappeActionHandler<OrderTransitionInput, ErpSalesOrder> = {
  write: orderWrite("erp.order.cancelled") as FrappeWriteSpec<OrderTransitionInput, ErpSalesOrder>,
};

const orderGet: FrappeActionHandler<OrderRefInput, ErpSalesOrder> = {
  async read(rc, input) {
    const doc = await query<RawDoc | null>(rc, "order", { name: input.id ?? input.ref });
    if (!doc) throw notFound("Order");
    return mapOne(rc, doc, mapOrder);
  },
};

const orderSearch: FrappeActionHandler<SearchOrdersInput, { orders: ErpSalesOrder[] }> = {
  async read(rc, input) {
    const docs = await query(rc, "orders", {
      q: input.q ?? null,
      status: input.status ?? null,
      customer: input.companyId ?? null,
      deal: input.dealId ?? null,
      limit: input.limit,
    });
    return { orders: await mapMany(rc, docs, mapOrder) };
  },
};

// --- ERP: invoices -----------------------------------------------------------

const invoiceWrite = (
  event: BusinessEventType,
): FrappeWriteSpec<Record<string, unknown>, ErpInvoice> => ({
  recordType: "invoice",
  event,
  payload: (_wc, input) => withoutKey(input),
  map: (rc, result) => mapOne(rc, docOf(result, "sales_invoice"), mapInvoice),
  recordId: (output) => output.id,
});

const invoiceCreateDraft: FrappeActionHandler<CreateInvoiceDraftInput, ErpInvoice> = {
  write: invoiceWrite("erp.invoice.draft_created") as FrappeWriteSpec<
    CreateInvoiceDraftInput,
    ErpInvoice
  >,
};
const invoiceIssue: FrappeActionHandler<IssueInvoiceInput, ErpInvoice> = {
  write: invoiceWrite("erp.invoice.issued") as FrappeWriteSpec<IssueInvoiceInput, ErpInvoice>,
};
const invoiceRecordPayment: FrappeActionHandler<RecordInvoicePaymentInput, ErpInvoice> = {
  write: invoiceWrite("erp.invoice.payment_recorded") as FrappeWriteSpec<
    RecordInvoicePaymentInput,
    ErpInvoice
  >,
};

const invoiceGet: FrappeActionHandler<InvoiceRefInput, ErpInvoice> = {
  async read(rc, input) {
    const doc = await query<RawDoc | null>(rc, "invoice", { name: input.id ?? input.ref });
    if (!doc) throw notFound("Invoice");
    return mapOne(rc, doc, mapInvoice);
  },
};

const invoiceSearch: FrappeActionHandler<SearchInvoicesInput, { invoices: ErpInvoice[] }> = {
  async read(rc, input) {
    const docs = await query(rc, "invoices", {
      status: input.status ?? null,
      payment_status: input.paymentStatus ?? null,
      customer: input.companyId ?? null,
      limit: input.limit,
    });
    return { invoices: await mapMany(rc, docs, mapInvoice) };
  },
};

// --- overviews (not actions; the pages call them directly) -------------------

export async function frappeCrmOverview(rc: FrappeReadContext): Promise<CrmOverview> {
  const row = await query<RawDoc>(rc, "crm_overview", {});
  return {
    companies: int(row, "companies"),
    contacts: int(row, "contacts"),
    openLeads: int(row, "open_leads"),
    openDeals: int(row, "open_deals"),
    openDealAmount: num(row, "open_deal_amount"),
    wonDealAmount: num(row, "won_deal_amount"),
    openFollowUps: int(row, "open_follow_ups"),
    currency: rc.env.currency,
  };
}

export async function frappeErpOverview(rc: FrappeReadContext): Promise<ErpOverview> {
  const row = await query<RawDoc>(rc, "erp_overview", {});
  return {
    products: int(row, "products"),
    lowStockProducts: int(row, "low_stock_products"),
    draftOrders: int(row, "draft_orders"),
    pendingApprovalOrders: int(row, "pending_approval_orders"),
    confirmedOrders: int(row, "confirmed_orders"),
    confirmedOrderAmount: num(row, "confirmed_order_amount"),
    draftInvoices: int(row, "draft_invoices"),
    outstandingInvoiceAmount: num(row, "outstanding_invoice_amount"),
    currency: rc.env.currency,
  };
}

// --- Site administration (Operator) -------------------------------------------
//
// Reads go to the bridge's admin queries, writes to its admin actions, so the
// site enforces the gateway user's permissions and its blocklist in one place
// and every write lands in the same ledger as a typed action.

const adminDoctypeList: FrappeActionHandler<
  ListDoctypesInput,
  { doctypes: AdminDoctypeSummary[] }
> = {
  read: async (rc, input) => ({
    doctypes: await query<AdminDoctypeSummary[]>(rc, "admin_doctypes", input),
  }),
};

const adminDoctypeDescribe: FrappeActionHandler<DescribeDoctypeInput, AdminDoctypeDescription> = {
  read: (rc, input) => query<AdminDoctypeDescription>(rc, "admin_doctype", input),
};

const adminDocumentList: FrappeActionHandler<
  ListDocumentsInput,
  { doctype: string; documents: AdminDocument[] }
> = {
  read: async (rc, input) => ({
    doctype: input.doctype,
    documents: await query<AdminDocument[]>(rc, "admin_documents", input),
  }),
};

const adminDocumentGet: FrappeActionHandler<GetDocumentInput, AdminDocumentResult> = {
  read: async (rc, input) => ({
    doctype: input.doctype,
    name: input.name,
    document: await query<AdminDocument>(rc, "admin_document", input),
  }),
};

function adminDocumentWrite<Input extends Record<string, unknown>>(): FrappeWriteSpec<
  Input,
  AdminDocumentResult
> {
  return {
    recordType: "document",
    event: "admin.document.changed",
    payload: (_wc, input) => withoutKey(input),
    map: async (_rc, result) => ({
      doctype: str(result, "doctype") ?? "",
      name: str(result, "name") ?? "",
      document: docOf(result, "document"),
    }),
    recordId: (output) => adminDocumentRecordId(output.doctype, output.name),
  };
}

const adminDocumentInsert: FrappeActionHandler<InsertDocumentInput, AdminDocumentResult> = {
  write: adminDocumentWrite<InsertDocumentInput>(),
};
const adminDocumentUpdate: FrappeActionHandler<UpdateDocumentInput, AdminDocumentResult> = {
  write: adminDocumentWrite<UpdateDocumentInput>(),
};
const adminDocumentSubmit: FrappeActionHandler<DocumentRefInput, AdminDocumentResult> = {
  write: adminDocumentWrite<DocumentRefInput>(),
};
const adminDocumentCancel: FrappeActionHandler<DocumentRefInput, AdminDocumentResult> = {
  write: adminDocumentWrite<DocumentRefInput>(),
};

const adminDocumentDelete: FrappeActionHandler<DocumentRefInput, AdminDeleteResult> = {
  write: {
    recordType: "document",
    event: "admin.document.changed",
    payload: (_wc, input) => withoutKey(input),
    map: async (_rc, result) => ({
      doctype: str(result, "doctype") ?? "",
      name: str(result, "name") ?? "",
      deleted: true as const,
    }),
    recordId: (output) => adminDocumentRecordId(output.doctype, output.name),
  },
};

const adminMethodCall: FrappeActionHandler<CallMethodInput, AdminMethodResult> = {
  write: {
    recordType: "document",
    event: "admin.document.changed",
    payload: (_wc, input) => withoutKey(input),
    map: async (_rc, result) => ({ method: str(result, "method") ?? "", result: result.result }),
    recordId: (output) => `method:${output.method}`,
  },
};

// --- table ------------------------------------------------------------------

export const FRAPPE_ACTION_HANDLERS: Record<BusinessActionId, FrappeActionHandler> = {
  "crm.company.create": companyCreate as FrappeActionHandler,
  "crm.company.update": companyUpdate as FrappeActionHandler,
  "crm.company.search": companySearch as FrappeActionHandler,
  "crm.company.find_duplicates": companyFindDuplicates as FrappeActionHandler,
  "crm.contact.create": contactCreate as FrappeActionHandler,
  "crm.contact.update": contactUpdate as FrappeActionHandler,
  "crm.contact.search": contactSearch as FrappeActionHandler,
  "crm.contact.find_duplicates": contactFindDuplicates as FrappeActionHandler,
  "crm.lead.create": leadCreate as FrappeActionHandler,
  "crm.lead.update": leadUpdate as FrappeActionHandler,
  "crm.lead.assign": leadAssign as FrappeActionHandler,
  "crm.lead.qualify": leadQualify as FrappeActionHandler,
  "crm.lead.convert": leadConvert as FrappeActionHandler,
  "crm.lead.search": leadSearch as FrappeActionHandler,
  "crm.deal.create": dealCreate as FrappeActionHandler,
  "crm.deal.update": dealUpdate as FrappeActionHandler,
  "crm.deal.update_stage": dealUpdateStage as FrappeActionHandler,
  "crm.deal.search": dealSearch as FrappeActionHandler,
  "crm.activity.create": activityCreate as FrappeActionHandler,
  "crm.activity.complete": activityComplete as FrappeActionHandler,
  "crm.activity.list": activityList as FrappeActionHandler,
  "erp.product.create": productCreate as FrappeActionHandler,
  "erp.product.update": productUpdate as FrappeActionHandler,
  "erp.product.search": productSearch as FrappeActionHandler,
  "erp.inventory.check": inventoryCheck as FrappeActionHandler,
  "erp.inventory.adjust": inventoryAdjust as FrappeActionHandler,
  "erp.order.create_draft": orderCreateDraft as FrappeActionHandler,
  "erp.order.add_item": orderAddItem as FrappeActionHandler,
  "erp.order.remove_item": orderRemoveItem as FrappeActionHandler,
  "erp.order.request_approval": orderRequestApproval as FrappeActionHandler,
  "erp.order.approve": orderApprove as FrappeActionHandler,
  "erp.order.confirm": orderConfirm as FrappeActionHandler,
  "erp.order.cancel": orderCancel as FrappeActionHandler,
  "erp.order.get": orderGet as FrappeActionHandler,
  "erp.order.search": orderSearch as FrappeActionHandler,
  "erp.invoice.create_draft": invoiceCreateDraft as FrappeActionHandler,
  "erp.invoice.issue": invoiceIssue as FrappeActionHandler,
  "erp.invoice.record_payment": invoiceRecordPayment as FrappeActionHandler,
  "erp.invoice.get": invoiceGet as FrappeActionHandler,
  "erp.invoice.search": invoiceSearch as FrappeActionHandler,
  "admin.doctype.list": adminDoctypeList as FrappeActionHandler,
  "admin.doctype.describe": adminDoctypeDescribe as FrappeActionHandler,
  "admin.document.list": adminDocumentList as FrappeActionHandler,
  "admin.document.get": adminDocumentGet as FrappeActionHandler,
  "admin.document.insert": adminDocumentInsert as FrappeActionHandler,
  "admin.document.update": adminDocumentUpdate as FrappeActionHandler,
  "admin.document.submit": adminDocumentSubmit as FrappeActionHandler,
  "admin.document.cancel": adminDocumentCancel as FrappeActionHandler,
  "admin.document.delete": adminDocumentDelete as FrappeActionHandler,
  "admin.method.call": adminMethodCall as FrappeActionHandler,
};
