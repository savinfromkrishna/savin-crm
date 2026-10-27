import type {
  CreateDealInput,
  CrmDeal,
  SearchDealsInput,
  UpdateDealInput,
  UpdateDealStageInput,
} from "@savingroup/contracts";
import { DEAL_REF_PREFIX, isClosedDealStage, parseBusinessRef } from "@savingroup/contracts";
import { AttributionResolver, resolveAttribution } from "../attribution.js";
import { emitBusinessEvent } from "../audit.js";
import type { BusinessClient, BusinessContext } from "../context.js";
import { actorColumns } from "../context.js";
import { invalidState, notFound } from "../errors.js";
import {
  containsText,
  requireCompany,
  requireContact,
  requireDealByRef,
  resolveAssignee,
} from "../lookups.js";
import { toDecimal } from "../money.js";
import { allocateBusinessNumber, ensureBusinessSettings } from "../settings.js";
import { coerceDealStage, collectActor, dealInclude, toDealDto } from "./dto.js";

type DealRowWithRelations = NonNullable<Awaited<ReturnType<typeof findDealRow>>>;

async function findDealRow(client: BusinessClient, spaceId: string, id: string) {
  return client.crmDeal.findFirst({ where: { id, spaceId }, include: dealInclude });
}

function collectDeal(
  resolver: AttributionResolver,
  row: {
    createdByUserId: string | null;
    createdByBotId: string | null;
    ownerUserId: string | null;
    ownerBotId: string | null;
  },
) {
  collectActor(resolver, row);
  resolver.collect({ userId: row.ownerUserId, botId: row.ownerBotId });
}

async function dealAttribution(client: BusinessClient, spaceId: string, row: DealRowWithRelations) {
  const resolver = new AttributionResolver(client, spaceId);
  collectDeal(resolver, row);
  await resolver.load();
  return resolver;
}

export async function createDeal(
  client: BusinessClient,
  ctx: BusinessContext,
  input: CreateDealInput,
): Promise<CrmDeal> {
  if (input.companyId) await requireCompany(client, ctx.spaceId, input.companyId);
  if (input.contactId) await requireContact(client, ctx.spaceId, input.contactId);
  const owner = await resolveAssignee(client, ctx.spaceId, {
    assigneeUserId: input.ownerUserId,
    assigneeBotId: input.ownerBotId,
  });
  const settings = await ensureBusinessSettings(client, ctx.spaceId);
  const number = await allocateBusinessNumber(client, ctx.spaceId, "deal");
  const closed = isClosedDealStage(input.stage);
  const row = await client.crmDeal.create({
    include: dealInclude,
    data: {
      spaceId: ctx.spaceId,
      number,
      title: input.title,
      stage: input.stage,
      amount: toDecimal(input.amount),
      currency: settings.currency,
      expectedCloseAt: input.expectedCloseAt ? new Date(input.expectedCloseAt) : null,
      closedAt: closed ? ctx.now : null,
      notes: input.notes || null,
      companyId: input.companyId ?? null,
      contactId: input.contactId ?? null,
      ownerUserId: owner.assigneeUserId,
      ownerBotId: owner.assigneeBotId,
      ...actorColumns(ctx.actor),
    },
  });
  await emitBusinessEvent(client, ctx, {
    type: "crm.deal.created",
    recordType: "deal",
    recordId: row.id,
    payload: { number: row.number, title: row.title, amount: input.amount, stage: row.stage },
  });
  return toDealDto(row, await dealAttribution(client, ctx.spaceId, row));
}

