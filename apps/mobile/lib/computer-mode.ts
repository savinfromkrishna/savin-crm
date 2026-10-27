import type { ComputerMode, ComputerStatus } from "@savingroup/contracts";
import { userHoldsComputerControl } from "@savingroup/core";
import { rpc } from "./api";
import { COMPUTER_LIFECYCLE_TIMEOUT_MS } from "./computer";

/**
 * Move a bot between the Team and its Private computer. The server refuses while the user
 * holds control, so that control is handed back first; a bot waiting on it is told it was
 * skipped. Resolves false when `isCurrent` turned false after the release and nothing switched.
 */
export async function switchComputerMode(
  botId: string,
  mode: ComputerMode,
  computer: ComputerStatus | null,
  isCurrent: () => boolean = () => true,
): Promise<boolean> {
  if (userHoldsComputerControl(computer, botId)) {
    await rpc("computer/release", {
      botId,
      reason: computer?.takeoverRequested ? "skipped" : undefined,
    });
    if (!isCurrent()) return false;
  }
  await rpc("bots/setComputer", { botId, mode }, { timeoutMs: COMPUTER_LIFECYCLE_TIMEOUT_MS });
  return true;
}
