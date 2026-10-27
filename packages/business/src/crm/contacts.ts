import type {
  CreateContactInput,
  CrmContact,
  SearchContactsInput,
  UpdateContactInput,
} from "@savingroup/contracts";
import { resolveAttribution } from "../attribution.js";
import { emitBusinessEvent } from "../audit.js";
import type { BusinessClient, BusinessContext } from "../context.js";
import { actorColumns } from "../context.js";
import { containsText, requireCompany, requireContact } from "../lookups.js";
import { singleAttribution } from "./companies.js";
import { collectActor, contactDisplayName, contactInclude, toContactDto } from "./dto.js";

export async function createContact(
  client: BusinessClient,
  ctx: BusinessContext,
  input: CreateContactInput,
): Promise<CrmContact> {
  if (input.companyId) await requireCompany(client, ctx.spaceId, input.companyId);
  const row = await client.crmContact.create({
    include: contactInclude,
    data: {
      spaceId: ctx.spaceId,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email?.toLowerCase() || null,
      phone: input.phone || null,
      title: input.title || null,
      notes: input.notes || null,
      companyId: input.companyId ?? null,
      ...actorColumns(ctx.actor),
    },
  });
  await emitBusinessEvent(client, ctx, {
    type: "crm.contact.created",
    recordType: "contact",
    recordId: row.id,
    payload: { name: contactDisplayName(row), companyId: row.companyId },
  });
  return toContactDto(row, await singleAttribution(client, ctx.spaceId, row));
}

export async function updateContact(
  client: BusinessClient,
  ctx: BusinessContext,
  input: UpdateContactInput,
): Promise<CrmContact> {
  const current = await requireContact(client, ctx.spaceId, input.id);
  if (input.companyId) await requireCompany(client, ctx.spaceId, input.companyId);
  const row = await client.crmContact.update({
    where: { id: current.id },
    include: contactInclude,
    data: {
      ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
      ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
      ...(input.email !== undefined ? { email: input.email?.toLowerCase() || null } : {}),
      ...(input.phone !== undefined ? { phone: input.phone || null } : {}),
      ...(input.title !== undefined ? { title: input.title || null } : {}),
      ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
      ...(input.companyId !== undefined ? { companyId: input.companyId } : {}),
    },
  });
  return toContactDto(row, await singleAttribution(client, ctx.spaceId, row));
}

export async function searchContacts(
  client: BusinessClient,
  spaceId: string,
  input: SearchContactsInput,
): Promise<{ contacts: CrmContact[] }> {
  const q = containsText(input.q);
  const rows = await client.crmContact.findMany({
    where: {
      spaceId,
      ...(input.id ? { id: input.id } : {}),
      ...(input.companyId ? { companyId: input.companyId } : {}),
      ...(input.email ? { email: input.email.toLowerCase() } : {}),
      ...(q
        ? { OR: [{ firstName: q }, { lastName: q }, { email: q }, { company: { name: q } }] }
        : {}),
    },
    include: contactInclude,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
    take: input.limit,
  });
  const attribution = await resolveAttribution(client, spaceId, rows, (row, resolver) =>
    collectActor(resolver, row),
  );
  return { contacts: rows.map((row) => toContactDto(row, attribution)) };
}
