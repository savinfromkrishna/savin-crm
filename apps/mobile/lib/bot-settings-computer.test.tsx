// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, createElement, useEffect } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BotSettingsScreen from "../app/bot-settings";

const rpc = vi.hoisted(() => vi.fn());
const back = vi.hoisted(() => vi.fn());

vi.mock("./api", () => ({ rpc }));
vi.mock("./bot-voices", () => ({
  voiceLabel: () => "",
  deviceVoices: async () => [],
  voiceForBot: async () => undefined,
  setVoiceForBot: async () => undefined,
}));
vi.mock("./device-voice", () => ({ loadDeviceVoiceEnabled: async () => false }));
vi.mock("./voice", () => ({ stopVoicePlayback: () => undefined }));
vi.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ back }),
  useLocalSearchParams: () => ({ botId: "bot-1" }),
  useFocusEffect: (effect: () => (() => void) | undefined) => useEffect(effect, [effect]),
}));
vi.mock("react-native", () => {
  const view = ({ children }: { children?: ReactNode }) => createElement("div", null, children);
  return {
    Alert: { alert: () => undefined },
    StyleSheet: { create: (styles: unknown) => styles },
    ScrollView: view,
    View: view,
    Text: ({ children }: { children?: ReactNode }) => createElement("span", null, children),
    TextInput: () => null,
    Pressable: ({ children, onPress }: { children?: ReactNode; onPress: () => void }) =>
      createElement("button", { type: "button", onClick: onPress }, children),
  };
});
vi.mock("./native", () => ({
  native: { fill: "fill", tertiaryLabel: "muted" },
  useMobileTokens: () => ({ mutedForeground: "muted", foreground: "ink", destructive: "error" }),
}));
vi.mock("./i18n", () => {
  const t = (text: string) => text;
  return { t, useI18n: () => ({ t }) };
});
vi.mock("../components/bot-avatar", () => ({ BotAvatar: () => null }));
vi.mock("../components/glass-title", () => ({ glassHeaderOptions: () => ({}) }));
vi.mock("../components/menu-picker", () => ({
  MenuPicker: () => null,
  MenuPickerMenu: () => null,
}));
vi.mock("../components/native-symbol", () => ({ NativeSymbol: () => null }));
vi.mock("../components/row-accessories", () => ({ Chevron: () => null }));
vi.mock("../components/native-action-button", () => ({
  NativeActionButton: (props: { label: string; onPress: () => void }) =>
    createElement("button", { type: "button", onClick: props.onPress }, props.label),
}));
vi.mock("../components/native-segmented-control", () => ({
  NativeSegmentedControl: (props: {
    accessibilityLabel: string;
    value?: string;
    disabled?: boolean;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
  }) =>
    createElement(
      "fieldset",
      {
        "aria-label": props.accessibilityLabel,
        "data-value": props.value,
        "data-disabled": String(Boolean(props.disabled)),
      },
      props.options.map((option) =>
        createElement(
          "button",
          { key: option.value, type: "button", onClick: () => props.onChange(option.value) },
          option.label,
        ),
      ),
    ),
}));
vi.mock("../components/native-switch", () => ({
  NativeSwitch: (props: {
    accessibilityLabel: string;
    value: boolean;
    onValueChange: (value: boolean) => void;
  }) =>
    createElement("button", {
      type: "button",
      role: "switch",
      "aria-label": props.accessibilityLabel,
      "aria-checked": String(props.value),
      onClick: () => props.onValueChange(!props.value),
    }),
}));

const savedBot = {
  id: "bot-1",
  name: "Fixture",
  title: "",
  color: "#111111",
  computerMode: "team",
  computerAccess: "full",
  disabledBuiltinTools: ["shell"],
  autoSpeak: false,
};

const computerStatus = {
  botId: "bot-1",
  controlHolder: "none",
  controlBotId: null,
  takeoverRequested: false,
};

function respond(overrides: Record<string, (input: unknown) => unknown> = {}) {
  rpc.mockImplementation(async (procedure: string, input: unknown) => {
    const override = overrides[procedure];
    if (override) return override(input);
    if (procedure === "bots/get") return savedBot;
    if (procedure === "me") return {};
    if (procedure === "computer/status") return computerStatus;
    if (procedure === "models/list" || procedure === "models/credentials") return [];
    return {};
  });
}

function calls(procedure: string) {
  return rpc.mock.calls.filter(([called]) => called === procedure).map(([, input]) => input);
}

