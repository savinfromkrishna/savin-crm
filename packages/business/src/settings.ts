import type { BusinessSettings, UpdateBusinessSettingsInput } from "@savingroup/contracts";
import type { BusinessSettings as BusinessSettingsRow } from "@savingroup/db";
import type { BusinessClient } from "./context.js";

/** skipDuplicates tolerates concurrent first opens without aborting their transactions. */
export async function ensureBusinessSettings(
  client: BusinessClient,
  spaceId: string,
): Promise<BusinessSettingsRow> {
  const existing = await client.businessSettings.findUnique({ where: { spaceId } });
  if (existing) return existing;
  await client.businessSettings.createMany({ data: [{ spaceId }], skipDuplicates: true });
  return client.businessSettings.findUniqueOrThrow({ where: { spaceId } });
}

export type NumberedRecord = "lead" | "deal" | "order" | "invoice";

const COUNTER_COLUMN: Record<NumberedRecord, keyof BusinessSettingsRow> = {
  lead: "nextLeadNumber",
  deal: "nextDealNumber",
  order: "nextOrderNumber",
  invoice: "nextInvoiceNumber",
};

/**
 * Atomically reserve the next number of a kind for the space. The counter is
 * incremented in the caller's transaction, so concurrent creates get distinct
 * ascending numbers.
 */
export async function allocateBusinessNumber(
  client: BusinessClient,
  spaceId: string,
  kind: NumberedRecord,
): Promise<number> {
  await ensureBusinessSettings(client, spaceId);
  const column = COUNTER_COLUMN[kind];
  const updated = await client.businessSettings.update({
    where: { spaceId },
    data: { [column]: { increment: 1 } },
    select: { [column]: true },
  });
  return (updated as unknown as Record<string, number>)[column]! - 1;
}

export async function updateBusinessSettings(
  client: BusinessClient,
  spaceId: string,
  input: UpdateBusinessSettingsInput,
): Promise<BusinessSettingsRow> {
  await ensureBusinessSettings(client, spaceId);
  return client.businessSettings.update({
    where: { spaceId },
    data: {
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
      ...(input.allowNegativeStock !== undefined
        ? { allowNegativeStock: input.allowNegativeStock }
        : {}),
      ...(input.orderApprovalRequired !== undefined
        ? { orderApprovalRequired: input.orderApprovalRequired }
        : {}),
      ...(input.invoiceApprovalRequired !== undefined
        ? { invoiceApprovalRequired: input.invoiceApprovalRequired }
        : {}),
    },
  });
}

export function toBusinessSettingsDto(row: BusinessSettingsRow): BusinessSettings {
  return {
    spaceId: row.spaceId,
    currency: row.currency,
    allowNegativeStock: row.allowNegativeStock,
    orderApprovalRequired: row.orderApprovalRequired,
    invoiceApprovalRequired: row.invoiceApprovalRequired,
    updatedAt: row.updatedAt.toISOString(),
  };
}
