import type {
  CreateCompanyInput,
  CrmCompany,
  SearchCompaniesInput,
  UpdateCompanyInput,
} from "@savingroup/contracts";
import { AttributionResolver, resolveAttribution } from "../attribution.js";
import { emitBusinessEvent } from "../audit.js";
import type { BusinessClient, BusinessContext } from "../context.js";
import { actorColumns } from "../context.js";
import { containsText, requireCompany } from "../lookups.js";
import { collectActor, toCompanyDto } from "./dto.js";

export async function createCompany(
  client: BusinessClient,
  ctx: BusinessContext,
  input: CreateCompanyInput,
): Promise<CrmCompany> {
  const row = await client.crmCompany.create({
    data: {
      spaceId: ctx.spaceId,
      name: input.name,
      domain: input.domain || null,
      phone: input.phone || null,
      notes: input.notes || null,
      ...actorColumns(ctx.actor),
    },
  });
  await emitBusinessEvent(client, ctx, {
    type: "crm.company.created",
    recordType: "company",
    recordId: row.id,
    payload: { name: row.name },
  });
  return toCompanyDto(row, await singleAttribution(client, ctx.spaceId, row));
}

export async function updateCompany(
  client: BusinessClient,
  ctx: BusinessContext,
  input: UpdateCompanyInput,
): Promise<CrmCompany> {
  const current = await requireCompany(client, ctx.spaceId, input.id);
  const row = await client.crmCompany.update({
    where: { id: current.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.domain !== undefined ? { domain: input.domain || null } : {}),
      ...(input.phone !== undefined ? { phone: input.phone || null } : {}),
      ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
    },
  });
  return toCompanyDto(row, await singleAttribution(client, ctx.spaceId, row));
}

export async function searchCompanies(
  client: BusinessClient,
  spaceId: string,
  input: SearchCompaniesInput,
): Promise<{ companies: CrmCompany[] }> {
  const q = containsText(input.q);
  const rows = await client.crmCompany.findMany({
    where: {
      spaceId,
      ...(input.id ? { id: input.id } : {}),
      ...(q ? { OR: [{ name: q }, { domain: q }] } : {}),
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: input.limit,
  });
  const attribution = await resolveAttribution(client, spaceId, rows, (row, resolver) =>
    collectActor(resolver, row),
  );
  return { companies: rows.map((row) => toCompanyDto(row, attribution)) };
}

export async function singleAttribution(
  client: BusinessClient,
  spaceId: string,
  row: { createdByUserId: string | null; createdByBotId: string | null },
): Promise<AttributionResolver> {
  const resolver = new AttributionResolver(client, spaceId);
  collectActor(resolver, row);
  await resolver.load();
  return resolver;
}
