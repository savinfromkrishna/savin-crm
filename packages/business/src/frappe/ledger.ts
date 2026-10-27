import { randomUUID } from "node:crypto";
import type { BusinessOperationStatus } from "@savingroup/contracts";
import type {
  BusinessOperation as BusinessOperationRow,
  Prisma,
  PrismaClient,
} from "@savingroup/db";

/**
 * The operation ledger: one row per write the gateway sends to a business
 * environment, keyed by the idempotency key. It is what makes "did that
 * commit?" answerable after a lost response, and what a retry consults first.
 */

export interface OperationRecord {
  id: string;
  environmentId: string;
  spaceId: string;
  actionId: string;
  actionVersion: number;
  idempotencyKey: string;
  status: BusinessOperationStatus;
  attempts: number;
  actorUserId: string | null;
  actorBotId: string | null;
  runId: string | null;
  request: Record<string, unknown>;
  result: unknown;
  errorCode: string | null;
  errorMessage: string | null;
  externalDoctype: string | null;
  externalName: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface CreateOperationInput {
  environmentId: string;
  spaceId: string;
  actionId: string;
  actionVersion: number;
  idempotencyKey: string;
  actorUserId: string | null;
  actorBotId: string | null;
  runId: string | null;
  request: Record<string, unknown>;
}

export interface UpdateOperationInput {
  status?: BusinessOperationStatus;
  incrementAttempts?: boolean;
  result?: unknown;
  errorCode?: string | null;
  errorMessage?: string | null;
  externalDoctype?: string | null;
  externalName?: string | null;
  completedAt?: Date | null;
}

export interface OperationLedger {
  find(environmentId: string, idempotencyKey: string): Promise<OperationRecord | null>;
  get(id: string): Promise<OperationRecord | null>;
  /** Inserts the row; a concurrent insert with the same key returns the existing row. */
  create(input: CreateOperationInput): Promise<OperationRecord>;
  update(id: string, input: UpdateOperationInput): Promise<OperationRecord>;
  list(filter: {
    spaceId?: string;
    environmentId?: string;
    status?: BusinessOperationStatus;
    limit: number;
  }): Promise<OperationRecord[]>;
  /** Operations whose outcome is still unknown, oldest first, for the reconciler. */
  unsettled(environmentId: string, limit: number): Promise<OperationRecord[]>;
}

const UNIQUE_VIOLATION = "P2002";

function fromRow(row: BusinessOperationRow): OperationRecord {
  return {
    ...row,
    status: row.status as BusinessOperationStatus,
    request: (row.request ?? {}) as Record<string, unknown>,
    result: row.result ?? null,
  };
}

export class PrismaOperationLedger implements OperationLedger {
  constructor(private readonly prisma: PrismaClient) {}

  async find(environmentId: string, idempotencyKey: string): Promise<OperationRecord | null> {
    const row = await this.prisma.businessOperation.findUnique({
      where: { environmentId_idempotencyKey: { environmentId, idempotencyKey } },
    });
    return row ? fromRow(row) : null;
  }

  async get(id: string): Promise<OperationRecord | null> {
    const row = await this.prisma.businessOperation.findUnique({ where: { id } });
    return row ? fromRow(row) : null;
  }

  async create(input: CreateOperationInput): Promise<OperationRecord> {
    try {
      const row = await this.prisma.businessOperation.create({
        data: {
          ...input,
          request: input.request as Prisma.InputJsonValue,
          status: "requested",
        },
      });
      return fromRow(row);
    } catch (error) {
      if ((error as { code?: unknown }).code === UNIQUE_VIOLATION) {
        const existing = await this.find(input.environmentId, input.idempotencyKey);
        if (existing) return existing;
      }
      throw error;
    }
  }

