import { randomUUID } from "node:crypto";
import type {
  BusinessActionId,
  BusinessEventType,
  BusinessRecordType,
} from "@savingroup/contracts";
import type { PrismaClient } from "@savingroup/db";
import type { BusinessContext } from "../context.js";
import { actorIds } from "../context.js";
import { BusinessActionError } from "../errors.js";
import { ensureBusinessSettings } from "../settings.js";
import type { FrappeActionHandler, FrappeReadContext, FrappeWriteContext } from "./actions.js";
import { FRAPPE_ACTION_HANDLERS } from "./actions.js";
import type { FrappeRequestError } from "./client.js";
import { isFrappeRequestError } from "./client.js";
import type { FrappeGateway } from "./gateway.js";
import type { OperationRecord } from "./ledger.js";
import type { RawDoc } from "./mapping.js";
import { scheduleReconcile } from "./reconcile.js";
import type {
  BridgeCallContext,
  BridgeExecuteResult,
  BridgeOperationLookup,
  ResolvedEnvironment,
} from "./types.js";
import { BRIDGE_METHODS, BRIDGE_PROTOCOL_VERSION } from "./types.js";

/**
 * Runs one business action against an organization's Frappe site.
 *
 * Reads call the site and map. Writes go through the operation ledger:
 *
 *   find row by key → replay / reconcile / proceed
 *   → mark executing → bridge `execute` with the row id as operation id
 *   → succeeded (store result) | failed (store error) | outcome unknown
 *
 * An unknown outcome is never retried blindly. The gateway asks the bridge
 * whether the operation committed; only a definitive "not found" allows the
 * same key to run again, and that happens on the next request, not here.
 */

export interface FrappeRunDeps {
  gateway: FrappeGateway;
  prisma: PrismaClient;
}

export interface FrappeWriteOutcome<Output = unknown> {
  data: Output;
  replayed: boolean;
  recordType: BusinessRecordType;
  recordId: string;
  event: BusinessEventType;
  operationId: string;
}

export function frappeErrorToBusinessError(error: FrappeRequestError): BusinessActionError {
  if (error.businessCode) return new BusinessActionError(error.businessCode, error.message);
  if (error.status === 401 || error.status === 403) {
    return new BusinessActionError(
      "permission_denied",
      "The business system rejected the gateway's credentials.",
    );
  }
  if (error.status === 404) return new BusinessActionError("not_found", error.message);
  return new BusinessActionError("unavailable", `The business system failed: ${error.message}`);
}

const UNCONFIRMED_MESSAGE =
  "The business system did not confirm this operation. It is being reconciled; the same request will return the result once known.";

function handlerFor(actionId: BusinessActionId): FrappeActionHandler {
  return FRAPPE_ACTION_HANDLERS[actionId];
}

export function readContext(
  deps: FrappeRunDeps,
  env: ResolvedEnvironment,
  spaceId: string,
): FrappeReadContext {
  return { client: deps.gateway.clientForEnvironment(env), env, prisma: deps.prisma, spaceId };
}

export async function runFrappeRead(
  deps: FrappeRunDeps,
  env: ResolvedEnvironment,
  actionId: BusinessActionId,
  ctx: BusinessContext,
  input: Record<string, unknown>,
): Promise<unknown> {
  const handler = handlerFor(actionId);
  if (!handler.read) {
    throw new BusinessActionError("unavailable", `${actionId} has no read handler.`);
  }
  try {
    return await handler.read(readContext(deps, env, ctx.spaceId), input);
  } catch (error) {
    if (isFrappeRequestError(error)) throw frappeErrorToBusinessError(error);
    throw error;
  }
}

async function bridgeContext(
  wc: Pick<FrappeWriteContext, "env" | "settings" | "ctx">,
): Promise<BridgeCallContext> {
  const actor = actorIds(wc.ctx.actor);
  return {
    company: wc.env.companyName,
    company_abbr: wc.env.companyAbbr,
    currency: wc.env.currency,
    defaults: {
      warehouse: wc.env.blueprint.defaultWarehouse,
      item_group: wc.env.blueprint.defaultItemGroup,
      uom: wc.env.blueprint.defaultUom,
      customer_group: wc.env.blueprint.defaultCustomerGroup,
      territory: wc.env.blueprint.defaultTerritory,
      price_list: wc.env.blueprint.defaultPriceList,
    },
    policy: {
      allow_negative_stock: wc.settings.allowNegativeStock,
      order_approval_required: wc.settings.orderApprovalRequired,
      invoice_approval_required: wc.settings.invoiceApprovalRequired,
    },
    actor: { user_id: actor.userId, bot_id: actor.botId, run_id: wc.ctx.runId ?? null },
  };
}

