import { readBoundedResponseBytes } from "@savingroup/core";
import { sanitizeConnectorError } from "./connector-safety.js";
import type { GoogleFetch } from "./google-oauth.js";

const MAX_RETRIES = 3;
const MAX_BACKOFF_MS = 8_000;
const MAX_RETRY_AFTER_MS = 20_000;
const REQUEST_TIMEOUT_MS = 60_000;
export const MAX_GOOGLE_JSON_BYTES = 8 * 1024 * 1024;
/** Resumable uploads must send whole multiples of 256 KiB except the final chunk. */
export const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
const UPLOAD_CHUNK_TIMEOUT_MS = 5 * 60_000;

export type GoogleErrorKind =
  | "permission"
  | "api_disabled"
  | "quota"
  | "rate_limit"
  | "not_found"
  | "auth"
  | "invalid"
  | "conflict"
  | "server";

/** A failed Google API call, with a message that is safe to show the model and the user. */
export class GoogleApiError extends Error {
  constructor(
    readonly kind: GoogleErrorKind,
    readonly status: number,
    message: string,
    readonly reason?: string,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

type QueryValue = string | number | boolean | readonly string[] | undefined;

export interface GoogleApiRequest {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  query?: Record<string, QueryValue>;
  json?: unknown;
  body?: Uint8Array | string;
  headers?: Record<string, string>;
  /** Retry server errors and dropped connections, which may already have taken effect. */
  idempotent?: boolean;
  responseType?: "json" | "bytes" | "text" | "none";
  maxBytes?: number;
}

export interface GoogleApiOptions {
  /** Returns a valid access token, refreshing first when asked or when it expired. */
  accessToken(options?: { forceRefresh?: boolean }): Promise<string>;
  /** Called when Google rejects a freshly refreshed token. */
  onUnauthorized?(): Promise<void>;
  /** Tokens to strip from any message, in addition to the access token itself. */
  secrets?: string[];
  fetch?: GoogleFetch;
  signal: AbortSignal;
  /** Product name used in actionable errors, such as "Gmail". */
  service: string;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
}

export function buildGoogleUrl(base: string, query: Record<string, QueryValue> = {}): string {
  const url = new URL(base);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".googleapis.com")) {
    throw new Error("Google API requests must target googleapis.com over HTTPS");
  }
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, item);
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function retryAfterMs(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

type ParsedGoogleError = { message: string; reasons: string[]; status: string };

function parseGoogleError(text: string): ParsedGoogleError {
  try {
    const body = JSON.parse(text) as {
      error?:
        | string
        | {
            message?: unknown;
            status?: unknown;
            errors?: Array<{ reason?: unknown; message?: unknown }>;
            details?: Array<{ reason?: unknown }>;
          };
      error_description?: unknown;
    };
    if (typeof body.error === "string") {
      return {
        message: typeof body.error_description === "string" ? body.error_description : body.error,
        reasons: [body.error],
        status: "",
      };
    }
    const error = body.error ?? {};
    const reasons = [
      ...(error.errors ?? []).map((item) => item.reason),
      ...(error.details ?? []).map((item) => item.reason),
    ].filter((reason): reason is string => typeof reason === "string" && reason.length > 0);
    return {
      message: typeof error.message === "string" ? error.message : "",
      reasons,
      status: typeof error.status === "string" ? error.status : "",
    };
  } catch {
    return { message: "", reasons: [], status: "" };
  }
}

const PERMISSION_REASONS = new Set([
  "insufficientPermissions",
  "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
  "insufficientScopes",
]);
const API_DISABLED_REASONS = new Set(["accessNotConfigured", "SERVICE_DISABLED"]);
const QUOTA_REASONS = new Set(["quotaExceeded", "dailyLimitExceeded", "dailyLimitExceededUnreg"]);
const RATE_LIMIT_REASONS = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "RATE_LIMIT_EXCEEDED",
]);

export function classifyGoogleError(
  status: number,
  parsed: Pick<ParsedGoogleError, "reasons" | "message">,
): GoogleErrorKind {
  const reasons = new Set(parsed.reasons);
  const has = (set: Set<string>) => [...reasons].some((reason) => set.has(reason));
  if (status === 429 || has(RATE_LIMIT_REASONS)) return "rate_limit";
  if (has(QUOTA_REASONS)) return "quota";
  if (has(API_DISABLED_REASONS)) return "api_disabled";
  if (has(PERMISSION_REASONS) || /insufficient authentication scopes/i.test(parsed.message)) {
    return "permission";
  }
  if (status === 401) return "auth";
  if (status === 404) return "not_found";
  if (status === 409 || status === 412) return "conflict";
  if (status >= 500) return "server";
  if (status === 403) return "permission";
  return "invalid";
}

