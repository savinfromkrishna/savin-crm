import { describe, expect, it, vi } from "vitest";
import { buildGoogleUrl, classifyGoogleError, GoogleApi, retryAfterMs } from "./google-api.js";

const URL_BASE = "https://www.googleapis.com/drive/v3/files";

function googleError(status: number, reason: string, message = "message") {
  return Response.json({ error: { code: status, message, errors: [{ reason }] } }, { status });
}

function api(
  responses: Array<Response | Error>,
  options: { tokens?: string[]; onUnauthorized?: () => Promise<void> } = {},
) {
  const calls: Array<{ url: string; method: string; headers: Headers; body?: unknown }> = [];
  const sleeps: number[] = [];
  const tokens = [...(options.tokens ?? ["ya29.first", "ya29.second"])];
  const accessToken = vi.fn(async (request?: { forceRefresh?: boolean }) =>
    request?.forceRefresh ? (tokens[1] ?? tokens[0]!) : tokens[0]!,
  );
  const client = new GoogleApi({
    accessToken,
    onUnauthorized: options.onUnauthorized,
    fetch: async (input, init) => {
      calls.push({
        url: String(input),
        method: init?.method ?? "GET",
        headers: new Headers(init?.headers),
        body: init?.body,
      });
      const next = responses.shift();
      if (!next) throw new Error("No more responses");
      if (next instanceof Error) throw next;
      return next;
    },
    signal: new AbortController().signal,
    service: "Drive",
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0,
  });
  return { client, calls, sleeps, accessToken };
}