async function settle(
  deps: FrappeRunDeps,
  handler: FrappeActionHandler,
  rc: FrappeReadContext,
  operation: OperationRecord,
  result: RawDoc,
  external: { doctype: string; name: string } | null | undefined,
  replayed: boolean,
): Promise<FrappeWriteOutcome> {
  const spec = handler.write!;
  const data = await spec.map(rc, result);
  const recordId = spec.recordId(data);
  await deps.gateway.ledger.update(operation.id, {
    status: "succeeded",
    result: data,
    externalDoctype: external?.doctype ?? null,
    externalName: external?.name ?? null,
    errorCode: null,
    errorMessage: null,
    completedAt: new Date(),
  });
  return {
    data,
    replayed,
    recordType: spec.recordType,
    recordId,
    event: spec.event,
    operationId: operation.id,
  };
}

/**
 * Ask the site whether an operation with this id committed. Returns the
 * settled outcome, or null when the site has never seen it (safe to run).
 */
export async function reconcileOperation(
  deps: FrappeRunDeps,
  env: ResolvedEnvironment,
  operation: OperationRecord,
): Promise<FrappeWriteOutcome | null> {
  const handler = handlerFor(operation.actionId as BusinessActionId);
  const rc = readContext(deps, env, operation.spaceId);
  const lookup = await rc.client.call<BridgeOperationLookup>(BRIDGE_METHODS.getOperation, {
    operation_id: operation.id,
  });
  if (!lookup.found) return null;
  if (lookup.status === "failed") {
    await deps.gateway.ledger.update(operation.id, {
      status: "failed",
      errorCode: lookup.error?.code ?? "unavailable",
      errorMessage: lookup.error?.message ?? "The business system rejected the operation.",
      completedAt: new Date(),
    });
    throw new BusinessActionError(
      (lookup.error?.code as BusinessActionError["code"]) ?? "unavailable",
      lookup.error?.message ?? "The business system rejected the operation.",
    );
  }
  if (!handler.write || !lookup.result) {
    await deps.gateway.ledger.update(operation.id, {
      status: "requires_reconciliation",
      errorMessage: "The site confirmed the operation but returned no result to map.",
    });
    throw new BusinessActionError("unavailable", UNCONFIRMED_MESSAGE);
  }
  return settle(deps, handler, rc, operation, lookup.result, lookup.external, true);
}

function replayFailure(operation: OperationRecord): BusinessActionError {
  return new BusinessActionError(
    (operation.errorCode as BusinessActionError["code"]) ?? "conflict",
    operation.errorMessage ??
      `A previous ${operation.actionId} request with this idempotency key failed.`,
  );
}

