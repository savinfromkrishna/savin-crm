/**
 * Crash recovery is unbounded by construction: an expired lease is reclaimed with a
 * higher fence and the attempt starts over. A run that takes the worker down every
 * time (or whose setup keeps failing for a non-transient reason) would otherwise be
 * retried forever on the reconciler's schedule. This budget stops that run once
 * enough consecutive attempts ended without reaching a pause, a reply, or a stop.
 */
export const MAX_UNFINISHED_RUN_ATTEMPTS = 5;

export type RunAttemptOutcome = {
  fence: number;
  status: string;
  error: string | null;
};

/** Attempt states that mean the run moved: it answered, paused for a person, or was stopped. */
const PROGRESS_ATTEMPT_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "waiting_input",
  "waiting_takeover",
]);

/**
 * Whether one earlier attempt ended without the run moving. `interrupted` is a worker
 * that shut down mid-run; `setup_failed` with an error is a non-transient setup fault
 * (a transient wait on a busy computer leaves the error empty and does not count);
 * `running` under a lower fence is a worker that died before it could clean up.
 */
export function isUnfinishedRunAttempt(attempt: RunAttemptOutcome, currentFence: number): boolean {
  if (attempt.status === "interrupted") return true;
  if (attempt.status === "setup_failed") return Boolean(attempt.error);
  if (attempt.status === "running") return attempt.fence < currentFence;
  return false;
}

/**
 * Consecutive unfinished attempts before `currentFence`, newest first, stopping at the
 * last attempt where the run made progress. A long task that pauses for approval
 * several times is not penalised for an occasional restart in between.
 */
export function countUnfinishedRunAttempts(
  attempts: readonly RunAttemptOutcome[],
  currentFence: number,
): number {
  const earlier = attempts
    .filter((attempt) => attempt.fence < currentFence)
    .sort((left, right) => right.fence - left.fence);
  let count = 0;
  for (const attempt of earlier) {
    if (PROGRESS_ATTEMPT_STATUSES.has(attempt.status)) break;
    if (isUnfinishedRunAttempt(attempt, currentFence)) count += 1;
  }
  return count;
}

export function runRecoveryExhausted(
  attempts: readonly RunAttemptOutcome[],
  currentFence: number,
  budget = MAX_UNFINISHED_RUN_ATTEMPTS,
): boolean {
  return countUnfinishedRunAttempts(attempts, currentFence) >= budget;
}

/** Stored as the run's error and shown where other failures appear. */
export function runRecoveryExhaustedMessage(unfinishedAttempts: number): string {
  return `Stopped after ${unfinishedAttempts} interrupted attempts without finishing.`;
}
