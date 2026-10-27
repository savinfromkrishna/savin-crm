import type { BusinessActionId, BusinessRecordType } from "@savingroup/contracts";
import type { PrismaClient } from "@savingroup/db";
import type { BusinessContext } from "../context.js";
import { isBusinessActionError } from "../errors.js";
import type { FrappeGateway } from "../frappe/gateway.js";
import { runFrappeWrite } from "../frappe/run.js";
import { decimalToNumber } from "../money.js";

/**
 * Moves an organization's prototype CRM/ERP records to its Frappe site.
 *
 * Dry run by default: inventory, collisions and totals, nothing written. With
 * `apply`, masters and CRM records are created through the gateway's idempotent
 * writes (operation key `migrate:<env>:<type>:<legacy id>`), stamped with the
 * legacy id on the site, and recorded in `BusinessRecordMapping`. Orders and
 * invoices are inventoried and reported for a person to decide per document;
 * see ADR 0004 for why they are not recreated automatically.
 */

export type MigratableType = "company" | "contact" | "lead" | "deal" | "product";
const MIGRATABLE: readonly MigratableType[] = ["company", "contact", "lead", "deal", "product"];

export interface MigrationCounts {
  total: number;
  mapped: number;
  created: number;
  linked: number;
  failed: number;
}

export interface MigrationReport {
  environmentId: string;
  organizationId: string;
  spaces: string[];
  dryRun: boolean;
  counts: Record<MigratableType, MigrationCounts>;
  manual: { orders: number; invoices: number; invoiceTotal: number; invoiceOutstanding: number };
  collisions: Array<{ type: MigratableType; legacyId: string; name: string }>;
  failures: Array<{ type: MigratableType; legacyId: string; error: string }>;
}

export interface MigrationDeps {
  prisma: PrismaClient;
  gateway: FrappeGateway;
}

/**
 * A rejected migration write stays rejected under its key (that is what the
 * ledger promises), so a rerun after fixing the cause uses the next free key.
 * Succeeded and in-flight keys are returned as they are and replay normally.
 */
async function retryableKey(deps: MigrationDeps, environmentId: string, base: string) {
  let key = base;
  for (let attempt = 1; attempt < 50; attempt += 1) {
    const existing = await deps.gateway.ledger.find(environmentId, key);
    if (existing?.status !== "failed") return key;
    key = `${base}:retry-${attempt}`;
  }
  return key;
}

function emptyCounts(): MigrationCounts {
  return { total: 0, mapped: 0, created: 0, linked: 0, failed: 0 };
}

