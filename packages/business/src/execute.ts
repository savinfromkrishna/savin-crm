import type { BusinessActionId, BusinessError } from "@savingroup/contracts";
import { businessToolName, disabledBuiltinToolSet } from "@savingroup/contracts";
import { withTransactionRetry } from "@savingroup/db";
import {
  findIdempotentAction,
  isUniqueViolation,
  recordBusinessAction,
  recordSucceededWrite,
} from "./audit.js";
import type { BusinessActor, BusinessContext, BusinessDeps } from "./context.js";
import {
  BusinessActionError,
  invalidInputFromZod,
  isBusinessActionError,
  permissionDenied,
} from "./errors.js";
import { runFrappeRead, runFrappeWrite } from "./frappe/run.js";
import type { ResolvedEnvironment } from "./frappe/types.js";
import { publishPendingBusinessEvents } from "./live.js";
import type { BusinessActionDefinition } from "./registry.js";
import { getBusinessAction } from "./registry.js";

export type BusinessActionResult<Output = unknown> =
  | { ok: true; data: Output; replayed: boolean }
  | { ok: false; error: BusinessError };

export interface ExecuteBusinessActionOptions {
  spaceId: string;
  actor: BusinessActor;
  runId?: string;
  now?: Date;
}

/**
 * The single entry point for every business action, from the API and from bot
 * tools alike: validate, authorize, replay or run, audit, and publish committed
 * events. Services never run outside it.
 *
 * Where the records live depends on the organization: with an active business
 * environment the action runs on its ERPNext + Frappe CRM site through the
 * gateway's operation ledger; otherwise the built-in prototype tables answer.
 * Validation, bot permissions, the audit log and the live events are the same
 * on both paths.
 */
export async function executeBusinessAction(
  deps: BusinessDeps,
  actionId: BusinessActionId,
  rawInput: unknown,
  options: ExecuteBusinessActionOptions,
): Promise<BusinessActionResult> {
  if (!deps.enabled) {
    return failure(new BusinessActionError("unavailable", "Business apps are not enabled."));
  }
  const action = getBusinessAction(actionId);
  const parsed = action.input.safeParse(rawInput ?? {});
  if (!parsed.success) return failure(invalidInputFromZod(parsed.error));
  const ctx: BusinessContext = {
    spaceId: options.spaceId,
    actor: options.actor,
    runId: options.runId,
    now: options.now ?? new Date(),
  };
  const denied = await checkBotPermission(deps, ctx, actionId);
  if (denied) return failure(denied);

  const input = parsed.data as Record<string, unknown>;

  let environment: ResolvedEnvironment | null = null;
  if (deps.frappe) {
    try {
      environment = await deps.frappe.resolve(ctx.spaceId);
    } catch (error) {
      // An active environment whose credentials cannot be opened must not fall
      // back to the prototype tables: that would split the organization's data.
      return failure(
        new BusinessActionError(
          "unavailable",
          `The business environment is not reachable: ${describe(error)}`,
        ),
      );
    }
  }
  if (environment) return executeOnEnvironment(deps, environment, action, ctx, input);

  if (action.kind === "read") {
    try {
      return { ok: true, replayed: false, data: await action.run(deps.prisma, ctx, input) };
    } catch (error) {
      if (isBusinessActionError(error)) return failure(error);
      throw error;
    }
  }

  const idempotencyKey = idempotencyKeyOf(input);
  if (idempotencyKey) {
    const replay = await findIdempotentAction(deps.prisma, ctx.spaceId, idempotencyKey);
    if (replay) return replayResult(replay);
  }

  try {
    const data = await withTransactionRetry(() =>
      deps.prisma.$transaction(async (tx) => {
        const output = await action.run(tx, ctx, input);
        await recordBusinessAction(tx, ctx, {
          actionId,
          actionVersion: action.version,
          idempotencyKey,
          recordType: action.recordType,
          recordId: action.recordId?.(output),
          input,
          outcome: "succeeded",
          result: output,
        });
        return output;
      }),
    );
    await publishPendingBusinessEvents(deps.prisma, deps.live, ctx.spaceId).catch(() => undefined);
    return { ok: true, replayed: false, data };
  } catch (error) {
    if (idempotencyKey && isUniqueViolation(error)) {
      // A concurrent request with the same key committed first; hand back its outcome.
      const replay = await findIdempotentAction(deps.prisma, ctx.spaceId, idempotencyKey);
      if (replay) return replayResult(replay);
    }
    if (!isBusinessActionError(error)) throw error;
    await recordFailure(deps, ctx, action, input, idempotencyKey, error);
    return failure(error);
  }
}

