import { describe, expect, it } from "vitest";
import {
  BUILTIN_TOOL_NAMES,
  COMPUTER_TOOL_GROUPS,
  COMPUTER_TOOL_NAMES,
  computerToolGroupEnabled,
  isComputerToolGroupName,
  setComputerToolGroup,
} from "./builtin-tools.js";

describe("computer tool groups", () => {
  it("only names real built-in tools", () => {
    const builtins: readonly string[] = BUILTIN_TOOL_NAMES;
    for (const name of COMPUTER_TOOL_NAMES) expect(builtins).toContain(name);
  });

  it("puts each computer tool in one group", () => {
    const grouped = Object.values(COMPUTER_TOOL_GROUPS).flat();
    expect(new Set(grouped).size).toBe(grouped.length);
    expect(isComputerToolGroupName("shell")).toBe(true);
    expect(isComputerToolGroupName("web_search")).toBe(false);
  });

  it("switches a whole group and keeps unrelated disabled tools", () => {
    const off = setComputerToolGroup(["web_search"], "browser", false);
    expect(off).toEqual(["web_search", "browser_navigate", "browser_snapshot", "browser_act"]);
    expect(computerToolGroupEnabled(off, "browser")).toBe(false);
    expect(computerToolGroupEnabled(off, "shell")).toBe(true);
    expect(setComputerToolGroup(off, "browser", true)).toEqual(["web_search"]);
  });

  it("treats a partly disabled group as off and turns it fully back on", () => {
    expect(computerToolGroupEnabled(["computer_act"], "screen")).toBe(false);
    expect(setComputerToolGroup(["computer_act"], "screen", true)).toEqual([]);
  });
});
