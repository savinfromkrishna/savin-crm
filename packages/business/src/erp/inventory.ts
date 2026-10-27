import type {
  AdjustInventoryInput,
  CheckInventoryInput,
  InventoryAdjustment,
  InventoryLevel,
  ListInventoryAdjustmentsInput,
} from "@savingroup/contracts";
import type { Prisma } from "@savingroup/db";
import { AttributionResolver, resolveAttribution } from "../attribution.js";
import { emitBusinessEvent } from "../audit.js";
import type { BusinessClient, BusinessContext } from "../context.js";
import { actorColumns } from "../context.js";
import { collectActor } from "../crm/dto.js";
import { insufficientStock } from "../errors.js";
import { requireProductByRef } from "../lookups.js";
import { ensureBusinessSettings } from "../settings.js";
import { toAdjustmentDto } from "./dto.js";

export async function checkInventory(
  client: BusinessClient,
  spaceId: string,
  input: CheckInventoryInput,
): Promise<InventoryLevel> {
  const product = await requireProductByRef(client, spaceId, input);
  const settings = await ensureBusinessSettings(client, spaceId);
  return {
    productId: product.id,
    sku: product.sku,
    name: product.name,
    onHand: product.stockOnHand,
    available: product.stockOnHand,
    allowNegativeStock: settings.allowNegativeStock,
  };
}

/**
 * Lock the product row for the rest of the transaction so two adjustments (or
 * an adjustment racing an order confirmation) cannot both pass the stock check.
 */
export async function lockProductStock(
  tx: Prisma.TransactionClient,
  spaceId: string,
  productId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ stockOnHand: number }>>`
    SELECT "stockOnHand" FROM erp_products WHERE id = ${productId} AND "spaceId" = ${spaceId} FOR UPDATE`;
  const row = rows[0];
  if (!row) throw insufficientStock("Product no longer exists.");
  return row.stockOnHand;
}

export async function applyStockDelta(
  tx: Prisma.TransactionClient,
  ctx: BusinessContext,
  input: {
    product: { id: string; sku: string; name: string };
    delta: number;
    reason: string;
    orderId?: string;
    allowNegativeStock: boolean;
  },
) {
  const onHand = await lockProductStock(tx, ctx.spaceId, input.product.id);
  const quantityAfter = onHand + input.delta;
  if (quantityAfter < 0 && !input.allowNegativeStock) {
    throw insufficientStock(
      `Insufficient stock for ${input.product.sku}: ${onHand} on hand, ${-input.delta} needed.`,
    );
  }
  await tx.erpProduct.update({
    where: { id: input.product.id },
    data: { stockOnHand: quantityAfter },
  });
  const adjustment = await tx.erpInventoryAdjustment.create({
    include: { product: { select: { sku: true, name: true } } },
    data: {
      spaceId: ctx.spaceId,
      productId: input.product.id,
      delta: input.delta,
      quantityAfter,
      reason: input.reason,
      orderId: input.orderId ?? null,
      ...actorColumns(ctx.actor),
    },
  });
  await emitBusinessEvent(tx, ctx, {
    type: "erp.inventory.adjusted",
    recordType: "product",
    recordId: input.product.id,
    payload: {
      sku: input.product.sku,
      delta: input.delta,
      quantityAfter,
      reason: input.reason,
      ...(input.orderId ? { orderId: input.orderId } : {}),
    },
  });
  return adjustment;
}

export async function adjustInventory(
  tx: Prisma.TransactionClient,
  ctx: BusinessContext,
  input: AdjustInventoryInput,
): Promise<InventoryAdjustment> {
  // One query at a time: a transaction holds a single connection, and pg only
  // queues overlapping queries on one client until it stops supporting them.
  const product = await requireProductByRef(tx, ctx.spaceId, input);
  const settings = await ensureBusinessSettings(tx, ctx.spaceId);
  const adjustment = await applyStockDelta(tx, ctx, {
    product,
    delta: input.delta,
    reason: input.reason,
    allowNegativeStock: settings.allowNegativeStock,
  });
  const resolver = new AttributionResolver(tx, ctx.spaceId);
  collectActor(resolver, adjustment);
  await resolver.load();
  return toAdjustmentDto(adjustment, resolver);
}

export async function listInventoryAdjustments(
  client: BusinessClient,
  spaceId: string,
  input: ListInventoryAdjustmentsInput,
): Promise<InventoryAdjustment[]> {
  const rows = await client.erpInventoryAdjustment.findMany({
    where: { spaceId, ...(input.productId ? { productId: input.productId } : {}) },
    include: { product: { select: { sku: true, name: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit,
  });
  const attribution = await resolveAttribution(client, spaceId, rows, (row, resolver) =>
    collectActor(resolver, row),
  );
  return rows.map((row) => toAdjustmentDto(row, attribution));
}