export async function runFrappeWrite(
  deps: FrappeRunDeps,
  env: ResolvedEnvironment,
  action: { id: BusinessActionId; version: number },
  ctx: BusinessContext,
  input: Record<string, unknown>,
  idempotencyKey: string | undefined,
): Promise<FrappeWriteOutcome> {
  const handler = handlerFor(action.id);
  if (!handler.write) {
    throw new BusinessActionError("unavailable", `${action.id} has no write handler.`);
  }
  const key = idempotencyKey ?? `auto:${randomUUID()}`;
  const ledger = deps.gateway.ledger;
  const actor = actorIds(ctx.actor);

  let operation = await ledger.find(env.id, key);
  if (operation) {
    if (operation.status === "succeeded" && operation.result !== null) {
      return {
        data: operation.result,
        replayed: true,
        recordType: handler.write.recordType,
        recordId: handler.write.recordId(operation.result),
        event: handler.write.event,
        operationId: operation.id,
      };
    }
    if (operation.status === "failed") throw replayFailure(operation);
    if (operation.status !== "requested") {
      // executing / outcome_unknown / requires_reconciliation: ask before acting.
      const settled = await reconcileOperation(deps, env, operation).catch((error) => {
        if (isFrappeRequestError(error)) throw frappeErrorToBusinessError(error);
        throw error;
      });
      if (settled) return settled;
    }
  } else {
    operation = await ledger.create({
      environmentId: env.id,
      spaceId: ctx.spaceId,
      actionId: action.id,
      actionVersion: action.version,
      idempotencyKey: key,
      actorUserId: actor.userId,
      actorBotId: actor.botId,
      runId: ctx.runId ?? null,
      request: input,
    });
    if (operation.status === "succeeded" && operation.result !== null) {
      return {
        data: operation.result,
        replayed: true,
        recordType: handler.write.recordType,
        recordId: handler.write.recordId(operation.result),
        event: handler.write.event,
        operationId: operation.id,
      };
    }
  }

  const settings = await ensureBusinessSettings(deps.prisma, ctx.spaceId);
  const rc = readContext(deps, env, ctx.spaceId);
  const wc: FrappeWriteContext = {
    ...rc,
    ctx,
    settings: {
      allowNegativeStock: settings.allowNegativeStock,
      orderApprovalRequired: settings.orderApprovalRequired,
      invoiceApprovalRequired: settings.invoiceApprovalRequired,
    },
  };
  await ledger.update(operation.id, { status: "executing", incrementAttempts: true });
  let response: BridgeExecuteResult;
  try {
    response = await rc.client.call<BridgeExecuteResult>(BRIDGE_METHODS.execute, {
      operation_id: operation.id,
      action: action.id,
      version: action.version,
      protocol_version: BRIDGE_PROTOCOL_VERSION,
      payload: handler.write.payload(wc, input),
      context: await bridgeContext(wc),
    });
  } catch (error) {
    if (!isFrappeRequestError(error)) throw error;
    if (error.outcomeUnknown) {
      await ledger.update(operation.id, {
        status: "outcome_unknown",
        errorCode: null,
        errorMessage: error.message,
      });
      await scheduleReconcile(deps.gateway.jobs, operation.id, 0);
      // One immediate look; the reconciler job keeps asking after this.
      const settled = await reconcileOperation(deps, env, operation).catch(() => null);
      if (settled) return settled;
      throw new BusinessActionError("unavailable", UNCONFIRMED_MESSAGE);
    }
    const business = frappeErrorToBusinessError(error);
    await ledger.update(operation.id, {
      status: "failed",
      errorCode: business.code,
      errorMessage: business.message,
      completedAt: new Date(),
    });
    throw business;
  }
  const outcome = await settleCommitted(deps, handler, rc, operation, response);
  if (changesCompany(action.id, input)) {
    // A renamed company keeps working: the next write already names it right.
    await deps.gateway.environments.followCompanyRename(env.id).catch(() => undefined);
  }
  return outcome;
}

/** Site administration that touched the Company document, such as a rename. */
function changesCompany(actionId: BusinessActionId, input: Record<string, unknown>): boolean {
  if (!actionId.startsWith("admin.")) return false;
  const args = input.args;
  const doctype =
    input.doctype ??
    (args && typeof args === "object" ? (args as { doctype?: unknown }).doctype : undefined);
  return doctype === "Company";
}

/**
 * The site has committed. From here only Savingroup's own bookkeeping can fail
 * (a mapping bug, a saturated database), and that must neither report a
 * failure for a change that happened nor leave the row `executing` for good:
 * the row becomes an unknown outcome, the reconciler settles it from the
 * site's record, and the same key returns the result once known.
 */
async function settleCommitted(
  deps: FrappeRunDeps,
  handler: FrappeActionHandler,
  rc: FrappeReadContext,
  operation: OperationRecord,
  response: BridgeExecuteResult,
): Promise<FrappeWriteOutcome> {
  try {
    return await settle(
      deps,
      handler,
      rc,
      operation,
      response.result,
      response.external,
      Boolean(response.replayed),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.gateway.ledger
      .update(operation.id, {
        status: "outcome_unknown",
        errorMessage: `Committed on the site; recording the result failed: ${message}`,
      })
      .catch(() => undefined);
    await scheduleReconcile(deps.gateway.jobs, operation.id, 0);
    throw new BusinessActionError("unavailable", UNCONFIRMED_MESSAGE);
  }
}