function actionableMessage(
  kind: GoogleErrorKind,
  service: string,
  status: number,
  detail: string,
): string {
  switch (kind) {
    case "permission":
      return detail && !/insufficient authentication scopes/i.test(detail)
        ? `Google denied access: ${detail}`
        : `This Google account has not granted the ${service} permission this action needs.`;
    case "api_disabled":
      return `The ${service} API is not enabled for this deployment's Google Cloud project. The server owner must enable it in Google Cloud Console.`;
    case "quota":
      return `The ${service} API quota for this deployment's Google Cloud project is used up. Try again after it resets.`;
    case "rate_limit":
      return `Google is rate limiting ${service} requests. Try again in a minute.`;
    case "auth":
      return "Google rejected the stored authorization. Reconnect this Google account.";
    case "not_found":
      return detail ? `Not found: ${detail}` : "Google could not find that item.";
    default:
      return detail
        ? `Google ${service} returned HTTP ${status}: ${detail}`
        : `Google ${service} returned HTTP ${status}.`;
  }
}

function isRetryable(kind: GoogleErrorKind, idempotent: boolean): boolean {
  // A rate-limited request was not processed, so even non-idempotent calls may retry.
  if (kind === "rate_limit") return true;
  return idempotent && kind === "server";
}

/** Authenticated access to Google REST APIs for one account during one tool call. */
export class GoogleApi {
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  private readonly random: () => number;
  private token?: string;

  constructor(private readonly options: GoogleApiOptions) {
    this.sleep = options.sleep ?? abortableSleep;
    this.random = options.random ?? Math.random;
  }

  get signal(): AbortSignal {
    return this.options.signal;
  }

  private secrets(): string[] {
    return [...(this.token ? [this.token] : []), ...(this.options.secrets ?? [])];
  }

