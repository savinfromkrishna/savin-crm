import * as z from "zod";
import {
  BUSINESS_NAME_MAX_LENGTH,
  BUSINESS_SEARCH_MAX_LENGTH,
  BUSINESS_SHORT_TEXT_MAX_LENGTH,
  BUSINESS_TEXT_MAX_LENGTH,
  BusinessActorSchema,
  BusinessListLimitSchema,
  IdempotentInput,
  MoneySchema,
} from "./business.js";
import { Id, IsoDate } from "./ids.js";

const Name = z.string().trim().min(1).max(BUSINESS_NAME_MAX_LENGTH);
const OptionalShortText = z.string().trim().max(BUSINESS_SHORT_TEXT_MAX_LENGTH);
const OptionalLongText = z.string().max(BUSINESS_TEXT_MAX_LENGTH);
const SearchText = z.string().trim().max(BUSINESS_SEARCH_MAX_LENGTH);
const Quantity = z.number().int().positive().max(1_000_000);
const StockDelta = z
  .number()
  .int()
  .min(-1_000_000)
  .max(1_000_000)
  .refine((value) => value !== 0, { message: "Delta must not be zero" });

export const SKU_MAX_LENGTH = 64;
/** Stock on hand at or below this counts as low, on the overview and in its lists. */
export const LOW_STOCK_THRESHOLD = 5;
export const SkuSchema = z
  .string()
  .trim()
  .min(1)
  .max(SKU_MAX_LENGTH)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Use letters, digits, dots, dashes, or underscores")
  .transform((value) => value.toUpperCase());

// --- Products & inventory ----------------------------------------------------

