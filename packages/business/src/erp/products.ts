import type {
  CreateProductInput,
  ErpProduct,
  SearchProductsInput,
  UpdateProductInput,
} from "@savingroup/contracts";
import { AttributionResolver, resolveAttribution } from "../attribution.js";
import { emitBusinessEvent } from "../audit.js";
import type { BusinessClient, BusinessContext } from "../context.js";
import { actorColumns } from "../context.js";
import { collectActor } from "../crm/dto.js";
import { conflict } from "../errors.js";
import { containsText, requireProductByRef } from "../lookups.js";
import { toDecimal } from "../money.js";
import { ensureBusinessSettings } from "../settings.js";
import { toProductDto } from "./dto.js";

async function productAttribution(
  client: BusinessClient,
  spaceId: string,
  row: { createdByUserId: string | null; createdByBotId: string | null },
) {
  const resolver = new AttributionResolver(client, spaceId);
  collectActor(resolver, row);
  await resolver.load();
  return resolver;
}

export async function createProduct(
  client: BusinessClient,
  ctx: BusinessContext,
  input: CreateProductInput,
): Promise<ErpProduct> {
  const existing = await client.erpProduct.findFirst({
    where: { spaceId: ctx.spaceId, sku: input.sku },
    select: { id: true },
  });
  if (existing) throw conflict(`SKU ${input.sku} already exists.`);
  const settings = await ensureBusinessSettings(client, ctx.spaceId);
  const row = await client.erpProduct.create({
    data: {
      spaceId: ctx.spaceId,
      sku: input.sku,
      name: input.name,
      description: input.description || null,
      unitPrice: toDecimal(input.unitPrice),
      currency: settings.currency,
      stockOnHand: input.initialStock,
      ...actorColumns(ctx.actor),
    },
  });
  if (input.initialStock > 0) {
    await client.erpInventoryAdjustment.create({
      data: {
        spaceId: ctx.spaceId,
        productId: row.id,
        delta: input.initialStock,
        quantityAfter: input.initialStock,
        reason: "Opening stock",
        ...actorColumns(ctx.actor),
      },
    });
  }
  await emitBusinessEvent(client, ctx, {
    type: "erp.product.created",
    recordType: "product",
    recordId: row.id,
    payload: { sku: row.sku, name: row.name, unitPrice: input.unitPrice },
  });
  return toProductDto(row, await productAttribution(client, ctx.spaceId, row));
}

export async function updateProduct(
  client: BusinessClient,
  ctx: BusinessContext,
  input: UpdateProductInput,
): Promise<ErpProduct> {
  const current = await requireProductByRef(client, ctx.spaceId, {
    productId: input.id,
    sku: input.id ? undefined : input.sku,
  });
  // With an id present, `sku` is a rename; without one it only identified the product.
  const nextSku = input.id && input.sku && input.sku !== current.sku ? input.sku : undefined;
  if (nextSku) {
    const taken = await client.erpProduct.findFirst({
      where: { spaceId: ctx.spaceId, sku: nextSku },
      select: { id: true },
    });
    if (taken) throw conflict(`SKU ${nextSku} already exists.`);
  }
  const row = await client.erpProduct.update({
    where: { id: current.id },
    data: {
      ...(nextSku ? { sku: nextSku } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description || null } : {}),
      ...(input.unitPrice !== undefined ? { unitPrice: toDecimal(input.unitPrice) } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    },
  });
  await emitBusinessEvent(client, ctx, {
    type: "erp.product.updated",
    recordType: "product",
    recordId: row.id,
    payload: {
      ...(input.unitPrice !== undefined ? { unitPrice: input.unitPrice } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    },
  });
  return toProductDto(row, await productAttribution(client, ctx.spaceId, row));
}

export async function searchProducts(
  client: BusinessClient,
  spaceId: string,
  input: SearchProductsInput,
): Promise<{ products: ErpProduct[] }> {
  const q = containsText(input.q);
  const rows = await client.erpProduct.findMany({
    where: {
      spaceId,
      ...(input.id ? { id: input.id } : {}),
      ...(input.sku ? { sku: input.sku.trim().toUpperCase() } : {}),
      ...(input.includeInactive ? {} : { active: true }),
      ...(q ? { OR: [{ name: q }, { sku: q }, { description: q }] } : {}),
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: input.limit,
  });
  const attribution = await resolveAttribution(client, spaceId, rows, (row, resolver) =>
    collectActor(resolver, row),
  );
  return { products: rows.map((row) => toProductDto(row, attribution)) };
}
