import { rpc } from "./api";
import { t } from "./i18n";

const CALLBACK_URL = "savingroup://connections/done";

/** Connectors that call back to this server; the app relays their callback itself. */
export function finishesInApp(connectorId: string | undefined): boolean {
  return connectorId === "google";
}

/**
 * The phone's browser has no Savingroup session, so the server hands the provider's
 * callback to the app, which finishes it with its own session.
 * Resolves "connected", "cancelled", or a failure reason from the server.
 */
export async function authorizeInApp(connectorId: string, authorizationUrl: string) {
  // Deferred like SSO so older binaries without the module still load this screen.
  const { openAuthSessionAsync } = await import("expo-web-browser").catch(() => {
    throw new Error(t("Could not continue"));
  });
  const outcome = await openAuthSessionAsync(authorizationUrl, CALLBACK_URL);
  if (outcome.type !== "success") return "cancelled";
  const callback = new URL(outcome.url);
  const state = callback.searchParams.get("state");
  if (callback.protocol !== "savingroup:" || !state) throw new Error(t("Could not continue"));
  const finished = await rpc<{ result: string }>("connections/finish", {
    connectorId,
    state,
    code: callback.searchParams.get("code") ?? undefined,
    error: callback.searchParams.get("error") ?? undefined,
  });
  return finished.result;
}

export function authorizationFailureText(reason: string): string {
  if (reason === "denied" || reason === "not_granted") return t("Access wasn't granted.");
  if (reason === "expired") return t("This sign-in expired. Try again.");
  return t("Something went wrong. Try again.");
}