export const ErpProductSchema = z.object({
  id: Id,
  spaceId: Id,
  sku: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  unitPrice: z.number(),
  currency: z.string(),
  active: z.boolean(),
  stockOnHand: z.number().int(),
  /** HSN (goods) or SAC (services) classification; sites with GST require it. */
  hsnCode: z.string().nullable(),
  createdBy: BusinessActorSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ErpProduct = z.infer<typeof ErpProductSchema>;

export const CreateProductInput = IdempotentInput.extend({
  sku: SkuSchema,
  name: Name,
  description: OptionalLongText.optional(),
  unitPrice: MoneySchema,
  /** Opening stock, recorded as the first adjustment. */
  initialStock: z.number().int().nonnegative().max(1_000_000).default(0),
  /** HSN/SAC code; a GST-enabled site refuses an item without one. */
  hsnCode: z.string().trim().min(2).max(12).optional(),
});
export type CreateProductInput = z.infer<typeof CreateProductInput>;

export const UpdateProductInput = IdempotentInput.extend({
  id: Id.optional(),
  sku: SkuSchema.optional(),
  name: Name.optional(),
  description: OptionalLongText.nullable().optional(),
  unitPrice: MoneySchema.optional(),
  active: z.boolean().optional(),
  hsnCode: z.string().trim().min(2).max(12).nullable().optional(),
}).refine((value) => Boolean(value.id) || Boolean(value.sku), {
  message: "Provide the product id or sku",
});
export type UpdateProductInput = z.infer<typeof UpdateProductInput>;

export const SearchProductsInput = z.object({
  id: Id.optional(),
  sku: z.string().trim().max(SKU_MAX_LENGTH).optional(),
  q: SearchText.optional(),
  includeInactive: z.boolean().default(false),
  limit: BusinessListLimitSchema,
});
export type SearchProductsInput = z.infer<typeof SearchProductsInput>;
export const SearchProductsOutput = z.object({ products: z.array(ErpProductSchema) });

export const ProductRefInput = z
  .object({ productId: Id.optional(), sku: z.string().trim().max(SKU_MAX_LENGTH).optional() })
  .refine((value) => Boolean(value.productId) || Boolean(value.sku), {
    message: "Provide productId or sku",
  });

export const CheckInventoryInput = ProductRefInput;
export type CheckInventoryInput = z.infer<typeof CheckInventoryInput>;

export const InventoryLevelSchema = z.object({
  productId: Id,
  sku: z.string(),
  name: z.string(),
  onHand: z.number().int(),
  /** Stock that may still be promised; equals onHand until reservations exist. */
  available: z.number().int(),
  allowNegativeStock: z.boolean(),
});
export type InventoryLevel = z.infer<typeof InventoryLevelSchema>;

export const AdjustInventoryInput = IdempotentInput.extend({
  productId: Id.optional(),
  sku: z.string().trim().max(SKU_MAX_LENGTH).optional(),
  delta: StockDelta,
  reason: z.string().trim().min(1).max(BUSINESS_SHORT_TEXT_MAX_LENGTH),
}).refine((value) => Boolean(value.productId) || Boolean(value.sku), {
  message: "Provide productId or sku",
});
export type AdjustInventoryInput = z.infer<typeof AdjustInventoryInput>;

export const InventoryAdjustmentSchema = z.object({
  id: Id,
  productId: Id,
  sku: z.string(),
  productName: z.string(),
  delta: z.number().int(),
  quantityAfter: z.number().int(),
  reason: z.string(),
  orderId: Id.nullable(),
  createdBy: BusinessActorSchema,
  createdAt: z.string(),
});
export type InventoryAdjustment = z.infer<typeof InventoryAdjustmentSchema>;

export const ListInventoryAdjustmentsInput = z.object({
  productId: Id.optional(),
  limit: BusinessListLimitSchema,
});
export type ListInventoryAdjustmentsInput = z.infer<typeof ListInventoryAdjustmentsInput>;

// --- Sales orders ------------------------------------------------------------

export const ORDER_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "confirmed",
  "cancelled",
] as const;
export const OrderStatusSchema = z.enum(ORDER_STATUSES);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const OrderLineSchema = z.object({
  id: Id,
  productId: Id,
  sku: z.string(),
  description: z.string(),
  quantity: z.number().int(),
  unitPrice: z.number(),
  lineTotal: z.number(),
  position: z.number().int(),
});
export type OrderLine = z.infer<typeof OrderLineSchema>;

export const ErpSalesOrderSchema = z.object({
  id: Id,
  spaceId: Id,
  number: z.number().int().positive(),
  ref: z.string(),
  status: OrderStatusSchema,
  currency: z.string(),
  subtotal: z.number(),
  notes: z.string().nullable(),
  companyId: Id.nullable(),
  companyName: z.string().nullable(),
  contactId: Id.nullable(),
  contactName: z.string().nullable(),
  dealId: Id.nullable(),
  invoiceId: Id.nullable(),
  lines: z.array(OrderLineSchema),
  approvalRequestedAt: z.string().nullable(),
  approvedAt: z.string().nullable(),
  approvedBy: BusinessActorSchema,
  confirmedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  createdBy: BusinessActorSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ErpSalesOrder = z.infer<typeof ErpSalesOrderSchema>;

export const OrderLineInput = z.object({
  productId: Id.optional(),
  sku: z.string().trim().max(SKU_MAX_LENGTH).optional(),
  quantity: Quantity,
  /** Overrides the catalog price for this line. */
  unitPrice: MoneySchema.optional(),
});

export const CreateOrderDraftInput = IdempotentInput.extend({
  companyId: Id.optional(),
  contactId: Id.optional(),
  dealId: Id.optional(),
  /** Deal ref such as D-2; the order inherits the deal's customer when none is given. */
  dealRef: z.string().trim().max(40).optional(),
  notes: OptionalLongText.optional(),
  lines: z.array(OrderLineInput).max(200).default([]),
});
export type CreateOrderDraftInput = z.infer<typeof CreateOrderDraftInput>;

export const AddOrderItemInput = IdempotentInput.extend({
  orderId: Id,
  productId: Id.optional(),
  sku: z.string().trim().max(SKU_MAX_LENGTH).optional(),
  quantity: Quantity,
  unitPrice: MoneySchema.optional(),
}).refine((value) => Boolean(value.productId) || Boolean(value.sku), {
  message: "Provide productId or sku",
});
export type AddOrderItemInput = z.infer<typeof AddOrderItemInput>;

export const RemoveOrderItemInput = IdempotentInput.extend({ orderId: Id, lineId: Id });
export type RemoveOrderItemInput = z.infer<typeof RemoveOrderItemInput>;

export const OrderRefInput = IdempotentInput.extend({
  id: Id.optional(),
  ref: z.string().trim().max(40).optional(),
}).refine((value) => Boolean(value.id) || Boolean(value.ref), {
  message: "Provide the order id or ref",
});
export type OrderRefInput = z.infer<typeof OrderRefInput>;

export const OrderTransitionInput = IdempotentInput.extend({
  id: Id.optional(),
  ref: z.string().trim().max(40).optional(),
  reason: OptionalShortText.optional(),
}).refine((value) => Boolean(value.id) || Boolean(value.ref), {
  message: "Provide the order id or ref",
});
export type OrderTransitionInput = z.infer<typeof OrderTransitionInput>;

export const SearchOrdersInput = z.object({
  q: SearchText.optional(),
  status: OrderStatusSchema.optional(),
  companyId: Id.optional(),
  dealId: Id.optional(),
  limit: BusinessListLimitSchema,
});
export type SearchOrdersInput = z.infer<typeof SearchOrdersInput>;
export const SearchOrdersOutput = z.object({ orders: z.array(ErpSalesOrderSchema) });

// --- Invoices ----------------------------------------------------------------

export const INVOICE_STATUSES = ["draft", "issued", "paid"] as const;
export const InvoiceStatusSchema = z.enum(INVOICE_STATUSES);
export type InvoiceStatus = z.infer<typeof InvoiceStatusSchema>;

export const PAYMENT_STATUSES = ["unpaid", "partial", "paid"] as const;
export const PaymentStatusSchema = z.enum(PAYMENT_STATUSES);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

export const InvoiceLineSchema = z.object({
  id: Id,
  productId: Id.nullable(),
  description: z.string(),
  quantity: z.number().int(),
  unitPrice: z.number(),
  lineTotal: z.number(),
  position: z.number().int(),
});
export type InvoiceLine = z.infer<typeof InvoiceLineSchema>;

export const ErpInvoiceSchema = z.object({
  id: Id,
  spaceId: Id,
  number: z.number().int().positive(),
  ref: z.string(),
  status: InvoiceStatusSchema,
  paymentStatus: PaymentStatusSchema,
  currency: z.string(),
  subtotal: z.number(),
  total: z.number(),
  amountPaid: z.number(),
  notes: z.string().nullable(),
  orderId: Id,
  orderRef: z.string(),
  companyId: Id.nullable(),
  companyName: z.string().nullable(),
  lines: z.array(InvoiceLineSchema),
  issuedAt: z.string().nullable(),
  dueAt: z.string().nullable(),
  paidAt: z.string().nullable(),
  approvedBy: BusinessActorSchema,
  createdBy: BusinessActorSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ErpInvoice = z.infer<typeof ErpInvoiceSchema>;

export const CreateInvoiceDraftInput = IdempotentInput.extend({
  orderId: Id.optional(),
  orderRef: z.string().trim().max(40).optional(),
  dueAt: IsoDate.optional(),
  notes: OptionalLongText.optional(),
}).refine((value) => Boolean(value.orderId) || Boolean(value.orderRef), {
  message: "Provide the order id or ref",
});
export type CreateInvoiceDraftInput = z.infer<typeof CreateInvoiceDraftInput>;

export const InvoiceRefInput = IdempotentInput.extend({
  id: Id.optional(),
  ref: z.string().trim().max(40).optional(),
}).refine((value) => Boolean(value.id) || Boolean(value.ref), {
  message: "Provide the invoice id or ref",
});
export type InvoiceRefInput = z.infer<typeof InvoiceRefInput>;

export const IssueInvoiceInput = IdempotentInput.extend({
  id: Id.optional(),
  ref: z.string().trim().max(40).optional(),
  dueAt: IsoDate.optional(),
}).refine((value) => Boolean(value.id) || Boolean(value.ref), {
  message: "Provide the invoice id or ref",
});
export type IssueInvoiceInput = z.infer<typeof IssueInvoiceInput>;

export const RecordInvoicePaymentInput = IdempotentInput.extend({
  id: Id.optional(),
  ref: z.string().trim().max(40).optional(),
  amount: MoneySchema.refine((value) => value > 0, { message: "Amount must be positive" }),
  note: OptionalShortText.optional(),
}).refine((value) => Boolean(value.id) || Boolean(value.ref), {
  message: "Provide the invoice id or ref",
});
export type RecordInvoicePaymentInput = z.infer<typeof RecordInvoicePaymentInput>;

export const SearchInvoicesInput = z.object({
  status: InvoiceStatusSchema.optional(),
  paymentStatus: PaymentStatusSchema.optional(),
  companyId: Id.optional(),
  limit: BusinessListLimitSchema,
});
export type SearchInvoicesInput = z.infer<typeof SearchInvoicesInput>;
export const SearchInvoicesOutput = z.object({ invoices: z.array(ErpInvoiceSchema) });

export const ErpOverviewSchema = z.object({
  products: z.number().int().nonnegative(),
  lowStockProducts: z.number().int().nonnegative(),
  draftOrders: z.number().int().nonnegative(),
  pendingApprovalOrders: z.number().int().nonnegative(),
  confirmedOrders: z.number().int().nonnegative(),
  confirmedOrderAmount: z.number(),
  draftInvoices: z.number().int().nonnegative(),
  outstandingInvoiceAmount: z.number(),
  currency: z.string(),
});
export type ErpOverview = z.infer<typeof ErpOverviewSchema>;