export async function migrateLegacyBusinessData(
  deps: MigrationDeps,
  options: {
    organizationId: string;
    actorUserId: string;
    apply: boolean;
    /** Stamped on every migrated product when the site requires an HSN/SAC code (GST). */
    defaultHsnCode?: string;
  },
): Promise<MigrationReport> {
  const row = await deps.gateway.environments.getForOrganization(options.organizationId);
  if (row?.status !== "active") {
    throw new Error("The organization has no active business environment to migrate into.");
  }
  const env = await deps.gateway.environments.resolveRow(row);
  const spaces = await deps.prisma.space.findMany({
    where: { organizationId: options.organizationId, deletingAt: null },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  const report: MigrationReport = {
    environmentId: env.id,
    organizationId: options.organizationId,
    spaces: spaces.map((space) => space.id),
    dryRun: !options.apply,
    counts: {
      company: emptyCounts(),
      contact: emptyCounts(),
      lead: emptyCounts(),
      deal: emptyCounts(),
      product: emptyCounts(),
    },
    manual: { orders: 0, invoices: 0, invoiceTotal: 0, invoiceOutstanding: 0 },
    collisions: [],
    failures: [],
  };
  const mappings = new Map<string, string>();
  for (const mapping of await deps.prisma.businessRecordMapping.findMany({
    where: { environmentId: env.id },
  })) {
    mappings.set(`${mapping.recordType}:${mapping.legacyId}`, mapping.externalName);
  }
  const mapped = (type: MigratableType, legacyId: string | null | undefined) =>
    legacyId ? (mappings.get(`${type}:${legacyId}`) ?? null) : null;

  const client = deps.gateway.clientForEnvironment(env);
  const existingByName = async (doctype: string, name: string) => {
    try {
      await client.getDoc(doctype, name);
      return true;
    } catch {
      return false;
    }
  };

  const migrate = async (
    type: MigratableType,
    spaceId: string,
    legacyId: string,
    actionId: BusinessActionId,
    input: Record<string, unknown>,
    doctype: string,
    externalName: (output: Record<string, unknown>) => string,
    collisionName?: string,
  ) => {
    const counts = report.counts[type];
    counts.total += 1;
    if (mapped(type, legacyId)) {
      counts.mapped += 1;
      return mapped(type, legacyId);
    }
    if (collisionName && (await existingByName(doctype, collisionName))) {
      report.collisions.push({ type, legacyId, name: collisionName });
      if (!options.apply) return collisionName;
      await deps.prisma.businessRecordMapping.upsert({
        where: {
          environmentId_recordType_legacyId: { environmentId: env.id, recordType: type, legacyId },
        },
        create: {
          environmentId: env.id,
          recordType: type,
          legacyId,
          externalDoctype: doctype,
          externalName: collisionName,
        },
        update: { externalDoctype: doctype, externalName: collisionName },
      });
      mappings.set(`${type}:${legacyId}`, collisionName);
      counts.linked += 1;
      return collisionName;
    }
    if (!options.apply) return null;
    const ctx: BusinessContext = {
      spaceId,
      actor: { userId: options.actorUserId },
      now: new Date(),
    };
    try {
      const outcome = await runFrappeWrite(
        { gateway: deps.gateway, prisma: deps.prisma },
        env,
        { id: actionId, version: 1 },
        ctx,
        input,
        await retryableKey(deps, env.id, `migrate:${env.id}:${type}:${legacyId}`),
      );
      const name = externalName(outcome.data as Record<string, unknown>);
      await client
        .updateDoc(doctype, name, { savingroup_legacy_id: legacyId })
        .catch(() => undefined);
      await deps.prisma.businessRecordMapping.upsert({
        where: {
          environmentId_recordType_legacyId: { environmentId: env.id, recordType: type, legacyId },
        },
        create: {
          environmentId: env.id,
          recordType: type,
          legacyId,
          externalDoctype: doctype,
          externalName: name,
        },
        update: { externalDoctype: doctype, externalName: name },
      });
      mappings.set(`${type}:${legacyId}`, name);
      counts.created += 1;
      return name;
    } catch (error) {
      counts.failed += 1;
      report.failures.push({
        type,
        legacyId,
        error: isBusinessActionError(error) ? `${error.code}: ${error.message}` : String(error),
      });
      return null;
    }
  };

  for (const space of spaces) {
    const spaceId = space.id;
    const companies = await deps.prisma.crmCompany.findMany({
      where: { spaceId },
      orderBy: { createdAt: "asc" },
    });
    for (const company of companies) {
      await migrate(
        "company",
        spaceId,
        company.id,
        "crm.company.create",
        {
          name: company.name,
          ...(company.domain ? { domain: company.domain } : {}),
          ...(company.phone ? { phone: company.phone } : {}),
          ...(company.notes ? { notes: company.notes } : {}),
        },
        "CRM Organization",
        (output) => String(output.id),
        company.name,
      );
    }
    const contacts = await deps.prisma.crmContact.findMany({
      where: { spaceId },
      orderBy: { createdAt: "asc" },
    });
    for (const contact of contacts) {
      await migrate(
        "contact",
        spaceId,
        contact.id,
        "crm.contact.create",
        {
          firstName: contact.firstName,
          lastName: contact.lastName,
          ...(contact.email ? { email: contact.email } : {}),
          ...(contact.phone ? { phone: contact.phone } : {}),
          ...(contact.title ? { title: contact.title } : {}),
          ...(contact.notes ? { notes: contact.notes } : {}),
          ...(mapped("company", contact.companyId)
            ? { companyId: mapped("company", contact.companyId) }
            : {}),
        },
        "Contact",
        (output) => String(output.id),
      );
    }
    const leads = await deps.prisma.crmLead.findMany({
      where: { spaceId },
      orderBy: { number: "asc" },
    });
    for (const lead of leads) {
      const name = await migrate(
        "lead",
        spaceId,
        lead.id,
        "crm.lead.create",
        {
          title: lead.title,
          ...(lead.source ? { source: lead.source } : {}),
          ...(lead.notes ? { notes: lead.notes } : {}),
          ...(lead.value !== null ? { value: decimalToNumber(lead.value) } : {}),
          ...(mapped("company", lead.companyId)
            ? { companyId: mapped("company", lead.companyId) }
            : {}),
          ...(mapped("contact", lead.contactId)
            ? { contactId: mapped("contact", lead.contactId) }
            : {}),
          ...(lead.assigneeUserId ? { assigneeUserId: lead.assigneeUserId } : {}),
          ...(lead.assigneeBotId ? { assigneeBotId: lead.assigneeBotId } : {}),
        },
        "CRM Lead",
        (output) => String(output.id),
      );
      if (name && options.apply && lead.status !== "new" && lead.status !== "converted") {
        const ctx: BusinessContext = {
          spaceId,
          actor: { userId: options.actorUserId },
          now: new Date(),
        };
        await runFrappeWrite(
          { gateway: deps.gateway, prisma: deps.prisma },
          env,
          { id: "crm.lead.qualify", version: 1 },
          ctx,
          { id: name, status: lead.status },
          `migrate:${env.id}:lead-status:${lead.id}`,
        ).catch((error) => {
          report.failures.push({
            type: "lead",
            legacyId: lead.id,
            error: `status: ${String(error)}`,
          });
        });
      }
    }
    const deals = await deps.prisma.crmDeal.findMany({
      where: { spaceId },
      orderBy: { number: "asc" },
    });
    for (const deal of deals) {
      await migrate(
        "deal",
        spaceId,
        deal.id,
        "crm.deal.create",
        {
          title: deal.title,
          amount: decimalToNumber(deal.amount),
          stage: deal.stage,
          ...(deal.expectedCloseAt ? { expectedCloseAt: deal.expectedCloseAt.toISOString() } : {}),
          ...(deal.notes ? { notes: deal.notes } : {}),
          ...(mapped("company", deal.companyId)
            ? { companyId: mapped("company", deal.companyId) }
            : {}),
          ...(mapped("contact", deal.contactId)
            ? { contactId: mapped("contact", deal.contactId) }
            : {}),
          ...(deal.ownerUserId ? { ownerUserId: deal.ownerUserId } : {}),
          ...(deal.ownerBotId ? { ownerBotId: deal.ownerBotId } : {}),
        },
        "CRM Deal",
        (output) => String(output.id),
      );
    }
    const products = await deps.prisma.erpProduct.findMany({
      where: { spaceId },
      orderBy: { createdAt: "asc" },
    });
    for (const product of products) {
      await migrate(
        "product",
        spaceId,
        product.id,
        "erp.product.create",
        {
          sku: product.sku,
          name: product.name,
          ...(product.description ? { description: product.description } : {}),
          unitPrice: decimalToNumber(product.unitPrice),
          initialStock: Math.max(0, product.stockOnHand),
          ...(options.defaultHsnCode ? { hsnCode: options.defaultHsnCode } : {}),
        },
        "Item",
        (output) => String(output.id),
        product.sku.toUpperCase(),
      );
    }
    report.manual.orders += await deps.prisma.erpSalesOrder.count({ where: { spaceId } });
    const invoices = await deps.prisma.erpInvoice.findMany({
      where: { spaceId },
      select: { total: true, amountPaid: true },
    });
    report.manual.invoices += invoices.length;
    for (const invoice of invoices) {
      report.manual.invoiceTotal += decimalToNumber(invoice.total);
      report.manual.invoiceOutstanding +=
        decimalToNumber(invoice.total) - decimalToNumber(invoice.amountPaid);
    }
  }
  return report;
}

export function formatMigrationReport(report: MigrationReport): string {
  const lines = [
    `${report.dryRun ? "Dry run" : "Applied"} for organization ${report.organizationId} → environment ${report.environmentId}`,
    `Spaces: ${report.spaces.length}`,
    "",
    "type       total  mapped  created  linked  failed",
  ];
  for (const type of MIGRATABLE) {
    const c = report.counts[type];
    lines.push(
      `${type.padEnd(10)} ${String(c.total).padStart(5)}  ${String(c.mapped).padStart(6)}  ${String(c.created).padStart(7)}  ${String(c.linked).padStart(6)}  ${String(c.failed).padStart(6)}`,
    );
  }
  lines.push(
    "",
    `Orders left for manual review: ${report.manual.orders}`,
    `Invoices left for manual review: ${report.manual.invoices} (total ${report.manual.invoiceTotal.toFixed(2)}, outstanding ${report.manual.invoiceOutstanding.toFixed(2)})`,
  );
  if (report.collisions.length) {
    lines.push("", "Existing site records linked instead of created:");
    for (const entry of report.collisions)
      lines.push(`  ${entry.type} ${entry.legacyId} → ${entry.name}`);
  }
  if (report.failures.length) {
    lines.push("", "Failures:");
    for (const entry of report.failures)
      lines.push(`  ${entry.type} ${entry.legacyId}: ${entry.error}`);
  }
  return lines.join("\n");
}

export const MIGRATABLE_RECORD_TYPES: readonly BusinessRecordType[] = MIGRATABLE;
