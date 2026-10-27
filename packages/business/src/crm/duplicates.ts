import type {
  CompanyDuplicateGroup,
  ContactDuplicateGroup,
  FindCompanyDuplicatesOutput,
  FindContactDuplicatesOutput,
  FindDuplicatesInput,
} from "@savingroup/contracts";
import { resolveAttribution } from "../attribution.js";
import type { BusinessClient } from "../context.js";
import { collectActor, contactInclude, toCompanyDto, toContactDto } from "./dto.js";

function normalizeText(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

function normalizeDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

function normalizePhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D+/g, "");
  return digits.length >= 7 ? digits : null;
}

export async function findDuplicateCompanies(
  client: BusinessClient,
  spaceId: string,
  input: FindDuplicatesInput,
): Promise<FindCompanyDuplicatesOutput> {
  const rows = await client.crmCompany.findMany({
    where: { spaceId },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: 500,
  });
  const attribution = await resolveAttribution(client, spaceId, rows, (row, resolver) =>
    collectActor(resolver, row),
  );
  const dtos = rows.map((row) => toCompanyDto(row, attribution));

  const byDomain = new Map<string, typeof dtos>();
  const byName = new Map<string, typeof dtos>();
  const byPhone = new Map<string, typeof dtos>();

  for (const company of dtos) {
    const domain = normalizeDomain(company.domain);
    if (domain) {
      const list = byDomain.get(domain) ?? [];
      list.push(company);
      byDomain.set(domain, list);
    }
    const name = normalizeText(company.name);
    if (name) {
      const list = byName.get(name) ?? [];
      list.push(company);
      byName.set(name, list);
    }
    const phone = normalizePhone(company.phone);
    if (phone) {
      const list = byPhone.get(phone) ?? [];
      list.push(company);
      byPhone.set(phone, list);
    }
  }

  const groups: CompanyDuplicateGroup[] = [];
  const seenPairs = new Set<string>();

  const addGroups = (bucket: Map<string, typeof dtos>, reasonPrefix: string) => {
    for (const [key, members] of bucket) {
      if (members.length < 2) continue;
      const signature = members
        .map((m) => m.id)
        .sort()
        .join(",");
      if (seenPairs.has(signature)) continue;
      seenPairs.add(signature);
      groups.push({
        reason: `${reasonPrefix}: ${key}`,
        matchKey: key,
        companies: members,
      });
      if (groups.length >= input.limit) return;
    }
  };

  addGroups(byDomain, "Matching domain");
  if (groups.length < input.limit) addGroups(byName, "Matching normalized company name");
  if (groups.length < input.limit) addGroups(byPhone, "Matching phone number");

  return { groups: groups.slice(0, input.limit) };
}

export async function findDuplicateContacts(
  client: BusinessClient,
  spaceId: string,
  input: FindDuplicatesInput,
): Promise<FindContactDuplicatesOutput> {
  const rows = await client.crmContact.findMany({
    where: { spaceId },
    include: contactInclude,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: 500,
  });
  const attribution = await resolveAttribution(client, spaceId, rows, (row, resolver) =>
    collectActor(resolver, row),
  );
  const dtos = rows.map((row) => toContactDto(row, attribution));

  const byEmail = new Map<string, typeof dtos>();
  const byNameAndCompany = new Map<string, typeof dtos>();
  const byPhone = new Map<string, typeof dtos>();

  for (const contact of dtos) {
    const email = contact.email?.trim().toLowerCase() || null;
    if (email) {
      const list = byEmail.get(email) ?? [];
      list.push(contact);
      byEmail.set(email, list);
    }
    const fullName = normalizeText(contact.name);
    if (fullName) {
      const key = contact.companyId
        ? `${fullName} @ ${contact.companyName ?? contact.companyId}`
        : fullName;
      const list = byNameAndCompany.get(key) ?? [];
      list.push(contact);
      byNameAndCompany.set(key, list);
    }
    const phone = normalizePhone(contact.phone);
    if (phone) {
      const list = byPhone.get(phone) ?? [];
      list.push(contact);
      byPhone.set(phone, list);
    }
  }

  const groups: ContactDuplicateGroup[] = [];
  const seenPairs = new Set<string>();

  const addGroups = (bucket: Map<string, typeof dtos>, reasonPrefix: string) => {
    for (const [key, members] of bucket) {
      if (members.length < 2) continue;
      const signature = members
        .map((m) => m.id)
        .sort()
        .join(",");
      if (seenPairs.has(signature)) continue;
      seenPairs.add(signature);
      groups.push({
        reason: `${reasonPrefix}: ${key}`,
        matchKey: key,
        contacts: members,
      });
      if (groups.length >= input.limit) return;
    }
  };

  addGroups(byEmail, "Matching email address");
  if (groups.length < input.limit) addGroups(byNameAndCompany, "Matching full name");
  if (groups.length < input.limit) addGroups(byPhone, "Matching phone number");

  return { groups: groups.slice(0, input.limit) };
}
