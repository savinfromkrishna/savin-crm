import { describe, expect, it } from "vitest";
import {
  countUnfinishedRunAttempts,
  isUnfinishedRunAttempt,
  MAX_UNFINISHED_RUN_ATTEMPTS,
  runRecoveryExhausted,
  runRecoveryExhaustedMessage,
} from "./run-recovery.js";

const attempt = (fence: number, status: string, error: string | null = null) => ({
  fence,
  status,
  error,
});

describe("run recovery budget", () => {
  it("counts interrupted attempts and stale running rows from dead workers", () => {
    const attempts = [
      attempt(1, "interrupted"),
      attempt(2, "running"),
      attempt(3, "setup_failed", "Run setup failed; retrying"),
    ];
    expect(countUnfinishedRunAttempts(attempts, 4)).toBe(3);
  });

  it("ignores the live attempt and anything at or above the current fence", () => {
    expect(isUnfinishedRunAttempt(attempt(4, "running"), 4)).toBe(false);
    expect(countUnfinishedRunAttempts([attempt(4, "running"), attempt(5, "running")], 4)).toBe(0);
  });

  it("does not count transient setup waits that left no error", () => {
    expect(isUnfinishedRunAttempt(attempt(1, "setup_failed", null), 2)).toBe(false);
    expect(
      countUnfinishedRunAttempts([attempt(1, "setup_failed"), attempt(2, "setup_failed")], 3),
    ).toBe(0);
  });

  it("resets at the last attempt where the run paused or answered", () => {
    const attempts = [
      attempt(1, "interrupted"),
      attempt(2, "interrupted"),
      attempt(3, "waiting_input"),
      attempt(4, "interrupted"),
      attempt(5, "waiting_takeover"),
      attempt(6, "interrupted"),
    ];
    expect(countUnfinishedRunAttempts(attempts, 7)).toBe(1);
  });

  it("orders by fence rather than by array position", () => {
    const attempts = [
      attempt(3, "interrupted"),
      attempt(1, "completed"),
      attempt(2, "interrupted"),
    ];
    expect(countUnfinishedRunAttempts(attempts, 4)).toBe(2);
  });

  it("exhausts at the budget and not before", () => {
    const below = Array.from({ length: MAX_UNFINISHED_RUN_ATTEMPTS - 1 }, (_, index) =>
      attempt(index + 1, "interrupted"),
    );
    expect(runRecoveryExhausted(below, MAX_UNFINISHED_RUN_ATTEMPTS)).toBe(false);
    const atBudget = [...below, attempt(MAX_UNFINISHED_RUN_ATTEMPTS, "interrupted")];
    expect(runRecoveryExhausted(atBudget, MAX_UNFINISHED_RUN_ATTEMPTS + 1)).toBe(true);
  });

  it("names the attempt count in the stored error", () => {
    expect(runRecoveryExhaustedMessage(5)).toBe(
      "Stopped after 5 interrupted attempts without finishing.",
    );
  });
});
