import * as z from "zod";
import { BusinessListLimitSchema, IdempotentInput } from "./business.js";

/**
 * Administration of a connected ERPNext + Frappe CRM site: any doctype the
 * gateway user may touch, through the same bridge, operation ledger and
 * approval rules as the typed CRM and ERP actions. The prototype tables have
 * nothing to administer, so these actions need an active business environment.
 */

export const ADMIN_DOCTYPE_MAX_LENGTH = 140;
export const ADMIN_DOC_NAME_MAX_LENGTH = 140;
export const ADMIN_METHOD_MAX_LENGTH = 200;
export const ADMIN_FIELD_MAX_LENGTH = 140;
export const ADMIN_LIST_MAX_OFFSET = 100_000;

export const AdminDoctypeName = z.string().trim().min(1).max(ADMIN_DOCTYPE_MAX_LENGTH);
export const AdminDocName = z.string().trim().min(1).max(ADMIN_DOC_NAME_MAX_LENGTH);
const FieldName = z.string().trim().min(1).max(ADMIN_FIELD_MAX_LENGTH);
/** Field values as Frappe takes them: scalars, or arrays of rows for child tables. */
export const AdminDocValues = z.record(z.string(), z.unknown());

/** `[field, operator, value]` as Frappe's list API takes it. */
export const AdminFilterTuple = z.tuple([FieldName, z.string().trim().min(1).max(20), z.unknown()]);
export const AdminFilters = z.union([z.record(z.string(), z.unknown()), z.array(AdminFilterTuple)]);
export type AdminFilters = z.infer<typeof AdminFilters>;

// --- inputs ------------------------------------------------------------------

export const ListDoctypesInput = z.object({
  q: z.string().trim().max(200).optional(),
  module: z.string().trim().max(ADMIN_DOCTYPE_MAX_LENGTH).optional(),
  limit: BusinessListLimitSchema,
});
export type ListDoctypesInput = z.infer<typeof ListDoctypesInput>;

export const DescribeDoctypeInput = z.object({ doctype: AdminDoctypeName });
export type DescribeDoctypeInput = z.infer<typeof DescribeDoctypeInput>;

export const ListDocumentsInput = z.object({
  doctype: AdminDoctypeName,
  filters: AdminFilters.optional(),
  fields: z.array(FieldName).max(50).optional(),
  orderBy: z.string().trim().max(200).optional(),
  limit: BusinessListLimitSchema,
  offset: z.number().int().min(0).max(ADMIN_LIST_MAX_OFFSET).default(0),
});
export type ListDocumentsInput = z.infer<typeof ListDocumentsInput>;

export const GetDocumentInput = z.object({ doctype: AdminDoctypeName, name: AdminDocName });
export type GetDocumentInput = z.infer<typeof GetDocumentInput>;

export const InsertDocumentInput = IdempotentInput.extend({
  doctype: AdminDoctypeName,
  values: AdminDocValues,
  /** Submit right after inserting; only for submittable doctypes. */
  submit: z.boolean().default(false),
});
export type InsertDocumentInput = z.infer<typeof InsertDocumentInput>;

export const UpdateDocumentInput = IdempotentInput.extend({
  doctype: AdminDoctypeName,
  name: AdminDocName,
  values: AdminDocValues,
});
export type UpdateDocumentInput = z.infer<typeof UpdateDocumentInput>;

export const DocumentRefInput = IdempotentInput.extend({
  doctype: AdminDoctypeName,
  name: AdminDocName,
});
export type DocumentRefInput = z.infer<typeof DocumentRefInput>;

export const ADMIN_METHOD_PATTERN = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)+$/i;
export const CallMethodInput = IdempotentInput.extend({
  method: z
    .string()
    .trim()
    .min(1)
    .max(ADMIN_METHOD_MAX_LENGTH)
    .regex(ADMIN_METHOD_PATTERN, "Use a dotted Python path such as frappe.client.get_count"),
  args: z.record(z.string(), z.unknown()).default({}),
});
export type CallMethodInput = z.infer<typeof CallMethodInput>;

// --- outputs -----------------------------------------------------------------

export const AdminDoctypeSummarySchema = z.object({
  name: z.string(),
  module: z.string().nullable(),
  isSubmittable: z.boolean(),
  isSingle: z.boolean(),
  isChild: z.boolean(),
  custom: z.boolean(),
});
export type AdminDoctypeSummary = z.infer<typeof AdminDoctypeSummarySchema>;

export const AdminFieldSchema = z.object({
  fieldname: z.string(),
  label: z.string().nullable(),
  fieldtype: z.string(),
  /** Link target, select options or child doctype, as Frappe stores it. */
  options: z.string().nullable(),
  required: z.boolean(),
  readOnly: z.boolean(),
  default: z.string().nullable(),
});
export type AdminField = z.infer<typeof AdminFieldSchema>;

export const AdminWorkflowSchema = z.object({
  name: z.string(),
  states: z.array(z.string()),
  transitions: z.array(z.object({ state: z.string(), action: z.string(), nextState: z.string() })),
});

export const AdminDoctypeDescriptionSchema = z.object({
  doctype: z.string(),
  module: z.string().nullable(),
  isSubmittable: z.boolean(),
  isSingle: z.boolean(),
  naming: z.string().nullable(),
  fields: z.array(AdminFieldSchema),
  /** What the gateway user may do with this doctype. */
  permissions: z.object({
    read: z.boolean(),
    write: z.boolean(),
    create: z.boolean(),
    delete: z.boolean(),
    submit: z.boolean(),
    cancel: z.boolean(),
  }),
  workflow: AdminWorkflowSchema.nullable(),
});
export type AdminDoctypeDescription = z.infer<typeof AdminDoctypeDescriptionSchema>;

/** A site document as Frappe returns it; child tables are arrays of rows. */
export const AdminDocumentSchema = z.record(z.string(), z.unknown());
export type AdminDocument = z.infer<typeof AdminDocumentSchema>;

export const AdminDocumentResultSchema = z.object({
  doctype: z.string(),
  name: z.string(),
  document: AdminDocumentSchema,
});
export type AdminDocumentResult = z.infer<typeof AdminDocumentResultSchema>;

export const AdminDeleteResultSchema = z.object({
  doctype: z.string(),
  name: z.string(),
  deleted: z.literal(true),
});
export type AdminDeleteResult = z.infer<typeof AdminDeleteResultSchema>;

export const AdminMethodResultSchema = z.object({ method: z.string(), result: z.unknown() });
export type AdminMethodResult = z.infer<typeof AdminMethodResultSchema>;

/** Audit id of a site document: the doctype and name that identify it there. */
export function adminDocumentRecordId(doctype: string, name: string): string {
  return `${doctype}/${name}`;
}
