import type { RunTrace, RunTraceStep } from "@savingroup/contracts";
import { countUnfinishedRunAttempts } from "./run-recovery.js";

/** Stored rows the trace is assembled from. Dates stay native until serialisation. */
export interface RunTraceRunRow {
  id: string;
  status: string;
  trigger: string;
  error: string | null;
  leaseFence: number;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface RunTraceAttemptRow {
  id: string;
  fence: number;
  status: string;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

export interface RunTraceEventRow {
  seq: number;
  type: string;
  createdAt: Date;
  payload: unknown;
}

export interface RunTraceEffectRow {
  id: string;
  kind: string;
  status: string;
  reviewDecision: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Run lifecycle and effect bookkeeping worth a timeline entry; tool steps are listed separately. */
export const RUN_TRACE_EVENT_TYPES = [
  "run.started",
  "run.waiting_input",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "computer.takeover.requested",
  "computer.takeover.released",
  "effect.recorded",
  "effect.reconciled",
  "agent.tool.called",
  "agent.tool.completed",
] as const;

const ACTIVE_RUN_STATUSES = new Set(["queued", "leased", "running"]);
const STEP_OUTCOMES = new Set<RunTraceStep["outcome"]>(["succeeded", "error", "paused"]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function errorText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  const message = record(value).message;
  if (typeof message === "string") return message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** The attempt whose window contains the moment: the newest attempt started at or before it. */
function attemptFenceAt(attempts: readonly RunTraceAttemptRow[], at: Date): number | null {
  let fence: number | null = null;
  for (const attempt of attempts) {
    if (attempt.startedAt.getTime() <= at.getTime()) fence = attempt.fence;
  }
  return fence;
}

export function assembleRunTrace(input: {
  run: RunTraceRunRow;
  attempts: readonly RunTraceAttemptRow[];
  events: readonly RunTraceEventRow[];
  effects: readonly RunTraceEffectRow[];
}): RunTrace {
  const attempts = [...input.attempts].sort((left, right) => left.fence - right.fence);
  const events = [...input.events].sort((left, right) => left.seq - right.seq);
  const runActive = ACTIVE_RUN_STATUSES.has(input.run.status);

  // A runtime may hand out the same tool-call id again when a later attempt replays
  // the turn, so a step is one call within one attempt.
  const steps = new Map<string, RunTraceStep>();
  for (const event of events) {
    const payload = record(event.payload);
    const executionId = typeof payload.executionId === "string" ? payload.executionId : null;
    if (!executionId) continue;
    const name = typeof payload.name === "string" ? payload.name : "";
    const attemptFence = attemptFenceAt(attempts, event.createdAt);
    const key = `${attemptFence ?? "none"}:${executionId}`;
    if (event.type === "agent.tool.called") {
      if (steps.has(key)) continue;
      steps.set(key, {
        executionId,
        name,
        attemptFence,
        calledAt: event.createdAt.toISOString(),
        durationMs: null,
        outcome: runActive ? "running" : "interrupted",
      });
    } else if (event.type === "agent.tool.completed") {
      const existing = steps.get(key);
      const outcome = STEP_OUTCOMES.has(payload.outcome as RunTraceStep["outcome"])
        ? (payload.outcome as RunTraceStep["outcome"])
        : "succeeded";
      const durationMs =
        typeof payload.durationMs === "number" && Number.isFinite(payload.durationMs)
          ? Math.max(0, Math.round(payload.durationMs))
          : null;
      const error = errorText(payload.error);
      steps.set(key, {
        executionId,
        name: existing?.name || name,
        attemptFence,
        calledAt: existing?.calledAt ?? event.createdAt.toISOString(),
        durationMs,
        outcome,
        ...(error !== undefined ? { error } : {}),
      });
    }
  }

  const stepList = [...steps.values()];
  const effectCounts = { executed: 0, reconciled: 0, denied: 0, uncertain: 0, pending: 0 };
  for (const effect of input.effects) {
    if (effect.status === "completed") effectCounts.executed += 1;
    else if (effect.status === "denied") effectCounts.denied += 1;
    else if (effect.status === "uncertain") effectCounts.uncertain += 1;
    else effectCounts.pending += 1;
  }
  effectCounts.reconciled = events.filter((event) => event.type === "effect.reconciled").length;

  return {
    runId: input.run.id,
    status: input.run.status as RunTrace["status"],
    trigger: input.run.trigger as RunTrace["trigger"],
    error: input.run.error,
    createdAt: input.run.createdAt.toISOString(),
    startedAt: input.run.startedAt?.toISOString() ?? null,
    completedAt: input.run.completedAt?.toISOString() ?? null,
    attempts: attempts.map((attempt) => ({
      id: attempt.id,
      fence: attempt.fence,
      status: attempt.status,
      error: attempt.error,
      startedAt: attempt.startedAt.toISOString(),
      finishedAt: attempt.finishedAt?.toISOString() ?? null,
    })),
    steps: stepList,
    effects: [...input.effects]
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .map((effect) => ({
        id: effect.id,
        kind: effect.kind,
        status: effect.status,
        reviewDecision: effect.reviewDecision,
        createdAt: effect.createdAt.toISOString(),
        updatedAt: effect.updatedAt.toISOString(),
      })),
    events: events
      .filter(
        (event) => event.type !== "agent.tool.called" && event.type !== "agent.tool.completed",
      )
      .map((event) => ({ seq: event.seq, type: event.type, at: event.createdAt.toISOString() })),
    summary: {
      attempts: attempts.length,
      // A live run's newest attempt is still in flight; on a settled run that attempt is
      // included, and a terminal one stops the count at zero.
      unfinishedAttempts: countUnfinishedRunAttempts(
        attempts,
        runActive ? input.run.leaseFence : input.run.leaseFence + 1,
      ),
      toolCalls: stepList.length,
      failedToolCalls: stepList.filter((step) => step.outcome === "error").length,
      effects: effectCounts,
    },
  };
}
