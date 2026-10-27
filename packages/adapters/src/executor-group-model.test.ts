import type { AgentRunRequest } from "@savingroup/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import type * as ComputerLifecycleModule from "./computer-lifecycle.js";
import { createRunExecutor } from "./executor.js";

vi.mock("./computer-lifecycle.js", async (importOriginal) => ({
  ...(await importOriginal<typeof ComputerLifecycleModule>()),
  acquireComputerExecutionLease: async () => null,
  acquireDedicatedScreenLeaseFence: async () => null,
  provisionComputer: async () => ({ id: "computer-1", kind: "desktop" }),
}));

type ModelChoice = {
  modelProvider: string | null;
  modelId: string | null;
  thinkingLevel: string | null;
};

const BOT_MODEL = { modelProvider: "openrouter", modelId: "bot-model", thinkingLevel: "low" };
const GROUP_MODEL = { modelProvider: "openrouter", modelId: "group-model", thinkingLevel: "high" };

/** One member's turn in a thread that belongs to a group with `group` as its model. */
async function memberTurn(group: ModelChoice | null) {
  const run = {
    id: "run-1",
    botId: "bot-1",
    threadId: "thread-1",
    taskId: "task-1",
    spaceId: "space-1",
    userId: "user-1",
    status: "queued",
    trigger: "user",
    leaseFence: 0,
  };
  let request: AgentRunRequest | undefined;
  const runtimeRun = vi.fn(async function* (next: AgentRunRequest) {
    request = next;
    yield { type: "done" as const, text: "Done" };
  });
  const now = new Date("2026-10-01T00:00:00.000Z");
  const prisma = {
    run: {
      findUnique: vi.fn(async () => run),
      findUniqueOrThrow: vi.fn(async () => run),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(run, data);
        return { count: 1 };
      }),
    },
    bot: {
      findUniqueOrThrow: vi.fn(async () => ({
        id: run.botId,
        name: "Assistant",
        title: "Assistant",
        description: "Test assistant",
        ...BOT_MODEL,
        computerId: "computer-1",
        computerSwitching: false,
        memoryScope: null,
        computer: { id: "computer-1", scope: "dedicated" },
      })),
      findMany: vi.fn(async () => []),
    },
    attempt: {
      create: vi.fn(async () => ({ id: "attempt-1" })),
      findMany: vi.fn(async () => []),
      update: vi.fn(),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    thread: {
      findUniqueOrThrow: vi.fn(async () => ({
        id: run.threadId,
        groupId: group ? "group-1" : null,
        group,
        historyCompactionSummary: null,
        historyCompactedUpToSeq: null,
        nextMessageSeq: 1,
      })),
    },
    chatGroup: { findUnique: vi.fn(async () => null) },
    message: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null) },
    task: { findUniqueOrThrow: vi.fn(async () => ({ id: run.taskId, prompt: "Plan the launch" })) },
    computer: { updateMany: vi.fn(async () => ({ count: 1 })) },
    connection: { findMany: vi.fn(async () => []) },
    spaceModelPreference: {
      findFirst: vi.fn(async (args: { where: { credential?: { provider?: string } } }) =>
        args.where.credential?.provider === "openrouter"
          ? {
              id: "preference-openrouter",
              isDefault: true,
              modelId: "space-model",
              credential: {
                id: "credential-openrouter",
                userId: run.userId,
                provider: "openrouter",
                label: "openrouter",
                secretId: "secret-openrouter",
                createdAt: now,
                updatedAt: now,
              },
            }
          : null,
      ),
    },
    secret: { findFirst: vi.fn(async () => null) },
    userModelCredential: { findFirst: vi.fn(async () => null) },
    spaceBackupModel: { findMany: vi.fn(async () => []) },
    deploymentSettings: { findUnique: vi.fn(async () => null) },
    taughtSkill: { findMany: vi.fn(async () => []) },
    agentSecret: { findMany: vi.fn(async () => []) },
    botSecret: { findMany: vi.fn(async () => []) },
    agentSkill: { findMany: vi.fn(async () => []) },
    scratchpadItem: { findMany: vi.fn(async () => []) },
    externalEffect: { findMany: vi.fn(async () => []) },
    artifact: { findMany: vi.fn(async () => []) },
  };
  const finalizeRun = vi.fn(async () => ({ continuationRunId: null }));
  const executor = createRunExecutor({
    prisma,
    runtime: { describe: () => ({ capabilities: { scripted: false } }), run: runtimeRun },
    sandbox: {
      describe: () => ({ capabilities: { graphical: false } }),
      writeFile: vi.fn(async () => undefined),
      async *exportWorkspace() {
        yield* [];
      },
    },
    home: { commit: vi.fn(async () => "fixture-revision") },
    memory: { read: async () => ({ documents: [] }) },
    memoryProviders: { resolve: async () => null },
    artifacts: { get: vi.fn() },
    events: { append: vi.fn(async () => undefined), finalizeRun },
    jobs: { enqueue: vi.fn(async () => undefined) },
    secrets: [],
  } as unknown as Parameters<typeof createRunExecutor>[0]);

  await executor.continueRun(run.id, "worker-1");
  expect(finalizeRun).not.toHaveBeenCalledWith(expect.objectContaining({ outcome: "failed" }));
  if (!request) throw new Error("runtime was not called");
  return { request, run };
}

describe("group model", () => {
  it("runs a member on the group's model while it replies in the group", async () => {
    const { request, run } = await memberTurn(GROUP_MODEL);
    expect(request.model).toMatchObject({
      provider: "openrouter",
      id: "group-model",
      thinkingLevel: "high",
    });
    // The run records what it used without pinning it, so the next turn follows the group.
    expect(run).toMatchObject({ modelId: "group-model" });
    expect(run).not.toHaveProperty("modelPinned");
  });

  it("keeps each member on its own model when the group has none", async () => {
    const empty = { modelProvider: null, modelId: null, thinkingLevel: null };
    for (const group of [empty, null]) {
      const { request } = await memberTurn(group);
      expect(request.model).toMatchObject({ id: "bot-model", thinkingLevel: "low" });
    }
  });
});
