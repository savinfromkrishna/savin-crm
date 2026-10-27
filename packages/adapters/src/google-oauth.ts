import { createHash, randomBytes } from "node:crypto";
import { readBoundedResponseBytes } from "@savingroup/core";
import { combineSignals, sanitizeConnectorError } from "./connector-safety.js";

export const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
/** Identity scopes ride along with every request so the callback learns which account consented. */
export const GOOGLE_IDENTITY_SCOPES = ["openid", "email", "profile"] as const;
export const GOOGLE_CALLBACK_PATH = "/api/integrations/google/callback";

const TOKEN_REQUEST_TIMEOUT_MS = 15_000;
const MAX_TOKEN_RESPONSE_BYTES = 64 * 1024;
const ID_TOKEN_CLOCK_SKEW_MS = 5 * 60_000;
const GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

export interface GoogleClientConfig {
  clientId: string;
  clientSecret: string;
}

export type GoogleFetch = typeof fetch;

export function googleRedirectUri(webOrigin: string): string {
  return new URL(GOOGLE_CALLBACK_PATH, webOrigin).toString();
}

export function isGoogleClientConfigured(
  config: Partial<GoogleClientConfig> | undefined,
): config is GoogleClientConfig {
  return Boolean(config?.clientId?.trim() && config.clientSecret?.trim());
}

/**
 * A rejection from Google's OAuth endpoints. `invalid_grant` on refresh means the
 * user revoked access, the grant expired, or the password changed: the account
 * must be authorized again. `invalid_client` is a deployment configuration error.
 */
export class GoogleOAuthError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GoogleOAuthError";
  }

  get terminal(): boolean {
    return this.code === "invalid_grant" || this.code === "unauthorized_client";
  }
}

function base64Url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

/** RFC 7636 S256 pair. The verifier never leaves the server. */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(48));
  return { verifier, challenge: base64Url(createHash("sha256").update(verifier).digest()) };
}

export function newOAuthState(): string {
  return base64Url(randomBytes(32));
}

export function newOAuthNonce(): string {
  return base64Url(randomBytes(24));
}

/** Only the hash is stored, so a database read cannot forge a callback. */
export function hashOAuthState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

export function googleAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  scopes: readonly string[];
  state: string;
  codeChallenge: string;
  nonce: string;
  loginHint?: string;
}): string {
  const url = new URL(GOOGLE_AUTHORIZE_URL);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", [...new Set(input.scopes)].join(" "));
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("nonce", input.nonce);
  // Offline access returns a refresh token; consent forces one on every grant so a
  // reconnect never keeps a dead refresh token. Granted scopes accumulate.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  if (input.loginHint) {
    url.searchParams.set("login_hint", input.loginHint);
    url.searchParams.set("prompt", "consent");
  } else {
    url.searchParams.set("prompt", "select_account consent");
  }
  return url.toString();
}

export interface GoogleTokenResponse {
  accessToken: string;
  refreshToken?: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  /** Every scope the account has granted this client, not only the ones just requested. */
  scopes: string[];
  idToken?: string;
}

export function parseGrantedScopes(value: unknown): string[] {
  return typeof value === "string" ? [...new Set(value.split(/\s+/).filter(Boolean))] : [];
}

async function tokenRequest(
  body: URLSearchParams,
  options: { fetch?: GoogleFetch; signal?: AbortSignal; secrets: string[]; now?: () => number },
): Promise<GoogleTokenResponse> {
  const signal = combineSignals(options.signal, AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS));
  const response = await (options.fetch ?? globalThis.fetch)(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body,
    redirect: "error",
    signal,
  });
  const text = new TextDecoder().decode(
    await readBoundedResponseBytes(response, {
      maxBytes: MAX_TOKEN_RESPONSE_BYTES,
      tooLargeMessage: "Google token response is too large",
      read: (operation) => operation(),
    }),
  );
  let parsed: Record<string, unknown> = {};
  try {
    const value = JSON.parse(text) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      parsed = value as Record<string, unknown>;
    }
  } catch {
    // Non-JSON bodies are reported by status below.
  }
  if (!response.ok) {
    const code = typeof parsed.error === "string" ? parsed.error : `http_${response.status}`;
    const description =
      typeof parsed.error_description === "string" ? parsed.error_description : "";
    throw new GoogleOAuthError(
      code,
      response.status,
      sanitizeConnectorError(
        `Google rejected the token request (${code}${description ? `: ${description}` : ""})`,
        options.secrets,
      ),
    );
  }
  const accessToken = typeof parsed.access_token === "string" ? parsed.access_token : "";
  const expiresIn = typeof parsed.expires_in === "number" ? parsed.expires_in : 3_600;
  if (!accessToken) {
    throw new GoogleOAuthError("invalid_response", response.status, "Google returned no token");
  }
  return {
    accessToken,
    ...(typeof parsed.refresh_token === "string" && parsed.refresh_token
      ? { refreshToken: parsed.refresh_token }
      : {}),
    expiresAt: (options.now ?? Date.now)() + Math.max(60, expiresIn) * 1_000,
    scopes: parseGrantedScopes(parsed.scope),
    ...(typeof parsed.id_token === "string" ? { idToken: parsed.id_token } : {}),
  };
}

