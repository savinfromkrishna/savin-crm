import type { GoogleCallbackResult } from "@savingroup/adapters";
import { GoogleConnector } from "@savingroup/adapters";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { mountGoogleOAuthRoutes } from "./google-oauth.js";

function appWith(
  result: GoogleCallbackResult | undefined,
  sessionUserId: string | null = "user-1",
) {
  const handleCallback = vi.fn(async () => result!);
  const connector = Object.create(GoogleConnector.prototype) as GoogleConnector;
  connector.handleCallback = handleCallback;
  const app = new Hono();
  mountGoogleOAuthRoutes(app, {
    integrationSettings: { resolve: async () => (result ? connector : undefined) },
    webOrigin: "https://savingroup.test",
    sessionUserId: async () => sessionUserId,
  });
  return { app, handleCallback };
}

async function callback(app: Hono, query: string) {
  return app.request(`https://savingroup.test/api/integrations/google/callback?${query}`);
}

describe("google oauth callback route", () => {
  it("finishes with the browser's session and sends it to the result page without the code", async () => {
    const { app, handleCallback } = appWith({ status: "connected", provider: "gmail" });
    const response = await callback(app, "state=s1&code=c1");
    expect(handleCallback).toHaveBeenCalledWith({
      state: "s1",
      code: "c1",
      error: null,
      sessionUserId: "user-1",
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://savingroup.test/connections/done?connector=google&result=connected&app=gmail",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("ignores repeated parameters instead of picking one", async () => {
    const { app, handleCallback } = appWith({ status: "failed", reason: "expired" });
    await callback(app, "state=a&state=b&code=c");
    expect(handleCallback).toHaveBeenCalledWith(expect.objectContaining({ state: null }));
  });

  it("reports failures by reason", async () => {
    const { app } = appWith({ status: "failed", reason: "session", provider: "youtube" }, null);
    const response = await callback(app, "state=s1&code=c1");
    expect(response.headers.get("location")).toBe(
      "https://savingroup.test/connections/done?connector=google&result=session&app=youtube",
    );
  });

  it("hands an app-started sign-in to the app", async () => {
    const { app } = appWith({ status: "handoff", state: "s1", code: "c1" });
    const response = await callback(app, "state=s1&code=c1");
    expect(response.headers.get("location")).toBe(
      "savingroup://connections/done?connector=google&state=s1&code=c1",
    );
  });

  it("fails cleanly when Google is not configured", async () => {
    const { app } = appWith(undefined);
    const response = await callback(app, "state=s1&code=c1");
    expect(response.headers.get("location")).toBe(
      "https://savingroup.test/connections/done?connector=google&result=failed",
    );
  });
});
