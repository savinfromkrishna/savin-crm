import type {
  AddOrderItemInput,
  CreateOrderDraftInput,
  ErpSalesOrder,
  OrderRefInput,
  OrderTransitionInput,
  RemoveOrderItemInput,
  SearchOrdersInput,
} from "@savingroup/contracts";
import { ORDER_REF_PREFIX, parseBusinessRef } from "@savingroup/contracts";
import type { Prisma } from "@savingroup/db";
import { AttributionResolver, resolveAttribution } from "../attribution.js";
import { emitBusinessEvent } from "../audit.js";
import type { BusinessClient, BusinessContext } from "../context.js";
import { actorColumns, actorIds } from "../context.js";
import { markDealWonFromOrder } from "../crm/deals.js";
import { invalidInput, invalidState, notFound } from "../errors.js";
import {
  containsText,
  requireCompany,
  requireContact,
  requireDealByRef,
  requireProductByRef,
} from "../lookups.js";
import { decimalToNumber, lineTotal, sumMoney, toDecimal } from "../money.js";
import { allocateBusinessNumber, ensureBusinessSettings } from "../settings.js";
import {
  coerceOrderStatus,
  collectOrder,
  type OrderRowWithRelations,
  orderInclude,
  orderRef,
  toOrderDto,
} from "./dto.js";
import { applyStockDelta } from "./inventory.js";

async function orderAttribution(
  client: BusinessClient,
  spaceId: string,
  row: OrderRowWithRelations,
): Promise<AttributionResolver> {
  const resolver = new AttributionResolver(client, spaceId);
  collectOrder(resolver, row);
  await resolver.load();
  return resolver;
}

async function loadOrder(
  client: BusinessClient,
  spaceId: string,
  id: string,
): Promise<OrderRowWithRelations> {
  const row = await client.erpSalesOrder.findFirst({
    where: { id, spaceId },
    include: orderInclude,
  });
  if (!row) throw notFound("Order");
  return row;
}

export async function requireOrderByRef(
  client: BusinessClient,
  spaceId: string,
  ref: { id?: string; ref?: string },
): Promise<OrderRowWithRelations> {
  if (ref.id) return loadOrder(client, spaceId, ref.id);
  if (ref.ref) {
    const number = parseBusinessRef(ref.ref, ORDER_REF_PREFIX);
    if (number === null) throw notFound(`Order ${ref.ref}`);
    const row = await client.erpSalesOrder.findFirst({
      where: { spaceId, number },
      include: orderInclude,
    });
    if (!row) throw notFound(`Order ${ref.ref}`);
    return row;
  }
  throw invalidInput("Provide the order id or ref.");
}

async function orderDto(client: BusinessClient, spaceId: string, id: string) {
  const row = await loadOrder(client, spaceId, id);
  return toOrderDto(row, await orderAttribution(client, spaceId, row));
}

/** Recompute the subtotal from the lines after any line change. */
async function refreshSubtotal(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  const lines = await tx.erpSalesOrderLine.findMany({
    where: { orderId },
    select: { lineTotal: true },
  });
  await tx.erpSalesOrder.update({
    where: { id: orderId },
    data: { subtotal: toDecimal(sumMoney(lines.map((line) => decimalToNumber(line.lineTotal)))) },
  });
}

