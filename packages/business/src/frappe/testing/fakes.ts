import type { SecretStore } from "@savingroup/adapter-kit";
import type { BusinessEnvironment as BusinessEnvironmentRow, PrismaClient } from "@savingroup/db";

/**
 * Test doubles for the gateway's Savingroup-side dependencies. The fake Prisma
 * covers exactly what the business executor, the gateway and the migration
 * tool touch; a missing method throws so a new dependency is noticed, not
 * silently ignored.
 */

export type EnvRowInput = Partial<BusinessEnvironmentRow> & {
  id: string;
  organizationId: string;
  siteUrl: string;
};

export function environmentRow(input: EnvRowInput): BusinessEnvironmentRow {
  const now = new Date("2026-10-18T10:00:00Z");
  return {
    provider: "frappe",
    blueprintId: "india-smb",
    blueprintVersion: 1,
    siteName: new URL(input.siteUrl).host,
    companyName: "Savingroup Demo Pvt Ltd",
    companyAbbr: "RD",
    country: "India",
    currency: "INR",
    status: "active",
    installedApps: ["frappe", "erpnext", "crm", "india_compliance", "savingroup_business_bridge"],
    credentialSecretId: null,
    credentialCiphertext: null,
    webhookSecretId: null,
    webhookSecretCiphertext: null,
    lastVerifiedAt: now,
    lastError: null,
    createdByUserId: "owner",
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

/** Reversible "encryption" for tests: the ciphertext is the plaintext, tagged. */
export function fakeSecrets(): Pick<SecretStore, "put" | "load"> & { puts: number } {
  const store = {
    puts: 0,
    async put(plaintext: string, _context: unknown, options?: { recordId?: string }) {
      store.puts += 1;
      const id = options?.recordId ?? `secret-${store.puts}`;
      const ciphertext = `sealed:${Buffer.from(plaintext, "utf8").toString("base64")}`;
      return { id, ref: ciphertext, ciphertext };
    },
    async load(ref: string) {
      if (!ref.startsWith("sealed:")) throw new Error("Encrypted secret is malformed");
      return Buffer.from(ref.slice("sealed:".length), "base64").toString("utf8");
    },
  };
  return store;
}

type Row = Record<string, unknown>;

export interface FakeWorld {
  /** spaceId → organizationId */
  spaces: Record<string, string>;
  /** organizationId → environment row */
  environments: Record<string, BusinessEnvironmentRow>;
  bots: Record<
    string,
    { spaceId: string; disabledBuiltinTools: string[]; archivedAt: Date | null }
  >;
  /** Prototype rows per table, for migration tests. */
  legacy: {
    crmCompany: Row[];
    crmContact: Row[];
    crmLead: Row[];
    crmDeal: Row[];
    erpProduct: Row[];
    erpSalesOrder: Row[];
    erpInvoice: Row[];
  };
  settings: {
    allowNegativeStock: boolean;
    orderApprovalRequired: boolean;
    invoiceApprovalRequired: boolean;
    currency: string;
  };
}

export function fakeWorld(overrides: Partial<FakeWorld> = {}): FakeWorld {
  return {
    spaces: {},
    environments: {},
    bots: {},
    legacy: {
      crmCompany: [],
      crmContact: [],
      crmLead: [],
      crmDeal: [],
      erpProduct: [],
      erpSalesOrder: [],
      erpInvoice: [],
    },
    settings: {
      allowNegativeStock: false,
      orderApprovalRequired: true,
      invoiceApprovalRequired: true,
      currency: "INR",
    },
    ...overrides,
  };
}

export interface FakePrismaHandle {
  prisma: PrismaClient;
  actionLogs: Row[];
  events: Row[];
  deliveries: Set<string>;
  mappings: Row[];
}

function legacyTable(rows: Row[]) {
  const bySpace = (where: { spaceId?: string } | undefined) =>
    rows.filter((row) => !where?.spaceId || row.spaceId === where.spaceId);
  return {
    findMany: async ({ where }: { where?: { spaceId?: string } } = {}) => bySpace(where),
    count: async ({ where }: { where?: { spaceId?: string } } = {}) => bySpace(where).length,
  };
}

export function fakePrisma(world: FakeWorld): FakePrismaHandle {
  const actionLogs: Row[] = [];
  const events: Row[] = [];
  const deliveries = new Set<string>();
  const mappings: Row[] = [];
  const settingsRow = (spaceId: string) => ({
    id: `settings-${spaceId}`,
    spaceId,
    ...world.settings,
    nextLeadNumber: 1,
    nextDealNumber: 1,
    nextOrderNumber: 1,
    nextInvoiceNumber: 1,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });
  const envByOrg = (organizationId: string) => world.environments[organizationId] ?? null;
  const envById = (id: string) =>
    Object.values(world.environments).find((row) => row.id === id) ?? null;

  const client = {
    space: {
      findUnique: async ({
        where,
        select,
      }: {
        where: { id: string };
        select: Record<string, unknown>;
      }) => {
        const organizationId = world.spaces[where.id];
        if (!organizationId) return null;
        if (select.organizationId) return { organizationId };
        return { organization: { businessEnvironment: envByOrg(organizationId) } };
      },
      findMany: async ({ where }: { where: { organizationId: string } }) =>
        Object.entries(world.spaces)
          .filter(([, org]) => org === where.organizationId)
          .map(([id]) => ({ id })),
    },
    businessEnvironment: {
      findUnique: async ({ where }: { where: { organizationId?: string; id?: string } }) =>
        where.organizationId ? envByOrg(where.organizationId) : envById(where.id!),
      create: async ({ data }: { data: Row }) => {
        const row = environmentRow({
          ...(data as EnvRowInput),
          id: (data as { id?: string }).id ?? `env-${Object.keys(world.environments).length + 1}`,
        });
        world.environments[row.organizationId] = row;
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        const row = envById(where.id);
        if (!row) throw new Error("env not found");
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
    },
    bot: {
      findFirst: async ({ where }: { where: { id: string; spaceId: string } }) => {
        const bot = world.bots[where.id];
        return bot && bot.spaceId === where.spaceId
          ? { disabledBuiltinTools: bot.disabledBuiltinTools, archivedAt: bot.archivedAt }
          : null;
      },
      findMany: async () => [],
    },
    user: { findMany: async () => [] },
    // Prototype tables (empty unless a test seeds world.legacy).
    crmCompany: legacyTable(world.legacy.crmCompany),
    crmContact: legacyTable(world.legacy.crmContact),
    crmLead: legacyTable(world.legacy.crmLead),
    crmDeal: legacyTable(world.legacy.crmDeal),
    erpProduct: legacyTable(world.legacy.erpProduct),
    erpSalesOrder: legacyTable(world.legacy.erpSalesOrder),
    erpInvoice: legacyTable(world.legacy.erpInvoice),
    businessRecordMapping: {
      findMany: async ({ where }: { where: { environmentId: string } }) =>
        mappings.filter((row) => row.environmentId === where.environmentId),
      upsert: async ({
        where,
        create,
      }: {
        where: {
          environmentId_recordType_legacyId: {
            environmentId: string;
            recordType: string;
            legacyId: string;
          };
        };
        create: Row;
        update: Row;
      }) => {
        const key = where.environmentId_recordType_legacyId;
        const existing = mappings.find(
          (row) =>
            row.environmentId === key.environmentId &&
            row.recordType === key.recordType &&
            row.legacyId === key.legacyId,
        );
        if (existing) {
          Object.assign(existing, create);
          return existing;
        }
        const row = { id: `map-${mappings.length + 1}`, ...create };
        mappings.push(row);
        return row;
      },
    },
    businessSettings: {
      findUnique: async ({ where }: { where: { spaceId: string } }) => settingsRow(where.spaceId),
      createMany: async () => ({ count: 0 }),
      findUniqueOrThrow: async ({ where }: { where: { spaceId: string } }) =>
        settingsRow(where.spaceId),
    },
    businessActionLog: {
      findUnique: async ({
        where,
      }: {
        where: { spaceId_idempotencyKey: { spaceId: string; idempotencyKey: string } };
      }) =>
        actionLogs.find(
          (log) =>
            log.spaceId === where.spaceId_idempotencyKey.spaceId &&
            log.idempotencyKey === where.spaceId_idempotencyKey.idempotencyKey,
        ) ?? null,
      create: async ({ data }: { data: Row }) => {
        const duplicate = actionLogs.find(
          (log) =>
            data.idempotencyKey &&
            log.spaceId === data.spaceId &&
            log.idempotencyKey === data.idempotencyKey,
        );
        if (duplicate) throw Object.assign(new Error("unique"), { code: "P2002" });
        const row = { id: `log-${actionLogs.length + 1}`, createdAt: new Date(), ...data };
        actionLogs.push(row);
        return row;
      },
    },
    businessEvent: {
      create: async ({ data }: { data: Row }) => {
        const row = {
          id: `event-${events.length + 1}`,
          createdAt: new Date(),
          publishedAt: null,
          ...data,
        };
        events.push(row);
        return row;
      },
      findMany: async ({ where }: { where: { spaceId: string } }) =>
        events.filter((event) => event.spaceId === where.spaceId && !event.publishedAt),
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        const event = events.find((row) => row.id === where.id);
        if (event) Object.assign(event, data);
        return event;
      },
    },
    businessWebhookDelivery: {
      create: async ({ data }: { data: { environmentId: string; deliveryId: string } }) => {
        const key = `${data.environmentId}:${data.deliveryId}`;
        if (deliveries.has(key)) throw Object.assign(new Error("unique"), { code: "P2002" });
        deliveries.add(key);
        return { id: key, ...data };
      },
    },
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => run(client),
  };
  return { prisma: client as unknown as PrismaClient, actionLogs, events, deliveries, mappings };
}
