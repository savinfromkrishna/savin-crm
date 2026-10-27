import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { RunTrace } from "@savingroup/contracts";
import { MAX_UNFINISHED_RUN_ATTEMPTS, runRecoveryExhaustedMessage } from "@savingroup/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { createApp } from "../../../apps/api/src/app.ts";
import {
  answerApproval,
  createActor,
  isTerminalStatus,
  requireApprovalFor,
  rpc,
  seedAbandonedRun,
  sendMessage,
  waitForRun,
  waitForThread,
} from "./reliability-scenario.js";

process.env.WAKEUP_DRIVER = "memory";
process.env.SANDBOX_PROVIDER = "fake";
process.env.AGENT_RUNTIME = "scripted";

const hasDb = process.env.VERIFY_DATABASE === "1" && Boolean(process.env.DATABASE_URL);
const DESTINATION_PROMPT = "write this to the destination crm as a note";

describe.skipIf(!hasDb)("reliable autonomous execution", () => {
  let handles: Awaited<ReturnType<typeof createApp>>;
  const dataDir = mkdtempSync(path.join(tmpdir(), "savingroup-reliability-"));
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    const { createApp } = await import("../../../apps/api/src/app.ts");
    handles = await createApp({
      databaseUrl: process.env.DATABASE_URL!,
      dataDir,
      sandboxProvider: "fake",
      agentRuntime: "scripted",
      wakeupDriver: "memory",
      defaultProvider: "scripted",
      defaultModel: "scripted",
    });
  });

  afterAll(async () => {
    await handles?.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const trace = (cookie: string, runId: string) =>
    rpc<RunTrace>(handles, cookie, "runs/trace", { runId });

  it("gates a side effect on approval, executes it once, and suppresses a replay", async () => {
    const actor = await createActor(handles, `approve-${stamp}`);
    await requireApprovalFor(handles, actor, "destination.write");
    const recordsBefore = handles.connector.records.length;

    const runId = await sendMessage(handles, actor, DESTINATION_PROMPT);
    await waitForThread(handles, actor, (snapshot) => snapshot.run?.status === "waiting_input");
    expect(handles.connector.records).toHaveLength(recordsBefore);

    const paused = await trace(actor.cookie, runId);
    expect(paused.status).toBe("waiting_input");
    expect(paused.attempts.map((attempt) => attempt.status)).toEqual(["waiting_input"]);
    expect(paused.effects).toEqual([
      expect.objectContaining({ kind: "destination.write", status: "intended" }),
    ]);
    expect(paused.steps).toContainEqual(
      expect.objectContaining({ name: "destination.write", attemptFence: 1, outcome: "paused" }),
    );
    expect(paused.events.map((event) => event.type)).toEqual(["run.started", "run.waiting_input"]);
    expect(paused.summary.effects).toMatchObject({ executed: 0, pending: 1 });

    const { approvalEffectId } = await answerApproval(handles, actor, runId, "allow");
    await waitForRun(handles, runId, (run) => isTerminalStatus(run.status));
    expect(handles.connector.records).toHaveLength(recordsBefore + 1);

    const completed = await trace(actor.cookie, runId);
    expect(completed.status).toBe("completed");
    expect(completed.attempts.map((attempt) => [attempt.fence, attempt.status])).toEqual([
      [1, "waiting_input"],
      [2, "completed"],
    ]);
    expect(completed.effects).toEqual([
      expect.objectContaining({ id: approvalEffectId, status: "completed" }),
    ]);
    // The resumed attempt repeats the call; it is matched to the approved record and
    // executed from there, so one reconciliation and one execution.
    expect(completed.summary).toMatchObject({
      attempts: 2,
      unfinishedAttempts: 0,
      failedToolCalls: 0,
      effects: { executed: 1, reconciled: 1, denied: 0, uncertain: 0, pending: 0 },
    });
    expect(completed.completedAt).not.toBeNull();

    // A worker that died right after the write, before its terminal commit, leaves a
    // running row with an expired lease. The reclaim replays the turn and must not
    // write twice: the stored effect answers the repeated call.
    await handles.prisma.run.update({
      where: { id: runId },
      data: {
        status: "running",
        completedAt: null,
        leaseOwner: "dead-worker",
        leaseExpiresAt: new Date(Date.now() - 60_000),
      },
    });
    await handles.executor.continueRun(runId, `replay-${stamp}`);
    expect(handles.connector.records).toHaveLength(recordsBefore + 1);
    const replayed = await trace(actor.cookie, runId);
    expect(replayed.status).toBe("completed");
    expect(replayed.attempts.map((attempt) => [attempt.fence, attempt.status])).toEqual([
      [1, "waiting_input"],
      [2, "completed"],
      [3, "completed"],
    ]);
    expect(replayed.summary.effects).toMatchObject({ executed: 1, reconciled: 2 });
    expect(replayed.summary.toolCalls).toBe(3);
  });

  it("records a denied approval and performs nothing", async () => {
    const actor = await createActor(handles, `deny-${stamp}`);
    await requireApprovalFor(handles, actor, "destination.write");
    const recordsBefore = handles.connector.records.length;

    const runId = await sendMessage(handles, actor, DESTINATION_PROMPT);
    await answerApproval(handles, actor, runId, "deny");
    const run = await waitForRun(handles, runId, (current) => isTerminalStatus(current.status));

    expect(run.status).toBe("completed");
    expect(handles.connector.records).toHaveLength(recordsBefore);
    const denied = await trace(actor.cookie, runId);
    expect(denied.effects).toEqual([expect.objectContaining({ status: "denied" })]);
    expect(denied.summary.effects).toMatchObject({ executed: 0, denied: 1 });
  });

  it("stops a run once its recovery budget is spent instead of reclaiming it forever", async () => {
    const actor = await createActor(handles, `budget-${stamp}`);
    const recordsBefore = handles.connector.records.length;
    const interrupted = Array.from({ length: MAX_UNFINISHED_RUN_ATTEMPTS }, () => ({
      status: "interrupted",
    }));
    const runId = await seedAbandonedRun(handles, actor, DESTINATION_PROMPT, interrupted);

    await handles.executor.continueRun(runId, `recovery-${stamp}`);

    const run = await handles.prisma.run.findUniqueOrThrow({ where: { id: runId } });
    expect(run).toMatchObject({
      status: "failed",
      error: runRecoveryExhaustedMessage(MAX_UNFINISHED_RUN_ATTEMPTS),
      leaseOwner: null,
    });
    expect(handles.connector.records).toHaveLength(recordsBefore);
    const stopped = await trace(actor.cookie, runId);
    expect(stopped.attempts).toHaveLength(MAX_UNFINISHED_RUN_ATTEMPTS + 1);
    expect(stopped.attempts.at(-1)).toMatchObject({
      fence: MAX_UNFINISHED_RUN_ATTEMPTS + 1,
      status: "failed",
      error: run.error,
    });
    expect(stopped.events.map((event) => event.type)).toContain("run.failed");
    expect(stopped.summary).toMatchObject({ toolCalls: 0, unfinishedAttempts: 0 });
    expect(
      (await handles.prisma.task.findUniqueOrThrow({ where: { id: run.taskId } })).status,
    ).toBe("failed");

    // The budget is terminal for the reconciler too: the run no longer matches a reclaim.
    await handles.executor.continueRun(runId, `late-${stamp}`);
    expect(await handles.prisma.attempt.count({ where: { runId } })).toBe(
      MAX_UNFINISHED_RUN_ATTEMPTS + 1,
    );
  });

  it("still recovers a run that is one attempt under the budget", async () => {
    const actor = await createActor(handles, `under-${stamp}`);
    const recordsBefore = handles.connector.records.length;
    const interrupted = Array.from({ length: MAX_UNFINISHED_RUN_ATTEMPTS - 1 }, () => ({
      status: "interrupted",
    }));
    const runId = await seedAbandonedRun(handles, actor, DESTINATION_PROMPT, interrupted);

    await handles.executor.continueRun(runId, `recovery-${stamp}`);

    const run = await handles.prisma.run.findUniqueOrThrow({ where: { id: runId } });
    expect(run).toMatchObject({ status: "completed", error: null });
    expect(handles.connector.records).toHaveLength(recordsBefore + 1);
    const recovered = await trace(actor.cookie, runId);
    expect(recovered.attempts.at(-1)).toMatchObject({
      fence: MAX_UNFINISHED_RUN_ATTEMPTS,
      status: "completed",
    });
    expect(recovered.summary).toMatchObject({ unfinishedAttempts: 0, toolCalls: 1 });
  });

  it("does not spend the budget on transient setup waits or on earlier paused turns", async () => {
    const actor = await createActor(handles, `transient-${stamp}`);
    const history = [
      { status: "interrupted" },
      { status: "interrupted" },
      { status: "interrupted" },
      // The run paused for a person here, which resets the count.
      { status: "waiting_input" },
      // A busy computer leaves no error and is not a crash.
      ...Array.from({ length: MAX_UNFINISHED_RUN_ATTEMPTS }, () => ({
        status: "setup_failed",
        error: null,
      })),
      { status: "interrupted" },
    ];
    const runId = await seedAbandonedRun(handles, actor, DESTINATION_PROMPT, history);

    await handles.executor.continueRun(runId, `recovery-${stamp}`);

    const run = await handles.prisma.run.findUniqueOrThrow({ where: { id: runId } });
    expect(run).toMatchObject({ status: "completed", error: null });
  });

  it("hides a run's trace from an account that cannot read its thread", async () => {
    const owner = await createActor(handles, `owner-${stamp}`);
    const other = await createActor(handles, `other-${stamp}`);
    const runId = await sendMessage(handles, owner, "say hello");
    await waitForRun(handles, runId, (run) => isTerminalStatus(run.status));

    await expect(trace(owner.cookie, runId)).resolves.toMatchObject({ runId });
    await expect(trace(other.cookie, runId)).rejects.toThrow(/404|not found/i);
  });
});
