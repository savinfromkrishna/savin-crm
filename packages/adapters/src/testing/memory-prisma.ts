import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@savingroup/db";

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

const COMPOUND_KEYS: Record<string, string[]> = {
  spaceId_userId_connectorId_subject: ["spaceId", "userId", "connectorId", "subject"],
};

function matchesValue(value: unknown, condition: unknown): boolean {
  if (condition instanceof Date)
    return value instanceof Date && value.getTime() === condition.getTime();
  if (condition && typeof condition === "object" && !Array.isArray(condition)) {
    const ops = condition as Record<string, unknown>;
    if ("in" in ops && !(ops.in as unknown[]).includes(value)) return false;
    if ("not" in ops) {
      const not = ops.not;
      if (not && typeof not === "object" && !(not instanceof Date)) {
        if (matchesValue(value, not)) return false;
      } else if (value === not) {
        return false;
      }
    }
    const compare = (bound: unknown, test: (left: number, right: number) => boolean) =>
      value instanceof Date && bound instanceof Date
        ? test(value.getTime(), bound.getTime())
        : false;
    if ("lt" in ops && !compare(ops.lt, (l, r) => l < r)) return false;
    if ("lte" in ops && !compare(ops.lte, (l, r) => l <= r)) return false;
    if ("gt" in ops && !compare(ops.gt, (l, r) => l > r)) return false;
    if ("gte" in ops && !compare(ops.gte, (l, r) => l >= r)) return false;
    if ("equals" in ops && value !== ops.equals) return false;
    return true;
  }
  return value === condition;
}

function matches(row: Row, where: Where | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, condition]) => {
    const compound = COMPOUND_KEYS[key];
    if (compound) {
      return compound.every((field) => row[field] === (condition as Row)[field]);
    }
    return matchesValue(row[key], condition);
  });
}

class MemoryTable {
  readonly rows: Row[] = [];

  constructor(
    private readonly defaults: () => Row = () => ({}),
    private readonly relations: Record<string, (row: Row) => Row | null> = {},
  ) {}

  private project(
    row: Row,
    select?: Record<string, unknown>,
    include?: Record<string, unknown>,
  ): Row {
    const relationOf = (key: string, nested: unknown) => {
      const related = this.relations[key]?.(row) ?? null;
      const spec = nested as { select?: Record<string, unknown> } | true;
      return related && spec !== true && spec.select ? pick(related, spec.select) : related;
    };
    if (select) {
      return Object.fromEntries(
        Object.entries(select)
          .filter(([, value]) => value)
          .map(([key, value]) => [key, key in this.relations ? relationOf(key, value) : row[key]]),
      );
    }
    const copy: Row = { ...row };
    for (const [key, value] of Object.entries(include ?? {})) {
      if (value) copy[key] = relationOf(key, value);
    }
    return copy;
  }

