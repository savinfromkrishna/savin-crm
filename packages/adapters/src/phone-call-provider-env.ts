/**
 * Empty, unknown, or livekit-without-credentials becomes none so the API still
 * boots and phone tools stay uninjected. "fake" is an alias for the emulator.
 */
export function resolvePhoneCallProvider(source: NodeJS.ProcessEnv = process.env): string {
  const configured = source.TELEPHONY_PROVIDER;
  if (configured !== undefined && !configured.trim()) return "none";
  const requested = (configured?.trim() || "none").toLowerCase();
  if (requested === "none") return "none";
  if (requested === "emulator" || requested === "fake") return "emulator";
  if (requested === "livekit") {
    return optional(source.LIVEKIT_URL) &&
      optional(source.LIVEKIT_API_KEY) &&
      optional(source.LIVEKIT_API_SECRET) &&
      optional(source.LIVEKIT_SIP_TRUNK_ID)
      ? "livekit"
      : "none";
  }
  // Soft-fall: do not throw at API boot for typos or future vendor names.
  return "none";
}

function optional(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
