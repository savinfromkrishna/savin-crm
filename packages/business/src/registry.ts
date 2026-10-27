import type {
  AdminMethodResult,
  BusinessActionDescriptor,
  BusinessActionId,
  BusinessRecordType,
} from "@savingroup/contracts";
import {
  AddOrderItemInput,
  AdjustInventoryInput,
  AssignLeadInput,
  adminDocumentRecordId,
  businessToolName,
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
  DescribeDoctypeInput,
  DocumentRefInput,
  FindDuplicatesInput,
  GetDocumentInput,
  InsertDocumentInput,
  InvoiceRefInput,
  IssueInvoiceInput,
  isBusinessConsequentialActionId,
  ListActivitiesInput,
  ListDoctypesInput,
  ListDocumentsInput,
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
import type { Prisma } from "@savingroup/db";
import type { z } from "zod";
import type { BusinessContext } from "./context.js";
import { completeActivity, createActivity, listActivities } from "./crm/activities.js";
import { createCompany, searchCompanies, updateCompany } from "./crm/companies.js";
import { createContact, searchContacts, updateContact } from "./crm/contacts.js";
import { createDeal, searchDeals, updateDeal, updateDealStage } from "./crm/deals.js";
import { findDuplicateCompanies, findDuplicateContacts } from "./crm/duplicates.js";
import {
  assignLead,
  convertLead,
  createLead,
  qualifyLead,
  searchLeads,
  updateLead,
} from "./crm/leads.js";
import { adjustInventory, checkInventory } from "./erp/inventory.js";
import {
  createInvoiceDraft,
  getInvoice,
  issueInvoice,
  recordInvoicePayment,
  searchInvoices,
} from "./erp/invoices.js";
import {
  addOrderItem,
  approveOrder,
  cancelOrder,
  confirmOrder,
  createOrderDraft,
  getOrder,
  removeOrderItem,
  requestOrderApproval,
  searchOrders,
} from "./erp/orders.js";
import { createProduct, searchProducts, updateProduct } from "./erp/products.js";
import { BusinessActionError } from "./errors.js";

/**
 * One typed, versioned action. The same definition serves the HTTP API, the
 * bot tool surface and tests, so there is exactly one validation and one
 * authorization path into each application service.
 */
export interface BusinessActionDefinition<Input = unknown, Output = unknown> {
  id: BusinessActionId;
  version: number;
  description: string;
  kind: "read" | "write";
  input: z.ZodType<Input, unknown>;
  /** The record the action is about, for the audit trail. */
  recordType?: BusinessRecordType;
  recordId?: (output: Output) => string;
  run: (client: Prisma.TransactionClient, ctx: BusinessContext, input: Input) => Promise<Output>;
}

function read<Input, Output>(
  id: BusinessActionId,
  description: string,
  input: z.ZodType<Input, unknown>,
  run: (client: Prisma.TransactionClient, spaceId: string, input: Input) => Promise<Output>,
): BusinessActionDefinition<Input, Output> {
  return {
    id,
    version: 1,
    description,
    kind: "read",
    input,
    run: (client, ctx, parsed) => run(client, ctx.spaceId, parsed),
  };
}

function write<Input, Output>(
  id: BusinessActionId,
  description: string,
  input: z.ZodType<Input, unknown>,
  recordType: BusinessRecordType,
  recordId: (output: Output) => string,
  run: (tx: Prisma.TransactionClient, ctx: BusinessContext, input: Input) => Promise<Output>,
): BusinessActionDefinition<Input, Output> {
  return { id, version: 1, description, kind: "write", input, recordType, recordId, run };
}

const byId = (record: { id: string }) => record.id;

// Site administration exists only on a connected ERPNext + Frappe CRM site; the
// prototype tables have no doctypes, workflows or automations to administer.
const SITE_ONLY_MESSAGE =
  "Site administration needs a connected Savingroup ERP + CRM site. Connect one under ERP → Overview first.";

function siteOnly(): never {
  throw new BusinessActionError("unavailable", SITE_ONLY_MESSAGE);
}

function adminRead<Input>(
  id: BusinessActionId,
  description: string,
  input: z.ZodType<Input, unknown>,
): BusinessActionDefinition<Input, unknown> {
  return { id, version: 1, description, kind: "read", input, run: async () => siteOnly() };
}

function adminWrite<Input, Output>(
  id: BusinessActionId,
  description: string,
  input: z.ZodType<Input, unknown>,
  recordId: (output: Output) => string,
): BusinessActionDefinition<Input, Output> {
  return {
    id,
    version: 1,
    description,
    kind: "write",
    input,
    recordType: "document",
    recordId,
    run: async () => siteOnly(),
  };
}

const byDocument = (output: { doctype: string; name: string }) =>
  adminDocumentRecordId(output.doctype, output.name);

export const BUSINESS_ACTIONS: readonly BusinessActionDefinition[] = [
  // CRM: companies and contacts
  write(
    "crm.company.create",
    "Create a customer company in CRM OS.",
    CreateCompanyInput,
    "company",
    byId,
    createCompany,
  ),
  write(
    "crm.company.update",
    "Update a company's name, domain, phone or notes.",
    UpdateCompanyInput,
    "company",
    byId,
    updateCompany,
  ),
  read(
    "crm.company.search",
    "Find companies by id or name/domain text.",
    SearchCompaniesInput,
    searchCompanies,
  ),
  read(
    "crm.company.find_duplicates",
    "Find duplicate companies sharing a normalized domain, name, or phone number.",
    FindDuplicatesInput,
    findDuplicateCompanies,
  ),
  write(
    "crm.contact.create",
    "Create a contact, optionally linked to a company.",
    CreateContactInput,
    "contact",
    byId,
    createContact,
  ),
  write(
    "crm.contact.update",
    "Update a contact's details or company.",
    UpdateContactInput,
    "contact",
    byId,
    updateContact,
  ),
  read(
    "crm.contact.search",
    "Find contacts by id, email, company or name text.",
    SearchContactsInput,
    searchContacts,
  ),
  read(
    "crm.contact.find_duplicates",
    "Find duplicate contacts sharing an email address, normalized full name, or phone number.",
    FindDuplicatesInput,
    findDuplicateContacts,
  ),
  // CRM: leads
  write(
    "crm.lead.create",
    "Create a lead (a potential sale) and optionally assign it to a user or bot.",
    CreateLeadInput,
    "lead",
    byId,
    createLead,
  ),
  write(
    "crm.lead.update",
    "Update a lead's title, source, notes, value, company or contact.",
    UpdateLeadInput,
    "lead",
    byId,
    updateLead,
  ),
  write(
    "crm.lead.assign",
    "Assign a lead to a space member (assigneeUserId) or a bot (assigneeBotId).",
    AssignLeadInput,
    "lead",
    byId,
    assignLead,
  ),
  write(
    "crm.lead.qualify",
    "Set a lead's qualification status: contacted, qualified or unqualified.",
    QualifyLeadInput,
    "lead",
    byId,
    qualifyLead,
  ),
  write(
    "crm.lead.convert",
    "Convert a qualified lead into a deal. Returns the lead and the new deal.",
    ConvertLeadInput,
    "lead",
    (output: { lead: { id: string } }) => output.lead.id,
    convertLead,
  ),
  read(
    "crm.lead.search",
    "Find leads by id, ref (L-12), status, assignee, company or text.",
    SearchLeadsInput,
    searchLeads,
  ),
  // CRM: deals
  write(
    "crm.deal.create",
    "Create a deal in the pipeline with an expected amount.",
    CreateDealInput,
    "deal",
    byId,
    createDeal,
  ),
  write(
    "crm.deal.update",
    "Update a deal's title, amount, close date, customer or owner.",
    UpdateDealInput,
    "deal",
    byId,
    updateDeal,
  ),
  write(
    "crm.deal.update_stage",
    "Move a deal to another pipeline stage: qualification, proposal, negotiation, won or lost.",
    UpdateDealStageInput,
    "deal",
    byId,
    updateDealStage,
  ),
  read(
    "crm.deal.search",
    "Find deals by id, ref (D-7), stage, company, owner or text.",
    SearchDealsInput,
    searchDeals,
  ),
  // CRM: activities
  write(
    "crm.activity.create",
    "Log a call, email, meeting, note or follow-up against a company, contact, lead or deal. A follow-up with dueAt is a task.",
    CreateActivityInput,
    "activity",
    byId,
    createActivity,
  ),
  write(
    "crm.activity.complete",
    "Mark a follow-up or activity task completed (or reopen it with completed: false).",
    CompleteActivityInput,
    "activity",
    byId,
    completeActivity,
  ),
  read(
    "crm.activity.list",
    "List activities for a record; openOnly returns outstanding follow-ups.",
    ListActivitiesInput,
    listActivities,
  ),
  // ERP: products and inventory
  write(
    "erp.product.create",
    "Create a catalog product with SKU, price and opening stock.",
    CreateProductInput,
    "product",
    byId,
    createProduct,
  ),
  write(
    "erp.product.update",
    "Update a product's name, description, price or active flag. Identify it by id or sku.",
    UpdateProductInput,
    "product",
    byId,
    updateProduct,
  ),
  read(
    "erp.product.search",
    "Find products by id, SKU or name text.",
    SearchProductsInput,
    searchProducts,
  ),
  read(
    "erp.inventory.check",
    "Check stock on hand and availability for a product by id or SKU.",
    CheckInventoryInput,
    checkInventory,
  ),
  write(
    "erp.inventory.adjust",
    "Adjust stock by a signed delta with a reason. Negative results are rejected unless the space allows negative stock.",
    AdjustInventoryInput,
    "product",
    (output: { productId: string }) => output.productId,
    adjustInventory,
  ),
  // ERP: sales orders
  write(
    "erp.order.create_draft",
    "Create a draft sales order for a CRM customer, optionally with lines.",
    CreateOrderDraftInput,
    "order",
    byId,
    createOrderDraft,
  ),
  write(
    "erp.order.add_item",
    "Add a product line to a draft order. Price defaults to the catalog price.",
    AddOrderItemInput,
    "order",
    byId,
    addOrderItem,
  ),
  write(
    "erp.order.remove_item",
    "Remove a line from a draft order.",
    RemoveOrderItemInput,
    "order",
    byId,
    removeOrderItem,
  ),
  write(
    "erp.order.request_approval",
    "Submit a draft order for approval.",
    OrderTransitionInput,
    "order",
    byId,
    requestOrderApproval,
  ),
  write(
    "erp.order.approve",
    "Approve an order so it can be confirmed.",
    OrderTransitionInput,
    "order",
    byId,
    approveOrder,
  ),
  write(
    "erp.order.confirm",
    "Confirm an approved order: stock is re-validated and deducted, and a linked deal is marked won.",
    OrderTransitionInput,
    "order",
    byId,
    confirmOrder,
  ),
  write(
    "erp.order.cancel",
    "Cancel an order that is not yet confirmed.",
    OrderTransitionInput,
    "order",
    byId,
    cancelOrder,
  ),
  read(
    "erp.order.get",
    "Read one order by id or ref (SO-3) with its lines.",
    OrderRefInput,
    getOrder,
  ),
  read(
    "erp.order.search",
    "List orders by status, company, deal or text.",
    SearchOrdersInput,
    searchOrders,
  ),
  // ERP: invoices
  write(
    "erp.invoice.create_draft",
    "Create a draft invoice from a confirmed order.",
    CreateInvoiceDraftInput,
    "invoice",
    byId,
    createInvoiceDraft,
  ),
  write(
    "erp.invoice.issue",
    "Issue a draft invoice to the customer.",
    IssueInvoiceInput,
    "invoice",
    byId,
    issueInvoice,
  ),
  write(
    "erp.invoice.record_payment",
    "Record a manual payment against an issued invoice.",
    RecordInvoicePaymentInput,
    "invoice",
    byId,
    recordInvoicePayment,
  ),
  read(
    "erp.invoice.get",
    "Read one invoice by id or ref (INV-2) with its lines.",
    InvoiceRefInput,
    getInvoice,
  ),
  read(
    "erp.invoice.search",
    "List invoices by status, payment status or company.",
    SearchInvoicesInput,
    searchInvoices,
  ),
  // Site administration (Operator): any doctype on the connected site
  adminRead(
    "admin.doctype.list",
    "List doctypes (record types) on the connected business site, optionally filtered by name text or module. Use it to discover what the site can store before describing or editing records.",
    ListDoctypesInput,
  ),
  adminRead(
    "admin.doctype.describe",
    "Describe a doctype on the business site: its fields with types, options and required flags, whether it is submittable, your permissions on it, and its active workflow if any. Call this before the first insert or update of a doctype you have not used yet.",
    DescribeDoctypeInput,
  ),
  adminRead(
    "admin.document.list",
    "List documents of any doctype on the business site with Frappe filters (an object of field equalities or [field, operator, value] triples), fields, order and limit. Use the crm_* and erp_* searches for everyday CRM and ERP records.",
    ListDocumentsInput,
  ),
  adminRead(
    "admin.document.get",
    "Fetch one document of any doctype on the business site by name, including its child tables.",
    GetDocumentInput,
  ),
  adminWrite(
    "admin.document.insert",
    "Create a document of any doctype on the business site: masters (Warehouse, Price List, Item Group, Customer Group, Territory, UOM, tax templates, Payment Terms), workflow rules (Workflow with states and transitions), automations (Notification, Assignment Rule, Auto Email Report, Auto Repeat, Webhook) and customisation (Custom Field, Property Setter, Print Format, Email Template). values follow the doctype's fields; child tables are arrays of rows. Set submit for submittable doctypes. Users, roles, permissions, credentials and scripts are refused.",
    InsertDocumentInput,
    byDocument,
  ),
  adminWrite(
    "admin.document.update",
    "Update fields of an existing document of any doctype on the business site; a child table given as an array replaces that table. Single doctypes (settings) take the doctype as the name.",
    UpdateDocumentInput,
    byDocument,
  ),
  adminWrite(
    "admin.document.submit",
    "Submit a draft document of a submittable doctype on the business site.",
    DocumentRefInput,
    byDocument,
  ),
  adminWrite(
    "admin.document.cancel",
    "Cancel a submitted document on the business site.",
    DocumentRefInput,
    byDocument,
  ),
  adminWrite(
    "admin.document.delete",
    "Delete a document from the business site. Irreversible: prefer disabling or cancelling when the doctype supports it.",
    DocumentRefInput,
    byDocument,
  ),
  adminWrite(
    "admin.method.call",
    "Call a whitelisted server method on the business site with keyword arguments, for example frappe.client.get_count or a Customize Form helper, when no document insert or update covers the need. User, role, credential, script and deletion methods are refused.",
    CallMethodInput,
    (output: AdminMethodResult) => `method:${output.method}`,
  ),
] as BusinessActionDefinition[];

const actionsById = new Map<BusinessActionId, BusinessActionDefinition>(
  BUSINESS_ACTIONS.map((action) => [action.id, action]),
);

export function getBusinessAction(id: BusinessActionId): BusinessActionDefinition {
  const action = actionsById.get(id);
  if (!action) throw new Error(`Unknown business action: ${id}`);
  return action;
}

export function listBusinessActionDescriptors(): BusinessActionDescriptor[] {
  return BUSINESS_ACTIONS.map((action) => ({
    id: action.id,
    toolName: businessToolName(action.id),
    version: action.version,
    description: action.description,
    kind: action.kind,
    consequential: isBusinessConsequentialActionId(action.id),
  }));
}
