import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkNovncTarget,
  resolveNovncTarget,
  SCREEN_AUTHORITY_GRACE_MS,
  SCREEN_AUTHORITY_TIMEOUT_MS,
  safeProxyHeaders,
  watchScreenAuthorization,
} from "./screen-proxy.js";

const target = {
  protocol: "http:" as const,
  hostname: "127.0.0.1",
  port: 49152,
  path: "/websockify",
  interactive: false,
};
const allowed = { target };
const denied = { target: null, failure: "authority_rejected" as const };
const unavailable = { target: null, failure: "authority_unavailable" as const };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("screen proxy", () => {
  it("rejects legacy URLs without contacting the API", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(
      await resolveNovncTarget("/novnc/old/view/token/embed.html", "secret", "http://api.example"),
    ).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("checks each request and fails closed on revocation or API failure", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(target))
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetch);
    const failures: string[] = [];
    const resolve = () =>
      resolveNovncTarget(
        "/novnc/session/view/token/websockify",
        "secret",
        "http://api.example",
        (reason) => failures.push(reason),
      );
    expect(await resolve()).toEqual(target);
    expect(await resolve()).toBeNull();
    expect(await resolve()).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(failures).toEqual(["authority_rejected", "authority_unavailable"]);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      redirect: "error",
      headers: { authorization: "Bearer secret" },
    });
  });
  it("gives a slow authority longer than a burst of queued database checks", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(target));
    vi.stubGlobal("fetch", fetch);
    await resolveNovncTarget("/novnc/session/view/token/rfb.js", "secret", "http://api.example");
    const signal = fetch.mock.calls[0]?.[1]?.signal as AbortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
    expect(SCREEN_AUTHORITY_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000);
  });
  it("shares one authority round trip between concurrent checks of a path", async () => {
    const releases: Array<(value: Response) => void> = [];
    const fetch = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          releases.push(resolve);
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const path = "/novnc/session/view/token/core/rfb.js";
    const first = checkNovncTarget(path, "secret", "http://api.example");
    const second = checkNovncTarget(path, "secret", "http://api.example");
    const other = checkNovncTarget(
      "/novnc/session/view/token/core/input/keyboard.js",
      "secret",
      "http://api.example",
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const release of releases) release(Response.json(target));
    expect(await first).toEqual(allowed);
    expect(await second).toEqual(allowed);
    await expect(other).resolves.toEqual(allowed);
    fetch.mockResolvedValue(Response.json(target));
    // A settled check is not reused: the next request asks the authority again.
    await checkNovncTarget(path, "secret", "http://api.example");
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("fails closed for a malformed authority response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ hostname: "screen.example", port: "443" })),
    );
    const onFailure = vi.fn();
    expect(
      await resolveNovncTarget(
        "/novnc/session/view/token/vnc.html",
        "secret",
        "http://api.example",
        onFailure,
      ),
    ).toBeNull();
    expect(onFailure).toHaveBeenCalledWith("invalid_authority_response");
  });
  it("reports invalid JSON as an invalid authority response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })));
    const onFailure = vi.fn();
    expect(
      await resolveNovncTarget(
        "/novnc/session/view/token/vnc.html",
        "secret",
        "http://api.example",
        onFailure,
      ),
    ).toBeNull();
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith("invalid_authority_response");
  });
  it("reports a dropped authority body as unavailable", async () => {
    const response = new Response("{}", { status: 200 });
    vi.spyOn(response, "json").mockRejectedValueOnce(new Error("aborted"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const onFailure = vi.fn();
    expect(
      await resolveNovncTarget(
        "/novnc/session/view/token/vnc.html",
        "secret",
        "http://api.example",
        onFailure,
      ),
    ).toBeNull();
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith("authority_unavailable");
  });

  it("closes an active stream on revocation and stops checking closed streams", async () => {
    vi.useFakeTimers();
    const check = vi.fn().mockResolvedValueOnce(allowed).mockResolvedValueOnce(denied);
    const revoke = vi.fn();
    watchScreenAuthorization(check, revoke);
    await vi.advanceTimersByTimeAsync(1000);
    expect(revoke).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(revoke).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(check).toHaveBeenCalledTimes(2);
    const stop = watchScreenAuthorization(check, revoke);
    stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(check).toHaveBeenCalledTimes(2);
  });
  it("keeps a stream open through a transient authority outage, then fails closed", async () => {
    vi.useFakeTimers();
    const revoke = vi.fn();
    const check = vi
      .fn()
      .mockResolvedValueOnce(unavailable)
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(allowed)
      .mockResolvedValue(unavailable);
    watchScreenAuthorization(check, revoke);
    await vi.advanceTimersByTimeAsync(3000);
    expect(check).toHaveBeenCalledTimes(3);
    expect(revoke).not.toHaveBeenCalled();
    // The successful check reset the grace window.
    await vi.advanceTimersByTimeAsync(SCREEN_AUTHORITY_GRACE_MS - 1000);
    expect(revoke).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(revoke).toHaveBeenCalledTimes(1);
  });
  it("revokes a stream the moment the authority denies it during an outage", async () => {
    vi.useFakeTimers();
    const revoke = vi.fn();
    const check = vi.fn().mockResolvedValueOnce(unavailable).mockResolvedValueOnce(denied);
    watchScreenAuthorization(check, revoke);
    await vi.advanceTimersByTimeAsync(1000);
    expect(revoke).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(revoke).toHaveBeenCalledTimes(1);
  });
  it("does not forward application credentials", () => {
    expect(
      safeProxyHeaders({
        host: "app.example",
        cookie: "session=secret",
        authorization: "Bearer secret",
        "proxy-authorization": "Basic secret",
        upgrade: "websocket",
        "sec-websocket-key": "key",
      }),
    ).toEqual({ upgrade: "websocket", "sec-websocket-key": "key" });
  });

  it("does not forward HTTP/2 pseudo-headers to the HTTP/1 upstream", () => {
    expect(
      safeProxyHeaders({
        ":method": "GET",
        ":path": "/novnc/embed.html",
        ":authority": "localhost:5173",
        ":scheme": "https",
        upgrade: "websocket",
        "sec-websocket-key": "key",
      }),
    ).toEqual({ upgrade: "websocket", "sec-websocket-key": "key" });
  });
});
