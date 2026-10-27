import { ORPCError } from "@orpc/server";
import type { BusinessActionResult, BusinessDeps, FrappeGateway } from "@savingroup/business";
import {
  crmOverview,
  ensureBusinessSettings,
  environmentToDto,
  erpOverview,
  executeBusinessAction,
  frappeCrmOverview,
  frappeErpOverview,
  frappeListInventoryAdjustments,
  isBusinessActionError,
  listInventoryAdjustments,
  readContext,
  sweepUnsettledOperations,
  toBusinessSettingsDto,
} from "@savingroup/business";
import type {
  Actor,
  BusinessActionId,
  BusinessEnvironment,
  BusinessErrorCode,
  BusinessOperation,
  BusinessSettings,
  ConnectBusinessEnvironmentInput,
  CrmOverview,
  ErpOverview,
  InventoryAdjustment,
  ListBusinessOperationsInput,
  ListInventoryAdjustmentsInput,
} from "@savingroup/contracts";
import type { PrismaClient } from "@savingroup/db";

/**
 * HTTP adapters for business actions. Every handler goes through
 * executeBusinessAction, the same path bots use, so validation, authorization
 * and auditing cannot differ between a person and a digital employee.
 */
const ORPC_CODES: Record<BusinessErrorCode, string> = {
  invalid_input: "BAD_REQUEST",
  not_found: "NOT_FOUND",
  permission_denied: "FORBIDDEN",
  conflict: "CONFLICT",
  invalid_state: "CONFLICT",
  insufficient_stock: "CONFLICT",
  unavailable: "NOT_FOUND",
};

export function throwBusinessError(result: Extract<BusinessActionResult, { ok: false }>): never {
  throw new ORPCError(ORPC_CODES[result.error.code] as "BAD_REQUEST", {
    message: result.error.message,
    data: { code: result.error.code, issues: result.error.issues },
  });
}

/** Policy settings (stock rules, approvals, currency) are the space owner's call. */
export async function requireSpaceOwner(prisma: PrismaClient, actor: Actor): Promise<void> {
  const membership = await prisma.spaceMember.findFirst({
    where: { spaceId: actor.spaceId, userId: actor.userId },
    select: { role: true },
  });
  if (membership?.role !== "owner") {
    throw new ORPCError("FORBIDDEN", {
      message: "Only the space owner can change these settings.",
    });
  }
}

export async function businessCall<Output>(
  deps: BusinessDeps,
  actor: Actor,
  actionId: BusinessActionId,
  input: unknown,
): Promise<Output> {
  const result = await executeBusinessAction(deps, actionId, input, {
    spaceId: actor.spaceId,
    actor: { userId: actor.userId },
  });
  if (!result.ok) throwBusinessError(result);
  return result.data as Output;
}

// --- reads that are not actions: overviews, adjustments, settings ------------