describe("google api client", () => {
  it("only targets googleapis.com over HTTPS", () => {
    expect(buildGoogleUrl(URL_BASE, { q: "x", ids: ["a", "b"], skip: undefined })).toBe(
      `${URL_BASE}?q=x&ids=a&ids=b`,
    );
    expect(() => buildGoogleUrl("https://evil.example/drive")).toThrow("googleapis.com");
    expect(() => buildGoogleUrl("http://www.googleapis.com/drive")).toThrow("HTTPS");
  });

  it("parses Retry-After seconds and dates", () => {
    expect(retryAfterMs("3")).toBe(3_000);
    expect(retryAfterMs("Sun, 11 Oct 2026 12:00:10 GMT", Date.parse("2026-10-11T12:00:00Z"))).toBe(
      10_000,
    );
    expect(retryAfterMs("soon")).toBeUndefined();
  });

  it.each([
    [403, ["insufficientPermissions"], "permission"],
    [403, ["ACCESS_TOKEN_SCOPE_INSUFFICIENT"], "permission"],
    [403, ["SERVICE_DISABLED"], "api_disabled"],
    [403, ["quotaExceeded"], "quota"],
    [403, ["userRateLimitExceeded"], "rate_limit"],
    [429, [], "rate_limit"],
    [404, [], "not_found"],
    [409, [], "conflict"],
    [503, [], "server"],
  ] as const)("classifies HTTP %s %j as %s", (status, reasons, kind) => {
    expect(classifyGoogleError(status, { reasons: [...reasons], message: "" })).toBe(kind);
  });

  it("waits out rate limits, honoring Retry-After, even for POST", async () => {
    const { client, sleeps } = api([
      new Response(null, { status: 429, headers: { "retry-after": "2" } }),
      googleError(403, "userRateLimitExceeded"),
      Response.json({ id: "ok" }),
    ]);
    await expect(client.json({ method: "POST", url: URL_BASE, json: {} })).resolves.toEqual({
      id: "ok",
    });
    expect(sleeps).toEqual([2_000, 1_000]);
  });

  it("retries server errors only for idempotent requests", async () => {
    const retried = api([new Response(null, { status: 503 }), Response.json({ ok: true })]);
    await expect(retried.client.json({ url: URL_BASE })).resolves.toEqual({ ok: true });

    const once = api([new Response(null, { status: 503 }), Response.json({ ok: true })]);
    await expect(
      once.client.json({ method: "POST", url: URL_BASE, json: {} }),
    ).rejects.toMatchObject({ kind: "server", status: 503 });
    expect(once.calls).toHaveLength(1);

    const network = api([new TypeError("fetch failed"), Response.json({ ok: true })]);
    await expect(network.client.json({ url: URL_BASE })).resolves.toEqual({ ok: true });
  });

  it("refreshes once on 401 and reports a second rejection", async () => {
    const recovered = api([googleError(401, "authError"), Response.json({ ok: true })]);
    await expect(recovered.client.json({ url: URL_BASE })).resolves.toEqual({ ok: true });
    expect(recovered.accessToken).toHaveBeenLastCalledWith({ forceRefresh: true });
    expect(recovered.calls[1]?.headers.get("authorization")).toBe("Bearer ya29.second");

    const onUnauthorized = vi.fn(async () => undefined);
    const rejected = api([googleError(401, "authError"), googleError(401, "authError")], {
      onUnauthorized,
    });
    await expect(rejected.client.json({ url: URL_BASE })).rejects.toMatchObject({ kind: "auth" });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("explains missing scopes and disabled APIs without echoing tokens", async () => {
    const scope = api([
      googleError(
        403,
        "insufficientPermissions",
        "Request had insufficient authentication scopes.",
      ),
    ]);
    const error = await scope.client.json({ url: URL_BASE }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ kind: "permission" });
    expect((error as Error).message).toContain("has not granted the Drive permission");

    const disabled = api([googleError(403, "SERVICE_DISABLED", "Drive API has not been used")]);
    await expect(disabled.client.json({ url: URL_BASE })).rejects.toThrow(
      "enable it in Google Cloud Console",
    );

    const echo = api([googleError(400, "badRequest", "bad token ya29.first in request")]);
    const echoed = await echo.client.json({ url: URL_BASE }).catch((caught: unknown) => caught);
    expect((echoed as Error).message).not.toContain("ya29.first");
  });

  describe("resumable uploads", () => {
    const CHUNK = 256 * 1024;
    const bytes = new Uint8Array(CHUNK * 2 + 10).map((_, index) => index % 251);
    const session = "https://www.googleapis.com/upload/drive/v3/files?upload_id=abc";

    it("sends 256 KiB chunks with content ranges and reports progress", async () => {
      const progress: number[] = [];
      const { client, calls } = api([
        new Response(null, { status: 200, headers: { location: session } }),
        new Response(null, { status: 308, headers: { range: `bytes=0-${CHUNK - 1}` } }),
        new Response(null, { status: 308, headers: { range: `bytes=0-${CHUNK * 2 - 1}` } }),
        Response.json({ id: "file-1" }),
      ]);
      const result = await client.resumableUpload({
        url: "https://www.googleapis.com/upload/drive/v3/files",
        metadata: { name: "a.bin" },
        bytes,
        mimeType: "application/octet-stream",
        chunkBytes: CHUNK,
        onProgress: (done) => {
          progress.push(done);
        },
      });
      expect(result).toEqual({ id: "file-1" });
      expect(calls[0]?.url).toContain("uploadType=resumable");
      expect(calls[0]?.headers.get("x-upload-content-length")).toBe(String(bytes.byteLength));
      expect(calls.slice(1).map((call) => call.headers.get("content-range"))).toEqual([
        `bytes 0-${CHUNK - 1}/${bytes.byteLength}`,
        `bytes ${CHUNK}-${CHUNK * 2 - 1}/${bytes.byteLength}`,
        `bytes ${CHUNK * 2}-${bytes.byteLength - 1}/${bytes.byteLength}`,
      ]);
      expect(progress).toEqual([CHUNK, CHUNK * 2, bytes.byteLength]);
    });

    it("asks the session what it stored after a dropped chunk and resumes there", async () => {
      const { client, calls, sleeps } = api([
        new Response(null, { status: 200, headers: { location: session } }),
        new TypeError("fetch failed"),
        new Response(null, { status: 308, headers: { range: `bytes=0-${CHUNK - 1}` } }),
        new Response(null, { status: 308, headers: { range: `bytes=0-${CHUNK * 2 - 1}` } }),
        new Response(null, { status: 503 }),
        new Response(null, { status: 308, headers: { range: `bytes=0-${CHUNK * 2 - 1}` } }),
        Response.json({ id: "file-2" }),
      ]);
      await expect(
        client.resumableUpload({
          url: "https://www.googleapis.com/upload/drive/v3/files",
          metadata: {},
          bytes,
          mimeType: "application/octet-stream",
          chunkBytes: CHUNK,
        }),
      ).resolves.toEqual({ id: "file-2" });
      expect(calls.map((call) => call.headers.get("content-range"))).toEqual([
        null,
        `bytes 0-${CHUNK - 1}/${bytes.byteLength}`,
        `bytes */${bytes.byteLength}`,
        `bytes ${CHUNK}-${CHUNK * 2 - 1}/${bytes.byteLength}`,
        `bytes ${CHUNK * 2}-${bytes.byteLength - 1}/${bytes.byteLength}`,
        `bytes */${bytes.byteLength}`,
        `bytes ${CHUNK * 2}-${bytes.byteLength - 1}/${bytes.byteLength}`,
      ]);
      expect(sleeps).toHaveLength(2);
    });

    it("gives up after repeated failures and when the session expires", async () => {
      const failing = api([
        new Response(null, { status: 200, headers: { location: session } }),
        ...Array.from({ length: 10 }, () => new TypeError("fetch failed")),
      ]);
      await expect(
        failing.client.resumableUpload({
          url: "https://www.googleapis.com/upload/drive/v3/files",
          metadata: {},
          bytes,
          mimeType: "application/octet-stream",
          chunkBytes: CHUNK,
        }),
      ).rejects.toThrow("kept failing");

      const expired = api([
        new Response(null, { status: 200, headers: { location: session } }),
        new Response(null, { status: 404 }),
      ]);
      await expect(
        expired.client.resumableUpload({
          url: "https://www.googleapis.com/upload/drive/v3/files",
          metadata: {},
          bytes,
          mimeType: "application/octet-stream",
          chunkBytes: CHUNK,
        }),
      ).rejects.toThrow("session expired");
    });

    it("refuses a session URL outside googleapis.com", async () => {
      const { client } = api([
        new Response(null, { status: 200, headers: { location: "https://evil.example/upload" } }),
      ]);
      await expect(
        client.resumableUpload({
          url: "https://www.googleapis.com/upload/drive/v3/files",
          metadata: {},
          bytes,
          mimeType: "application/octet-stream",
          chunkBytes: CHUNK,
        }),
      ).rejects.toThrow("invalid upload session");
    });
  });
});
