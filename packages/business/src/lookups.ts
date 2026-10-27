import { DEAL_REF_PREFIX, LEAD_REF_PREFIX, parseBusinessRef } from "@savingroup/contracts";
import type { BusinessClient } from "./context.js";
import { invalidInput, notFound } from "./errors.js";

/** Every cross-record reference is checked against the same space before use. */
export async function requireCompany(client: BusinessClient, spaceId: string, id: string) {
  const row = await client.crmCompany.findFirst({ where: { id, spaceId } });
  if (!row) throw notFound("Company");
  return row;
}

export async function requireContact(client: BusinessClient, spaceId: string, id: string) {
  const row = await client.crmContact.findFirst({ where: { id, spaceId } });
  if (!row) throw notFound("Contact");
  return row;
}

export async function requireLead(client: BusinessClient, spaceId: string, id: string) {
  const row = await client.crmLead.findFirst({ where: { id, spaceId } });
  if (!row) throw notFound("Lead");
  return row;
}

export async function requireDeal(client: BusinessClient, spaceId: string, id: string) {
  const row = await client.crmDeal.findFirst({ where: { id, spaceId } });
  if (!row) throw notFound("Deal");
  return row;
}

export async function requireLeadByRef(
  client: BusinessClient,
  spaceId: string,
  input: { id?: string; ref?: string },
) {
  if (input.id) return requireLead(client, spaceId, input.id);
  const number = input.ref ? parseBusinessRef(input.ref, LEAD_REF_PREFIX) : null;
  if (number === null) throw notFound(`Lead ${input.ref ?? ""}`.trim());
  const row = await client.crmLead.findFirst({ where: { spaceId, number } });
  if (!row) throw notFound(`Lead ${input.ref}`);
  return row;
}

export async function requireDealByRef(
  client: BusinessClient,
  spaceId: string,
  input: { id?: string; ref?: string },
) {
  if (input.id) return requireDeal(client, spaceId, input.id);
  const number = input.ref ? parseBusinessRef(input.ref, DEAL_REF_PREFIX) : null;
  if (number === null) throw notFound(`Deal ${input.ref ?? ""}`.trim());
  const row = await client.crmDeal.findFirst({ where: { spaceId, number } });
  if (!row) throw notFound(`Deal ${input.ref}`);
  return row;
}

export async function requireProduct(client: BusinessClient, spaceId: string, id: string) {
  const row = await client.erpProduct.findFirst({ where: { id, spaceId } });
  if (!row) throw notFound("Product");
  return row;
}

export async function requireProductByRef(
  client: BusinessClient,
  spaceId: string,
  ref: { productId?: string; sku?: string },
) {
  if (ref.productId) return requireProduct(client, spaceId, ref.productId);
  if (ref.sku) {
    const row = await client.erpProduct.findFirst({
      where: { spaceId, sku: ref.sku.trim().toUpperCase() },
    });
    if (!row) throw notFound(`Product ${ref.sku}`);
    return row;
  }
  throw invalidInput("Provide productId or sku.");
}

export interface AssigneeInput {
  assigneeUserId?: string | null;
  assigneeBotId?: string | null;
}

/**
 * An assignee must be a member of the space (user) or an active bot in it.
 * Returns the normalised pair with exactly one id or both null.
 */
export async function resolveAssignee(
  client: BusinessClient,
  spaceId: string,
  input: AssigneeInput,
): Promise<{ assigneeUserId: string | null; assigneeBotId: string | null }> {
  if (input.assigneeUserId && input.assigneeBotId) {
    throw invalidInput("Assign to a user or a bot, not both.");
  }
  if (input.assigneeBotId) {
    await requireBot(client, spaceId, input.assigneeBotId);
    return { assigneeUserId: null, assigneeBotId: input.assigneeBotId };
  }
  if (input.assigneeUserId) {
    await requireMember(client, spaceId, input.assigneeUserId);
    return { assigneeUserId: input.assigneeUserId, assigneeBotId: null };
  }
  return { assigneeUserId: null, assigneeBotId: null };
}

export async function requireBot(client: BusinessClient, spaceId: string, botId: string) {
  const bot = await client.bot.findFirst({
    where: { id: botId, spaceId, archivedAt: null },
    select: { id: true, name: true },
  });
  if (!bot) throw notFound("Bot");
  return bot;
}

export async function requireMember(client: BusinessClient, spaceId: string, userId: string) {
  const member = await client.spaceMember.findFirst({
    where: { spaceId, userId },
    select: { id: true },
  });
  if (!member) throw notFound("Space member");
  return member;
}

/** Case-insensitive contains, the way a person types a search box. */
export function containsText(q: string | undefined) {
  const text = q?.trim();
  return text ? ({ contains: text, mode: "insensitive" } as const) : undefined;
}