  private backoff(attempt: number): number {
    return Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempt) + Math.floor(this.random() * 250);
  }

  async json<T>(request: Omit<GoogleApiRequest, "responseType">): Promise<T> {
    return (await this.request({ ...request, responseType: "json" })) as T;
  }

  async request(request: GoogleApiRequest): Promise<unknown> {
    const method = request.method ?? "GET";
    const idempotent = request.idempotent ?? (method !== "POST" && method !== "PATCH");
    const url = buildGoogleUrl(request.url, request.query);
    const body =
      request.json !== undefined ? JSON.stringify(request.json) : (request.body ?? undefined);
    let refreshed = false;
    for (let attempt = 0; ; attempt += 1) {
      this.token = await this.options.accessToken(refreshed ? { forceRefresh: true } : undefined);
      const signal = AbortSignal.any([
        this.options.signal,
        AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ]);
      let response: Response;
      try {
        response = await (this.options.fetch ?? globalThis.fetch)(url, {
          method,
          headers: {
            authorization: `Bearer ${this.token}`,
            accept: "application/json",
            ...(request.json !== undefined ? { "content-type": "application/json" } : {}),
            ...request.headers,
          },
          ...(body !== undefined ? { body: body as BodyInit } : {}),
          redirect: "error",
          signal,
        });
      } catch (error) {
        if (this.options.signal.aborted) throw error;
        if (idempotent && attempt < MAX_RETRIES) {
          await this.sleep(this.backoff(attempt), this.options.signal);
          continue;
        }
        throw new GoogleApiError(
          "server",
          0,
          sanitizeConnectorError(
            `Could not reach Google ${this.options.service}: ${error instanceof Error ? error.message : String(error)}`,
            this.secrets(),
          ),
        );
      }
      if (response.ok) return this.readSuccess(response, request);
      const text = await this.readText(response, 64 * 1024).catch(() => "");
      const parsed = parseGoogleError(text);
      const kind = classifyGoogleError(response.status, parsed);
      if (kind === "auth" && !refreshed) {
        refreshed = true;
        continue;
      }
      if (kind === "auth") await this.options.onUnauthorized?.();
      if (isRetryable(kind, idempotent) && attempt < MAX_RETRIES) {
        const waited = retryAfterMs(response.headers.get("retry-after"));
        await this.sleep(
          Math.min(MAX_RETRY_AFTER_MS, waited ?? this.backoff(attempt)),
          this.options.signal,
        );
        continue;
      }
      throw new GoogleApiError(
        kind,
        response.status,
        sanitizeConnectorError(
          actionableMessage(kind, this.options.service, response.status, parsed.message),
          this.secrets(),
        ).slice(0, 600),
        parsed.reasons[0],
      );
    }
  }

  private async readSuccess(response: Response, request: GoogleApiRequest): Promise<unknown> {
    const type = request.responseType ?? "json";
    if (type === "none" || response.status === 204) {
      await response.body?.cancel().catch(() => undefined);
      return undefined;
    }
    const maxBytes = request.maxBytes ?? MAX_GOOGLE_JSON_BYTES;
    if (type === "bytes") return this.readBytes(response, maxBytes);
    const text = await this.readText(response, maxBytes);
    if (type === "text") return text;
    if (!text) return {};
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new GoogleApiError(
        "server",
        response.status,
        `Google ${this.options.service} returned an unreadable response.`,
      );
    }
  }

  private readBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
    return readBoundedResponseBytes(response, {
      maxBytes,
      tooLargeMessage: `The file is larger than ${Math.floor(maxBytes / (1024 * 1024))} MiB.`,
      read: (operation) => operation(),
    });
  }

  private async readText(response: Response, maxBytes: number): Promise<string> {
    return new TextDecoder().decode(await this.readBytes(response, maxBytes));
  }

  /**
   * Google's resumable protocol: one session per upload, chunks retried in place.
   * After a failure the session reports how many bytes it stored and the upload
   * resumes from there instead of starting over.
   */
  async resumableUpload(input: {
    url: string;
    query?: Record<string, QueryValue>;
    metadata: unknown;
    bytes: Uint8Array;
    mimeType: string;
    method?: "POST" | "PUT" | "PATCH";
    chunkBytes?: number;
    onProgress?: (uploaded: number, total: number) => Promise<void> | void;
  }): Promise<unknown> {
    const total = input.bytes.byteLength;
    if (total === 0) throw new GoogleApiError("invalid", 400, "The file is empty.");
    const chunkBytes = input.chunkBytes ?? UPLOAD_CHUNK_BYTES;
    if (chunkBytes <= 0 || chunkBytes % (256 * 1024) !== 0) {
      throw new Error("Upload chunks must be a multiple of 256 KiB");
    }
    const session = await this.startUploadSession(input, total);
    let offset = 0;
    let failures = 0;
    let probe = false;
    let refreshed = false;
    const fail = async (cause: string, retryAfter?: number) => {
      failures += 1;
      if (failures > MAX_RETRIES) {
        throw new GoogleApiError(
          "server",
          0,
          sanitizeConnectorError(
            `The upload to Google ${this.options.service} kept failing: ${cause}`,
            this.secrets(),
          ).slice(0, 600),
        );
      }
      await this.sleep(
        Math.min(MAX_RETRY_AFTER_MS, retryAfter ?? this.backoff(failures - 1)),
        this.options.signal,
      );
      probe = true;
    };
    for (;;) {
      let response: Response;
      const sent = probe ? 0 : Math.min(chunkBytes, total - offset);
      try {
        response = probe
          ? await this.uploadRequest(session, `bytes */${total}`)
          : await this.uploadRequest(
              session,
              `bytes ${offset}-${offset + sent - 1}/${total}`,
              input.bytes.subarray(offset, offset + sent),
            );
      } catch (error) {
        if (this.options.signal.aborted) throw error;
        await fail(error instanceof Error ? error.message : String(error));
        continue;
      }
      probe = false;
      if (response.ok) {
        await input.onProgress?.(total, total);
        return this.readSuccess(response, { url: session, responseType: "json" });
      }
      if (response.status === 308) {
        await response.body?.cancel().catch(() => undefined);
        const next = storedThrough(response.headers.get("range"), total);
        if (next > offset) failures = 0;
        else if (sent > 0) await fail("Google stored none of the last chunk");
        offset = next;
        await input.onProgress?.(offset, total);
        // Every byte is stored but the final response was lost: ask for the result.
        if (offset >= total) probe = true;
        continue;
      }
      const text = await this.readText(response, 64 * 1024).catch(() => "");
      const parsed = parseGoogleError(text);
      const kind = classifyGoogleError(response.status, parsed);
      if (kind === "auth" && !refreshed) {
        refreshed = true;
        this.token = await this.options.accessToken({ forceRefresh: true });
        probe = true;
        continue;
      }
      if (kind === "server" || kind === "rate_limit") {
        await fail(`HTTP ${response.status}`, retryAfterMs(response.headers.get("retry-after")));
        continue;
      }
      if (response.status === 404 || response.status === 410) {
        throw new GoogleApiError(
          "not_found",
          response.status,
          "The Google upload session expired before the file finished. Try the upload again.",
        );
      }
      throw new GoogleApiError(
        kind,
        response.status,
        sanitizeConnectorError(
          actionableMessage(kind, this.options.service, response.status, parsed.message),
          this.secrets(),
        ).slice(0, 600),
        parsed.reasons[0],
      );
    }
  }

  private async startUploadSession(
    input: {
      url: string;
      query?: Record<string, QueryValue>;
      metadata: unknown;
      mimeType: string;
      method?: "POST" | "PUT" | "PATCH";
    },
    total: number,
  ): Promise<string> {
    const url = buildGoogleUrl(input.url, { ...input.query, uploadType: "resumable" });
    let refreshed = false;
    for (let attempt = 0; ; attempt += 1) {
      this.token = await this.options.accessToken(refreshed ? { forceRefresh: true } : undefined);
      let response: Response;
      try {
        response = await (this.options.fetch ?? globalThis.fetch)(url, {
          method: input.method ?? "POST",
          headers: {
            authorization: `Bearer ${this.token}`,
            "content-type": "application/json; charset=UTF-8",
            "x-upload-content-type": input.mimeType,
            "x-upload-content-length": String(total),
          },
          body: JSON.stringify(input.metadata ?? {}),
          redirect: "error",
          signal: AbortSignal.any([this.options.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
        });
      } catch (error) {
        // A session creates nothing until its last byte arrives, so starting one may retry.
        if (this.options.signal.aborted || attempt >= MAX_RETRIES) throw error;
        await this.sleep(this.backoff(attempt), this.options.signal);
        continue;
      }
      const location = response.headers.get("location");
      if (response.ok && location) {
        await response.body?.cancel().catch(() => undefined);
        const session = new URL(location, url);
        if (session.protocol !== "https:" || !session.hostname.endsWith(".googleapis.com")) {
          throw new GoogleApiError(
            "server",
            response.status,
            "Google returned an invalid upload session.",
          );
        }
        return session.toString();
      }
      const text = await this.readText(response, 64 * 1024).catch(() => "");
      const parsed = parseGoogleError(text);
      const kind = response.ok ? "server" : classifyGoogleError(response.status, parsed);
      if (kind === "auth" && !refreshed) {
        refreshed = true;
        continue;
      }
      if ((kind === "server" || kind === "rate_limit") && attempt < MAX_RETRIES) {
        const waited = retryAfterMs(response.headers.get("retry-after"));
        await this.sleep(
          Math.min(MAX_RETRY_AFTER_MS, waited ?? this.backoff(attempt)),
          this.options.signal,
        );
        continue;
      }
      throw new GoogleApiError(
        kind,
        response.status,
        sanitizeConnectorError(
          actionableMessage(kind, this.options.service, response.status, parsed.message),
          this.secrets(),
        ).slice(0, 600),
        parsed.reasons[0],
      );
    }
  }

  private uploadRequest(
    session: string,
    contentRange: string,
    chunk?: Uint8Array,
  ): Promise<Response> {
    return (this.options.fetch ?? globalThis.fetch)(session, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-length": String(chunk?.byteLength ?? 0),
        "content-range": contentRange,
      },
      ...(chunk ? { body: chunk as BodyInit } : {}),
      redirect: "error",
      signal: AbortSignal.any([
        this.options.signal,
        AbortSignal.timeout(chunk ? UPLOAD_CHUNK_TIMEOUT_MS : REQUEST_TIMEOUT_MS),
      ]),
    });
  }
}

/** Next byte to send, from a 308 response's Range header; no header means nothing is stored. */
function storedThrough(range: string | null, total: number): number {
  const match = /^bytes=0-(\d+)$/.exec(range?.trim() ?? "");
  return match ? Math.min(total, Number(match[1]) + 1) : 0;
}
