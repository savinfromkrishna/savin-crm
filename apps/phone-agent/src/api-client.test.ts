import { describe, expect, it, vi } from "vitest";
import { PhoneCallApi } from "./api-client.js";
import { parsePhoneAgentMetadata } from "./metadata.js";

const metadata = {
  callId: "call-1",
  apiUrl: "http://api.internal:3100",
  token: "per-call-token-0123456789",
};

describe("phone agent job metadata", () => {
  it("accepts the dispatch payload and rejects anything else", () => {
    expect(parsePhoneAgentMetadata(JSON.stringify(metadata))).toEqual(metadata);
    expect(parsePhoneAgentMetadata(JSON.stringify({ callId: "x" }))).toBeNull();
    expect(parsePhoneAgentMetadata("not json")).toBeNull();
    expect(parsePhoneAgentMetadata(undefined)).toBeNull();
  });
});

describe("phone call api client", () => {
  it("addresses the call's endpoints with its bearer token and never follows redirects", async () => {
    const fetchMock = vi.fn(async (input: URL | string, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/turn")) {
        return Response.json({ reply: "See you at seven.", endCall: true });
      }
      if (url.endsWith("/speak")) {
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "audio/mpeg; charset=binary" },
        });
      }
      if (url.endsWith("/transcribe")) return Response.json({ text: "hello" });
      return Response.json({ ok: true, greeting: "Hi" });
    });
    const api = new PhoneCallApi(metadata, fetchMock as unknown as typeof fetch);

    await expect(api.turn("yes")).resolves.toEqual({ reply: "See you at seven.", endCall: true });
    const clip = await api.speak("Hello");
    expect(clip.mimeType).toBe("audio/mpeg");
    expect([...clip.bytes]).toEqual([1, 2, 3]);
    await expect(api.transcribe(new Uint8Array([0, 1]), "en-US")).resolves.toBe("hello");
    await api.ended({ status: "completed", endReason: "callee_hung_up" });

    for (const [input, init] of fetchMock.mock.calls) {
      expect(
        String(input).startsWith("http://api.internal:3100/api/internal/phone-calls/call-1"),
      ).toBe(true);
      expect(init?.redirect).toBe("error");
      expect((init?.headers as Record<string, string> | undefined)?.authorization).toBe(
        `Bearer ${metadata.token}`,
      );
    }
    const transcribeBody = JSON.parse(String(fetchMock.mock.calls[2]![1]?.body));
    expect(transcribeBody).toMatchObject({ mimeType: "audio/wav", language: "en-US" });
  });

  it("fails on a non-2xx status without exposing the body", async () => {
    const api = new PhoneCallApi(
      metadata,
      (async () => new Response("secret details", { status: 401 })) as unknown as typeof fetch,
    );
    await expect(api.brief()).rejects.toThrow(/returned 401/);
    await expect(api.brief()).rejects.not.toThrow(/secret details/);
  });
});
