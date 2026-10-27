import type {
  AdapterContext,
  PhoneCallPlaceRequest,
  PhoneCallProvider,
} from "@savingroup/adapter-kit";
import { PhoneCallRequestRejected } from "@savingroup/adapter-kit";
import { describe, expect, it } from "vitest";
import { LiveKitPhoneCallProvider, phoneCallRoomName } from "./livekit-phone-call.js";
import { EmulatorPhoneCallProvider } from "./phone-call-emulator.js";
import { createPhoneCallConnection, phoneCallsEnabled } from "./phone-call-factory.js";
import { resolvePhoneCallProvider } from "./phone-call-provider-env.js";
import { LiveKitPhoneCallEmulator } from "./testing/livekit-phone-call-emulator.js";

const ctx: AdapterContext = {
  operationId: "operation",
  traceId: "trace",
  spaceId: "test-space",
  userId: "test-user",
  signal: new AbortController().signal,
};

function request(overrides: Partial<PhoneCallPlaceRequest> = {}): PhoneCallPlaceRequest {
  return {
    idempotencyKey: "call-1",
    callId: "call-1",
    to: "+14155550123",
    brief: {
      purpose: "Confirm the table for two at seven.",
      instructions: "",
      greeting: "Hi, I am calling for Sam.",
      callerName: "Sam",
    },
    maxDurationSec: 600,
    agent: { apiUrl: "http://127.0.0.1:3100", token: "per-call-token" },
    ...overrides,
  };
}

interface Harness {
  provider: PhoneCallProvider;
  answer(id: string): void;
  end(id: string): void;
}

const factories: Record<string, () => Harness> = {
  emulator() {
    const provider = new EmulatorPhoneCallProvider({ autoFinishAfterGets: null });
    return {
      provider,
      answer: (id) => provider.answer(id),
      end: (id) => provider.complete(id, { endReason: "callee_hung_up" }),
    };
  },
  livekit() {
    const wire = new LiveKitPhoneCallEmulator();
    const provider = new LiveKitPhoneCallProvider({
      url: "http://livekit.test",
      apiKey: "fake-key",
      apiSecret: "fake-secret",
      sipTrunkId: "ST_test",
      agentName: "savingroup-phone",
      clients: wire.clients,
    });
    return {
      provider,
      answer: (id) => wire.setCallee(id, "active"),
      end: (id) => wire.closeRoom(id),
    };
  },
};

for (const [name, create] of Object.entries(factories)) {
  describe(`${name} phone call conformance (offline)`, () => {
    it("describes an outbound capability on contract version 1", () => {
      const { provider } = create();
      const descriptor = provider.describe();
      expect(descriptor.contractVersion).toBe("1");
      expect(descriptor.capabilities.outbound).toBe(true);
    });

    it("places once per idempotency key and never dials the callee twice", async () => {
      const { provider } = create();
      const first = await provider.place(request(), ctx);
      const second = await provider.place(request(), ctx);
      expect(second.id).toBe(first.id);
      expect((await provider.get(first.id, ctx)).status).toBe("ringing");
    });

    it("moves from ringing to in progress to a terminal status", async () => {
      const { provider, answer, end } = create();
      const { id } = await provider.place(request(), ctx);
      answer(id);
      expect((await provider.get(id, ctx)).status).toBe("in_progress");
      end(id);
      const snapshot = await provider.get(id, ctx);
      expect(["completed", "no_answer"]).toContain(snapshot.status);
    });

    it("hangs up a live call and reports it cancelled", async () => {
      const { provider, answer } = create();
      const { id } = await provider.place(request(), ctx);
      answer(id);
      expect((await provider.hangup(id, ctx)).status).toBe("cancelled");
    });

    it("rejects a number the trunk cannot dial before any call exists", async () => {
      const { provider } = create();
      await expect(
        provider.place(request({ to: "+14155550000", idempotencyKey: "bad" }), ctx),
      ).rejects.toBeInstanceOf(PhoneCallRequestRejected);
    });

    it("honors abort", async () => {
      const { provider } = create();
      await expect(
        provider.place(request(), { ...ctx, signal: AbortSignal.abort() }),
      ).rejects.toThrow();
    });
  });
}