export async function updateDeal(
  client: BusinessClient,
  ctx: BusinessContext,
  input: UpdateDealInput,
): Promise<CrmDeal> {
  const current = await requireDealByRef(client, ctx.spaceId, input);
  if (input.companyId) await requireCompany(client, ctx.spaceId, input.companyId);
  if (input.contactId) await requireContact(client, ctx.spaceId, input.contactId);
  const ownerChange =
    input.ownerUserId !== undefined || input.ownerBotId !== undefined
      ? await resolveAssignee(client, ctx.spaceId, {
          assigneeUserId: input.ownerUserId ?? undefined,
          assigneeBotId: input.ownerBotId ?? undefined,
        })
      : undefined;
  const row = await client.crmDeal.update({
    where: { id: current.id },
    include: dealInclude,
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.amount !== undefined ? { amount: toDecimal(input.amount) } : {}),
      ...(input.expectedCloseAt !== undefined
        ? { expectedCloseAt: input.expectedCloseAt ? new Date(input.expectedCloseAt) : null }
        : {}),
      ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
      ...(input.companyId !== undefined ? { companyId: input.companyId } : {}),
      ...(input.contactId !== undefined ? { contactId: input.contactId } : {}),
      ...(ownerChange
        ? { ownerUserId: ownerChange.assigneeUserId, ownerBotId: ownerChange.assigneeBotId }
        : {}),
    },
  });
  await emitBusinessEvent(client, ctx, {
    type: "crm.deal.updated",
    recordType: "deal",
    recordId: row.id,
    payload: {
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
    },
  });
  return toDealDto(row, await dealAttribution(client, ctx.spaceId, row));
}

export async function updateDealStage(
  client: BusinessClient,
  ctx: BusinessContext,
  input: UpdateDealStageInput,
): Promise<CrmDeal> {
  const current = await requireDealByRef(client, ctx.spaceId, input);
  const from = coerceDealStage(current.stage);
  if (from === input.stage) throw invalidState(`Deal is already in stage ${from}.`);
  const row = await client.crmDeal.update({
    where: { id: current.id },
    include: dealInclude,
    data: {
      stage: input.stage,
      closedAt: isClosedDealStage(input.stage) ? (current.closedAt ?? ctx.now) : null,
    },
  });
  await emitBusinessEvent(client, ctx, {
    type: "crm.deal.stage_changed",
    recordType: "deal",
    recordId: row.id,
    payload: { from, to: input.stage, ...(input.reason ? { reason: input.reason } : {}) },
  });
  return toDealDto(row, await dealAttribution(client, ctx.spaceId, row));
}

/** ERP calls this when an order for the deal is confirmed; a closed deal stays as it is. */
export async function markDealWonFromOrder(
  client: BusinessClient,
  ctx: BusinessContext,
  dealId: string,
  orderRef: string,
): Promise<void> {
  const current = await client.crmDeal.findFirst({ where: { id: dealId, spaceId: ctx.spaceId } });
  if (!current || isClosedDealStage(coerceDealStage(current.stage))) return;
  await client.crmDeal.update({
    where: { id: current.id },
    data: { stage: "won", closedAt: ctx.now },
  });
  await emitBusinessEvent(client, ctx, {
    type: "crm.deal.stage_changed",
    recordType: "deal",
    recordId: current.id,
    payload: { from: current.stage, to: "won", reason: `Order ${orderRef} confirmed` },
  });
}

export async function searchDeals(
  client: BusinessClient,
  spaceId: string,
  input: SearchDealsInput,
): Promise<{ deals: CrmDeal[] }> {
  const q = containsText(input.q);
  let number: number | undefined;
  if (input.ref) {
    const parsed = parseBusinessRef(input.ref, DEAL_REF_PREFIX);
    if (parsed === null) throw notFound(`Deal ${input.ref}`);
    number = parsed;
  }
  const rows = await client.crmDeal.findMany({
    where: {
      spaceId,
      ...(input.id ? { id: input.id } : {}),
      ...(number !== undefined ? { number } : {}),
      ...(input.stage ? { stage: input.stage } : {}),
      ...(input.companyId ? { companyId: input.companyId } : {}),
      ...(input.ownerBotId ? { ownerBotId: input.ownerBotId } : {}),
      ...(input.ownerUserId ? { ownerUserId: input.ownerUserId } : {}),
      ...(q ? { OR: [{ title: q }, { company: { name: q } }, { notes: q }] } : {}),
    },
    include: dealInclude,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: input.limit,
  });
  const attribution = await resolveAttribution(client, spaceId, rows, (row, resolver) =>
    collectDeal(resolver, row),
  );
  return { deals: rows.map((row) => toDealDto(row, attribution)) };
}
