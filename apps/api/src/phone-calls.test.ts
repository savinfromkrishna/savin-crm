import { describe, expect, it } from "vitest";
import {
  defaultPhoneGreeting,
  END_CALL_TOKEN,
  parsePhoneCallReply,
  renderPhoneCallInstructions,
  renderPhoneCallPrompt,
} from "./phone-calls.js";

const brief = {
  purpose: "Confirm the table for two at seven.",
  instructions: "Ask for a window seat.",
  greeting: "",
  callerName: "Sam",
  language: "en-US",
};

describe("phone call speaker", () => {
  it("strips the end marker and markdown from the spoken line", () => {
    expect(parsePhoneCallReply(`**Great**, see you at seven. Goodbye! ${END_CALL_TOKEN}`)).toEqual({
      reply: "Great, see you at seven. Goodbye!",
      endCall: true,
    });
    expect(parsePhoneCallReply("Could you repeat the time?")).toEqual({
      reply: "Could you repeat the time?",
      endCall: false,
    });
  });

  it("briefs the model with the goal, the guidance, and the untrusted-speech rule", () => {
    const text = renderPhoneCallInstructions({ botName: "Ada", brief });
    expect(text).toContain("on behalf of Sam");
    expect(text).toContain(brief.purpose);
    expect(text).toContain(brief.instructions);
    expect(text).toContain("untrusted");
    expect(text).toContain(END_CALL_TOKEN);
    expect(text).toContain("Speak en-US");
  });

  it("renders the transcript with roles and keeps only recent turns", () => {
    const turns = Array.from({ length: 50 }, (_, index) => ({
      role: index % 2 ? ("callee" as const) : ("bot" as const),
      text: `line ${index}`,
      at: "2026-10-17T00:00:00.000Z",
    }));
    const prompt = renderPhoneCallPrompt(turns);
    expect(prompt).not.toContain("line 0");
    expect(prompt).toContain("Callee: line 49");
    expect(prompt).toContain("You: line 48");
    expect(renderPhoneCallPrompt([])).toContain("just picked up");
  });

  it("uses the requested greeting or a plain default", () => {
    expect(defaultPhoneGreeting("Ada", brief)).toBe("Hi, this is Ada calling on behalf of Sam.");
    expect(defaultPhoneGreeting("Ada", { ...brief, greeting: " Hello there. " })).toBe(
      "Hello there.",
    );
  });
});
