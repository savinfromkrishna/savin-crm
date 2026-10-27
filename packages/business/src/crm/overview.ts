import type { CrmOverview } from "@savingroup/contracts";
import type { BusinessClient } from "../context.js";
import { decimalToNumber } from "../money.js";
import { ensureBusinessSettings } from "../settings.js";

export async function crmOverview(client: BusinessClient, spaceId: string): Promise<CrmOverview> {
  const [settings, companies, contacts, openLeads, openDeals, wonDeals, openFollowUps] =
    await Promise.all([
      ensureBusinessSettings(client, spaceId),
      client.crmCompany.count({ where: { spaceId } }),
      client.crmContact.count({ where: { spaceId } }),
      client.crmLead.count({
        where: { spaceId, status: { notIn: ["converted", "unqualified"] } },
      }),
      client.crmDeal.aggregate({
        where: { spaceId, stage: { notIn: ["won", "lost"] } },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      client.crmDeal.aggregate({ where: { spaceId, stage: "won" }, _sum: { amount: true } }),
      client.crmActivity.count({ where: { spaceId, completedAt: null, dueAt: { not: null } } }),
    ]);
  return {
    companies,
    contacts,
    openLeads,
    openDeals: openDeals._count._all,
    openDealAmount: decimalToNumber(openDeals._sum.amount),
    wonDealAmount: decimalToNumber(wonDeals._sum.amount),
    openFollowUps,
    currency: settings.currency,
  };
}
