import * as z from "zod";
import { CurrencyCodeSchema } from "./business.js";
import { Id } from "./ids.js";

/**
 * The business environment behind CRM OS and ERP OS for an organization.
 *
 * Savingroup keeps organizations, people, bots, policies and the operation ledger.
 * Transactional business records live in a dedicated Frappe site (ERPNext +
 * Frappe CRM) per organization once an environment is active; until then the
 * built-in prototype tables answer. Every space in the organization shares the
 * same environment.
 */

export const BUSINESS_ENVIRONMENT_PROVIDERS = ["frappe"] as const;
export const BusinessEnvironmentProviderSchema = z.enum(BUSINESS_ENVIRONMENT_PROVIDERS);
export type BusinessEnvironmentProvider = z.infer<typeof BusinessEnvironmentProviderSchema>;

/** Versioned, code-defined setups: which apps, country defaults, fiscal year, chart. */
export const BUSINESS_BLUEPRINT_IDS = ["india-smb", "generic"] as const;
export const BusinessBlueprintIdSchema = z.enum(BUSINESS_BLUEPRINT_IDS);
export type BusinessBlueprintId = z.infer<typeof BusinessBlueprintIdSchema>;

export const BUSINESS_ENVIRONMENT_STATUSES = [
  /** Registered; the site is being created or configured. */
  "provisioning",
  /** Credentials stored; the gateway is checking the site answers as expected. */
  "verifying",
  /** Reads and writes for the organization go to this environment. */
  "active",
  /** Verification or provisioning failed; the prototype keeps answering. */
  "failed",
  /** Turned off by the owner; the prototype answers again (rollback). */
  "disabled",
] as const;
export const BusinessEnvironmentStatusSchema = z.enum(BUSINESS_ENVIRONMENT_STATUSES);
export type BusinessEnvironmentStatus = z.infer<typeof BusinessEnvironmentStatusSchema>;

export const BusinessEnvironmentSchema = z.object({
  id: Id,
  organizationId: Id,
  provider: BusinessEnvironmentProviderSchema,
  blueprintId: BusinessBlueprintIdSchema,
  blueprintVersion: z.number().int().positive(),
  siteUrl: z.string(),
  siteName: z.string(),
  companyName: z.string(),
  companyAbbr: z.string(),
  country: z.string(),
  currency: z.string(),
  status: BusinessEnvironmentStatusSchema,
  /** Apps the site reported on the last verification, e.g. erpnext, crm. */
  installedApps: z.array(z.string()),
  lastVerifiedAt: z.string().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type BusinessEnvironment = z.infer<typeof BusinessEnvironmentSchema>;

const SiteUrl = z
  .string()
  .trim()
  .url()
  .max(400)
  .refine((value) => /^https?:\/\//.test(value), { message: "Use an http(s) URL" })
  .transform((value) => value.replace(/\/+$/, ""));

const Secret = z.string().trim().min(8).max(400);

/**
 * Attach an existing Frappe site to the organization. The key pair belongs to
 * the site's Savingroup gateway user, never to Administrator; the gateway stores
 * it encrypted and verifies the site before anything routes to it.
 */
export const ConnectBusinessEnvironmentInput = z.object({
  siteUrl: SiteUrl,
  apiKey: Secret,
  apiSecret: Secret,
  /** Shared secret the site signs its event deliveries with. */
  webhookSecret: Secret,
  blueprintId: BusinessBlueprintIdSchema,
  companyName: z.string().trim().min(1).max(140),
  companyAbbr: z.string().trim().min(1).max(10),
  country: z.string().trim().min(2).max(60),
  currency: CurrencyCodeSchema,
});
export type ConnectBusinessEnvironmentInput = z.infer<typeof ConnectBusinessEnvironmentInput>;

/** Ledger of every write the gateway sent to the environment. */
export const BUSINESS_OPERATION_STATUSES = [
  "requested",
  "pending_approval",
  "executing",
  "succeeded",
  "failed",
  /** The request was sent but no answer arrived; nothing is retried until reconciled. */
  "outcome_unknown",
  /** Reconciliation could not settle it automatically; a person has to look. */
  "requires_reconciliation",
] as const;
export const BusinessOperationStatusSchema = z.enum(BUSINESS_OPERATION_STATUSES);
export type BusinessOperationStatus = z.infer<typeof BusinessOperationStatusSchema>;

export const BusinessOperationSchema = z.object({
  id: Id,
  environmentId: Id,
  spaceId: Id,
  actionId: z.string(),
  actionVersion: z.number().int().positive(),
  idempotencyKey: z.string(),
  status: BusinessOperationStatusSchema,
  attempts: z.number().int().nonnegative(),
  actorUserId: Id.nullable(),
  actorBotId: Id.nullable(),
  runId: Id.nullable(),
  externalDoctype: z.string().nullable(),
  externalName: z.string().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
});
export type BusinessOperation = z.infer<typeof BusinessOperationSchema>;

export const ListBusinessOperationsInput = z.object({
  status: BusinessOperationStatusSchema.optional(),
  limit: z.number().int().min(1).max(200).default(50),
});
export type ListBusinessOperationsInput = z.infer<typeof ListBusinessOperationsInput>;

/** Inbound business events the site delivers to Savingroup, named by the gateway. */
export const BUSINESS_EXTERNAL_EVENT_TYPES = [
  "crm.lead.created",
  "crm.lead.updated",
  "crm.deal.created",
  "crm.deal.updated",
  "crm.deal.won",
  "customer.created",
  "sales.quotation.created",
  "sales.order.submitted",
  "sales.order.cancelled",
  "sales.invoice.submitted",
  "sales.invoice.cancelled",
  "finance.payment.recorded",
  "inventory.stock.changed",
] as const;
export const BusinessExternalEventTypeSchema = z.enum(BUSINESS_EXTERNAL_EVENT_TYPES);
export type BusinessExternalEventType = z.infer<typeof BusinessExternalEventTypeSchema>;
