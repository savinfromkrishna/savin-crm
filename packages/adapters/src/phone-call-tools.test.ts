import { describe, expect, it } from "vitest";
import { builtinAgentTools } from "./builtin-tools.js";
import {
  PHONE_CALL_TOOL_NAMES,
  phoneCallPlaceSchema,
  selectPhoneCallTools,
  validPhoneCallArgs,
} from "./phone-call-tools.js";

describe("phone call tool arguments", () => {
  it("accepts an international number with a purpose", () => {
    expect(
      validPhoneCallArgs("phone_call_place", {
        to: "+14155550123",
        purpose: "Confirm the booking",
        maxMinutes: 5,
      }),
    ).toBe(true);
  });

  it("rejects local numbers, empty purposes, out-of-range durations, and unknown keys", () => {
    expect(validPhoneCallArgs("phone_call_place", { to: "4155550123", purpose: "x" })).toBe(false);
    expect(validPhoneCallArgs("phone_call_place", { to: "+14155550123", purpose: "" })).toBe(false);
    expect(
      validPhoneCallArgs("phone_call_place", { to: "+14155550123", purpose: "x", maxMinutes: 90 }),
    ).toBe(false);
    expect(
      validPhoneCallArgs("phone_call_place", { to: "+14155550123", purpose: "x", apiKey: "nope" }),
    ).toBe(false);
  });

  it("trims the number so copied whitespace does not fail the call", () => {
    expect(phoneCallPlaceSchema.parse({ to: " +14155550123 ", purpose: "x" }).to).toBe(
      "+14155550123",
    );
  });

  it("requires an id for status and hang-up", () => {
    expect(validPhoneCallArgs("phone_call_status", { id: "call-1" })).toBe(true);
    expect(validPhoneCallArgs("phone_call_hangup", {})).toBe(false);
  });
});

describe("phone call tool selection", () => {
  it("withholds every phone tool until a provider is configured", () => {
    const names = (tools: { name: string }[]) => tools.map((tool) => tool.name);
    const withoutProvider = names(selectPhoneCallTools(builtinAgentTools, false));
    for (const name of PHONE_CALL_TOOL_NAMES) expect(withoutProvider).not.toContain(name);
    const withProvider = names(selectPhoneCallTools(builtinAgentTools, true));
    for (const name of PHONE_CALL_TOOL_NAMES) expect(withProvider).toContain(name);
    expect(builtinAgentTools.find((tool) => tool.name === "phone_call_status")?.readOnly).toBe(
      true,
    );
  });
});
