import type { BusinessErrorCode } from "@savingroup/contracts";
import { BUSINESS_ERROR_CODES } from "@savingroup/contracts";

/**
 * Minimal, dependency-free Frappe REST client. It speaks the stable v1 API
 * (`/api/resource`, `/api/method`) with token authentication as the site's
 * Savingroup gateway user. Nothing here knows about doctypes or business rules;
 * the gateway's action handlers do.
 */

export interface FrappeClientOptions {
  baseUrl: string;
  apiKey: string;
  apiSecret: string;
  /** Injected in tests; defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Per request. Writes that time out are reconciled, never blindly retried. */
  timeoutMs?: number;
}

/** `[field, operator, value]` or `[doctype, field, operator, value]`, as Frappe accepts. */
export type FrappeFilter =
  | [string, string, string | number | boolean | null | string[]]
  | [string, string, string, string | number | boolean | null | string[]];

export interface FrappeListOptions {
  filters?: FrappeFilter[];
  orFilters?: FrappeFilter[];
  fields?: string[];
  limit?: number;
  start?: number;
  orderBy?: string;
}

export type FrappeDoc = Record<string, unknown> & { name: string };

export type FrappeFailureKind = "http" | "network" | "timeout";

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_MESSAGE_CHARS = 600;

/**
 * Any failed request. `outcomeUnknown` is the important bit for writes: a
 * timeout or a dropped connection may have reached the site and committed, so
 * the caller must reconcile before trying again.
 */
export class FrappeRequestError extends Error {
  readonly kind: FrappeFailureKind;
  readonly status: number | undefined;
  readonly excType: string | undefined;
  readonly serverMessages: readonly string[];
  /** Set when the bridge raised a typed business error. */
  readonly businessCode: BusinessErrorCode | undefined;

  constructor(input: {
    kind: FrappeFailureKind;
    message: string;
    status?: number;
    excType?: string;
    serverMessages?: string[];
    businessCode?: BusinessErrorCode;
  }) {
    super(input.message);
    this.name = "FrappeRequestError";
    this.kind = input.kind;
    this.status = input.status;
    this.excType = input.excType;
    this.serverMessages = input.serverMessages ?? [];
    this.businessCode = input.businessCode;
  }

  get outcomeUnknown(): boolean {
    return this.kind !== "http";
  }
}

export function isFrappeRequestError(error: unknown): error is FrappeRequestError {
  return error instanceof FrappeRequestError;
}

/** Frappe nests user-facing messages as a JSON array of JSON strings. */
export function parseServerMessages(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const outer = JSON.parse(raw) as unknown;
    if (!Array.isArray(outer)) return [];
    return outer.flatMap((entry) => {
      if (typeof entry !== "string") return [];
      try {
        const inner = JSON.parse(entry) as { message?: unknown };
        return typeof inner.message === "string" ? [stripHtml(inner.message)] : [];
      } catch {
        return [stripHtml(entry)];
      }
    });
  } catch {
    return [];
  }
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The bridge raises `SavingroupBusinessError` with a JSON body `{code, message}`.
 * Other Frappe exceptions map by type, so a plain ERPNext validation still
 * becomes a typed business error instead of a generic failure.
 */
const EXC_TYPE_CODES: Record<string, BusinessErrorCode> = {
  ValidationError: "invalid_input",
  MandatoryError: "invalid_input",
  InvalidStatusError: "invalid_state",
  DoesNotExistError: "not_found",
  PermissionError: "permission_denied",
  AuthenticationError: "permission_denied",
  DuplicateEntryError: "conflict",
  UniqueValidationError: "conflict",
  TimestampMismatchError: "conflict",
  LinkExistsError: "conflict",
  NegativeStockError: "insufficient_stock",
  CSRFTokenError: "unavailable",
};

export function businessCodeFromFrappeError(
  excType: string | undefined,
  messages: readonly string[],
): { code: BusinessErrorCode | undefined; message: string | undefined } {
  for (const message of messages) {
    if (!message.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(message) as { code?: unknown; message?: unknown };
      if (
        typeof parsed.code === "string" &&
        (BUSINESS_ERROR_CODES as readonly string[]).includes(parsed.code)
      ) {
        return {
          code: parsed.code as BusinessErrorCode,
          message: typeof parsed.message === "string" ? parsed.message : undefined,
        };
      }
    } catch {
      // Not the bridge's JSON envelope; fall through to the type map.
    }
  }
  const code = excType ? EXC_TYPE_CODES[excType] : undefined;
  return { code, message: messages[0] };
}