/**
 * The environment path. The site holds the records; Savingroup still writes the
 * audit entry and the domain event for every committed write, so history and
 * live refresh look the same to people and bots whichever backend answered.
 */
async function executeOnEnvironment(
  deps: BusinessDeps,
  environment: ResolvedEnvironment,
  action: BusinessActionDefinition,
  ctx: BusinessContext,
  input: Record<string, unknown>,
): Promise<BusinessActionResult> {
  const runDeps = { gateway: deps.frappe!, prisma: deps.prisma };
  if (action.kind === "read") {
    try {
      return {
        ok: true,
        replayed: false,
        data: await runFrappeRead(runDeps, environment, action.id, ctx, input),
      };
    } catch (error) {
      if (isBusinessActionError(error)) return failure(error);
      throw error;
    }
  }
  const idempotencyKey = idempotencyKeyOf(input);
  if (idempotencyKey) {
    const replay = await findIdempotentAction(deps.prisma, ctx.spaceId, idempotencyKey);
    if (replay) return replayResult(replay);
  }
  try {
    const outcome = await runFrappeWrite(
      runDeps,
      environment,
      { id: action.id, version: action.version },
      ctx,
      input,
      idempotencyKey,
    );
    // A replay from the ledger reaches this point only when no audit row exists for
    // the key (an earlier one returns above), so a reconciled write is recorded here too.
    await recordSucceededWrite(deps.prisma, ctx, {
      actionId: action.id,
      actionVersion: action.version,
      idempotencyKey,
      recordType: outcome.recordType,
      recordId: outcome.recordId,
      input,
      result: outcome.data,
      event: outcome.event,
      payload: { source: "frappe", operationId: outcome.operationId },
    });
    await publishPendingBusinessEvents(deps.prisma, deps.live, ctx.spaceId).catch(() => undefined);
    return { ok: true, replayed: outcome.replayed, data: outcome.data };
  } catch (error) {
    if (!isBusinessActionError(error)) throw error;
    await recordFailure(deps, ctx, action, input, idempotencyKey, error);
    return failure(error);
  }
}

function idempotencyKeyOf(input: Record<string, unknown>): string | undefined {
  return typeof input.idempotencyKey === "string" ? input.idempotencyKey : undefined;
}

async function recordFailure(
  deps: BusinessDeps,
  ctx: BusinessContext,
  action: BusinessActionDefinition,
  input: Record<string, unknown>,
  idempotencyKey: string | undefined,
  error: BusinessActionError,
): Promise<void> {
  // An unconfirmed operation is not a failure: the key must stay free for the reconciled retry.
  if (error.code === "unavailable") return;
  await recordBusinessAction(deps.prisma, ctx, {
    actionId: action.id,
    actionVersion: action.version,
    idempotencyKey,
    recordType: action.recordType,
    input,
    outcome: "failed",
    errorCode: error.code,
  }).catch(() => undefined);
}

function failure(error: BusinessActionError): BusinessActionResult {
  return { ok: false, error: error.toJSON() };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function replayResult(log: {
  outcome: string;
  result: unknown;
  errorCode: string | null;
  actionId: string;
}): BusinessActionResult {
  if (log.outcome === "succeeded") return { ok: true, replayed: true, data: log.result };
  return {
    ok: false,
    error: {
      code: (log.errorCode as BusinessError["code"]) ?? "conflict",
      message: `A previous ${log.actionId} request with this idempotency key failed.`,
    },
  };
}

/**
 * A bot's allowed actions are enforced here, from the database, not from what
 * the model was told. The executor also filters disabled tools out of the
 * offered set, but that is a convenience; this is the boundary.
 */
async function checkBotPermission(
  deps: BusinessDeps,
  ctx: BusinessContext,
  actionId: BusinessActionId,
): Promise<BusinessActionError | undefined> {
  if (!ctx.actor.botId) return undefined;
  const bot = await deps.prisma.bot.findFirst({
    where: { id: ctx.actor.botId, spaceId: ctx.spaceId },
    select: { disabledBuiltinTools: true, archivedAt: true },
  });
  if (!bot) return permissionDenied("This bot does not belong to the workspace.");
  if (bot.archivedAt) return permissionDenied("An archived bot cannot run business actions.");
  const toolName = businessToolName(actionId);
  if (disabledBuiltinToolSet(bot.disabledBuiltinTools).has(toolName)) {
    return permissionDenied(`This bot is not allowed to run ${actionId}.`);
  }
  return undefined;
}
