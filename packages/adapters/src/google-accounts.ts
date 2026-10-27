import type { SecretRecord, SecretStore } from "@savingroup/adapter-kit";
import type { PrismaClient } from "@savingroup/db";
import { getLogger } from "@savingroup/logging";
import {
  type GoogleClientConfig,
  type GoogleFetch,
  GoogleOAuthError,
  refreshGoogleAccessToken,
} from "./google-oauth.js";
import { persistPreparedSecret } from "./secret-persistence.js";

export const GOOGLE_CONNECTOR_ID = "google";
export const GOOGLE_SECRET_KIND = "connector:google";
/** Refresh a little early so a token cannot expire between the check and the request. */
const ACCESS_TOKEN_MARGIN_MS = 2 * 60_000;

/** The only credential at rest. Access tokens stay in process memory. */
export interface GoogleGrant {
  refreshToken: string;
}

export interface GoogleAccountRecord {
  id: string;
  spaceId: string;
  userId: string;
  email: string;
  status: string;
  scopes: string[];
  secretId: string | null;
  secret: { id: string; ciphertext: string } | null;
}

export class GoogleReauthorizationRequiredError extends Error {
  constructor(readonly email: string) {
    super(`Google access for ${email} expired or was revoked. Reconnect it in Integrations.`);
    this.name = "GoogleReauthorizationRequiredError";
  }
}

function sameScopes(left: readonly string[], right: readonly string[]): boolean {
  const set = new Set(left);
  return left.length === right.length && right.every((scope) => set.has(scope));
}

export class GoogleTokenVault {
  private readonly cache = new Map<
    string,
    { secretId: string; token: string; expiresAt: number }
  >();
  private readonly refreshing = new Map<string, Promise<string>>();

  constructor(
    private readonly options: {
      prisma: PrismaClient;
      secrets: SecretStore;
      client: GoogleClientConfig;
      fetch?: GoogleFetch;
      now?: () => number;
    },
  ) {}

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  /** Keep the access token a fresh authorization returned, so first use skips a refresh. */
  remember(accountId: string, secretId: string, token: string, expiresAt: number): void {
    this.cache.set(accountId, { secretId, token, expiresAt });
  }

  forget(accountId: string): void {
    this.cache.delete(accountId);
  }

  async seal(
    grant: GoogleGrant,
    owner: { spaceId: string; userId: string },
  ): Promise<SecretRecord> {
    return this.options.secrets.put(JSON.stringify(grant), {
      operationId: "google.grant",
      traceId: "google.grant",
      spaceId: owner.spaceId,
      userId: owner.userId,
      signal: AbortSignal.timeout(30_000),
    });
  }

  async open(secret: { id: string; ciphertext: string }): Promise<GoogleGrant> {
    const value = JSON.parse(await this.options.secrets.load(secret.ciphertext, secret.id)) as {
      refreshToken?: unknown;
    };
    if (typeof value.refreshToken !== "string" || !value.refreshToken) {
      throw new Error("Stored Google grant is unreadable");
    }
    return { refreshToken: value.refreshToken };
  }

  /**
   * A valid access token for the account. Concurrent callers share one refresh;
   * a refresh Google rejects as invalid_grant marks the account for reconnection.
   */
  async accessToken(
    account: GoogleAccountRecord,
    options: { forceRefresh?: boolean } = {},
  ): Promise<string> {
    if (account.status !== "active" || !account.secret) {
      throw new GoogleReauthorizationRequiredError(account.email);
    }
    const secret = account.secret;
    const cached = this.cache.get(account.id);
    if (
      !options.forceRefresh &&
      cached?.secretId === secret.id &&
      cached.expiresAt - this.now() > ACCESS_TOKEN_MARGIN_MS
    ) {
      return cached.token;
    }
    const key = `${account.id}:${secret.id}`;
    const inflight = this.refreshing.get(key);
    if (inflight) return inflight;
    const refresh = this.refresh(account, secret).finally(() => this.refreshing.delete(key));
    this.refreshing.set(key, refresh);
    return refresh;
  }

  private async refresh(
    account: GoogleAccountRecord,
    secret: { id: string; ciphertext: string },
  ): Promise<string> {
    const grant = await this.open(secret);
    let response: Awaited<ReturnType<typeof refreshGoogleAccessToken>>;
    try {
      response = await refreshGoogleAccessToken(this.options.client, grant.refreshToken, {
        fetch: this.options.fetch,
        now: this.options.now,
      });
    } catch (error) {
      if (error instanceof GoogleOAuthError && error.terminal) {
        this.cache.delete(account.id);
        await this.markReauthorize(account, secret.id, error.message);
        throw new GoogleReauthorizationRequiredError(account.email);
      }
      if (error instanceof GoogleOAuthError && error.code === "invalid_client") {
        throw new Error(
          "Google rejected this deployment's OAuth client. The server owner must update it in Integrations.",
        );
      }
      throw error;
    }
    this.cache.set(account.id, {
      secretId: secret.id,
      token: response.accessToken,
      expiresAt: response.expiresAt,
    });
    const scopes =
      response.scopes.length > 0 && !sameScopes(response.scopes, account.scopes)
        ? response.scopes
        : undefined;
    if (response.refreshToken && response.refreshToken !== grant.refreshToken) {
      await this.rotate(account, secret.id, response.refreshToken, scopes);
    } else {
      // Only the row this grant still backs; a reconnect may already have replaced it.
      await this.options.prisma.connectorAccount
        .updateMany({
          where: { id: account.id, secretId: secret.id },
          data: { refreshedAt: new Date(this.now()), ...(scopes ? { scopes } : {}) },
        })
        .catch((error: unknown) =>
          getLogger().error("google token refresh bookkeeping failed", error),
        );
    }
    return response.accessToken;
  }

  /** Google rarely rotates refresh tokens; when it does, store the new one unless a reconnect won. */
  private async rotate(
    account: GoogleAccountRecord,
    previousSecretId: string,
    refreshToken: string,
    scopes: string[] | undefined,
  ): Promise<void> {
    const { prisma, secrets } = this.options;
    const stored = await this.seal({ refreshToken }, account);
    const committed = await persistPreparedSecret(prisma, secrets, stored, () =>
      prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM connector_accounts WHERE id = ${account.id} FOR UPDATE`;
        const current = await tx.connectorAccount.findUnique({
          where: { id: account.id },
          select: { secretId: true },
        });
        if (current?.secretId !== previousSecretId) return false;
        await tx.secret.create({
          data: {
            id: stored.id,
            userId: account.userId,
            spaceId: account.spaceId,
            kind: GOOGLE_SECRET_KIND,
            ciphertext: stored.ciphertext,
          },
        });
        await tx.connectorAccount.update({
          where: { id: account.id },
          data: {
            secretId: stored.id,
            refreshedAt: new Date(this.now()),
            ...(scopes ? { scopes } : {}),
          },
        });
        await tx.secret.deleteMany({ where: { id: previousSecretId } });
        return true;
      }),
    );
    if (committed) {
      const cached = this.cache.get(account.id);
      if (cached) this.cache.set(account.id, { ...cached, secretId: stored.id });
    }
  }

  /** Compare-and-set on the grant, so a reconnect that already replaced it stays active. */
  private async markReauthorize(
    account: GoogleAccountRecord,
    secretId: string,
    reason: string,
  ): Promise<void> {
    await this.options.prisma.connectorAccount.updateMany({
      where: { id: account.id, secretId, status: "active" },
      data: { status: "reauthorize", lastError: reason.slice(0, 500) },
    });
  }
}
