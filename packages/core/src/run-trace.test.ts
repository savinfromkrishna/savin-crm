import { describe, expect, it } from "vitest";
import { assembleRunTrace } from "./run-trace.js";

const at = (offsetMs: number) => new Date(Date.UTC(2026, 9, 12, 12, 0, 0, offsetMs));

const run = {
  id: "run-1",
  status: "completed",
  trigger: "user",
  error: null,
  leaseFence: 2,
  createdAt: at(0),
  startedAt: at(10),
  completedAt: at(900),
};

const attempt = (
  id: string,
  fence: number,
  status: string,
  startedAt: Date,
  finishedAt: Date | null,
) => ({ id, fence, status, error: null, startedAt, finishedAt });

const called = (seq: number, createdAt: Date, name: string, executionId: string) => ({
  seq,
  type: "agent.tool.called",
  createdAt,
  payload: { name, executionId },
});

const completed = (
  seq: number,
  createdAt: Date,
  name: string,
  executionId: string,
  extra: Record<string, unknown>,
) => ({ seq, type: "agent.tool.completed", createdAt, payload: { name, executionId, ...extra } });

describe("assembleRunTrace", () => {
  it("joins tool call and completion events into steps with their attempt", () => {
    const trace = assembleRunTrace({
      run,
      attempts: [
        attempt("a1", 1, "waiting_input", at(10), at(300)),
        attempt("a2", 2, "completed", at(500), at(900)),
      ],
      events: [
        { seq: 1, type: "run.started", createdAt: at(10), payload: {} },
        called(2, at(100), "read_file", "x1"),
        completed(3, at(150), "read_file", "x1", { durationMs: 48.6, outcome: "succeeded" }),
        called(4, at(200), "destination.write", "x2"),
        { seq: 5, type: "effect.recorded", createdAt: at(201), payload: {} },
        completed(6, at(210), "destination.write", "x2", { durationMs: 5, outcome: "paused" }),
        { seq: 7, type: "run.waiting_input", createdAt: at(300), payload: {} },
        called(8, at(600), "destination.write", "x3"),
        completed(9, at(650), "destination.write", "x3", {
          durationMs: 20,
          outcome: "error",
          error: { message: "rejected" },
        }),
        { seq: 10, type: "run.completed", createdAt: at(900), payload: {} },
      ],
      effects: [
        {
          id: "e1",
          kind: "destination.write",
          status: "completed",
          reviewDecision: null,
          createdAt: at(201),
          updatedAt: at(640),
        },
      ],
    });

    expect(trace.steps).toEqual([
      expect.objectContaining({
        executionId: "x1",
        name: "read_file",
        attemptFence: 1,
        durationMs: 49,
        outcome: "succeeded",
      }),
      expect.objectContaining({ executionId: "x2", attemptFence: 1, outcome: "paused" }),
      expect.objectContaining({
        executionId: "x3",
        attemptFence: 2,
        outcome: "error",
        error: "rejected",
      }),
    ]);
    expect(trace.events.map((event) => event.type)).toEqual([
      "run.started",
      "effect.recorded",
      "run.waiting_input",
      "run.completed",
    ]);
    expect(trace.summary).toEqual({
      attempts: 2,
      unfinishedAttempts: 0,
      toolCalls: 3,
      failedToolCalls: 1,
      effects: { executed: 1, reconciled: 0, denied: 0, uncertain: 0, pending: 0 },
    });
    expect(trace.startedAt).toBe(at(10).toISOString());
  });

  it("keeps a replayed tool-call id apart per attempt", () => {
    const trace = assembleRunTrace({
      run,
      attempts: [
        attempt("a1", 1, "waiting_input", at(10), at(300)),
        attempt("a2", 2, "completed", at(500), at(900)),
      ],
      events: [
        called(1, at(100), "destination.write", "same-id"),
        completed(2, at(120), "destination.write", "same-id", { durationMs: 5, outcome: "paused" }),
        called(3, at(600), "destination.write", "same-id"),
        completed(4, at(640), "destination.write", "same-id", {
          durationMs: 7,
          outcome: "succeeded",
        }),
      ],
      effects: [],
    });
    expect(trace.steps.map((step) => [step.attemptFence, step.outcome])).toEqual([
      [1, "paused"],
      [2, "succeeded"],
    ]);
    expect(trace.summary.toolCalls).toBe(2);
  });

  it("marks calls without a completion as running or interrupted by run state", () => {
    const events = [called(1, at(100), "shell", "s1")];
    const attempts = [attempt("a1", 1, "running", at(10), null)];
    const running = assembleRunTrace({
      run: { ...run, status: "running", leaseFence: 1 },
      attempts,
      events,
      effects: [],
    });
    expect(running.steps[0]?.outcome).toBe("running");
    const failed = assembleRunTrace({
      run: { ...run, status: "failed", leaseFence: 1 },
      attempts,
      events,
      effects: [],
    });
    expect(failed.steps[0]?.outcome).toBe("interrupted");
  });

  it("counts reconciled effects and the tail of unfinished attempts", () => {
    const effect = (id: string, status: string, reviewDecision: string | null) => ({
      id,
      kind: "destination.write",
      status,
      reviewDecision,
      createdAt: at(Number(id.slice(1))),
      updatedAt: at(Number(id.slice(1)) + 1),
    });
    const trace = assembleRunTrace({
      run: { ...run, status: "running", leaseFence: 3 },
      attempts: [
        attempt("a1", 1, "interrupted", at(10), at(20)),
        attempt("a2", 2, "interrupted", at(30), at(40)),
        attempt("a3", 3, "running", at(50), null),
      ],
      events: [
        {
          seq: 1,
          type: "effect.reconciled",
          createdAt: at(60),
          payload: { executionId: "k", kind: "destination.write" },
        },
      ],
      effects: [
        effect("e3", "intended", null),
        effect("e1", "denied", "ask"),
        effect("e2", "uncertain", null),
      ],
    });
    expect(trace.summary.unfinishedAttempts).toBe(2);
    expect(trace.summary.effects).toEqual({
      executed: 0,
      reconciled: 1,
      denied: 1,
      uncertain: 1,
      pending: 1,
    });
    expect(trace.effects.map((item) => item.id)).toEqual(["e1", "e2", "e3"]);
  });
});
