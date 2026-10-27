import type { GoogleCallbackResult, IntegrationProviderSettings } from "@savingroup/adapters";
import { GOOGLE_CALLBACK_PATH, GoogleConnector } from "@savingroup/adapters";
import type { Hono } from "hono";

/** Where the web app shows how a connection attempt ended. */
export const CONNECTION_DONE_PATH = "/connections/done";
const APP_SCHEME = "savingroup://";

function single(params: URLSearchParams, name: string): string | null {
  const values = params.getAll(name);
  return values.length === 1 ? (values[0] ?? null) : null;
}

/**
 * Google redirects the consenting browser here. The code is exchanged on the
 * server, then the browser moves on to a result page without it.
 */
export function mountGoogleOAuthRoutes(
  app: Hono,
  deps: {
    integrationSettings: Pick<IntegrationProviderSettings, "resolve">;
    webOrigin: string;
    sessionUserId: (request: Request) => Promise<string | null>;
  },
): void {
  app.get(GOOGLE_CALLBACK_PATH, async (c) => {
    const params = new URL(c.req.url).searchParams;
    const done = new URL(CONNECTION_DONE_PATH, deps.webOrigin);
    done.searchParams.set("connector", "google");
    const google = await deps.integrationSettings.resolve("google").catch(() => undefined);
    const result: GoogleCallbackResult =
      google instanceof GoogleConnector
        ? await google.handleCallback({
            state: single(params, "state"),
            code: single(params, "code"),
            error: single(params, "error"),
            sessionUserId: await deps.sessionUserId(c.req.raw).catch(() => null),
          })
        : { status: "failed", reason: "failed" };
    c.header("cache-control", "no-store");
    c.header("referrer-policy", "no-referrer");
    if (result.status === "handoff") {
      // The app's sign-in sheet closes on this URL and relays it with the app's own session.
      const app = new URL(`${APP_SCHEME}${CONNECTION_DONE_PATH.slice(1)}`);
      app.searchParams.set("connector", "google");
      app.searchParams.set("state", result.state);
      if (result.code) app.searchParams.set("code", result.code);
      if (result.error) app.searchParams.set("error", result.error);
      return c.redirect(app.toString(), 303);
    }
    done.searchParams.set("result", result.status === "connected" ? "connected" : result.reason);
    if (result.provider) done.searchParams.set("app", result.provider);
    return c.redirect(done.toString(), 303);
  });
}
