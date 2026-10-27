import type {
  CompleteActivityInput,
  CreateActivityInput,
  CrmActivity,
  ListActivitiesInput,
} from "@savingroup/contracts";
import { AttributionResolver, resolveAttribution } from "../attribution.js";
import { emitBusinessEvent } from "../audit.js";
import type { BusinessClient, BusinessContext } from "../context.js";
import { actorColumns } from "../context.js";
import { notFound } from "../errors.js";
import {
  requireCompany,
  requireContact,
  requireDeal,
  requireLead,
  resolveAssignee,
} from "../lookups.js";
import { collectActor, toActivityDto } from "./dto.js";

function collectActivity(
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

export async function createActivity(
  client: BusinessClient,
  ctx: BusinessContext,
  input: CreateActivityInput,
): Promise<CrmActivity> {
  if (input.companyId) await requireCompany(client, ctx.spaceId, input.companyId);
  if (input.contactId) await requireContact(client, ctx.spaceId, input.contactId);
  if (input.leadId) await requireLead(client, ctx.spaceId, input.leadId);
  if (input.dealId) await requireDeal(client, ctx.spaceId, input.dealId);
  const assignee = await resolveAssignee(client, ctx.spaceId, input);
  const row = await client.crmActivity.create({
    data: {
      spaceId: ctx.spaceId,
      kind: input.kind,
      subject: input.subject,
      body: input.body || null,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      completedAt: input.completed ? ctx.now : null,
      companyId: input.companyId ?? null,
      contactId: input.contactId ?? null,
      leadId: input.leadId ?? null,
      dealId: input.dealId ?? null,
      ...assignee,
      ...actorColumns(ctx.actor),
    },
  });
  await emitBusinessEvent(client, ctx, {
    type: "crm.activity.created",
    recordType: "activity",
    recordId: row.id,
    payload: {
      kind: row.kind,
      subject: row.subject,
      leadId: row.leadId,
      dealId: row.dealId,
      contactId: row.contactId,
      companyId: row.companyId,
    },
  });
  const resolver = new AttributionResolver(client, ctx.spaceId);
  collectActivity(resolver, row);
  await resolver.load();
  return toActivityDto(row, resolver);
}

export async function completeActivity(
  client: BusinessClient,
  ctx: BusinessContext,
  input: CompleteActivityInput,
): Promise<CrmActivity> {
  const current = await client.crmActivity.findFirst({
    where: { id: input.id, spaceId: ctx.spaceId },
  });
  if (!current) throw notFound("Activity");
  const row = await client.crmActivity.update({
    where: { id: current.id },
    data: {
      completedAt: input.completed ? ctx.now : null,
    },
  });
  await emitBusinessEvent(client, ctx, {
    type: "crm.activity.completed",
    recordType: "activity",
    recordId: row.id,
    payload: {
      kind: row.kind,
      subject: row.subject,
      completed: input.completed,
      leadId: row.leadId,
      dealId: row.dealId,
    },
  });
  const resolver = new AttributionResolver(client, ctx.spaceId);
  collectActivity(resolver, row);
  await resolver.load();
  return toActivityDto(row, resolver);
}

export async function listActivities(
  client: BusinessClient,
  spaceId: string,
  input: ListActivitiesInput,
): Promise<{ activities: CrmActivity[] }> {
  const rows = await client.crmActivity.findMany({
    where: {
      spaceId,
      ...(input.companyId ? { companyId: input.companyId } : {}),
      ...(input.contactId ? { contactId: input.contactId } : {}),
      ...(input.leadId ? { leadId: input.leadId } : {}),
      ...(input.dealId ? { dealId: input.dealId } : {}),
      ...(input.kind ? { kind: input.kind } : {}),
      ...(input.openOnly ? { completedAt: null } : {}),
      ...(input.assigneeBotId ? { assigneeBotId: input.assigneeBotId } : {}),
      ...(input.assigneeUserId ? { assigneeUserId: input.assigneeUserId } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit,
  });
  const attribution = await resolveAttribution(client, spaceId, rows, (row, resolver) =>
    collectActivity(resolver, row),
  );
  return { activities: rows.map((row) => toActivityDto(row, attribution)) };
}
