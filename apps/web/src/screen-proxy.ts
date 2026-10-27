import type { IncomingHttpHeaders } from "node:http";
import type { ScreenProxyTarget } from "@savingroup/core/node/screen-capability";
import {
  isScreenProxyTarget,
  SCREEN_RECHECK_MS,
  SCREEN_TARGET_ENDPOINT,
} from "@savingroup/core/node/screen-capability";

const SENSITIVE_FORWARD_HEADERS = new Set([
  "authorization",
  "cookie",
  "host",
  "proxy-authenticate",
  "proxy-authorization",
]);

/**
 * A burst of noVNC asset requests queues behind the API's database pool, and a
 * remote database answers in hundreds of milliseconds per query. Give the
 * authority room to answer instead of treating queueing as an outage.
 */
export const SCREEN_AUTHORITY_TIMEOUT_MS = 10_000;
/**
 * An open stream survives this long without a reachable authority. An explicit
 * denial still revokes at the next recheck; only unreachable or timed-out
 * checks are tolerated, and the stream fails closed once the grace elapses.
 */
export const SCREEN_AUTHORITY_GRACE_MS = 15_000;

export type ScreenTargetFailure =
  | "invalid_path"
  | "authority_rejected"
  | "invalid_authority_response"
  | "authority_unavailable";

export type ScreenAuthorityResult =
  | { target: ScreenProxyTarget; failure?: undefined }
  | { target: null; failure: ScreenTargetFailure };

/** Concurrent checks of one capability path share a single authority round trip. */
const inFlightChecks = new Map<string, Promise<ScreenAuthorityResult>>();

/** Ask the API whether a capability path is still live. Never caches a positive answer. */
export function checkNovncTarget(
  url: string | undefined,
  secret: string,
  api: string,
): Promise<ScreenAuthorityResult> {
  if (!url?.startsWith("/novnc/session/")) {
    return Promise.resolve({ target: null, failure: "invalid_path" });
  }
  const key = `${api}\0${url}`;
  const pending = inFlightChecks.get(key);
  if (pending) return pending;
  const check = fetchNovncTarget(url, secret, api).finally(() => {
    if (inFlightChecks.get(key) === check) inFlightChecks.delete(key);
  });
  inFlightChecks.set(key, check);
  return check;
}

async function fetchNovncTarget(
  url: string,
  secret: string,
  api: string,
): Promise<ScreenAuthorityResult> {
  try {
    const response = await fetch(new URL(SCREEN_TARGET_ENDPOINT, api), {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(SCREEN_AUTHORITY_TIMEOUT_MS),
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ path: url }),
    });
    if (!response.ok) return { target: null, failure: "authority_rejected" };
    let target: unknown;
    try {
      target = await response.json();
    } catch (error) {
      return {
        target: null,
        failure:
          error instanceof SyntaxError ? "invalid_authority_response" : "authority_unavailable",
      };
    }
    if (isScreenProxyTarget(target)) return { target };
    return { target: null, failure: "invalid_authority_response" };
  } catch {
    return { target: null, failure: "authority_unavailable" };
  }
}

/** Fail closed when the authoritative lifecycle check is unavailable. */
export async function resolveNovncTarget(
  url: string | undefined,
  secret: string,
  api: string,
  onFailure?: (reason: ScreenTargetFailure) => void,
): Promise<ScreenProxyTarget | null> {
  const result = await checkNovncTarget(url, secret, api);
  if (result.failure) onFailure?.(result.failure);
  return result.target;
}

function isHttp2PseudoHeader(key: string) {
  return key.startsWith(":");
}

export function safeProxyHeaders(headers: IncomingHttpHeaders) {
  return Object.fromEntries(
    Object.entries(headers).filter(([key, value]) => {
      return (
        value != null &&
        !isHttp2PseudoHeader(key) &&
        !SENSITIVE_FORWARD_HEADERS.has(key.toLowerCase())
      );
    }),
  );
}

/**
 * Recheck streams as well as new requests; no positive authorization cache.
 * A denial revokes immediately. An unreachable authority is tolerated for
 * SCREEN_AUTHORITY_GRACE_MS so a slow database does not drop a live screen,
 * then the stream fails closed.
 */
export function watchScreenAuthorization(
  check: () => Promise<ScreenAuthorityResult>,
  revoke: () => void,
) {
  let stopped = false;
  let unavailableSince: number | undefined;
  let timer: ReturnType<typeof setTimeout>;
  const tick = async () => {
    let result: ScreenAuthorityResult;
    try {
      result = await check();
    } catch {
      result = { target: null, failure: "authority_unavailable" };
    }
    if (stopped) return;
    if (result.failure === "authority_unavailable") {
      unavailableSince ??= Date.now();
      if (Date.now() - unavailableSince >= SCREEN_AUTHORITY_GRACE_MS) {
        stopped = true;
        revoke();
        return;
      }
    } else if (result.failure) {
      stopped = true;
      revoke();
      return;
    } else {
      unavailableSince = undefined;
    }
    timer = setTimeout(tick, SCREEN_RECHECK_MS);
    timer.unref?.();
  };
  timer = setTimeout(tick, SCREEN_RECHECK_MS);
  timer.unref?.();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