export async function exchangeGoogleAuthorizationCode(
  client: GoogleClientConfig,
  input: { code: string; redirectUri: string; codeVerifier: string },
  options: { fetch?: GoogleFetch; signal?: AbortSignal; now?: () => number } = {},
): Promise<GoogleTokenResponse> {
  return tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
      client_id: client.clientId,
      client_secret: client.clientSecret,
    }),
    { ...options, secrets: [client.clientSecret, input.code, input.codeVerifier] },
  );
}

export async function refreshGoogleAccessToken(
  client: GoogleClientConfig,
  refreshToken: string,
  options: { fetch?: GoogleFetch; signal?: AbortSignal; now?: () => number } = {},
): Promise<GoogleTokenResponse> {
  return tokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: client.clientId,
      client_secret: client.clientSecret,
    }),
    { ...options, secrets: [client.clientSecret, refreshToken] },
  );
}

/**
 * Google revokes the whole grant, every scope this client holds for the account.
 * An already invalid token counts as revoked.
 */
export async function revokeGoogleToken(
  token: string,
  options: { fetch?: GoogleFetch; signal?: AbortSignal } = {},
): Promise<void> {
  const signal = combineSignals(options.signal, AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS));
  const response = await (options.fetch ?? globalThis.fetch)(GOOGLE_REVOKE_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
    redirect: "error",
    signal,
  });
  await response.body?.cancel().catch(() => undefined);
  if (response.ok || response.status === 400) return;
  throw new Error(`Google token revocation failed with HTTP ${response.status}`);
}

/**
 * Exchanging an unusable code proves the client id and secret without a user:
 * Google answers invalid_grant for a known client and invalid_client otherwise.
 */
export async function verifyGoogleClient(
  client: GoogleClientConfig,
  redirectUri: string,
  options: { fetch?: GoogleFetch; signal?: AbortSignal } = {},
): Promise<void> {
  try {
    await exchangeGoogleAuthorizationCode(
      client,
      { code: "savingroup-verify-client", redirectUri, codeVerifier: createPkcePair().verifier },
      options,
    );
  } catch (error) {
    if (error instanceof GoogleOAuthError && error.code === "invalid_grant") return;
    throw new Error("Google rejected this client ID or secret");
  }
  throw new Error("Google accepted a placeholder code");
}

export interface GoogleIdentity {
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

/**
 * Claims of an ID token received straight from the token endpoint over TLS. OpenID
 * Connect Core 3.1.3.7 lets that channel stand in for the signature check; the
 * audience, issuer, expiry and nonce are still verified here.
 */
export function googleIdentityFromIdToken(
  idToken: string | undefined,
  expected: { clientId: string; nonce: string; now?: number },
): GoogleIdentity {
  const segments = idToken?.split(".") ?? [];
  if (segments.length !== 3 || !segments[1]) throw new Error("Google did not return an ID token");
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    throw new Error("Google returned an unreadable ID token");
  }
  const now = expected.now ?? Date.now();
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!GOOGLE_ISSUERS.has(String(claims.iss))) throw new Error("ID token issuer is not Google");
  if (!audience.includes(expected.clientId)) throw new Error("ID token was issued to another app");
  if (typeof claims.exp !== "number" || claims.exp * 1_000 < now - ID_TOKEN_CLOCK_SKEW_MS) {
    throw new Error("ID token has expired");
  }
  if (claims.nonce !== expected.nonce) throw new Error("ID token nonce does not match");
  const subject = typeof claims.sub === "string" ? claims.sub.trim() : "";
  const email = typeof claims.email === "string" ? claims.email.trim() : "";
  if (!subject) throw new Error("ID token has no subject");
  if (!email) throw new Error("Google did not share the account email");
  return {
    subject,
    email,
    emailVerified: claims.email_verified === true || claims.email_verified === "true",
    name: typeof claims.name === "string" ? claims.name.trim() : "",
  };
}
