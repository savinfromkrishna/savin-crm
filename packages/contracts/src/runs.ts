import * as z from "zod";
import { Id, IsoDate, RunStatus } from "./ids.js";

export const RUN_TRIGGERS = [
  "user",
  "routine",
  "resume",
  "follow_up",
  "reaction",
  "call_end",
  "spawn",
  "skill",
  "bot_message",
  "webhook",
  "messaging",
  "cloud_agent",
  "phone_call",
  "created",
  "tickets",
] as const;
export const RunTriggerSchema = z.enum(RUN_TRIGGERS);
export type RunTrigger = z.infer<typeof RunTriggerSchema>;

export const RoutineRunSchema = z.object({
  id: Id,
  botId: Id,
  groupId: Id.nullable(),
  status: RunStatus,
  createdAt: IsoDate,
  startedAt: IsoDate.nullable(),
  completedAt: IsoDate.nullable(),
  messageId: Id.nullable(),
});
export type RoutineRun = z.infer<typeof RoutineRunSchema>;

export const RoutineRunCursorSchema = z.object({ id: Id, createdAt: IsoDate });
export type RoutineRunCursor = z.infer<typeof RoutineRunCursorSchema>;
export const RoutineHistorySchema = z.object({
  runs: z.array(RoutineRunSchema),
  nextCursor: RoutineRunCursorSchema.nullable(),
});
export type RoutineHistory = z.infer<typeof RoutineHistorySchema>;

export const RunActivityRowSchema = z.object({
  runId: Id,
  botId: Id,
  botName: z.string(),
  groupId: Id.nullable(),
  groupName: z.string().nullable(),
  threadId: Id,
  status: RunStatus,
  trigger: RunTriggerSchema,
  notificationsEnabled: z.boolean(),
  promptSnippet: z.string(),
  updatedAt: z.string(),
});
export type RunActivityRow = z.infer<typeof RunActivityRowSchema>;

export const RunsListOutputSchema = z.object({
  runs: z.array(RunActivityRowSchema),
});
export type RunsListOutput = z.infer<typeof RunsListOutputSchema>;

export const RunTraceAttemptSchema = z.object({
  id: Id,
  fence: z.number().int(),
  status: z.string(),
  error: z.string().nullable(),
  startedAt: IsoDate,
  finishedAt: IsoDate.nullable(),
});
export type RunTraceAttempt = z.infer<typeof RunTraceAttemptSchema>;

export const RunTraceStepSchema = z.object({
  executionId: z.string(),
  name: z.string(),
  /** The attempt whose window the call fell in; null when it predates every attempt. */
  attemptFence: z.number().int().nullable(),
  calledAt: IsoDate,
  durationMs: z.number().int().nonnegative().nullable(),
  /** `running` only while the run is active; a call with no completion on a settled run is `interrupted`. */
  outcome: z.enum(["succeeded", "error", "paused", "running", "interrupted"]),
  error: z.string().optional(),
});
export type RunTraceStep = z.infer<typeof RunTraceStepSchema>;

/** Status and review only. Arguments and results stay out of the trace. */
export const RunTraceEffectSchema = z.object({
  id: Id,
  kind: z.string(),
  status: z.string(),
  reviewDecision: z.string().nullable(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type RunTraceEffect = z.infer<typeof RunTraceEffectSchema>;

export const RunTraceEventSchema = z.object({
  seq: z.number().int().nonnegative(),
  type: z.string(),
  at: IsoDate,
});

export const RunTraceSummarySchema = z.object({
  attempts: z.number().int().nonnegative(),
  /** Consecutive newest attempts that ended without the run moving. */
  unfinishedAttempts: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  failedToolCalls: z.number().int().nonnegative(),
  effects: z.object({
    executed: z.number().int().nonnegative(),
    /** Calls matched to an effect already on record: an approved request resumed after
        its pause, or a repeated call answered from the stored outcome. */
    reconciled: z.number().int().nonnegative(),
    denied: z.number().int().nonnegative(),
    uncertain: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
  }),
});

export const RunTraceSchema = z.object({
  runId: Id,
  status: RunStatus,
  trigger: RunTriggerSchema,
  error: z.string().nullable(),
  createdAt: IsoDate,
  startedAt: IsoDate.nullable(),
  completedAt: IsoDate.nullable(),
  attempts: z.array(RunTraceAttemptSchema),
  steps: z.array(RunTraceStepSchema),
  effects: z.array(RunTraceEffectSchema),
  events: z.array(RunTraceEventSchema),
  summary: RunTraceSummarySchema,
});
export type RunTrace = z.infer<typeof RunTraceSchema>;
