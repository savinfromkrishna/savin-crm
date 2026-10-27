import type { ConnectorTool } from "@savingroup/adapter-kit";
import { businessActionIdFromToolName, businessToolName } from "@savingroup/contracts";
import { approvalEffectKey } from "@savingroup/core/node/approval-effect-key";
import { z } from "zod";
import type { BusinessDeps } from "./context.js";
import { executeBusinessAction } from "./execute.js";
import type { BusinessActionDefinition } from "./registry.js";
import { BUSINESS_ACTIONS } from "./registry.js";

/** Long free text is cut in list results; a get/search by id returns it whole. */
const LIST_TEXT_CHARS = 240;

function toolInputSchema(action: BusinessActionDefinition): Record<string, unknown> {
  const schema = z.toJSONSchema(action.input, { io: "input" }) as Record<string, unknown>;
  delete schema.$schema;
  const properties = schema.properties;
  if (properties && typeof properties === "object") {
    // Bots never choose idempotency keys; the executor derives one per run and call.
    delete (properties as Record<string, unknown>).idempotencyKey;
  }
  return schema;
}

/** The model-facing surface, derived from the registry so the two never drift. */
export const businessAgentTools: ConnectorTool[] = BUSINESS_ACTIONS.map((action) => ({
  name: businessToolName(action.id),
  description: action.description,
  inputSchema: toolInputSchema(action),
  ...(action.kind === "read" ? { readOnly: true } : {}),
}));

export interface RunBusinessToolInput {
  toolName: string;
  args: Record<string, unknown>;
  spaceId: string;
  userId: string;
  botId: string;
  runId?: string;
}

/**
 * Bot entry point. Space, user and bot come from the Run row, never from args.
 * Writes get a per-run idempotency key so a replay after a crash or an
 * approval resume returns the committed result instead of acting twice.
 */
export async function runBusinessTool(
  deps: BusinessDeps,
  input: RunBusinessToolInput,
): Promise<Record<string, unknown>> {
  const actionId = businessActionIdFromToolName(input.toolName);
  if (!actionId) return { error: `Unknown business tool ${input.toolName}.` };
  if (!deps.enabled) return { error: "Business apps are not enabled.", code: "unavailable" };
  const action = BUSINESS_ACTIONS.find((entry) => entry.id === actionId);
  const args = { ...input.args };
  delete args.idempotencyKey;
  if (action?.kind === "write" && input.runId) {
    args.idempotencyKey = approvalEffectKey(input.runId, input.toolName, input.args);
  }
  const result = await executeBusinessAction(deps, actionId, args, {
    spaceId: input.spaceId,
    actor: { userId: input.userId, botId: input.botId },
    runId: input.runId,
  });
  if (!result.ok) {
    return {
      error: result.error.message,
      code: result.error.code,
      ...(result.error.issues ? { issues: result.error.issues } : {}),
    };
  }
  const data = (action?.kind === "read" ? trimListText(result.data) : result.data) as Record<
    string,
    unknown
  >;
  return result.replayed ? { ...data, replayed: true } : data;
}

function trimListText(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(trimListText);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] =
        typeof entry === "string" && entry.length > LIST_TEXT_CHARS
          ? `${entry.slice(0, LIST_TEXT_CHARS - 1)}…`
          : trimListText(entry);
    }
    return out;
  }
  return value;
}