describe("bot settings computer", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    rpc.mockReset();
    back.mockReset();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  });

  const render = async () => act(async () => root.render(<BotSettingsScreen />));
  const control = (label: string) =>
    container.querySelector<HTMLElement>(`fieldset[aria-label="${label}"]`);
  const choose = (label: string, option: string) =>
    act(async () => {
      const button = [...control(label)!.querySelectorAll("button")].find(
        (candidate) => candidate.textContent === option,
      );
      button!.click();
    });
  const toolSwitch = (label: string) =>
    container.querySelector<HTMLElement>(`[role="switch"][aria-label="${label}"]`);
  // The Computer card holds the access choice; other rows have switches of their own.
  const switchStates = () =>
    [
      ...control("Computer access")!.parentElement!.querySelectorAll<HTMLElement>(
        '[role="switch"]',
      ),
    ].map((element) => [element.getAttribute("aria-label"), element.getAttribute("aria-checked")]);

  it("shows access, the computer and its tool groups from the saved bot", async () => {
    respond();
    await render();

    expect(control("Computer access")?.dataset.value).toBe("full");
    expect(control("Computer")?.dataset.value).toBe("team");
    expect(switchStates()).toEqual([
      ["Screen", "true"],
      ["Browser", "true"],
      ["Files", "true"],
      ["Shell", "false"],
    ]);
  });

  it("saves access at once and hides the computer and tools when Off", async () => {
    respond();
    await render();

    await choose("Computer access", "Off");

    expect(calls("bots/update")).toEqual([{ botId: "bot-1", computerAccess: "off" }]);
    expect(control("Computer access")?.dataset.value).toBe("off");
    expect(control("Computer")).toBeNull();
    expect(switchStates()).toEqual([]);

    await choose("Computer access", "Ask first");
    expect(calls("bots/update").at(-1)).toEqual({ botId: "bot-1", computerAccess: "ask" });
    expect(control("Computer")).not.toBeNull();
  });

  it("puts access back and shows the error when saving it fails", async () => {
    respond({
      "bots/update": () => {
        throw new Error("Access is managed by your space");
      },
    });
    await render();

    await choose("Computer access", "Ask first");

    expect(control("Computer access")?.dataset.value).toBe("full");
    expect(container.textContent).toContain("Access is managed by your space");
  });

  it("turns a tool group off and on by saving the disabled tools", async () => {
    respond();
    await render();

    await act(async () => toolSwitch("Browser")!.click());
    expect(calls("bots/update")).toEqual([
      {
        botId: "bot-1",
        disabledBuiltinTools: ["shell", "browser_navigate", "browser_snapshot", "browser_act"],
      },
    ]);
    expect(toolSwitch("Browser")?.getAttribute("aria-checked")).toBe("false");

    await act(async () => toolSwitch("Shell")!.click());
    expect(calls("bots/update").at(-1)).toEqual({
      botId: "bot-1",
      disabledBuiltinTools: ["browser_navigate", "browser_snapshot", "browser_act"],
    });
    expect(toolSwitch("Shell")?.getAttribute("aria-checked")).toBe("true");
  });

  it("puts a tool group back when saving it fails", async () => {
    respond({
      "bots/update": () => {
        throw new Error("Could not reach the tools");
      },
    });
    await render();

    await act(async () => toolSwitch("Files")!.click());

    expect(toolSwitch("Files")?.getAttribute("aria-checked")).toBe("true");
    expect(container.textContent).toContain("Could not reach the tools");
  });

  it("switches the computer on its own, handing back the user's control first", async () => {
    respond({
      "computer/status": () => ({
        ...computerStatus,
        controlHolder: "user",
        controlBotId: "bot-1",
      }),
    });
    await render();

    await choose("Computer", "Private");

    expect(
      rpc.mock.calls
        .filter(
          ([procedure]) => procedure === "computer/release" || procedure === "bots/setComputer",
        )
        .map(([procedure, input]) => [procedure, input]),
    ).toEqual([
      ["computer/release", { botId: "bot-1", reason: undefined }],
      ["bots/setComputer", { botId: "bot-1", mode: "dedicated" }],
    ]);
    expect(control("Computer")?.dataset.value).toBe("dedicated");
    expect(calls("bots/update")).toEqual([]);
  });

  it("keeps the saved computer when switching fails, and Save still works", async () => {
    respond({
      "bots/setComputer": () => {
        throw new Error("Stop the bot first");
      },
    });
    await render();

    await choose("Computer", "Private");

    expect(calls("computer/release")).toEqual([]);
    expect(control("Computer")?.dataset.value).toBe("team");
    expect(control("Computer")?.dataset.disabled).toBe("false");
    expect(container.textContent).toContain("Stop the bot first");

    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Save")!
        .click(),
    );
    expect(back).toHaveBeenCalledOnce();
    expect(calls("bots/setComputer")).toHaveLength(1);
  });
});