describe("livekit phone call translation", () => {
  it("dispatches the agent with only the per-call credential and dials with the trunk", async () => {
    const wire = new LiveKitPhoneCallEmulator();
    const provider = new LiveKitPhoneCallProvider({
      url: "http://livekit.test",
      apiKey: "fake-key",
      apiSecret: "fake-secret",
      sipTrunkId: "ST_test",
      agentName: "savingroup-phone",
      clients: wire.clients,
    });
    const { id } = await provider.place(request({ from: "+14155559999" }), ctx);
    expect(id).toBe(phoneCallRoomName("call-1"));
    expect(wire.dispatches).toHaveLength(1);
    const metadata = JSON.parse(wire.dispatches[0]!.metadata ?? "{}");
    expect(metadata).toEqual({
      callId: "call-1",
      apiUrl: "http://127.0.0.1:3100",
      token: "per-call-token",
    });
    expect(JSON.stringify(metadata)).not.toContain("fake-secret");
    expect(wire.dials[0]).toMatchObject({
      trunkId: "ST_test",
      number: "+14155550123",
      room: id,
      options: { fromNumber: "+14155559999", participantIdentity: "callee", maxCallDuration: 600 },
    });
  });

  it("reads the SIP leg state and treats a closed room as ended", async () => {
    const wire = new LiveKitPhoneCallEmulator();
    const provider = new LiveKitPhoneCallProvider({
      url: "http://livekit.test",
      apiKey: "fake-key",
      apiSecret: "fake-secret",
      sipTrunkId: "ST_test",
      agentName: "savingroup-phone",
      clients: wire.clients,
    });
    const { id } = await provider.place(request(), ctx);
    wire.setCallee(id, "ringing");
    expect((await provider.get(id, ctx)).status).toBe("ringing");
    wire.setCallee(id, "active");
    expect((await provider.get(id, ctx)).status).toBe("in_progress");
    wire.closeRoom(id);
    expect(await provider.get(id, ctx)).toMatchObject({
      status: "completed",
      endReason: "room_closed",
    });
    await expect(provider.hangup(id, ctx)).resolves.toMatchObject({ status: "cancelled" });
  });
});

describe("phone call composition", () => {
  it("fails closed without a complete LiveKit configuration", () => {
    for (const source of [
      {},
      { TELEPHONY_PROVIDER: "" },
      { TELEPHONY_PROVIDER: "bogus" },
      { TELEPHONY_PROVIDER: "livekit" },
      { TELEPHONY_PROVIDER: "livekit", LIVEKIT_URL: "http://lk", LIVEKIT_API_KEY: "k" },
    ]) {
      expect(resolvePhoneCallProvider(source)).toBe("none");
      expect(createPhoneCallConnection(source)).toBeNull();
    }
    expect(phoneCallsEnabled(null)).toBe(false);
  });

  it("binds LiveKit rows to a hash of the secret, never the secret", () => {
    const connection = createPhoneCallConnection({
      TELEPHONY_PROVIDER: "livekit",
      LIVEKIT_URL: "http://lk",
      LIVEKIT_API_KEY: "key",
      LIVEKIT_API_SECRET: "very-secret-value",
      LIVEKIT_SIP_TRUNK_ID: "ST_1",
      PHONE_CALL_FROM_NUMBER: "+14155559999",
      API_URL: "http://api.internal:3100",
    });
    expect(connection).not.toBeNull();
    expect(connection!.key.startsWith("livekit:")).toBe(true);
    expect(connection!.key).not.toContain("very-secret-value");
    expect(connection!.fromNumber).toBe("+14155559999");
    expect(connection!.agentApiUrl).toBe("http://api.internal:3100");
    expect(phoneCallsEnabled(connection)).toBe(true);
  });

  it("accepts the emulator under both names", () => {
    expect(resolvePhoneCallProvider({ TELEPHONY_PROVIDER: "fake" })).toBe("emulator");
    const connection = createPhoneCallConnection({ TELEPHONY_PROVIDER: "emulator" });
    expect(connection?.key).toBe("emulator");
    expect(connection?.provider.describe().capabilities.offline).toBe(true);
  });
});
