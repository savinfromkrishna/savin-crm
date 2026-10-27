import type { ComputerStatus, RunStatus } from "@savingroup/contracts";
import { isActive } from "./run-state.js";

export function userHoldsComputerControl(
  computer: Pick<ComputerStatus, "controlHolder" | "controlBotId"> | null | undefined,
  botId: string | undefined,
): boolean {
  return Boolean(botId && computer?.controlHolder === "user" && computer.controlBotId === botId);
}

/** True when a live bot run is blocking Take control (API would return 409). */
export function computerTakeoverBlocked(
  computer: Pick<ComputerStatus, "busyBotName"> | null | undefined,
  runStatus?: string | null,
): boolean {
  if (!computer?.busyBotName) return false;
  // waiting_takeover is the bot asking for control; terminal/idle clears the block even if
  // busyBotName is briefly stale while the executor still holds the lease in finally.
  if (!runStatus || runStatus === "waiting_takeover") return false;
  return isActive(runStatus as RunStatus);
}

/** Whole seconds left on the user's control lease, or null when there is none to show. */
export function takeoverSecondsLeft(
  expiresAt: string | null | undefined,
  now = Date.now(),
): number | null {
  if (!expiresAt) return null;
  const end = Date.parse(expiresAt);
  if (Number.isNaN(end)) return null;
  return Math.max(0, Math.ceil((end - now) / 1000));
}

export function formatTakeoverTimeLeft(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
