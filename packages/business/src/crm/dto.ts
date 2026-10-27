import type {
  CrmActivity,
  CrmCompany,
  CrmContact,
  CrmDeal,
  CrmLead,
  DealStage,
  LeadStatus,
} from "@savingroup/contracts";
import {
  ACTIVITY_KINDS,
  businessRef,
  DEAL_REF_PREFIX,
  DEAL_STAGES,
  LEAD_REF_PREFIX,
  LEAD_STATUSES,
} from "@savingroup/contracts";
import type {
  CrmActivity as CrmActivityRow,
  CrmCompany as CrmCompanyRow,
  CrmContact as CrmContactRow,
  CrmDeal as CrmDealRow,
  CrmLead as CrmLeadRow,
} from "@savingroup/db";
import type { AttributionResolver } from "../attribution.js";
import { decimalToNullableNumber, decimalToNumber } from "../money.js";

type Named = { name: string } | null;
type ContactNamed = { firstName: string; lastName: string } | null;

export function contactDisplayName(row: { firstName: string; lastName: string }): string {
  return [row.firstName, row.lastName].filter(Boolean).join(" ").trim();
}

export function coerceLeadStatus(value: string): LeadStatus {
  return (LEAD_STATUSES as readonly string[]).includes(value) ? (value as LeadStatus) : "new";
}

export function coerceDealStage(value: string): DealStage {
  return (DEAL_STAGES as readonly string[]).includes(value)
    ? (value as DealStage)
    : "qualification";
}

export function toCompanyDto(row: CrmCompanyRow, attribution: AttributionResolver): CrmCompany {
  return {
    id: row.id,
    spaceId: row.spaceId,
    name: row.name,
    domain: row.domain,
    phone: row.phone,
    notes: row.notes,
    createdBy: attribution.actor({ userId: row.createdByUserId, botId: row.createdByBotId }),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const contactInclude = { company: { select: { name: true } } } as const;

export function toContactDto(
  row: CrmContactRow & { company: Named },
  attribution: AttributionResolver,
): CrmContact {
  return {
    id: row.id,
    spaceId: row.spaceId,
    firstName: row.firstName,
    lastName: row.lastName,
    name: contactDisplayName(row),
    email: row.email,
    phone: row.phone,
    title: row.title,
    notes: row.notes,
    companyId: row.companyId,
    companyName: row.company?.name ?? null,
    createdBy: attribution.actor({ userId: row.createdByUserId, botId: row.createdByBotId }),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const leadInclude = { company: { select: { name: true } }, contact: true } as const;

export function toLeadDto(
  row: CrmLeadRow & { company: Named; contact: ContactNamed },
  attribution: AttributionResolver,
): CrmLead {
  return {
    id: row.id,
    spaceId: row.spaceId,
    number: row.number,
    ref: businessRef(LEAD_REF_PREFIX, row.number),
    title: row.title,
    status: coerceLeadStatus(row.status),
    source: row.source,
    notes: row.notes,
    value: decimalToNullableNumber(row.value),
    companyId: row.companyId,
    companyName: row.company?.name ?? null,
    contactId: row.contactId,
    contactName: row.contact ? contactDisplayName(row.contact) : null,
    assignee: attribution.actor({ userId: row.assigneeUserId, botId: row.assigneeBotId }),
    convertedDealId: row.convertedDealId,
    createdBy: attribution.actor({ userId: row.createdByUserId, botId: row.createdByBotId }),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const dealInclude = {
  company: { select: { name: true } },
  contact: true,
  sourceLead: { select: { id: true } },
} as const;

export function toDealDto(
  row: CrmDealRow & { company: Named; contact: ContactNamed; sourceLead: { id: string } | null },
  attribution: AttributionResolver,
): CrmDeal {
  return {
    id: row.id,
    spaceId: row.spaceId,
    number: row.number,
    ref: businessRef(DEAL_REF_PREFIX, row.number),
    title: row.title,
    stage: coerceDealStage(row.stage),
    amount: decimalToNumber(row.amount),
    currency: row.currency,
    expectedCloseAt: row.expectedCloseAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    notes: row.notes,
    companyId: row.companyId,
    companyName: row.company?.name ?? null,
    contactId: row.contactId,
    contactName: row.contact ? contactDisplayName(row.contact) : null,
    sourceLeadId: row.sourceLead?.id ?? null,
    owner: attribution.actor({ userId: row.ownerUserId, botId: row.ownerBotId }),
    createdBy: attribution.actor({ userId: row.createdByUserId, botId: row.createdByBotId }),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toActivityDto(row: CrmActivityRow, attribution: AttributionResolver): CrmActivity {
  return {
    id: row.id,
    spaceId: row.spaceId,
    kind: (ACTIVITY_KINDS as readonly string[]).includes(row.kind)
      ? (row.kind as CrmActivity["kind"])
      : "note",
    subject: row.subject,
    body: row.body,
    dueAt: row.dueAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    companyId: row.companyId,
    contactId: row.contactId,
    leadId: row.leadId,
    dealId: row.dealId,
    assignee: attribution.actor({ userId: row.assigneeUserId, botId: row.assigneeBotId }),
    createdBy: attribution.actor({ userId: row.createdByUserId, botId: row.createdByBotId }),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function collectActor(
  resolver: AttributionResolver,
  row: { createdByUserId: string | null; createdByBotId: string | null },
) {
  resolver.collect({ userId: row.createdByUserId, botId: row.createdByBotId });
}
