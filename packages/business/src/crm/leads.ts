import type {
  AssignLeadInput,
  ConvertLeadInput,
  CreateLeadInput,
  CrmDeal,
  CrmLead,
  QualifyLeadInput,
  SearchLeadsInput,
  UpdateLeadInput,
} from "@savingroup/contracts";
import { LEAD_REF_PREFIX, parseBusinessRef } from "@savingroup/contracts";
import { AttributionResolver, resolveAttribution } from "../attribution.js";
import { emitBusinessEvent } from "../audit.js";
import type { BusinessClient, BusinessContext } from "../context.js";
import { actorColumns } from "../context.js";
import { invalidState, notFound } from "../errors.js";
import {
  containsText,
  requireCompany,
  requireContact,
  requireLeadByRef,
  resolveAssignee,
} from "../lookups.js";
import { decimalToNullableNumber, toDecimal } from "../money.js";
import { allocateBusinessNumber } from "../settings.js";
import { createDeal } from "./deals.js";
import { collectActor, leadInclude, toLeadDto } from "./dto.js";

type LeadRowWithRelations = NonNullable<Awaited<ReturnType<typeof findLeadRow>>>;

async function findLeadRow(client: BusinessClient, spaceId: string, id: string) {
  return client.crmLead.findFirst({ where: { id, spaceId }, include: leadInclude });
}

async function leadAttribution(client: BusinessClient, spaceId: string, row: LeadRowWithRelations) {
  const resolver = new AttributionResolver(client, spaceId);
  collectLead(resolver, row);
  await resolver.load();
  return resolver;
}

function collectLead(
  resolver: AttributionResolver,
  row: {
    createdByUserId: string | null;
    createdByBotId: string | null;
    assigneeUserId: string | null;
    assigneeBotId: string | null;
  },
) {
  collectActor(resolver, row);
  resolver.collect({ userId: row.assigneeUserId, botId: row.assigneeBotId });
}

export async function createLead(
  client: BusinessClient,
  ctx: BusinessContext,
  input: CreateLeadInput,
): Promise<CrmLead> {
  if (input.companyId) await requireCompany(client, ctx.spaceId, input.companyId);
  if (input.contactId) await requireContact(client, ctx.spaceId, input.contactId);
  const assignee = await resolveAssignee(client, ctx.spaceId, input);
  const number = await allocateBusinessNumber(client, ctx.spaceId, "lead");
  const row = await client.crmLead.create({
    include: leadInclude,
    data: {
      spaceId: ctx.spaceId,
      number,
      title: input.title,
      status: "new",
      source: input.source || null,
      notes: input.notes || null,
      value: input.value !== undefined ? toDecimal(input.value) : null,
      companyId: input.companyId ?? null,
      contactId: input.contactId ?? null,
      ...assignee,
      ...actorColumns(ctx.actor),
    },
  });
  await emitBusinessEvent(client, ctx, {
    type: "crm.lead.created",
    recordType: "lead",
    recordId: row.id,
    payload: { number: row.number, title: row.title, companyId: row.companyId },
  });
  if (assignee.assigneeBotId || assignee.assigneeUserId) {
    await emitBusinessEvent(client, ctx, {
      type: "crm.lead.assigned",
      recordType: "lead",
      recordId: row.id,
      payload: { assigneeBotId: assignee.assigneeBotId, assigneeUserId: assignee.assigneeUserId },
    });
  }
  return toLeadDto(row, await leadAttribution(client, ctx.spaceId, row));
}

export async function updateLead(
  client: BusinessClient,
  ctx: BusinessContext,
  input: UpdateLeadInput,
): Promise<CrmLead> {
  const current = await requireLeadByRef(client, ctx.spaceId, input);
  if (input.companyId) await requireCompany(client, ctx.spaceId, input.companyId);
  if (input.contactId) await requireContact(client, ctx.spaceId, input.contactId);
  const row = await client.crmLead.update({
    where: { id: current.id },
    include: leadInclude,
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.source !== undefined ? { source: input.source || null } : {}),
      ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
      ...(input.value !== undefined
        ? { value: input.value !== null ? toDecimal(input.value) : null }
        : {}),
      ...(input.companyId !== undefined ? { companyId: input.companyId } : {}),
      ...(input.contactId !== undefined ? { contactId: input.contactId } : {}),
    },
  });
  await emitBusinessEvent(client, ctx, {
    type: "crm.lead.updated",
    recordType: "lead",
    recordId: row.id,
    payload: { number: row.number, title: row.title },
  });
  return toLeadDto(row, await leadAttribution(client, ctx.spaceId, row));
}

