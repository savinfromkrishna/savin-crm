import { ORPCError } from "@orpc/server";
import type { Actor, RunTrace } from "@savingroup/contracts";
import { assembleRunTrace, RUN_TRACE_EVENT_TYPES } from "@savingroup/core";
import type { PrismaClient } from "@savingroup/db";
import { IsolationError } from "@savingroup/db";
import { resolveThreadTarget } from "./thread-target.js";

/**
 * One run's execution record for the person who can read its thread. The run must
 * be in the actor's space and the thread check applies the same bot-ownership and
 * group-membership rules as reading the chat. Effect arguments and results are not
 * returned; they can hold connector payloads and are already redacted elsewhere.
 */
export async function loadRunTrace(
  prisma: PrismaClient,
  actor: Actor,
  runId: string,
): Promise<RunTrace> {
  const run = await prisma.run.findFirst({
    where: { id: runId, spaceId: actor.spaceId },
    select: {
      id: true,
      status: true,
      trigger: true,
      error: true,
      leaseFence: true,
      createdAt: true,
      startedAt: true,
      completedAt: true,
      botId: true,
      threadId: true,
      thread: { select: { groupId: true } },
    },
  });
  if (!run) throw new ORPCError("NOT_FOUND", { message: "Run not found" });
  try {
    const target = await resolveThreadTarget(
      prisma,
      actor,
      run.thread.groupId ? { groupId: run.thread.groupId } : { botId: run.botId },
      { includeArchived: true },
    );
    if (target.threadId !== run.threadId) throw new IsolationError();
  } catch (error) {
    if (error instanceof IsolationError) {
      throw new ORPCError("NOT_FOUND", { message: "Run not found" });
    }
    throw error;
  }

  const [attempts, events, effects] = await Promise.all([
    prisma.attempt.findMany({
      where: { runId: run.id },
      orderBy: { fence: "asc" },
      select: {
        id: true,
        fence: true,
        status: true,
        error: true,
        startedAt: true,
        finishedAt: true,
      },
    }),
    prisma.event.findMany({
      where: { runId: run.id, type: { in: [...RUN_TRACE_EVENT_TYPES] } },
      orderBy: { seq: "asc" },
      select: { seq: true, type: true, createdAt: true, payload: true },
    }),
    prisma.externalEffect.findMany({
      where: { runId: run.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        kind: true,
        status: true,
        reviewDecision: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);
  return assembleRunTrace({ run, attempts, events, effects });
}
