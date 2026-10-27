import { createHash } from "node:crypto";
import type { PhoneCallProvider } from "@savingroup/adapter-kit";
import { LiveKitPhoneCallProvider } from "./livekit-phone-call.js";
import { EmulatorPhoneCallProvider } from "./phone-call-emulator.js";
import { resolvePhoneCallProvider } from "./phone-call-provider-env.js";

export const DEFAULT_PHONE_AGENT_NAME = "savingroup-phone";

export interface PhoneCallConnection {
  provider: PhoneCallProvider;
  /** Opaque credential binding; rows are scoped by it so a rotated secret fails closed. */
  key: string;
  /** Caller id presented to the callee, when the trunk allows choosing one. */
  fromNumber?: string;
  /** Where the voice agent reaches this deployment's API for the call it is holding. */
  agentApiUrl: string;
}

export function phoneCallsEnabled(connection: PhoneCallConnection | null | undefined): boolean {
  return Boolean(connection?.provider.describe().capabilities.outbound);
}

export function createPhoneCallConnection(
  source: NodeJS.ProcessEnv = process.env,
): PhoneCallConnection | null {
  const kind = resolvePhoneCallProvider(source);
  const agentApiUrl =
    optional(source.PHONE_CALL_AGENT_API_URL) ??
    optional(source.API_URL) ??
    "http://127.0.0.1:3100";
  const fromNumber = optional(source.PHONE_CALL_FROM_NUMBER);
  if (kind === "emulator") {
    return { provider: new EmulatorPhoneCallProvider(), key: "emulator", fromNumber, agentApiUrl };
  }
  if (kind !== "livekit") return null;
  const apiSecret = source.LIVEKIT_API_SECRET!.trim();
  return {
    provider: new LiveKitPhoneCallProvider({
      url: source.LIVEKIT_URL!.trim(),
      apiKey: source.LIVEKIT_API_KEY!.trim(),
      apiSecret,
      sipTrunkId: source.LIVEKIT_SIP_TRUNK_ID!.trim(),
      agentName: optional(source.LIVEKIT_AGENT_NAME) ?? DEFAULT_PHONE_AGENT_NAME,
    }),
    key: `livekit:${createHash("sha256").update(apiSecret).digest("base64url")}`,
    fromNumber,
    agentApiUrl,
  };
}

function optional(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