export class FrappeClient {
  private readonly baseUrl: string;
  private readonly authorization: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: FrappeClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.authorization = `token ${options.apiKey}:${options.apiSecret}`;
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Whitelisted method call; returns Frappe's `message`. */
  async call<T = unknown>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    const body = await this.request("POST", `/api/method/${method}`, { body: args });
    return (body as { message: T }).message;
  }

  async getDoc<T extends FrappeDoc = FrappeDoc>(doctype: string, name: string): Promise<T> {
    const body = await this.request("GET", resourcePath(doctype, name));
    return (body as { data: T }).data;
  }

  async getList<T extends Record<string, unknown> = FrappeDoc>(
    doctype: string,
    options: FrappeListOptions = {},
  ): Promise<T[]> {
    const query: Record<string, string> = {
      fields: JSON.stringify(options.fields ?? ["name"]),
      limit_page_length: String(options.limit ?? 50),
      limit_start: String(options.start ?? 0),
    };
    if (options.filters?.length) query.filters = JSON.stringify(options.filters);
    if (options.orFilters?.length) query.or_filters = JSON.stringify(options.orFilters);
    if (options.orderBy) query.order_by = options.orderBy;
    const body = await this.request("GET", resourcePath(doctype), { query });
    return (body as { data: T[] }).data;
  }

  async insertDoc<T extends FrappeDoc = FrappeDoc>(
    doctype: string,
    doc: Record<string, unknown>,
  ): Promise<T> {
    const body = await this.request("POST", resourcePath(doctype), { body: doc });
    return (body as { data: T }).data;
  }

  async updateDoc<T extends FrappeDoc = FrappeDoc>(
    doctype: string,
    name: string,
    values: Record<string, unknown>,
  ): Promise<T> {
    const body = await this.request("PUT", resourcePath(doctype, name), { body: values });
    return (body as { data: T }).data;
  }

  async deleteDoc(doctype: string, name: string): Promise<void> {
    await this.request("DELETE", resourcePath(doctype, name));
  }

  private async request(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    options: { query?: Record<string, string>; body?: unknown } = {},
  ): Promise<unknown> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, value);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          authorization: this.authorization,
          accept: "application/json",
          ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = controller.signal.aborted;
      throw new FrappeRequestError({
        kind: aborted ? "timeout" : "network",
        message: aborted
          ? `The business system did not answer within ${this.timeoutMs} ms.`
          : `The business system could not be reached: ${describe(error)}`,
      });
    } finally {
      clearTimeout(timer);
    }
    const text = await response.text().catch(() => "");
    let parsed: unknown;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
    }
    if (response.ok) {
      if (parsed === undefined) {
        throw new FrappeRequestError({
          kind: "http",
          status: response.status,
          message: "The business system returned a non-JSON response.",
        });
      }
      return parsed;
    }
    const body = (parsed ?? {}) as {
      exc_type?: unknown;
      _server_messages?: unknown;
      _savingroup_error?: unknown;
      exception?: unknown;
      message?: unknown;
    };
    const excType = typeof body.exc_type === "string" ? body.exc_type : undefined;
    const serverMessages = parseServerMessages(body._server_messages);
    const envelope = body._savingroup_error;
    if (envelope && typeof envelope === "object") serverMessages.unshift(JSON.stringify(envelope));
    if (typeof body.exception === "string") {
      const last = lastLine(body.exception);
      if (last.startsWith("{")) serverMessages.push(last);
    }
    if (serverMessages.length === 0 && typeof body.message === "string") {
      serverMessages.push(stripHtml(body.message));
    }
    const typed = businessCodeFromFrappeError(excType, serverMessages);
    const summary =
      typed.message ??
      serverMessages[0] ??
      (typeof body.exception === "string" ? lastLine(body.exception) : undefined) ??
      `HTTP ${response.status}`;
    throw new FrappeRequestError({
      kind: "http",
      status: response.status,
      excType,
      serverMessages,
      businessCode: typed.code,
      message: summary.slice(0, MAX_MESSAGE_CHARS),
    });
  }
}

function resourcePath(doctype: string, name?: string): string {
  const base = `/api/resource/${encodeURIComponent(doctype)}`;
  return name === undefined ? base : `${base}/${encodeURIComponent(name)}`;
}

function lastLine(value: string): string {
  const lines = value.trim().split("\n");
  return stripHtml(lines[lines.length - 1] ?? value);
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: { code?: unknown } }).cause;
    const code = cause && typeof cause.code === "string" ? ` (${cause.code})` : "";
    return `${error.message}${code}`;
  }
  return String(error);
}
