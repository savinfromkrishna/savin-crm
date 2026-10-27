import { describe, expect, it } from "vitest";
import { computerAccessRequiresApproval } from "./action-approval.js";
import { formatTakeoverTimeLeft, takeoverSecondsLeft } from "./computer-control.js";

describe("takeover time left", () => {
  const now = Date.parse("2026-10-19T12:00:00.000Z");

  it("rounds partial seconds up and stops at zero", () => {
    expect(takeoverSecondsLeft("2026-10-19T12:14:59.200Z", now)).toBe(900);
    expect(takeoverSecondsLeft("2026-10-19T11:59:00.000Z", now)).toBe(0);
  });

  it("has nothing to show without a lease", () => {
    expect(takeoverSecondsLeft(null, now)).toBeNull();
    expect(takeoverSecondsLeft("not a date", now)).toBeNull();
  });

  it("formats minutes and seconds", () => {
    expect(formatTakeoverTimeLeft(900)).toBe("15:00");
    expect(formatTakeoverTimeLeft(65)).toBe("1:05");
    expect(formatTakeoverTimeLeft(0)).toBe("0:00");
  });
});

describe("computer access approvals", () => {
  it.each([
    "computer_act",
    "browser_navigate",
    "browser_act",
    "write_file",
    "shell",
    "open_path",
    "launch_app",
  ])("asks before %s under Ask first", (tool) => {
    expect(computerAccessRequiresApproval("ask", tool)).toBe(true);
    expect(computerAccessRequiresApproval("full", tool)).toBe(false);
  });

  it.each(["computer_observe", "browser_snapshot", "list_files", "read_file", "web_search"])(
    "lets %s run without asking",
    (tool) => {
      expect(computerAccessRequiresApproval("ask", tool)).toBe(false);
    },
  );
});