async function appendLine(
  tx: Prisma.TransactionClient,
  ctx: BusinessContext,
  order: { id: string; currency: string },
  line: { productId?: string; sku?: string; quantity: number; unitPrice?: number },
) {
  const product = await requireProductByRef(tx, ctx.spaceId, line);
  if (!product.active) throw invalidState(`Product ${product.sku} is inactive.`);
  const unitPrice = line.unitPrice ?? decimalToNumber(product.unitPrice);
  const last = await tx.erpSalesOrderLine.findFirst({
    where: { orderId: order.id },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return tx.erpSalesOrderLine.create({
    data: {
      spaceId: ctx.spaceId,
      orderId: order.id,
      productId: product.id,
      position: (last?.position ?? 0) + 1,
      description: product.name,
      quantity: line.quantity,
      unitPrice: toDecimal(unitPrice),
      lineTotal: toDecimal(lineTotal(line.quantity, unitPrice)),
    },
  });
}

function assertEditable(row: { status: string; number: number }) {
  if (coerceOrderStatus(row.status) !== "draft") {
    throw invalidState(`Order ${orderRef(row)} is ${row.status}; only drafts can change lines.`);
  }
}

export async function createOrderDraft(
  tx: Prisma.TransactionClient,
  ctx: BusinessContext,
  input: CreateOrderDraftInput,
): Promise<ErpSalesOrder> {
  if (input.companyId) await requireCompany(tx, ctx.spaceId, input.companyId);
  if (input.contactId) await requireContact(tx, ctx.spaceId, input.contactId);
  const deal =
    input.dealId || input.dealRef
      ? await requireDealByRef(tx, ctx.spaceId, { id: input.dealId, ref: input.dealRef })
      : null;
  // A deal already knows its customer; an order for it inherits them unless told otherwise.
  const companyId = input.companyId ?? deal?.companyId ?? null;
  const contactId = input.contactId ?? deal?.contactId ?? null;
  const settings = await ensureBusinessSettings(tx, ctx.spaceId);
  const number = await allocateBusinessNumber(tx, ctx.spaceId, "order");
  const row = await tx.erpSalesOrder.create({
    data: {
      spaceId: ctx.spaceId,
      number,
      status: "draft",
      currency: settings.currency,
      notes: input.notes || null,
      companyId,
      contactId,
      dealId: deal?.id ?? null,
      ...actorColumns(ctx.actor),
    },
  });
  for (const line of input.lines) await appendLine(tx, ctx, row, line);
  if (input.lines.length > 0) await refreshSubtotal(tx, row.id);
  await emitBusinessEvent(tx, ctx, {
    type: "erp.order.created",
    recordType: "order",
    recordId: row.id,
    payload: { number: row.number, companyId: row.companyId, dealId: row.dealId },
  });
  return orderDto(tx, ctx.spaceId, row.id);
}

export async function addOrderItem(
  tx: Prisma.TransactionClient,
  ctx: BusinessContext,
  input: AddOrderItemInput,
): Promise<ErpSalesOrder> {
  const order = await loadOrder(tx, ctx.spaceId, input.orderId);
  assertEditable(order);
  const line = await appendLine(tx, ctx, order, input);
  await refreshSubtotal(tx, order.id);
  await emitBusinessEvent(tx, ctx, {
    type: "erp.order.updated",
    recordType: "order",
    recordId: order.id,
    payload: { addedLineId: line.id, productId: line.productId, quantity: line.quantity },
  });
  return orderDto(tx, ctx.spaceId, order.id);
}

export async function removeOrderItem(
  tx: Prisma.TransactionClient,
  ctx: BusinessContext,
  input: RemoveOrderItemInput,
): Promise<ErpSalesOrder> {
  const order = await loadOrder(tx, ctx.spaceId, input.orderId);
  assertEditable(order);
  const line = order.lines.find((entry) => entry.id === input.lineId);
  if (!line) throw notFound("Order line");
  await tx.erpSalesOrderLine.delete({ where: { id: line.id } });
  await refreshSubtotal(tx, order.id);
  await emitBusinessEvent(tx, ctx, {
    type: "erp.order.updated",
    recordType: "order",
    recordId: order.id,
    payload: { removedLineId: line.id },
  });
  return orderDto(tx, ctx.spaceId, order.id);
}

export async function requestOrderApproval(
  tx: Prisma.TransactionClient,
  ctx: BusinessContext,
  input: OrderTransitionInput,
): Promise<ErpSalesOrder> {
  const order = await requireOrderByRef(tx, ctx.spaceId, input);
  const status = coerceOrderStatus(order.status);
  if (status !== "draft") throw invalidState(`Order ${orderRef(order)} is ${status}.`);
  if (order.lines.length === 0)
    throw invalidState("Add at least one line before requesting approval.");
  await tx.erpSalesOrder.update({
    where: { id: order.id },
    data: { status: "pending_approval", approvalRequestedAt: ctx.now },
  });
  await emitBusinessEvent(tx, ctx, {
    type: "erp.order.approval_requested",
    recordType: "order",
    recordId: order.id,
    payload: { number: order.number, subtotal: decimalToNumber(order.subtotal) },
  });
  return orderDto(tx, ctx.spaceId, order.id);
}

export async function approveOrder(
  tx: Prisma.TransactionClient,
  ctx: BusinessContext,
  input: OrderTransitionInput,
): Promise<ErpSalesOrder> {
  const order = await requireOrderByRef(tx, ctx.spaceId, input);
  const status = coerceOrderStatus(order.status);
  if (status !== "pending_approval" && status !== "draft") {
    throw invalidState(`Order ${orderRef(order)} is ${status}.`);
  }
  if (order.lines.length === 0) throw invalidState("Add at least one line before approving.");
  const approver = actorIds(ctx.actor);
  await tx.erpSalesOrder.update({
    where: { id: order.id },
    data: {
      status: "approved",
      approvedAt: ctx.now,
      approvedByUserId: approver.userId,
      approvedByBotId: approver.botId,
      approvalRequestedAt: order.approvalRequestedAt ?? ctx.now,
    },
  });
  await emitBusinessEvent(tx, ctx, {
    type: "erp.order.approved",
    recordType: "order",
    recordId: order.id,
    payload: { number: order.number, ...(input.reason ? { reason: input.reason } : {}) },
  });
  return orderDto(tx, ctx.spaceId, order.id);
}

/**
 * Confirmation is the point of no return: stock is re-validated under row locks
 * and decremented in the same transaction, and a linked deal is marked won.
 */
export async function confirmOrder(
  tx: Prisma.TransactionClient,
  ctx: BusinessContext,
  input: OrderTransitionInput,
): Promise<ErpSalesOrder> {
  const order = await requireOrderByRef(tx, ctx.spaceId, input);
  const settings = await ensureBusinessSettings(tx, ctx.spaceId);
  const status = coerceOrderStatus(order.status);
  if (status === "confirmed") throw invalidState(`Order ${orderRef(order)} is already confirmed.`);
  if (status === "cancelled") throw invalidState(`Order ${orderRef(order)} is cancelled.`);
  if (status !== "approved" && settings.orderApprovalRequired) {
    throw invalidState(
      `Order ${orderRef(order)} needs approval before it can be confirmed (status: ${status}).`,
    );
  }
  if (order.lines.length === 0) throw invalidState("Add at least one line before confirming.");
  // Lock in a stable order so two confirmations touching the same products never deadlock.
  const lines = [...order.lines].sort((a, b) => a.productId.localeCompare(b.productId));
  for (const line of lines) {
    await applyStockDelta(tx, ctx, {
      product: { id: line.productId, sku: line.product.sku, name: line.description },
      delta: -line.quantity,
      reason: `Order ${orderRef(order)} confirmed`,
      orderId: order.id,
      allowNegativeStock: settings.allowNegativeStock,
    });
  }
  const approver = actorIds(ctx.actor);
  await tx.erpSalesOrder.update({
    where: { id: order.id },
    data: {
      status: "confirmed",
      confirmedAt: ctx.now,
      ...(status !== "approved"
        ? {
            approvedAt: ctx.now,
            approvedByUserId: approver.userId,
            approvedByBotId: approver.botId,
          }
        : {}),
    },
  });
  await emitBusinessEvent(tx, ctx, {
    type: "erp.order.confirmed",
    recordType: "order",
    recordId: order.id,
    payload: {
      number: order.number,
      subtotal: decimalToNumber(order.subtotal),
      lines: order.lines.map((line) => ({ sku: line.product.sku, quantity: line.quantity })),
    },
  });
  if (order.dealId) await markDealWonFromOrder(tx, ctx, order.dealId, orderRef(order));
  return orderDto(tx, ctx.spaceId, order.id);
}

export async function cancelOrder(
  tx: Prisma.TransactionClient,
  ctx: BusinessContext,
  input: OrderTransitionInput,
): Promise<ErpSalesOrder> {
  const order = await requireOrderByRef(tx, ctx.spaceId, input);
  const status = coerceOrderStatus(order.status);
  if (status === "cancelled") throw invalidState(`Order ${orderRef(order)} is already cancelled.`);
  if (status === "confirmed") {
    throw invalidState(
      `Order ${orderRef(order)} is confirmed and stock has moved; reverse it with an inventory adjustment instead.`,
    );
  }
  await tx.erpSalesOrder.update({
    where: { id: order.id },
    data: { status: "cancelled", cancelledAt: ctx.now },
  });
  await emitBusinessEvent(tx, ctx, {
    type: "erp.order.cancelled",
    recordType: "order",
    recordId: order.id,
    payload: {
      number: order.number,
      from: status,
      ...(input.reason ? { reason: input.reason } : {}),
    },
  });
  return orderDto(tx, ctx.spaceId, order.id);
}

export async function getOrder(
  client: BusinessClient,
  spaceId: string,
  input: OrderRefInput,
): Promise<ErpSalesOrder> {
  const row = await requireOrderByRef(client, spaceId, input);
  return toOrderDto(row, await orderAttribution(client, spaceId, row));
}

export async function searchOrders(
  client: BusinessClient,
  spaceId: string,
  input: SearchOrdersInput,
): Promise<{ orders: ErpSalesOrder[] }> {
  const q = containsText(input.q);
  const number = input.q ? parseBusinessRef(input.q, ORDER_REF_PREFIX) : null;
  const rows = await client.erpSalesOrder.findMany({
    where: {
      spaceId,
      ...(input.status ? { status: input.status } : {}),
      ...(input.companyId ? { companyId: input.companyId } : {}),
      ...(input.dealId ? { dealId: input.dealId } : {}),
      ...(number !== null
        ? { number }
        : q
          ? {
              OR: [{ company: { name: q } }, { notes: q }, { lines: { some: { description: q } } }],
            }
          : {}),
    },
    include: orderInclude,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: input.limit,
  });
  const attribution = await resolveAttribution(client, spaceId, rows, (row, resolver) =>
    collectOrder(resolver, row),
  );
  return { orders: rows.map((row) => toOrderDto(row, attribution)) };
}
