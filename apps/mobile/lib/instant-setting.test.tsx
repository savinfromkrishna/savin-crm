// @vitest-environment jsdom

import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useInstantSetting } from "./instant-setting";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("useInstantSetting", () => {
  let root: Root;
  let setting: ReturnType<typeof useInstantSetting<string>>;

  function Probe() {
    setting = useInstantSetting("a");
    return null;
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    root = createRoot(document.createElement("div"));
    act(() => root.render(<Probe />));
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  });

  it("shows a change at once and puts the saved value back when it fails", async () => {
    act(() => setting.load("b"));
    const save = deferred();
    let failure: unknown;
    act(() => {
      setting
        .change("c", () => save.promise)
        .catch((error: unknown) => {
          failure = error;
        });
    });
    expect(setting.value).toBe("c");

    await act(async () => save.reject(new Error("offline")));

    expect(setting.value).toBe("b");
    expect(failure).toEqual(new Error("offline"));
  });

  it("leaves a superseded failure to the newer change", async () => {
    const first = deferred();
    const latest = deferred();
    const outcomes: string[] = [];
    act(() => {
      setting
        .change("b", () => first.promise)
        .then(
          () => outcomes.push("first quiet"),
          () => outcomes.push("first reported"),
        );
      setting
        .change("c", () => latest.promise)
        .then(
          () => outcomes.push("latest quiet"),
          () => outcomes.push("latest reported"),
        );
    });

    await act(async () => first.reject(new Error("offline")));
    expect(setting.value).toBe("c");

    await act(async () => latest.resolve());
    expect(setting.value).toBe("c");
    expect(outcomes).toEqual(["first quiet", "latest quiet"]);
  });

  it("falls back to the newest successful save when saves finish out of order", async () => {
    const first = deferred();
    const second = deferred();
    const third = deferred();
    act(() => {
      void setting.change("b", () => first.promise);
      void setting.change("c", () => second.promise);
    });
    await act(async () => second.resolve());
    await act(async () => first.resolve());

    act(() => {
      setting.change("d", () => third.promise).catch(() => undefined);
    });
    await act(async () => third.reject(new Error("offline")));

    expect(setting.value).toBe("c");
  });
});
