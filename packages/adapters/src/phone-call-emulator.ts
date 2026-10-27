import type {
  AdapterContext,
  AdapterDescriptor,
  PhoneCallCapabilities,
  PhoneCallHandle,
  PhoneCallPlaceRequest,
  PhoneCallProvider,
  PhoneCallSnapshot,
  PhoneCallTurn,
} from "@savingroup/adapter-kit";
import { PhoneCallRequestRejected } from "@savingroup/adapter-kit";

export const EMULATOR_CALLEE_LINE = "Hello, this is the front desk.";
export const EMULATOR_BOT_LINE = "Hi, I am calling on behalf of a customer to confirm a booking.";

interface EmulatedCall {
  request: PhoneCallPlaceRequest;
  snapshot: PhoneCallSnapshot;
  gets: number;
}

/**
 * In-process phone provider for tests and Playwright. Calls ring, are answered
 * with a two-line scripted exchange, and complete after a few polls unless a
 * test drives them by hand with answer(), say() and complete().
 */
export class EmulatorPhoneCallProvider implements PhoneCallProvider {
  private readonly calls = new Map<string, EmulatedCall>();
  private readonly byKey = new Map<string, string>();
  private counter = 0;

  constructor(private readonly options: { autoFinishAfterGets?: number | null } = {}) {}

  describe(): AdapterDescriptor<PhoneCallCapabilities> {
    return {
      id: "emulator",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { outbound: true, offline: true },
    };
  }

  async place(request: PhoneCallPlaceRequest, context: AdapterContext): Promise<PhoneCallHandle> {
    context.signal.throwIfAborted();
    const existing = this.byKey.get(request.idempotencyKey);
    if (existing) return { id: existing };
    if (request.to.endsWith("0000")) {
      throw new PhoneCallRequestRejected("That number cannot be dialed.");
    }
    this.counter += 1;
    const id = `emulated-call-${this.counter}`;
    this.byKey.set(request.idempotencyKey, id);
    this.calls.set(id, { request, snapshot: { id, status: "ringing", transcript: [] }, gets: 0 });
    return { id };
  }

  async get(id: string, context: AdapterContext): Promise<PhoneCallSnapshot> {
    context.signal.throwIfAborted();
    const call = this.calls.get(id);
    if (!call) return { id, status: "failed", endReason: "unknown_call" };
    call.gets += 1;
    const auto = this.options.autoFinishAfterGets;
    if (auto !== null) {
      const limit = auto ?? 2;
      if (call.gets === 1 && call.snapshot.status === "ringing") this.answer(id);
      if (call.gets >= limit && call.snapshot.status === "in_progress") {
        this.say(id, "bot", call.request.brief.greeting || EMULATOR_BOT_LINE);
        this.say(id, "callee", EMULATOR_CALLEE_LINE);
        this.complete(id, { summary: "The callee confirmed the request." });
      }
    }
    return structuredClone(call.snapshot);
  }

  async hangup(id: string, context: AdapterContext): Promise<PhoneCallSnapshot> {
    context.signal.throwIfAborted();
    const call = this.calls.get(id);
    if (!call) return { id, status: "failed", endReason: "unknown_call" };
    if (!isTerminal(call.snapshot.status)) {
      call.snapshot = { ...call.snapshot, status: "cancelled", endReason: "hung_up" };
    }
    return structuredClone(call.snapshot);
  }

  /** Test control: the callee picks up. */
  answer(id: string) {
    const call = this.calls.get(id);
    if (call && call.snapshot.status === "ringing") call.snapshot.status = "in_progress";
  }

  /** Test control: a line is spoken on the call. */
  say(id: string, role: PhoneCallTurn["role"], text: string) {
    const call = this.calls.get(id);
    if (!call) return;
    call.snapshot.transcript = [
      ...(call.snapshot.transcript ?? []),
      { role, text, at: new Date().toISOString() },
    ];
  }

  /** Test control: the call ends. */
  complete(
    id: string,
    outcome: { status?: PhoneCallSnapshot["status"]; endReason?: string; summary?: string } = {},
  ) {
    const call = this.calls.get(id);
    if (!call || isTerminal(call.snapshot.status)) return;
    call.snapshot = {
      ...call.snapshot,
      status: outcome.status ?? "completed",
      endReason: outcome.endReason ?? "callee_hung_up",
      ...(outcome.summary ? { summary: outcome.summary } : {}),
    };
  }
}

function isTerminal(status: PhoneCallSnapshot["status"]) {
  return status !== "queued" && status !== "ringing" && status !== "in_progress";
}