export async function assignLead(
  client: BusinessClient,
  ctx: BusinessContext,
  input: AssignLeadInput,
): Promise<CrmLead> {
  const current = await requireLeadByRef(client, ctx.spaceId, input);
  if (current.status === "converted") throw invalidState("A converted lead cannot be reassigned.");
  const assignee = await resolveAssignee(client, ctx.spaceId, input);
  const row = await client.crmLead.update({
    where: { id: current.id },
    include: leadInclude,
    data: { ...assignee, ...(current.status === "new" ? { status: "contacted" } : {}) },
  });
  await emitBusinessEvent(client, ctx, {
    type: "crm.lead.assigned",
    recordType: "lead",
    recordId: row.id,
    payload: { assigneeBotId: row.assigneeBotId, assigneeUserId: row.assigneeUserId },
  });
  return toLeadDto(row, await leadAttribution(client, ctx.spaceId, row));
}

export async function qualifyLead(
  client: BusinessClient,
  ctx: BusinessContext,
  input: QualifyLeadInput,
): Promise<CrmLead> {
  const current = await requireLeadByRef(client, ctx.spaceId, input);
  if (current.status === "converted") throw invalidState("A converted lead cannot change status.");
  const row = await client.crmLead.update({
    where: { id: current.id },
    include: leadInclude,
    data: {
      status: input.status,
      ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
      ...(input.value !== undefined ? { value: toDecimal(input.value) } : {}),
    },
  });
  await emitBusinessEvent(client, ctx, {
    type: "crm.lead.status_changed",
    recordType: "lead",
    recordId: row.id,
    payload: { from: current.status, to: row.status },
  });
  return toLeadDto(row, await leadAttribution(client, ctx.spaceId, row));
}

/** Only a qualified lead becomes a deal; the deal inherits customer, value and owner. */
export async function convertLead(
  client: BusinessClient,
  ctx: BusinessContext,
  input: ConvertLeadInput,
): Promise<{ lead: CrmLead; deal: CrmDeal }> {
  const current = await requireLeadByRef(client, ctx.spaceId, input);
  if (current.status === "converted") throw invalidState("Lead is already converted.");
  if (current.status !== "qualified") {
    throw invalidState("Only a qualified lead can be converted. Qualify it first.");
  }
  const deal = await createDeal(client, ctx, {
    title: input.title ?? current.title,
    amount: input.amount ?? decimalToNullableNumber(current.value) ?? 0,
    stage: "qualification",
    companyId: current.companyId ?? undefined,
    contactId: current.contactId ?? undefined,
    ownerUserId: current.assigneeUserId ?? undefined,
    ownerBotId: current.assigneeBotId ?? undefined,
  });
  const row = await client.crmLead.update({
    where: { id: current.id },
    include: leadInclude,
    data: { status: "converted", convertedDealId: deal.id },
  });
  await emitBusinessEvent(client, ctx, {
    type: "crm.lead.converted",
    recordType: "lead",
    recordId: row.id,
    payload: { dealId: deal.id, dealRef: deal.ref },
  });
  return { lead: toLeadDto(row, await leadAttribution(client, ctx.spaceId, row)), deal };
}

export async function searchLeads(
  client: BusinessClient,
  spaceId: string,
  input: SearchLeadsInput,
): Promise<{ leads: CrmLead[] }> {
  const q = containsText(input.q);
  let number: number | undefined;
  if (input.ref) {
    const parsed = parseBusinessRef(input.ref, LEAD_REF_PREFIX);
    if (parsed === null) throw notFound(`Lead ${input.ref}`);
    number = parsed;
  }
  const rows = await client.crmLead.findMany({
    where: {
      spaceId,
      ...(input.id ? { id: input.id } : {}),
      ...(number !== undefined ? { number } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.assigneeBotId ? { assigneeBotId: input.assigneeBotId } : {}),
      ...(input.assigneeUserId ? { assigneeUserId: input.assigneeUserId } : {}),
      ...(input.companyId ? { companyId: input.companyId } : {}),
      ...(q ? { OR: [{ title: q }, { company: { name: q } }, { notes: q }] } : {}),
    },
    include: leadInclude,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: input.limit,
  });
  const attribution = await resolveAttribution(client, spaceId, rows, (row, resolver) =>
    collectLead(resolver, row),
  );
  return { leads: rows.map((row) => toLeadDto(row, attribution)) };
}
