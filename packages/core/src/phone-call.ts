import type { MessageBlock, PhoneCallStatus } from "@savingroup/contracts";
import { PHONE_CALL_STATUSES } from "@savingroup/contracts";

export function phoneCallStatusValue(value: unknown): PhoneCallStatus {
  return (PHONE_CALL_STATUSES as readonly string[]).includes(String(value))
    ? (value as PhoneCallStatus)
    : "queued";
}

/** Keep the dialing prefix and the last digits: enough to recognise a number, not to dial it. */
export function maskPhoneNumber(number: string): string {
  const trimmed = number.trim();
  if (trimmed.length <= 6) return trimmed;
  return `${trimmed.slice(0, 3)}•••${trimmed.slice(-3)}`;
}

export function phoneCallDurationLabel(durationSec: number): string {
  const whole = Math.max(0, Math.floor(durationSec));
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function phoneCallBlockFromPayload(
  payload: Record<string, unknown>,
): Extract<MessageBlock, { kind: "phone_call" }> {
  const durationSec = Number(payload.durationSec);
  return {
    kind: "phone_call",
    callId: String(payload.callId ?? ""),
    to: String(payload.to ?? ""),
    purpose: String(payload.purpose ?? "Phone call"),
    status: phoneCallStatusValue(payload.status),
    ...(Number.isInteger(durationSec) && durationSec >= 0 ? { durationSec } : {}),
    ...(typeof payload.summary === "string" && payload.summary ? { summary: payload.summary } : {}),
  };
}
