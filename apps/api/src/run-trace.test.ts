import type { Actor } from "@savingroup/contracts";
import type { PrismaClient } from "@savingroup/db";
import { IsolationError } from "@savingroup/db";
import { describe, expect, it, vi } from "vitest";

const { resolveThreadTarget } = vi.hoisted(() => ({
  resolveThreadTarget: vi.fn(async (): Promise<{ threadId: string }> => ({ threadId: "thread-1" })),
}));
vi.mock("./thread-target.js", () => ({ resolveThreadTarget }));

import { loadRunTrace } from "./run-trace.js";

const actor: Actor = {
  userId: "user-1",
  spaceId: "space-1",
  email: "user@savingroup.test",
  isDeploymentOwner: false,
};

const at = (offsetMs: number) => new Date(Date.UTC(2026, 9, 12, 12, 0, 0, offsetMs));

function prismaWith(run: Record<string, unknown> | null) {
  return {
    run: { findFirst: vi.fn(async () => run) },
    attempt: {
      findMany: vi.fn(async () => [
        {
          id: "a1",
          fence: 1,
          status: "completed",
          error: null,
          startedAt: at(1),
          finishedAt: at(9),
        },
      ]),
    },
    event: {
      findMany: vi.fn(async () => [
        {
          seq: 3,
          type: "agent.tool.called",
          createdAt: at(2),
          payload: { name: "shell", executionId: "x" },
        },
        {
          seq: 4,
          type: "agent.tool.completed",
          createdAt: at(5),
          payload: { name: "shell", executionId: "x", durationMs: 3, outcome: "succeeded" },
        },
        { seq: 5, type: "run.completed", createdAt: at(9), payload: {} },
      ]),
    },
    externalEffect: { findMany: vi.fn(async () => []) },
  } as unknown as PrismaClient;
}

const storedRun = {
  id: "run-1",
  status: "completed",
  trigger: "user",
  error: null,
  leaseFence: 1,
  createdAt: at(0),
  startedAt: at(1),
  completedAt: at(9),
  botId: "bot-1",
  threadId: "thread-1",
  thread: { groupId: null },
};

describe("loadRunTrace", () => {
  it("returns the assembled trace for a run in the actor's space", async () => {
    const prisma = prismaWith(storedRun);
    const trace = await loadRunTrace(prisma, actor, "run-1");
    expect(prisma.run.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "run-1", spaceId: "space-1" } }),
    );
    expect(resolveThreadTarget).toHaveBeenLastCalledWith(
      prisma,
      actor,
      { botId: "bot-1" },
      { includeArchived: true },
    );
    expect(trace.steps).toEqual([
      expect.objectContaining({ name: "shell", attemptFence: 1, outcome: "succeeded" }),
    ]);
    expect(trace.summary.toolCalls).toBe(1);
  });

  it("checks group membership through the group target", async () => {
    const prisma = prismaWith({ ...storedRun, thread: { groupId: "group-1" } });
    await loadRunTrace(prisma, actor, "run-1");
    expect(resolveThreadTarget).toHaveBeenLastCalledWith(
      prisma,
      actor,
      { groupId: "group-1" },
      { includeArchived: true },
    );
  });

  it("answers not found for a run outside the space", async () => {
    await expect(loadRunTrace(prismaWith(null), actor, "run-1")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("answers not found when the thread is not readable", async () => {
    resolveThreadTarget.mockRejectedValueOnce(new IsolationError());
    await expect(loadRunTrace(prismaWith(storedRun), actor, "run-1")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    resolveThreadTarget.mockResolvedValueOnce({ threadId: "other-thread" });
    await expect(loadRunTrace(prismaWith(storedRun), actor, "run-1")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
