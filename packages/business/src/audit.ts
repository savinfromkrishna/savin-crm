import type {
  BusinessActionId,
  BusinessErrorCode,
  BusinessEvent as BusinessEventDto,
  BusinessEventType,
  BusinessHistoryEntry,
  BusinessRecordType,
} from "@savingroup/contracts";
import type {
  BusinessActionLog as BusinessActionLogRow,
  Prisma,
  PrismaClient,
} from "@savingroup/db";
import { resolveAttribution } from "./attribution.js";
import type { BusinessClient, BusinessContext } from "./context.js";
import { actorIds } from "./context.js";

export interface EmitEventInput {
  type: BusinessEventType;
  recordType: BusinessRecordType;
  recordId: string;
  payload?: Record<string, unknown>;
}

/** Written inside the state-changing transaction so it never describes a rollback. */
export async function emitBusinessEvent(
  client: BusinessClient,
  ctx: BusinessContext,
  input: EmitEventInput,
): Promise<void> {
  const actor = actorIds(ctx.actor);
  await client.businessEvent.create({
    data: {
      spaceId: ctx.spaceId,
      type: input.type,
      recordType: input.recordType,
      recordId: input.recordId,
      payload: (input.payload ?? {}) as Prisma.InputJsonValue,
      actorUserId: actor.userId,
      actorBotId: actor.botId,
      runId: ctx.runId ?? null,
    },
  });
}

export interface RecordActionInput {
  actionId: BusinessActionId;
  actionVersion: number;
  idempotencyKey?: string;
  recordType?: BusinessRecordType;
  recordId?: string;
  input: Record<string, unknown>;
  outcome: "succeeded" | "failed";
  errorCode?: BusinessErrorCode;
  result?: unknown;
}

export async function recordBusinessAction(
  client: BusinessClient,
  ctx: BusinessContext,
  input: RecordActionInput,
): Promise<BusinessActionLogRow> {
  const actor = actorIds(ctx.actor);
  return client.businessActionLog.create({
    data: {
      spaceId: ctx.spaceId,
      actionId: input.actionId,
      actionVersion: input.actionVersion,
      idempotencyKey: input.idempotencyKey ?? null,
      recordType: input.recordType ?? null,
      recordId: input.recordId ?? null,
      actorUserId: actor.userId,
      actorBotId: actor.botId,
      runId: ctx.runId ?? null,
      outcome: input.outcome,
      errorCode: input.errorCode ?? null,
      input: input.input as Prisma.InputJsonValue,
      result: input.result === undefined ? undefined : (input.result as Prisma.InputJsonValue),
    },
  });
}

const UNIQUE_VIOLATION = "P2002";

export function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" && (error as { code?: unknown }).code === UNIQUE_VIOLATION,
  );
}

export interface RecordSucceededWriteInput {
  actionId: BusinessActionId;
  actionVersion: number;
  idempotencyKey?: string;
  recordType: BusinessRecordType;
  recordId: string;
  input: Record<string, unknown>;
  result: unknown;
  event: BusinessEventType;
  payload?: Record<string, unknown>;
}

/**
 * The audit row and the domain event of a committed write, in one transaction.
 * A duplicate key means another request already recorded this write; that is
 * not an error, the write happened once.
 */
export async function recordSucceededWrite(
  prisma: PrismaClient,
  ctx: BusinessContext,
  input: RecordSucceededWriteInput,
): Promise<void> {
  await prisma
    .$transaction(async (tx) => {
      await recordBusinessAction(tx, ctx, {
        actionId: input.actionId,
        actionVersion: input.actionVersion,
        idempotencyKey: input.idempotencyKey,
        recordType: input.recordType,
        recordId: input.recordId,
        input: input.input,
        outcome: "succeeded",
        result: input.result,
      });
      await emitBusinessEvent(tx, ctx, {
        type: input.event,
        recordType: input.recordType,
        recordId: input.recordId,
        payload: input.payload,
      });
    })
    .catch((error) => {
      if (!isUniqueViolation(error)) throw error;
    });
}

export async function findIdempotentAction(
  client: BusinessClient,
  spaceId: string,
  idempotencyKey: string,
): Promise<BusinessActionLogRow | null> {
  return client.businessActionLog.findUnique({
    where: { spaceId_idempotencyKey: { spaceId, idempotencyKey } },
  });
}

export async function listBusinessHistory(
  client: BusinessClient,
  spaceId: string,
  input: { recordType: BusinessRecordType; recordId: string; limit: number },
): Promise<BusinessHistoryEntry[]> {
  const rows = await client.businessActionLog.findMany({
    where: { spaceId, recordType: input.recordType, recordId: input.recordId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit,
  });
  const attribution = await resolveAttribution(client, spaceId, rows, (row, resolver) =>
    resolver.collect({ userId: row.actorUserId, botId: row.actorBotId }),
  );
  return rows.map((row) => ({
    id: row.id,
    actionId: row.actionId,
    outcome: row.outcome === "failed" ? "failed" : "succeeded",
    errorCode: (row.errorCode as BusinessErrorCode | null) ?? null,
    actor: attribution.actor({ userId: row.actorUserId, botId: row.actorBotId }),
    runId: row.runId,
    input: asRecord(row.input),
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function listBusinessEvents(
  client: BusinessClient,
  spaceId: string,
  limit: number,
): Promise<BusinessEventDto[]> {
  const rows = await client.businessEvent.findMany({
    where: { spaceId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
  });
  const attribution = await resolveAttribution(client, spaceId, rows, (row, resolver) =>
    resolver.collect({ userId: row.actorUserId, botId: row.actorBotId }),
  );
  return rows.map((row) => ({
    id: row.id,
    spaceId: row.spaceId,
    type: row.type as BusinessEventType,
    recordType: row.recordType as BusinessRecordType,
    recordId: row.recordId,
    payload: asRecord(row.payload),
    actor: attribution.actor({ userId: row.actorUserId, botId: row.actorBotId }),
    createdAt: row.createdAt.toISOString(),
  }));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
