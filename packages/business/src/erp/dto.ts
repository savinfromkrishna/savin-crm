import type {
  ErpInvoice,
  ErpProduct,
  ErpSalesOrder,
  InventoryAdjustment,
  InvoiceStatus,
  OrderStatus,
  PaymentStatus,
} from "@savingroup/contracts";
import {
  businessRef,
  INVOICE_REF_PREFIX,
  INVOICE_STATUSES,
  ORDER_REF_PREFIX,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
} from "@savingroup/contracts";
import type {
  ErpInventoryAdjustment as ErpInventoryAdjustmentRow,
  ErpInvoiceLine as ErpInvoiceLineRow,
  ErpInvoice as ErpInvoiceRow,
  ErpProduct as ErpProductRow,
  ErpSalesOrderLine as ErpSalesOrderLineRow,
  ErpSalesOrder as ErpSalesOrderRow,
} from "@savingroup/db";
import type { AttributionResolver } from "../attribution.js";
import { contactDisplayName } from "../crm/dto.js";
import { decimalToNumber } from "../money.js";

type Named = { name: string } | null;

export function coerceOrderStatus(value: string): OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value) ? (value as OrderStatus) : "draft";
}
export function coerceInvoiceStatus(value: string): InvoiceStatus {
  return (INVOICE_STATUSES as readonly string[]).includes(value)
    ? (value as InvoiceStatus)
    : "draft";
}
export function coercePaymentStatus(value: string): PaymentStatus {
  return (PAYMENT_STATUSES as readonly string[]).includes(value)
    ? (value as PaymentStatus)
    : "unpaid";
}

export function toProductDto(row: ErpProductRow, attribution: AttributionResolver): ErpProduct {
  return {
    id: row.id,
    spaceId: row.spaceId,
    sku: row.sku,
    name: row.name,
    description: row.description,
    unitPrice: decimalToNumber(row.unitPrice),
    currency: row.currency,
    active: row.active,
    stockOnHand: row.stockOnHand,
    hsnCode: null,
    createdBy: attribution.actor({ userId: row.createdByUserId, botId: row.createdByBotId }),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toAdjustmentDto(
  row: ErpInventoryAdjustmentRow & { product: { sku: string; name: string } },
  attribution: AttributionResolver,
): InventoryAdjustment {
  return {
    id: row.id,
    productId: row.productId,
    sku: row.product.sku,
    productName: row.product.name,
    delta: row.delta,
    quantityAfter: row.quantityAfter,
    reason: row.reason,
    orderId: row.orderId,
    createdBy: attribution.actor({ userId: row.createdByUserId, botId: row.createdByBotId }),
    createdAt: row.createdAt.toISOString(),
  };
}

export const orderInclude = {
  company: { select: { name: true } },
  contact: { select: { firstName: true, lastName: true } },
  invoice: { select: { id: true } },
  lines: { include: { product: { select: { sku: true } } }, orderBy: { position: "asc" } },
} as const;

export type OrderRowWithRelations = ErpSalesOrderRow & {
  company: Named;
  contact: { firstName: string; lastName: string } | null;
  invoice: { id: string } | null;
  lines: Array<ErpSalesOrderLineRow & { product: { sku: string } }>;
};

export function orderRef(row: { number: number }): string {
  return businessRef(ORDER_REF_PREFIX, row.number);
}

export function collectOrder(resolver: AttributionResolver, row: OrderRowWithRelations) {
  resolver.collect({ userId: row.createdByUserId, botId: row.createdByBotId });
  resolver.collect({ userId: row.approvedByUserId, botId: row.approvedByBotId });
}

export function toOrderDto(
  row: OrderRowWithRelations,
  attribution: AttributionResolver,
): ErpSalesOrder {
  return {
    id: row.id,
    spaceId: row.spaceId,
    number: row.number,
    ref: orderRef(row),
    status: coerceOrderStatus(row.status),
    currency: row.currency,
    subtotal: decimalToNumber(row.subtotal),
    notes: row.notes,
    companyId: row.companyId,
    companyName: row.company?.name ?? null,
    contactId: row.contactId,
    contactName: row.contact ? contactDisplayName(row.contact) : null,
    dealId: row.dealId,
    invoiceId: row.invoice?.id ?? null,
    lines: row.lines.map((line) => ({
      id: line.id,
      productId: line.productId,
      sku: line.product.sku,
      description: line.description,
      quantity: line.quantity,
      unitPrice: decimalToNumber(line.unitPrice),
      lineTotal: decimalToNumber(line.lineTotal),
      position: line.position,
    })),
    approvalRequestedAt: row.approvalRequestedAt?.toISOString() ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    approvedBy: attribution.actor({ userId: row.approvedByUserId, botId: row.approvedByBotId }),
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    createdBy: attribution.actor({ userId: row.createdByUserId, botId: row.createdByBotId }),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const invoiceInclude = {
  company: { select: { name: true } },
  order: { select: { number: true } },
  lines: { orderBy: { position: "asc" } },
} as const;

export type InvoiceRowWithRelations = ErpInvoiceRow & {
  company: Named;
  order: { number: number };
  lines: ErpInvoiceLineRow[];
};

export function invoiceRef(row: { number: number }): string {
  return businessRef(INVOICE_REF_PREFIX, row.number);
}

export function collectInvoice(resolver: AttributionResolver, row: InvoiceRowWithRelations) {
  resolver.collect({ userId: row.createdByUserId, botId: row.createdByBotId });
  resolver.collect({ userId: row.approvedByUserId, botId: row.approvedByBotId });
}

export function toInvoiceDto(
  row: InvoiceRowWithRelations,
  attribution: AttributionResolver,
): ErpInvoice {
  return {
    id: row.id,
    spaceId: row.spaceId,
    number: row.number,
    ref: invoiceRef(row),
    status: coerceInvoiceStatus(row.status),
    paymentStatus: coercePaymentStatus(row.paymentStatus),
    currency: row.currency,
    subtotal: decimalToNumber(row.subtotal),
    total: decimalToNumber(row.total),
    amountPaid: decimalToNumber(row.amountPaid),
    notes: row.notes,
    orderId: row.orderId,
    orderRef: orderRef(row.order),
    companyId: row.companyId,
    companyName: row.company?.name ?? null,
    lines: row.lines.map((line) => ({
      id: line.id,
      productId: line.productId,
      description: line.description,
      quantity: line.quantity,
      unitPrice: decimalToNumber(line.unitPrice),
      lineTotal: decimalToNumber(line.lineTotal),
      position: line.position,
    })),
    issuedAt: row.issuedAt?.toISOString() ?? null,
    dueAt: row.dueAt?.toISOString() ?? null,
    paidAt: row.paidAt?.toISOString() ?? null,
    approvedBy: attribution.actor({ userId: row.approvedByUserId, botId: row.approvedByBotId }),
    createdBy: attribution.actor({ userId: row.createdByUserId, botId: row.createdByBotId }),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
