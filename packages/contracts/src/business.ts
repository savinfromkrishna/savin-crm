import * as z from "zod";
import { Id } from "./ids.js";

/**
 * Shared vocabulary for the business applications (CRM OS and ERP OS): action
 * identifiers, error codes, domain events, money, settings, and attribution.
 * Record shapes live in `crm.ts` and `erp.ts`.
 */

/** Dotted action ids are the stable public names; `_` tool names are what a model calls. */
export const BUSINESS_ACTION_IDS = [
  "crm.company.create",
  "crm.company.update",
  "crm.company.search",
  "crm.company.find_duplicates",
  "crm.contact.create",
  "crm.contact.update",
  "crm.contact.search",
  "crm.contact.find_duplicates",
  "crm.lead.create",
  "crm.lead.update",
  "crm.lead.assign",
  "crm.lead.qualify",
  "crm.lead.convert",
  "crm.lead.search",
  "crm.deal.create",
  "crm.deal.update",
  "crm.deal.update_stage",
  "crm.deal.search",
  "crm.activity.create",
  "crm.activity.complete",
  "crm.activity.list",
  "erp.product.create",
  "erp.product.update",
  "erp.product.search",
  "erp.inventory.check",
  "erp.inventory.adjust",
  "erp.order.create_draft",
  "erp.order.add_item",
  "erp.order.remove_item",
  "erp.order.request_approval",
  "erp.order.approve",
  "erp.order.confirm",
  "erp.order.cancel",
  "erp.order.get",
  "erp.order.search",
  "erp.invoice.create_draft",
  "erp.invoice.issue",
  "erp.invoice.record_payment",
  "erp.invoice.get",
  "erp.invoice.search",
  // Site administration: any doctype on a connected ERPNext + Frappe CRM site.
  "admin.doctype.list",
  "admin.doctype.describe",
  "admin.document.list",
  "admin.document.get",
  "admin.document.insert",
  "admin.document.update",
  "admin.document.submit",
  "admin.document.cancel",
  "admin.document.delete",
  "admin.method.call",
] as const;
export const BusinessActionIdSchema = z.enum(BUSINESS_ACTION_IDS);
export type BusinessActionId = z.infer<typeof BusinessActionIdSchema>;

type DotsToUnderscores<S extends string> = S extends `${infer Head}.${infer Tail}`
  ? `${Head}_${DotsToUnderscores<Tail>}`
  : S;
export type BusinessToolName = DotsToUnderscores<BusinessActionId>;

export function businessToolName<T extends BusinessActionId>(actionId: T): DotsToUnderscores<T> {
  return actionId.replaceAll(".", "_") as DotsToUnderscores<T>;
}

/** Every model-facing business tool name, in registry order. */
export const BUSINESS_TOOL_NAMES: readonly BusinessToolName[] = BUSINESS_ACTION_IDS.map((id) =>
  businessToolName(id),
);
const businessToolNameSet: ReadonlySet<string> = new Set(BUSINESS_TOOL_NAMES);
export function isBusinessToolName(name: string): name is BusinessToolName {
  return businessToolNameSet.has(name);
}
// Action ids also contain underscores (update_stage, create_draft), so the reverse map is explicit.
const actionIdByToolName = new Map<string, BusinessActionId>(
  BUSINESS_ACTION_IDS.map((id) => [businessToolName(id), id]),
);
export function businessActionIdFromToolName(name: string): BusinessActionId | undefined {
  return actionIdByToolName.get(name);
}

/** Writes a bot may only run after a human approves them (see action-approval). */
export const BUSINESS_CONSEQUENTIAL_ACTION_IDS = [
  "erp.inventory.adjust",
  "erp.order.approve",
  "erp.order.confirm",
  "erp.order.cancel",
  "erp.invoice.issue",
  "erp.invoice.record_payment",
  // Every administrative write changes the site's configuration or records for real.
  "admin.document.insert",
  "admin.document.update",
  "admin.document.submit",
  "admin.document.cancel",
  "admin.document.delete",
  "admin.method.call",
] as const satisfies readonly BusinessActionId[];
export const BUSINESS_CONSEQUENTIAL_TOOL_NAMES: readonly BusinessToolName[] =
  BUSINESS_CONSEQUENTIAL_ACTION_IDS.map((id) => businessToolName(id));

/** Reads: safe for unattended runs and never recorded as effects. */
export const BUSINESS_READ_ACTION_IDS = [
  "crm.company.search",
  "crm.company.find_duplicates",
  "crm.contact.search",
  "crm.contact.find_duplicates",
  "crm.lead.search",
  "crm.deal.search",
  "crm.activity.list",
  "erp.product.search",
  "erp.inventory.check",
  "erp.order.get",
  "erp.order.search",
  "erp.invoice.get",
  "erp.invoice.search",
  "admin.doctype.list",
  "admin.doctype.describe",
  "admin.document.list",
  "admin.document.get",
] as const satisfies readonly BusinessActionId[];
export const BUSINESS_READ_TOOL_NAMES: readonly BusinessToolName[] = BUSINESS_READ_ACTION_IDS.map(
  (id) => businessToolName(id),
);
export function isBusinessReadActionId(actionId: BusinessActionId): boolean {
  return (BUSINESS_READ_ACTION_IDS as readonly string[]).includes(actionId);
}
export function isBusinessConsequentialActionId(actionId: BusinessActionId): boolean {
  return (BUSINESS_CONSEQUENTIAL_ACTION_IDS as readonly string[]).includes(actionId);
}

