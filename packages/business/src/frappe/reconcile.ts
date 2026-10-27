import type { JobPublisher } from "@savingroup/adapter-kit";
import type { BusinessActionId } from "@savingroup/contracts";
import type { PrismaClient } from "@savingroup/db";
import { findIdempotentAction, recordSucceededWrite } from "../audit.js";
import { isBusinessActionError } from "../errors.js";
import { isFrappeRequestError } from "./client.js";
import type { FrappeGateway } from "./gateway.js";
import type { OperationRecord } from "./ledger.js";
import type { FrappeWriteOutcome } from "./run.js";
import { reconcileOperation } from "./run.js";

/**
 * Background settlement of operations whose outcome the gateway never saw.
 *
 * The job asks the site whether the operation committed. "Yes" settles the
 * row with the committed result; "no" returns the row to `requested`, so the
 * next request with the same key runs it. An unreachable site is retried with
 * backoff; after the cap the row is handed to a person.
 */
export const RECONCILE_MAX_ATTEMPTS = 8;
const BACKOFF_SECONDS = [30, 60, 120, 300, 600, 1200, 1800, 3600];
/** An `executing` row older than this lost its caller (crash, saturated database). */
export const STALE_OPERATION_MS = 2 * 60 * 1000;

export function reconcileJobKey(operationId: string): string {
  return `business.operation.reconcile:${operationId}`;
}

export async function scheduleReconcile(
  jobs: Pick<JobPublisher, "enqueue"> | undefined,
  operationId: string,
  attempt: number,
  now: Date = new Date(),
  delaySeconds?: number,
): Promise<void> {
  if (!jobs) return;
  const delay =
    delaySeconds ?? BACKOFF_SECONDS[Math.min(attempt, BACKOFF_SECONDS.length - 1)] ?? 3600;
  await jobs
    .enqueue({
      name: "business.operation.reconcile",
      payload: { operationId },
      availableAt: new Date(now.getTime() + delay * 1000),
      replaceKey: reconcileJobKey(operationId),
    })
    .catch(() => undefined);
}

export async function reconcileBusinessOperationJob(
  deps: { gateway: FrappeGateway; prisma: PrismaClient; jobs?: Pick<JobPublisher, "enqueue"> },
  operationId: string,
): Promise<"settled" | "released" | "retry_scheduled" | "handed_over" | "skipped"> {
  const ledger = deps.gateway.ledger;
  const operation = await ledger.get(operationId);
  if (!operation) return "skipped";
  if (operation.status !== "outcome_unknown" && operation.status !== "executing") return "skipped";
  const row = await deps.gateway.environments.getById(operation.environmentId);
  if (!row || row.status === "disabled") {
    await ledger.update(operation.id, {
      status: "requires_reconciliation",
      errorMessage: "The business environment is no longer active.",
    });
    return "handed_over";
  }
  try {
    const env = await deps.gateway.environments.resolveRow(row);
    const settled = await reconcileOperation(
      { gateway: deps.gateway, prisma: deps.prisma },
      env,
      operation,
    );
    if (settled) {
      await recordSettledOperation(deps.prisma, operation, settled);
      return "settled";
    }
    // The site never saw it: the key is free again for the next request.
    await ledger.update(operation.id, {
      status: "requested",
      errorMessage: "The business system never received the operation; it can be retried.",
    });
    return "released";
  } catch (error) {
    if (isBusinessActionError(error)) return "settled";
    if (!isFrappeRequestError(error) && !(error instanceof Error)) throw error;
    const attempts = operation.attempts + 1;
    await ledger.update(operation.id, {
      incrementAttempts: true,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    if (attempts >= RECONCILE_MAX_ATTEMPTS) {
      await ledger.update(operation.id, { status: "requires_reconciliation" });
      return "handed_over";
    }
    await scheduleReconcile(deps.jobs, operation.id, attempts);
    return "retry_scheduled";
  }
}

/**
 * The caller of a write that settles here never got to record it (its
 * bookkeeping failed after the commit, or it is long gone), so the audit row
 * and the domain event are written now, once, under the operation's key.
 */
async function recordSettledOperation(
  prisma: PrismaClient,
  operation: OperationRecord,
  outcome: FrappeWriteOutcome,
): Promise<void> {
  if (await findIdempotentAction(prisma, operation.spaceId, operation.idempotencyKey)) return;
  await recordSucceededWrite(
    prisma,
    {
      spaceId: operation.spaceId,
      actor: operation.actorBotId
        ? { userId: operation.actorUserId ?? "", botId: operation.actorBotId }
        : { userId: operation.actorUserId ?? "" },
      runId: operation.runId ?? undefined,
      now: new Date(),
    },
    {
      actionId: operation.actionId as BusinessActionId,
      actionVersion: operation.actionVersion,
      idempotencyKey: operation.idempotencyKey,
      recordType: outcome.recordType,
      recordId: outcome.recordId,
      input: operation.request,
      result: outcome.data,
      event: outcome.event,
      payload: { source: "frappe", operationId: operation.id, reconciled: true },
    },
  );
}

/**
 * Hands every stale unsettled operation of an environment to the reconciler.
 * Run when a person checks the environment and when the verify job runs, so a
 * row orphaned by a crash or a database outage is not forgotten.
 */
export async function sweepUnsettledOperations(
  gateway: FrappeGateway,
  environmentId: string,
  now: Date = new Date(),
): Promise<number> {
  const rows = await gateway.ledger.unsettled(environmentId, 100);
  let scheduled = 0;
  for (const row of rows) {
    if (now.getTime() - row.updatedAt.getTime() < STALE_OPERATION_MS) continue;
    await scheduleReconcile(gateway.jobs, row.id, 0, now, 0);
    scheduled += 1;
  }
  return scheduled;
}
