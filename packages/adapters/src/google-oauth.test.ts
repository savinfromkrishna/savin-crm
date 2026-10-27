import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createPkcePair,
  exchangeGoogleAuthorizationCode,
  GoogleOAuthError,
  googleAuthorizationUrl,
  googleIdentityFromIdToken,
  googleRedirectUri,
  hashOAuthState,
  refreshGoogleAccessToken,
  revokeGoogleToken,
  verifyGoogleClient,
} from "./google-oauth.js";

const CLIENT = {
  clientId: "client.apps.googleusercontent.com",
  clientSecret: "GOCSPX-fake-secret",
};

function idToken(claims: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256" })}.${encode(claims)}.signature`;
}

function tokenEndpoint(status: number, body: unknown, seen: URLSearchParams[] = []): typeof fetch {
  return async (_input, init) => {
    seen.push(new URLSearchParams(String(init?.body)));
    return Response.json(body, { status });
  };
}

describe("google oauth", () => {
  it("derives the callback from the web origin", () => {
    expect(googleRedirectUri("https://savingroup.example.com")).toBe(
      "https://savingroup.example.com/api/integrations/google/callback",
    );
  });

  it("creates an RFC 7636 S256 pair and hashes state", () => {
    const pair = createPkcePair();
    expect(pair.verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(pair.challenge).toBe(createHash("sha256").update(pair.verifier).digest("base64url"));
    expect(hashOAuthState("state")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("asks for an account choice unless one is hinted", () => {
    const base = {
      clientId: CLIENT.clientId,
      redirectUri: "https://savingroup.test/cb",
      scopes: ["openid", "email", "openid"],
      state: "s",
      codeChallenge: "c",
      nonce: "n",
    };
    const chooser = new URL(googleAuthorizationUrl(base)).searchParams;
    expect(chooser.get("prompt")).toBe("select_account consent");
    expect(chooser.get("scope")).toBe("openid email");
    const hinted = new URL(googleAuthorizationUrl({ ...base, loginHint: "a@example.test" }))
      .searchParams;
    expect(hinted.get("prompt")).toBe("consent");
    expect(hinted.get("login_hint")).toBe("a@example.test");
  });

  it("exchanges a code with the verifier and reports every granted scope", async () => {
    const seen: URLSearchParams[] = [];
    const tokens = await exchangeGoogleAuthorizationCode(
      CLIENT,
      { code: "code-1", redirectUri: "https://savingroup.test/cb", codeVerifier: "verifier" },
      {
        fetch: tokenEndpoint(
          200,
          {
            access_token: "ya29.fake",
            refresh_token: "1//fake",
            expires_in: 3599,
            scope: "openid https://www.googleapis.com/auth/gmail.readonly",
          },
          seen,
        ),
        now: () => 1_000,
      },
    );
    expect(seen[0]?.get("code_verifier")).toBe("verifier");
    expect(seen[0]?.get("grant_type")).toBe("authorization_code");
    expect(tokens).toEqual({
      accessToken: "ya29.fake",
      refreshToken: "1//fake",
      expiresAt: 1_000 + 3_599_000,
      scopes: ["openid", "https://www.googleapis.com/auth/gmail.readonly"],
    });
  });

  it("classifies a revoked refresh token as terminal without leaking secrets", async () => {
    const error = await refreshGoogleAccessToken(CLIENT, "1//refresh-secret", {
      fetch: tokenEndpoint(400, {
        error: "invalid_grant",
        error_description: "Token 1//refresh-secret has been expired or revoked.",
      }),
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GoogleOAuthError);
    expect((error as GoogleOAuthError).terminal).toBe(true);
    expect((error as Error).message).not.toContain("1//refresh-secret");
  });

  it("verifies client credentials with a placeholder code", async () => {
    await expect(
      verifyGoogleClient(CLIENT, "https://savingroup.test/cb", {
        fetch: tokenEndpoint(400, { error: "invalid_grant" }),
      }),
    ).resolves.toBeUndefined();
    await expect(
      verifyGoogleClient(CLIENT, "https://savingroup.test/cb", {
        fetch: tokenEndpoint(401, { error: "invalid_client" }),
      }),
    ).rejects.toThrow("Google rejected this client ID or secret");
  });

  it("treats an already invalid token as revoked", async () => {
    await expect(
      revokeGoogleToken("t", { fetch: async () => new Response(null, { status: 400 }) }),
    ).resolves.toBeUndefined();
    await expect(
      revokeGoogleToken("t", { fetch: async () => new Response(null, { status: 503 }) }),
    ).rejects.toThrow("HTTP 503");
  });

  describe("ID token claims", () => {
    const now = Date.parse("2026-10-11T12:00:00Z");
    const valid = {
      iss: "https://accounts.google.com",
      aud: CLIENT.clientId,
      sub: "123",
      email: "a@example.test",
      email_verified: true,
      nonce: "n",
      exp: now / 1_000 + 600,
    };
    const check = (claims: Record<string, unknown>) =>
      googleIdentityFromIdToken(idToken(claims), { clientId: CLIENT.clientId, nonce: "n", now });

    it("accepts Google's claims for this client and nonce", () => {
      expect(check(valid)).toEqual({
        subject: "123",
        email: "a@example.test",
        emailVerified: true,
        name: "",
      });
    });

    it.each([
      ["issuer", { iss: "https://evil.example" }, "issuer"],
      ["audience", { aud: "other" }, "another app"],
      ["expiry", { exp: now / 1_000 - 3_600 }, "expired"],
      ["nonce", { nonce: "replayed" }, "nonce"],
      ["subject", { sub: "" }, "subject"],
      ["email", { email: undefined }, "email"],
    ])("rejects a wrong %s", (_field, override, message) => {
      expect(() => check({ ...valid, ...override })).toThrow(message);
    });

    it("rejects a missing or malformed token", () => {
      expect(() =>
        googleIdentityFromIdToken(undefined, { clientId: CLIENT.clientId, nonce: "n" }),
      ).toThrow("did not return an ID token");
      expect(() =>
        googleIdentityFromIdToken("a.b.c", { clientId: CLIENT.clientId, nonce: "n" }),
      ).toThrow("unreadable");
    });
  });
});