/** Spawn keys of the business team's bots, so a surface can find a role's bot in a space. */
export const BUSINESS_TEAM_SPAWN_KEYS = {
  operator: "business:operator",
  sales: "business-demo:sales",
  operations: "business-demo:operations",
  finance: "business-demo:finance",
  analyst: "business-demo:analyst",
  steward: "business:steward",
} as const;
export type BusinessTeamRoleKey = keyof typeof BUSINESS_TEAM_SPAWN_KEYS;

export const BUSINESS_ERROR_CODES = [
  "invalid_input",
  "not_found",
  "permission_denied",
  "conflict",
  "invalid_state",
  "insufficient_stock",
  "unavailable",
] as const;
export const BusinessErrorCodeSchema = z.enum(BUSINESS_ERROR_CODES);
export type BusinessErrorCode = z.infer<typeof BusinessErrorCodeSchema>;

export const BusinessErrorSchema = z.object({
  code: BusinessErrorCodeSchema,
  message: z.string(),
  /** Field-level detail for invalid_input. */
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type BusinessError = z.infer<typeof BusinessErrorSchema>;

export const BUSINESS_EVENT_TYPES = [
  "crm.company.created",
  "crm.company.updated",
  "crm.contact.created",
  "crm.contact.updated",
  "crm.lead.created",
  "crm.lead.assigned",
  "crm.lead.status_changed",
  "crm.lead.converted",
  "crm.deal.created",
  "crm.deal.updated",
  "crm.deal.stage_changed",
  "crm.activity.created",
  "crm.activity.completed",
  "erp.product.created",
  "erp.product.updated",
  "erp.inventory.adjusted",
  "erp.order.created",
  "erp.order.updated",
  "erp.order.approval_requested",
  "erp.order.approved",
  "erp.order.confirmed",
  "erp.order.cancelled",
  "erp.invoice.draft_created",
  "erp.invoice.issued",
  "erp.invoice.payment_recorded",
  // Delivered by a connected business environment (ERPNext + Frappe CRM site).
  "crm.lead.updated",
  "crm.deal.won",
  "customer.created",
  "sales.quotation.created",
  "sales.order.submitted",
  "sales.order.cancelled",
  "sales.invoice.submitted",
  "sales.invoice.cancelled",
  "finance.payment.recorded",
  "inventory.stock.changed",
  // An administrative write on the site (any doctype), recorded like every other action.
  "admin.document.changed",
] as const;
export const BusinessEventTypeSchema = z.enum(BUSINESS_EVENT_TYPES);
export type BusinessEventType = z.infer<typeof BusinessEventTypeSchema>;

export const BUSINESS_RECORD_TYPES = [
  "company",
  "contact",
  "lead",
  "deal",
  "activity",
  "product",
  "order",
  "invoice",
  /** A site document of any doctype, identified as `<doctype>/<name>` (admin.* actions). */
  "document",
] as const;
export const BusinessRecordTypeSchema = z.enum(BUSINESS_RECORD_TYPES);
export type BusinessRecordType = z.infer<typeof BusinessRecordTypeSchema>;

/** Who did it, for display. Exactly one of the ids is set for a real actor. */
export const BusinessActorSchema = z.object({
  userId: Id.nullable(),
  botId: Id.nullable(),
  /** Display name resolved at read time; null when the actor was removed. */
  name: z.string().nullable(),
});
export type BusinessActor = z.infer<typeof BusinessActorSchema>;

/** Live signal that something in the space's business records changed. */
export const BusinessChangeSchema = z.object({
  spaceId: Id,
  type: BusinessEventTypeSchema.optional(),
  recordType: BusinessRecordTypeSchema.optional(),
  recordId: Id.optional(),
  createdAt: z.string(),
});
export type BusinessChange = z.infer<typeof BusinessChangeSchema>;

export const BusinessEventSchema = z.object({
  id: Id,
  spaceId: Id,
  type: BusinessEventTypeSchema,
  recordType: BusinessRecordTypeSchema,
  recordId: Id,
  payload: z.record(z.string(), z.unknown()),
  actor: BusinessActorSchema,
  createdAt: z.string(),
});
export type BusinessEvent = z.infer<typeof BusinessEventSchema>;

export const BusinessHistoryEntrySchema = z.object({
  id: Id,
  actionId: z.string(),
  outcome: z.enum(["succeeded", "failed"]),
  errorCode: BusinessErrorCodeSchema.nullable(),
  actor: BusinessActorSchema,
  runId: Id.nullable(),
  /** Validated input with nothing secret in it; shown as the change detail. */
  input: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export type BusinessHistoryEntry = z.infer<typeof BusinessHistoryEntrySchema>;

export const BusinessHistoryInput = z.object({
  recordType: BusinessRecordTypeSchema,
  recordId: Id,
  limit: z.number().int().min(1).max(200).default(50),
});
export type BusinessHistoryInput = z.infer<typeof BusinessHistoryInput>;

export const CURRENCY_CODE_LENGTH = 3;
export const CurrencyCodeSchema = z
  .string()
  .trim()
  .length(CURRENCY_CODE_LENGTH)
  .regex(/^[A-Za-z]{3}$/, "Use a 3-letter currency code")
  .transform((value) => value.toUpperCase());

/** Money moves through the API as a decimal number with at most two decimals. */
export const MoneySchema = z
  .number()
  .finite()
  .nonnegative()
  .max(999_999_999_999.99)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, {
    message: "At most two decimal places",
  });
export const SignedMoneySchema = z
  .number()
  .finite()
  .min(-999_999_999_999.99)
  .max(999_999_999_999.99)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, {
    message: "At most two decimal places",
  });

export function toMinorUnits(amount: number): number {
  return Math.round(amount * 100);
}
export function fromMinorUnits(minor: number): number {
  return minor / 100;
}
/** Decimal text Postgres accepts for a numeric(14,2) column. */
export function moneyToDecimalString(amount: number): string {
  return (toMinorUnits(amount) / 100).toFixed(2);
}

export const BUSINESS_NAME_MAX_LENGTH = 200;
export const BUSINESS_TEXT_MAX_LENGTH = 20_000;
export const BUSINESS_SHORT_TEXT_MAX_LENGTH = 500;
export const BUSINESS_SEARCH_MAX_LENGTH = 200;
export const BUSINESS_LIST_LIMIT = 50;
export const BUSINESS_LIST_MAX_LIMIT = 200;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 200;

export const IdempotencyKeySchema = z.string().trim().min(1).max(IDEMPOTENCY_KEY_MAX_LENGTH);
/** Mixed into every write input so a retried request or bot-attributed action can be recognised. */
export const IdempotentInput = z.object({
  idempotencyKey: IdempotencyKeySchema.optional(),
  actorBotId: Id.optional(),
});

export const BusinessListLimitSchema = z
  .number()
  .int()
  .min(1)
  .max(BUSINESS_LIST_MAX_LIMIT)
  .default(BUSINESS_LIST_LIMIT);

export const BusinessSettingsSchema = z.object({
  spaceId: Id,
  currency: z.string(),
  allowNegativeStock: z.boolean(),
  orderApprovalRequired: z.boolean(),
  invoiceApprovalRequired: z.boolean(),
  updatedAt: z.string(),
});
export type BusinessSettings = z.infer<typeof BusinessSettingsSchema>;

export const UpdateBusinessSettingsInput = z
  .object({
    currency: CurrencyCodeSchema.optional(),
    allowNegativeStock: z.boolean().optional(),
    orderApprovalRequired: z.boolean().optional(),
    invoiceApprovalRequired: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: "Provide a setting to change",
  });
export type UpdateBusinessSettingsInput = z.infer<typeof UpdateBusinessSettingsInput>;

export const BusinessActionDescriptorSchema = z.object({
  id: BusinessActionIdSchema,
  toolName: z.string(),
  version: z.number().int().positive(),
  description: z.string(),
  kind: z.enum(["read", "write"]),
  /** True when a bot needs human approval by default before running it. */
  consequential: z.boolean(),
});
export type BusinessActionDescriptor = z.infer<typeof BusinessActionDescriptorSchema>;

/** Human-readable references. Products are referenced by SKU. */
export const LEAD_REF_PREFIX = "L";
export const DEAL_REF_PREFIX = "D";
export const ORDER_REF_PREFIX = "SO";
export const INVOICE_REF_PREFIX = "INV";

export function businessRef(prefix: string, number: number): string {
  return `${prefix}-${number}`;
}

export function parseBusinessRef(value: string, prefix: string): number | null {
  const match = new RegExp(`^${prefix}-([1-9][0-9]*)$`, "i").exec(value.trim());
  const raw = match?.[1];
  return raw ? Number(raw) : null;
}

export const ProvisionBusinessTeamMemberSchema = z.object({
  key: z.string(),
  botId: Id,
  name: z.string(),
});

export const ProvisionBusinessTeamOutputSchema = z.object({
  team: z.array(ProvisionBusinessTeamMemberSchema),
});
export type ProvisionBusinessTeamOutput = z.infer<typeof ProvisionBusinessTeamOutputSchema>;

export const SeedBusinessDemoOutputSchema = z.object({
  companyIds: z.array(Id),
  contactIds: z.array(Id),
  productIds: z.array(Id),
  leadRefs: z.array(z.string()),
  dealRefs: z.array(z.string()),
  orderRefs: z.array(z.string()),
});
export type SeedBusinessDemoOutput = z.infer<typeof SeedBusinessDemoOutputSchema>;