  async findMany(
    args: {
      where?: Where;
      select?: Record<string, unknown>;
      include?: Record<string, unknown>;
      orderBy?: Record<string, "asc" | "desc"> | Array<Record<string, "asc" | "desc">>;
      take?: number;
      distinct?: string[];
    } = {},
  ): Promise<Row[]> {
    let rows = this.rows.filter((row) => matches(row, args.where));
    const order = Array.isArray(args.orderBy) ? args.orderBy : args.orderBy ? [args.orderBy] : [];
    rows = [...rows].sort((left, right) => {
      for (const spec of order) {
        const [key, direction] = Object.entries(spec)[0]!;
        const a = left[key] instanceof Date ? (left[key] as Date).getTime() : (left[key] as number);
        const b =
          right[key] instanceof Date ? (right[key] as Date).getTime() : (right[key] as number);
        if (a !== b) return (a < b ? -1 : 1) * (direction === "desc" ? -1 : 1);
      }
      return 0;
    });
    if (args.distinct) {
      const seen = new Set<string>();
      rows = rows.filter((row) => {
        const key = args.distinct!.map((field) => String(row[field])).join("|");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    if (args.take !== undefined) rows = rows.slice(0, args.take);
    return rows.map((row) => this.project(row, args.select, args.include));
  }

  async findFirst(args: Parameters<MemoryTable["findMany"]>[0] = {}): Promise<Row | null> {
    return (await this.findMany({ ...args, take: 1 }))[0] ?? null;
  }

  async findUnique(args: Parameters<MemoryTable["findMany"]>[0] = {}): Promise<Row | null> {
    return this.findFirst(args);
  }

  async create(args: { data: Row; select?: Record<string, unknown> }): Promise<Row> {
    const now = new Date();
    const row = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      ...this.defaults(),
      ...args.data,
    };
    this.rows.push(row);
    return this.project(row, args.select);
  }

  async update(args: { where: Where; data: Row; select?: Record<string, unknown> }): Promise<Row> {
    const row = this.rows.find((candidate) => matches(candidate, args.where));
    if (!row) throw new Error("Record to update not found");
    Object.assign(row, args.data, { updatedAt: new Date() });
    return this.project(row, args.select);
  }

  async updateMany(args: { where?: Where; data: Row }): Promise<{ count: number }> {
    const rows = this.rows.filter((row) => matches(row, args.where));
    for (const row of rows) Object.assign(row, args.data, { updatedAt: new Date() });
    return { count: rows.length };
  }

  async upsert(args: {
    where: Where;
    create: Row;
    update: Row;
    select?: Record<string, unknown>;
  }): Promise<Row> {
    const row = this.rows.find((candidate) => matches(candidate, args.where));
    if (row) return this.update({ where: { id: row.id }, data: args.update, select: args.select });
    return this.create({ data: args.create, select: args.select });
  }

  async delete(args: { where: Where }): Promise<Row> {
    const index = this.rows.findIndex((row) => matches(row, args.where));
    if (index < 0) throw new Error("Record to delete not found");
    return this.rows.splice(index, 1)[0]!;
  }

  async deleteMany(args: { where?: Where } = {}): Promise<{ count: number }> {
    const keep = this.rows.filter((row) => !matches(row, args.where));
    const count = this.rows.length - keep.length;
    this.rows.splice(0, this.rows.length, ...keep);
    return { count };
  }

  async count(args: { where?: Where } = {}): Promise<number> {
    return this.rows.filter((row) => matches(row, args.where)).length;
  }
}

function pick(row: Row, select: Record<string, unknown>): Row {
  return Object.fromEntries(
    Object.entries(select)
      .filter(([, value]) => value)
      .map(([key]) => [key, row[key]]),
  );
}

/** Just enough of Prisma for connector tests: tables, transactions, and advisory locks as no-ops. */
export function createMemoryPrisma(memberships: Array<{ userId: string; spaceId: string }> = []) {
  const secret = new MemoryTable();
  const tables = {
    secret,
    botSecret: new MemoryTable(),
    integrationProviderConfig: new MemoryTable(),
    connection: new MemoryTable(() => ({ metadata: {}, providerRef: null, secretId: null })),
    connectorAuthorization: new MemoryTable(),
    connectorActivity: new MemoryTable(() => ({
      error: null,
      detail: null,
      runId: null,
      accountId: null,
    })),
    connectorAccount: new MemoryTable(
      () => ({
        name: "",
        scopes: [],
        status: "active",
        lastError: null,
        secretId: null,
        refreshedAt: null,
      }),
      { secret: (row) => secret.rows.find((item) => item.id === row.secretId) ?? null },
    ),
    spaceMember: new MemoryTable(() => ({}), {
      member: (row) => ({ user: { email: `${String(row.userId)}@example.test` } }),
    }),
    deploymentSettings: new MemoryTable(),
  };
  for (const membership of memberships)
    tables.spaceMember.rows.push({ id: randomUUID(), ...membership });
  const client = {
    ...tables,
    async $transaction<T>(work: (tx: unknown) => Promise<T>): Promise<T> {
      return work(client);
    },
    async $executeRaw() {
      return 0;
    },
    async $queryRaw() {
      return [];
    },
  };
  return { prisma: client as unknown as PrismaClient, tables };
}