  async update(id: string, input: UpdateOperationInput): Promise<OperationRecord> {
    const row = await this.prisma.businessOperation.update({
      where: { id },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.incrementAttempts ? { attempts: { increment: 1 } } : {}),
        ...(input.result !== undefined && input.result !== null
          ? { result: input.result as Prisma.InputJsonValue }
          : {}),
        ...(input.errorCode !== undefined ? { errorCode: input.errorCode } : {}),
        ...(input.errorMessage !== undefined ? { errorMessage: input.errorMessage } : {}),
        ...(input.externalDoctype !== undefined ? { externalDoctype: input.externalDoctype } : {}),
        ...(input.externalName !== undefined ? { externalName: input.externalName } : {}),
        ...(input.completedAt !== undefined ? { completedAt: input.completedAt } : {}),
      },
    });
    return fromRow(row);
  }

  async list(filter: {
    spaceId?: string;
    environmentId?: string;
    status?: BusinessOperationStatus;
    limit: number;
  }): Promise<OperationRecord[]> {
    const rows = await this.prisma.businessOperation.findMany({
      where: {
        ...(filter.spaceId ? { spaceId: filter.spaceId } : {}),
        ...(filter.environmentId ? { environmentId: filter.environmentId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: filter.limit,
    });
    return rows.map(fromRow);
  }

  async unsettled(environmentId: string, limit: number): Promise<OperationRecord[]> {
    const rows = await this.prisma.businessOperation.findMany({
      where: { environmentId, status: { in: ["outcome_unknown", "executing"] } },
      orderBy: [{ updatedAt: "asc" }],
      take: limit,
    });
    return rows.map(fromRow);
  }
}

/** Deterministic in-memory ledger for unit tests. */
export class MemoryOperationLedger implements OperationLedger {
  readonly rows = new Map<string, OperationRecord>();
  private sequence = 0;

  async find(environmentId: string, idempotencyKey: string): Promise<OperationRecord | null> {
    for (const row of this.rows.values()) {
      if (row.environmentId === environmentId && row.idempotencyKey === idempotencyKey) return row;
    }
    return null;
  }

  async get(id: string): Promise<OperationRecord | null> {
    return this.rows.get(id) ?? null;
  }

  async create(input: CreateOperationInput): Promise<OperationRecord> {
    const existing = await this.find(input.environmentId, input.idempotencyKey);
    if (existing) return existing;
    this.sequence += 1;
    const now = new Date();
    const row: OperationRecord = {
      // Unique across processes: the id becomes the bridge-side operation id on a real site.
      id: `op-${this.sequence}-${randomUUID()}`,
      ...input,
      status: "requested",
      attempts: 0,
      result: null,
      errorCode: null,
      errorMessage: null,
      externalDoctype: null,
      externalName: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    this.rows.set(row.id, row);
    return row;
  }

  async update(id: string, input: UpdateOperationInput): Promise<OperationRecord> {
    const row = this.rows.get(id);
    if (!row) throw new Error(`Unknown operation ${id}`);
    const next: OperationRecord = {
      ...row,
      status: input.status ?? row.status,
      attempts: row.attempts + (input.incrementAttempts ? 1 : 0),
      result: input.result !== undefined ? input.result : row.result,
      errorCode: input.errorCode !== undefined ? input.errorCode : row.errorCode,
      errorMessage: input.errorMessage !== undefined ? input.errorMessage : row.errorMessage,
      externalDoctype:
        input.externalDoctype !== undefined ? input.externalDoctype : row.externalDoctype,
      externalName: input.externalName !== undefined ? input.externalName : row.externalName,
      completedAt: input.completedAt !== undefined ? input.completedAt : row.completedAt,
      updatedAt: new Date(),
    };
    this.rows.set(id, next);
    return next;
  }

  async list(filter: {
    spaceId?: string;
    environmentId?: string;
    status?: BusinessOperationStatus;
    limit: number;
  }): Promise<OperationRecord[]> {
    return [...this.rows.values()]
      .filter(
        (row) =>
          (!filter.spaceId || row.spaceId === filter.spaceId) &&
          (!filter.environmentId || row.environmentId === filter.environmentId) &&
          (!filter.status || row.status === filter.status),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, filter.limit);
  }

  async unsettled(environmentId: string, limit: number): Promise<OperationRecord[]> {
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.environmentId === environmentId &&
          (row.status === "outcome_unknown" || row.status === "executing"),
      )
      .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
      .slice(0, limit);
  }
}