async function activeEnvironment(deps: BusinessDeps, spaceId: string) {
  if (!deps.frappe) return null;
  try {
    return await deps.frappe.resolve(spaceId);
  } catch (error) {
    throw new ORPCError("SERVICE_UNAVAILABLE", {
      message: `The business environment is not reachable: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

function rethrow(error: unknown): never {
  if (isBusinessActionError(error)) throwBusinessError({ ok: false, error: error.toJSON() });
  throw error;
}

export async function crmOverviewFor(deps: BusinessDeps, actor: Actor): Promise<CrmOverview> {
  const env = await activeEnvironment(deps, actor.spaceId);
  if (!env) return crmOverview(deps.prisma, actor.spaceId);
  return frappeCrmOverview(
    readContext({ gateway: deps.frappe!, prisma: deps.prisma }, env, actor.spaceId),
  ).catch(rethrow);
}

export async function erpOverviewFor(deps: BusinessDeps, actor: Actor): Promise<ErpOverview> {
  const env = await activeEnvironment(deps, actor.spaceId);
  if (!env) return erpOverview(deps.prisma, actor.spaceId);
  return frappeErpOverview(
    readContext({ gateway: deps.frappe!, prisma: deps.prisma }, env, actor.spaceId),
  ).catch(rethrow);
}

export async function inventoryAdjustmentsFor(
  deps: BusinessDeps,
  actor: Actor,
  input: ListInventoryAdjustmentsInput,
): Promise<InventoryAdjustment[]> {
  const env = await activeEnvironment(deps, actor.spaceId);
  if (!env) return listInventoryAdjustments(deps.prisma, actor.spaceId, input);
  return frappeListInventoryAdjustments(
    readContext({ gateway: deps.frappe!, prisma: deps.prisma }, env, actor.spaceId),
    input,
  ).catch(rethrow);
}

/** With an active environment the site's company currency is the currency. */
export async function businessSettingsFor(
  deps: BusinessDeps,
  actor: Actor,
): Promise<BusinessSettings> {
  const settings = toBusinessSettingsDto(await ensureBusinessSettings(deps.prisma, actor.spaceId));
  const env = await activeEnvironment(deps, actor.spaceId);
  return env ? { ...settings, currency: env.currency } : settings;
}

// --- environment registry -----------------------------------------------------

function gatewayOf(deps: BusinessDeps): FrappeGateway {
  if (!deps.frappe) {
    throw new ORPCError("NOT_FOUND", { message: "Business environments are not available." });
  }
  return deps.frappe;
}

async function organizationIdOf(gateway: FrappeGateway, actor: Actor): Promise<string> {
  const organizationId = await gateway.environments.organizationIdForSpace(actor.spaceId);
  if (!organizationId) throw new ORPCError("NOT_FOUND", { message: "Workspace not found." });
  return organizationId;
}

export async function businessEnvironmentFor(
  deps: BusinessDeps,
  actor: Actor,
): Promise<BusinessEnvironment | null> {
  if (!deps.frappe) return null;
  const organizationId = await organizationIdOf(deps.frappe, actor);
  const row = await deps.frappe.environments.getForOrganization(organizationId);
  return row ? environmentToDto(row) : null;
}

export async function connectBusinessEnvironment(
  deps: BusinessDeps,
  actor: Actor,
  input: ConnectBusinessEnvironmentInput,
): Promise<BusinessEnvironment> {
  const gateway = gatewayOf(deps);
  const organizationId = await organizationIdOf(gateway, actor);
  try {
    const row = await gateway.environments.connect(
      { userId: actor.userId, spaceId: actor.spaceId, organizationId },
      input,
    );
    return environmentToDto(row);
  } catch (error) {
    rethrow(error);
  }
}

export async function verifyBusinessEnvironment(
  deps: BusinessDeps,
  actor: Actor,
): Promise<BusinessEnvironment> {
  const gateway = gatewayOf(deps);
  const organizationId = await organizationIdOf(gateway, actor);
  const row = await gateway.environments.getForOrganization(organizationId);
  if (!row) throw new ORPCError("NOT_FOUND", { message: "No business environment is connected." });
  const verified = await gateway.environments.verify(row.id);
  await sweepUnsettledOperations(gateway, row.id);
  return environmentToDto(verified);
}

export async function disableBusinessEnvironment(
  deps: BusinessDeps,
  actor: Actor,
): Promise<BusinessEnvironment> {
  const gateway = gatewayOf(deps);
  const organizationId = await organizationIdOf(gateway, actor);
  const row = await gateway.environments.getForOrganization(organizationId);
  if (!row) throw new ORPCError("NOT_FOUND", { message: "No business environment is connected." });
  return environmentToDto(await gateway.environments.disable(row.id));
}

export async function listBusinessOperationsFor(
  deps: BusinessDeps,
  actor: Actor,
  input: ListBusinessOperationsInput,
): Promise<BusinessOperation[]> {
  const gateway = gatewayOf(deps);
  const rows = await gateway.ledger.list({
    spaceId: actor.spaceId,
    status: input.status,
    limit: input.limit,
  });
  return rows.map((row) => ({
    id: row.id,
    environmentId: row.environmentId,
    spaceId: row.spaceId,
    actionId: row.actionId,
    actionVersion: row.actionVersion,
    idempotencyKey: row.idempotencyKey,
    status: row.status,
    attempts: row.attempts,
    actorUserId: row.actorUserId,
    actorBotId: row.actorBotId,
    runId: row.runId,
    externalDoctype: row.externalDoctype,
    externalName: row.externalName,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  }));
}
