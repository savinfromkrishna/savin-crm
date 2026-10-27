import { randomUUID } from "node:crypto";
import type {
  AdapterContext,
  ConnectedConnector,
  ConnectionAuthRequest,
  ConnectionFinishResult,
  ConnectorCall,
  ConnectorCatalogItem,
  ConnectorEvent,
  ConnectorTool,
  ManagedConnectorProvider,
  SecretStore,
} from "@savingroup/adapter-kit";
import type { ConnectionAccount, ConnectionActivity } from "@savingroup/contracts";
import type { Prisma, PrismaClient } from "@savingroup/db";
import { lockProviderConnectionScope, requireMembership } from "@savingroup/db";
import { getLogger } from "@savingroup/logging";
import { z } from "zod";
import { filterCatalog } from "./composio-connector.js";
import { sanitizeConnectorError } from "./connector-safety.js";
import {
  GOOGLE_CONNECTOR_ID,
  GOOGLE_SECRET_KIND,
  type GoogleAccountRecord,
  GoogleReauthorizationRequiredError,
  GoogleTokenVault,
} from "./google-accounts.js";
import { GoogleApi, GoogleApiError } from "./google-api.js";
import {
  createPkcePair,
  exchangeGoogleAuthorizationCode,
  GOOGLE_IDENTITY_SCOPES,
  type GoogleClientConfig,
  type GoogleFetch,
  googleAuthorizationUrl,
  googleIdentityFromIdToken,
  hashOAuthState,
  newOAuthNonce,
  newOAuthState,
  revokeGoogleToken,
  verifyGoogleClient,
} from "./google-oauth.js";
import {
  GOOGLE_SERVICES,
  googleOperationNamed,
  googlePermission,
  googleService,
} from "./google-services.js";
import {
  type GoogleOperation,
  type GooglePermission,
  type GoogleServiceDefinition,
  hasGooglePermission,
} from "./google-tools.js";
import {
  CATALOG_EXECUTE,
  catalogEntries,
  DIRECT_TOOL_LIMIT,
  executeLazyCatalogControl,
  isLazyCatalogControlRoute,
  lazyCatalogTools,
  resolveCatalogCall,
} from "./lazy-tool-catalog.js";
import { persistPreparedSecret } from "./secret-persistence.js";

export const GOOGLE_ACCESS_TOOL = "google_get_access";
const AUTHORIZATION_TTL_MS = 10 * 60_000;
const MAX_PENDING_AUTHORIZATIONS = 20;
const ACTIVITY_RETENTION_MS = 30 * 24 * 60 * 60_000;
/** A running activity this quiet belongs to a process that stopped. */
const STALE_ACTIVITY_MS = 60 * 60_000;
const PROGRESS_INTERVAL_MS = 5_000;
const ACTIVITY_LIMIT = 20;

export interface GoogleConnectorOptions {
  prisma: PrismaClient;
  secrets: SecretStore;
  client: GoogleClientConfig;
  /** The callback URL registered for this OAuth client in Google Cloud Console. */
  redirectUri: string;
  fetch?: GoogleFetch;
  now?: () => number;
}

/** Why a callback failed; the web app words each one for the user. */
export type GoogleCallbackFailure =
  | "expired"
  | "session"
  | "denied"
  | "not_granted"
  | "offline"
  | "removed"
  | "failed";

export type GoogleCallbackResult =
  | { status: "connected"; provider: string }
  | { status: "failed"; reason: GoogleCallbackFailure; provider?: string }
  /** An app-started authorization: send the callback on to the app. */
  | { status: "handoff"; state: string; code?: string; error?: string };

type Owner = { spaceId: string; userId: string };
type Binding = { connection: ConnectedConnector; account: GoogleAccountRecord };

const ACCOUNT_SELECT = {
  id: true,
  spaceId: true,
  userId: true,
  email: true,
  status: true,
  scopes: true,
  secretId: true,
  secret: { select: { id: true, ciphertext: true } },
} as const;

const AccessInput = z.object({
  service: z.string().max(64).optional(),
  permission: z.string().max(64).optional(),
  account: z.string().max(320).optional(),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function grants(
  service: GoogleServiceDefinition,
  required: readonly string[],
  scopes: readonly string[],
): boolean {
  return required.every((id) => {
    const permission = googlePermission(service, id);
    return Boolean(permission && hasGooglePermission(permission, scopes));
  });
}

async function lockGoogleAccount(
  tx: Prisma.TransactionClient,
  owner: Owner,
  subject: string,
): Promise<void> {
  const key = `space:${owner.spaceId}|user:${owner.userId}|connector:${GOOGLE_CONNECTOR_ID}|subject:${subject}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('connector-account'), hashtext(${key}))`;
}

/**
 * Google Workspace and YouTube connected straight to Google with OAuth, no hosted
 * broker. One Google account can back several apps; each app is a connection
 * that points at the account, and the account holds the encrypted grant.
 */
export class GoogleConnector implements ManagedConnectorProvider {
  private readonly vault: GoogleTokenVault;

  constructor(private readonly options: GoogleConnectorOptions) {
    this.vault = new GoogleTokenVault({
      prisma: options.prisma,
      secrets: options.secrets,
      client: options.client,
      fetch: options.fetch,
      now: options.now,
    });
  }

  describe() {
    return {
      id: GOOGLE_CONNECTOR_ID,
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { discover: true, oauth: true, secretsBrokered: true },
    };
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private get prisma(): PrismaClient {
    return this.options.prisma;
  }

  async verifyCredentials(context: AdapterContext): Promise<void> {
    await verifyGoogleClient(this.options.client, this.options.redirectUri, {
      fetch: this.options.fetch,
      signal: context.signal,
    });
  }

  async catalog(context: AdapterContext, query?: string): Promise<ConnectorCatalogItem[]> {
    await this.sweep({ spaceId: context.spaceId, userId: context.userId }).catch((error) =>
      getLogger().error("google sweep failed", error),
    );
    const connected = new Set(await this.listConnectedExternalIds(context));
    return filterCatalog(
      GOOGLE_SERVICES.map((service) => ({
        connectorId: GOOGLE_CONNECTOR_ID,
        slug: service.slug,
        name: service.name,
        logo: null,
        connected: connected.has(service.slug),
        noAuth: false,
      })),
      query ?? "",
    );
  }

  async listConnectedExternalIds(context: AdapterContext): Promise<string[]> {
    const rows = await this.prisma.connection.findMany({
      where: {
        spaceId: context.spaceId,
        userId: context.userId,
        connectorId: GOOGLE_CONNECTOR_ID,
        status: "connected",
      },
      select: { provider: true },
      distinct: ["provider"],
    });
    return rows.map((row) => row.provider);
  }

  /** Completion happens in the OAuth callback, never by polling. */
  async connectionReady(): Promise<boolean> {
    return false;
  }

  async begin(
    request: ConnectionAuthRequest,
    context: AdapterContext,
  ): Promise<{ authorizationUrl: string; state: string }> {
    const service = googleService(request.provider);
    if (!service) throw new Error(`Unknown Google app ${request.provider}`);
    if (!request.connectionId) throw new Error("Google authorization needs a connection");
    const permissions = (
      request.permissions?.length ? request.permissions : service.defaultPermissions
    ).map((id) => {
      const permission = googlePermission(service, id);
      if (!permission) throw new Error(`${service.name} has no ${id} permission`);
      return permission;
    });
    const owner = { spaceId: context.spaceId, userId: context.userId };
    await this.sweep(owner).catch((error) => getLogger().error("google sweep failed", error));
    const pending = await this.prisma.connectorAuthorization.count({
      where: { ...owner, connectorId: GOOGLE_CONNECTOR_ID },
    });
    if (pending >= MAX_PENDING_AUTHORIZATIONS) {
      throw new Error("Too many Google sign-ins are in progress. Wait a few minutes and retry.");
    }
    const id = randomUUID();
    const state = newOAuthState();
    const nonce = newOAuthNonce();
    const pkce = createPkcePair();
    const scopes = [
      ...new Set([...GOOGLE_IDENTITY_SCOPES, ...permissions.flatMap((item) => item.scopes)]),
    ];
    const sealed = await this.options.secrets.put(
      JSON.stringify({ verifier: pkce.verifier, nonce, app: request.returnTo === "app" }),
      { ...context, operationId: "google.authorize", traceId: "google.authorize" },
      { recordId: id, ephemeral: true },
    );
    await this.prisma.connectorAuthorization.create({
      data: {
        id,
        stateHash: hashOAuthState(state),
        ...owner,
        connectorId: GOOGLE_CONNECTOR_ID,
        connectionId: request.connectionId,
        provider: service.slug,
        scopes,
        ciphertext: sealed.ciphertext,
        expiresAt: new Date(this.now() + AUTHORIZATION_TTL_MS),
      },
    });
    const accountHint = request.accountHint?.trim();
    return {
      authorizationUrl: googleAuthorizationUrl({
        clientId: this.options.client.clientId,
        redirectUri: this.options.redirectUri,
        scopes,
        state,
        codeChallenge: pkce.challenge,
        nonce,
        ...(accountHint && /^[^\s@]+@[^\s@]+$/.test(accountHint) ? { loginHint: accountHint } : {}),
      }),
      // The connection keeps this flow id as its providerRef until the callback binds an account.
      state: id,
    };
  }

  async complete(request: { state: string }): Promise<{ connectionRef: string }> {
    return { connectionRef: request.state };
  }

  async finishAuthorization(
    request: { state: string; code?: string; error?: string },
    context: AdapterContext,
  ): Promise<ConnectionFinishResult> {
    const outcome = await this.handleCallback({
      state: request.state,
      code: request.code ?? null,
      error: request.error ?? null,
      sessionUserId: context.userId,
      fromApp: true,
    });
    if (outcome.status === "connected") return { result: "connected", provider: outcome.provider };
    if (outcome.status === "failed") {
      return {
        result: outcome.reason,
        ...(outcome.provider ? { provider: outcome.provider } : {}),
      };
    }
    return { result: "failed" };
  }

  /**
   * Finish an authorization from Google's redirect. The browser must carry the
   * Savingroup session of the user who started it, so a link sent to someone else
   * cannot attach their Google account to the sender. The state is single use.
   */
  async handleCallback(input: {
    state?: string | null;
    code?: string | null;
    error?: string | null;
    sessionUserId: string | null;
    /** Set when the native app relays the callback through its own authenticated session. */
    fromApp?: boolean;
  }): Promise<GoogleCallbackResult> {
    const failed = (reason: GoogleCallbackFailure, provider?: string): GoogleCallbackResult => ({
      status: "failed",
      reason,
      ...(provider ? { provider } : {}),
    });
    if (!input.state) return failed("expired");
    const flow = await this.prisma.connectorAuthorization.findUnique({
      where: { stateHash: hashOAuthState(input.state) },
    });
    if (
      !flow ||
      flow.connectorId !== GOOGLE_CONNECTOR_ID ||
      flow.expiresAt.getTime() <= this.now()
    ) {
      return failed("expired");
    }
    let sealed: { verifier?: string; nonce?: string; app?: boolean };
    try {
      sealed = JSON.parse(await this.options.secrets.load(flow.ciphertext, flow.id));
    } catch {
      return failed("failed", flow.provider);
    }
    // The phone's browser has no Savingroup session. It hands the callback to the app, which
    // finishes through its own session, so the same-user check below still applies.
    if (sealed.app && !input.fromApp) {
      return {
        status: "handoff",
        state: input.state,
        ...(input.code ? { code: input.code } : {}),
        ...(input.error ? { error: input.error } : {}),
      };
    }
    // Checked before the flow is consumed, so the right person can still finish it.
    if (!input.sessionUserId || input.sessionUserId !== flow.userId) {
      return failed("session", flow.provider);
    }
    try {
      await requireMembership(this.prisma, flow.userId, flow.spaceId);
    } catch {
      return failed("session", flow.provider);
    }
    const owner = { spaceId: flow.spaceId, userId: flow.userId };
    const consumed = await this.prisma.connectorAuthorization.deleteMany({
      where: { id: flow.id, expiresAt: { gt: new Date(this.now()) } },
    });
    if (consumed.count !== 1) return failed("expired");
    const service = googleService(flow.provider);
    const fail = async (
      reason: GoogleCallbackFailure,
      detail: string,
    ): Promise<GoogleCallbackResult> => {
      await this.prisma.connection.updateMany({
        where: { id: flow.connectionId, ...owner, status: "pending", providerRef: flow.id },
        data: { status: "error" },
      });
      await this.record(owner, {
        provider: flow.provider,
        action: "authorize",
        status: "failed",
        error: detail,
      });
      return failed(reason, flow.provider);
    };
    if (!service) return fail("failed", "This Google app is no longer available");
    if (input.error) {
      return fail(
        input.error === "access_denied" ? "denied" : "failed",
        `Google returned ${input.error.slice(0, 64)}`,
      );
    }
    if (!input.code) return fail("failed", "Google returned no authorization code");
    try {
      if (!sealed.verifier || !sealed.nonce) throw new Error("Authorization state is unreadable");
      const tokens = await exchangeGoogleAuthorizationCode(
        this.options.client,
        { code: input.code, redirectUri: this.options.redirectUri, codeVerifier: sealed.verifier },
        { fetch: this.options.fetch, signal: AbortSignal.timeout(20_000), now: this.options.now },
      );
      const identity = googleIdentityFromIdToken(tokens.idToken, {
        clientId: this.options.client.clientId,
        nonce: sealed.nonce,
        now: this.now(),
      });
      // Google's consent screen lets people untick scopes; nothing requested may be granted.
      const identityScopes = new Set<string>(GOOGLE_IDENTITY_SCOPES);
      const requested = flow.scopes.filter((scope) => !identityScopes.has(scope));
      if (requested.length > 0 && !requested.some((scope) => tokens.scopes.includes(scope))) {
        return fail("not_granted", `No ${service.name} permission was granted`);
      }
      const persisted = await this.persistAuthorization(owner, flow, identity, tokens);
      if (!persisted) {
        return fail("offline", "Google returned no refresh token for a new account");
      }
      if (!persisted.attached) {
        // The connection was removed while Google was asking for consent.
        await this.release(owner, persisted.accountId);
        return failed("removed", service.slug);
      }
      const granted = service.permissions.filter((permission) =>
        hasGooglePermission(permission, tokens.scopes),
      );
      getLogger().info("google authorization completed", {
        "connector.provider": service.slug,
        "connector.permissions": granted.map((permission) => permission.id).join(","),
      });
      await this.record(owner, {
        provider: service.slug,
        accountId: persisted.accountId,
        action: "authorize",
        status: "succeeded",
        detail: granted.map((permission) => permission.label).join(", "),
      });
      return { status: "connected", provider: service.slug };
    } catch (error) {
      const detail = sanitizeConnectorError(error, [
        this.options.client.clientSecret,
        input.code,
      ]).slice(0, 300);
      getLogger().warn("google authorization failed", { error: detail });
      return fail("failed", detail);
    }
  }

  /** Stores the grant on the account and binds the waiting connection to it. */
  private async persistAuthorization(
    owner: Owner,
    flow: { id: string; connectionId: string; provider: string },
    identity: { subject: string; email: string; name: string },
    tokens: { accessToken: string; refreshToken?: string; expiresAt: number; scopes: string[] },
  ): Promise<{ accountId: string; attached: boolean } | undefined> {
    let refreshToken = tokens.refreshToken;
    if (!refreshToken) {
      // Google may skip the refresh token for an existing grant; keep the stored one.
      const existing = await this.prisma.connectorAccount.findUnique({
        where: {
          spaceId_userId_connectorId_subject: {
            ...owner,
            connectorId: GOOGLE_CONNECTOR_ID,
            subject: identity.subject,
          },
        },
        select: { secret: { select: { id: true, ciphertext: true } } },
      });
      if (!existing?.secret) return undefined;
      refreshToken = (await this.vault.open(existing.secret)).refreshToken;
    }
    const stored = await this.vault.seal({ refreshToken }, owner);
    const result = await persistPreparedSecret(this.prisma, this.options.secrets, stored, () =>
      this.prisma.$transaction(
        async (tx) => {
          await lockGoogleAccount(tx, owner, identity.subject);
          const where = {
            spaceId_userId_connectorId_subject: {
              ...owner,
              connectorId: GOOGLE_CONNECTOR_ID,
              subject: identity.subject,
            },
          };
          const previous = await tx.connectorAccount.findUnique({
            where,
            select: { secretId: true },
          });
          await tx.secret.create({
            data: {
              id: stored.id,
              ...owner,
              kind: GOOGLE_SECRET_KIND,
              ciphertext: stored.ciphertext,
            },
          });
          const fields = {
            email: identity.email,
            name: identity.name,
            scopes: tokens.scopes,
            status: "active",
            lastError: null,
            secretId: stored.id,
            refreshedAt: new Date(this.now()),
          };
          const account = await tx.connectorAccount.upsert({
            where,
            create: {
              ...owner,
              connectorId: GOOGLE_CONNECTOR_ID,
              subject: identity.subject,
              ...fields,
            },
            update: fields,
            select: { id: true },
          });
          if (previous?.secretId && previous.secretId !== stored.id) {
            await tx.secret.deleteMany({ where: { id: previous.secretId } });
          }
          await lockProviderConnectionScope(tx, owner, GOOGLE_CONNECTOR_ID, flow.provider);
          const row = await tx.connection.findFirst({
            where: { id: flow.connectionId, ...owner, connectorId: GOOGLE_CONNECTOR_ID },
          });
          if (row?.status !== "pending" || row.providerRef !== flow.id) {
            return { accountId: account.id, attached: false };
          }
          // Reconnecting or adding a permission makes a second row for the same account; keep
          // the new one with the old label.
          const siblings = await tx.connection.findMany({
            where: {
              ...owner,
              connectorId: GOOGLE_CONNECTOR_ID,
              provider: flow.provider,
              providerRef: account.id,
              id: { not: row.id },
              status: { in: ["connected", "pending", "error"] },
            },
            orderBy: { createdAt: "asc" },
          });
          await tx.connection.update({
            where: { id: row.id },
            data: {
              status: "connected",
              providerRef: account.id,
              displayName: siblings[0]?.displayName ?? identity.email,
              metadata: {},
            },
          });
          if (siblings.length > 0) {
            await tx.connection.updateMany({
              where: { id: { in: siblings.map((sibling) => sibling.id) } },
              data: { status: "revoked" },
            });
          }
          return { accountId: account.id, attached: true };
        },
        { timeout: 30_000 },
      ),
    );
    this.vault.remember(result.accountId, stored.id, tokens.accessToken, tokens.expiresAt);
    return result;
  }

  /**
   * A connection was removed. Its ref is a flow id while pending and an account id once
   * connected; the account's Google grant is revoked only when no other app still uses it.
   */
  async revoke(connectionRef: string, context: AdapterContext): Promise<void> {
    const owner = { spaceId: context.spaceId, userId: context.userId };
    const flow = await this.prisma.connectorAuthorization.deleteMany({
      where: { id: connectionRef, ...owner, connectorId: GOOGLE_CONNECTOR_ID },
    });
    if (flow.count > 0) return;
    await this.release(owner, connectionRef);
  }

  /** Deletes an account nothing references, then revokes its grant at Google. */
  private async release(owner: Owner, accountId: string): Promise<void> {
    const account = await this.prisma.connectorAccount.findFirst({
      where: { id: accountId, ...owner, connectorId: GOOGLE_CONNECTOR_ID },
      select: { subject: true },
    });
    if (!account) return;
    const released = await this.prisma.$transaction(async (tx) => {
      await lockGoogleAccount(tx, owner, account.subject);
      const current = await tx.connectorAccount.findFirst({
        where: { id: accountId, ...owner, connectorId: GOOGLE_CONNECTOR_ID },
        select: { id: true, secret: { select: { id: true, ciphertext: true } } },
      });
      if (!current) return undefined;
      const references = await tx.connection.count({
        where: {
          ...owner,
          connectorId: GOOGLE_CONNECTOR_ID,
          providerRef: accountId,
          status: { in: ["connected", "pending", "error"] },
        },
      });
      if (references > 0) return undefined;
      const grant = current.secret
        ? await this.vault.open(current.secret).catch(() => undefined)
        : undefined;
      await tx.connectorAccount.delete({ where: { id: accountId } });
      if (current.secret) await tx.secret.deleteMany({ where: { id: current.secret.id } });
      return { grant };
    });
    if (!released) return;
    this.vault.forget(accountId);
    // The local grant is already gone; revoking at Google is best effort.
    let error: string | undefined;
    if (released.grant) {
      await revokeGoogleToken(released.grant.refreshToken, {
        fetch: this.options.fetch,
        signal: AbortSignal.timeout(15_000),
      }).catch((cause: unknown) => {
        error = sanitizeConnectorError(cause).slice(0, 300);
        getLogger().warn("google revoke failed", { error });
      });
    }
    await this.record(owner, {
      provider: "google",
      accountId,
      action: "revoke",
      status: error ? "failed" : "succeeded",
      error,
    });
  }

  /** Expired sign-ins fail their connection; accounts nothing references are released. */
  private async sweep(owner: Owner): Promise<void> {
    const now = new Date(this.now());
    const expired = await this.prisma.connectorAuthorization.findMany({
      where: { ...owner, connectorId: GOOGLE_CONNECTOR_ID, expiresAt: { lte: now } },
      select: { id: true, connectionId: true },
    });
    if (expired.length > 0) {
      await this.prisma.connectorAuthorization.deleteMany({
        where: { id: { in: expired.map((flow) => flow.id) } },
      });
      await this.prisma.connection.updateMany({
        where: {
          ...owner,
          connectorId: GOOGLE_CONNECTOR_ID,
          id: { in: expired.map((flow) => flow.connectionId) },
          status: "pending",
          providerRef: { in: expired.map((flow) => flow.id) },
        },
        data: { status: "error" },
      });
    }
    const accounts = await this.prisma.connectorAccount.findMany({
      where: {
        ...owner,
        connectorId: GOOGLE_CONNECTOR_ID,
        updatedAt: { lt: new Date(now.getTime() - AUTHORIZATION_TTL_MS) },
      },
      select: { id: true },
    });
    if (accounts.length > 0) {
      const used = new Set(
        (
          await this.prisma.connection.findMany({
            where: {
              ...owner,
              connectorId: GOOGLE_CONNECTOR_ID,
              providerRef: { in: accounts.map((account) => account.id) },
              status: { in: ["connected", "pending", "error"] },
            },
            select: { providerRef: true },
          })
        ).map((row) => row.providerRef),
      );
      for (const account of accounts) {
        if (!used.has(account.id)) await this.release(owner, account.id);
      }
    }
    await this.prisma.connectorActivity.deleteMany({
      where: {
        ...owner,
        connectorId: GOOGLE_CONNECTOR_ID,
        createdAt: { lt: new Date(now.getTime() - ACTIVITY_RETENTION_MS) },
      },
    });
  }

  async describeConnections(
    context: AdapterContext,
    connections: Array<{ id: string; provider: string; providerRef: string | null }>,
  ): Promise<Record<string, ConnectionAccount>> {
    const refs = [
      ...new Set(connections.map((row) => row.providerRef).filter((ref): ref is string => !!ref)),
    ];
    if (refs.length === 0) return {};
    const accounts = new Map(
      (
        await this.prisma.connectorAccount.findMany({
          where: {
            id: { in: refs },
            spaceId: context.spaceId,
            userId: context.userId,
            connectorId: GOOGLE_CONNECTOR_ID,
          },
          select: { id: true, email: true, status: true, scopes: true, lastError: true },
        })
      ).map((account) => [account.id, account]),
    );
    const described: Record<string, ConnectionAccount> = {};
    for (const row of connections) {
      const account = row.providerRef ? accounts.get(row.providerRef) : undefined;
      const service = googleService(row.provider);
      if (!account || !service) continue;
      described[row.id] = {
        id: account.id,
        email: account.email,
        status: account.status === "active" ? "ok" : "reconnect",
        permissions: service.permissions.map((permission) => ({
          id: permission.id,
          label: permission.label,
          granted: hasGooglePermission(permission, account.scopes),
        })),
        error: account.status === "active" ? null : account.lastError,
      };
    }
    return described;
  }

  async activity(context: AdapterContext, provider: string): Promise<ConnectionActivity[]> {
    const owner = { spaceId: context.spaceId, userId: context.userId };
    await this.prisma.connectorActivity.updateMany({
      where: {
        ...owner,
        connectorId: GOOGLE_CONNECTOR_ID,
        status: "running",
        updatedAt: { lt: new Date(this.now() - STALE_ACTIVITY_MS) },
      },
      data: { status: "failed", error: "Interrupted before it finished" },
    });
    const rows = await this.prisma.connectorActivity.findMany({
      where: { ...owner, connectorId: GOOGLE_CONNECTOR_ID, provider: { in: [provider, "google"] } },
      orderBy: { createdAt: "desc" },
      take: ACTIVITY_LIMIT,
    });
    const accountIds = [
      ...new Set(rows.map((row) => row.accountId).filter((id): id is string => !!id)),
    ];
    const emails = new Map(
      (
        await this.prisma.connectorAccount.findMany({
          where: { id: { in: accountIds }, ...owner },
          select: { id: true, email: true },
        })
      ).map((account) => [account.id, account.email]),
    );
    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      status: row.status as ConnectionActivity["status"],
      account: row.accountId ? (emails.get(row.accountId) ?? null) : null,
      error: row.error,
      detail: row.detail,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  private async record(
    owner: Owner,
    data: {
      provider: string;
      accountId?: string;
      action: string;
      status: "running" | "succeeded" | "failed";
      error?: string;
      detail?: string;
      runId?: string;
    },
  ): Promise<string | undefined> {
    try {
      const row = await this.prisma.connectorActivity.create({
        data: {
          ...owner,
          connectorId: GOOGLE_CONNECTOR_ID,
          provider: data.provider,
          accountId: data.accountId ?? null,
          action: data.action,
          status: data.status,
          error: data.error?.slice(0, 500) ?? null,
          detail: data.detail?.slice(0, 300) ?? null,
          runId: data.runId ?? null,
        },
        select: { id: true },
      });
      return row.id;
    } catch (error) {
      getLogger().error("google activity could not be recorded", error);
      return undefined;
    }
  }

  private async updateRecord(
    id: string | undefined,
    data: { status?: "succeeded" | "failed"; error?: string; detail?: string },
  ): Promise<void> {
    if (!id) return;
    await this.prisma.connectorActivity
      .update({
        where: { id },
        data: {
          ...(data.status ? { status: data.status } : {}),
          ...(data.error !== undefined ? { error: data.error.slice(0, 500) } : {}),
          ...(data.detail !== undefined ? { detail: data.detail.slice(0, 300) } : {}),
        },
      })
      .catch((error: unknown) => getLogger().error("google activity could not be updated", error));
  }

  /** Accounts behind this run's Google connections, checked against the run's owner. */
  private async bindings(context: AdapterContext): Promise<Map<string, Binding[]>> {
    const connections = (context.connectedConnections ?? []).filter(
      (connection) =>
        connection.connectorId === GOOGLE_CONNECTOR_ID &&
        connection.providerRef &&
        googleService(connection.externalId),
    );
    const byService = new Map<string, Binding[]>();
    if (connections.length === 0) return byService;
    const accounts = new Map(
      (
        await this.prisma.connectorAccount.findMany({
          where: {
            id: { in: [...new Set(connections.map((connection) => connection.providerRef!))] },
            spaceId: context.spaceId,
            userId: context.userId,
            connectorId: GOOGLE_CONNECTOR_ID,
          },
          select: ACCOUNT_SELECT,
        })
      ).map((account) => [account.id, account]),
    );
    for (const connection of connections) {
      const account = accounts.get(connection.providerRef!);
      if (!account) continue;
      const list = byService.get(connection.externalId) ?? [];
      if (!list.some((binding) => binding.account.id === account.id)) {
        list.push({ connection, account });
      }
      byService.set(connection.externalId, list);
    }
    return byService;
  }

  private accessTool(): ConnectorTool {
    return {
      name: GOOGLE_ACCESS_TOOL,
      description:
        "Check which Google apps, accounts, and permissions are connected. Pass service, and optionally permission, to ask the user to connect an app or grant a missing permission: an Authorize button appears in the chat.",
      inputSchema: {
        type: "object",
        properties: {
          service: {
            type: "string",
            enum: GOOGLE_SERVICES.map((service) => service.slug),
            description: "App to connect or check",
          },
          permission: {
            type: "string",
            description: "Permission id, such as read, compose, write, upload, or manage",
          },
          account: { type: "string", description: "Email of a specific connected account" },
        },
      },
      readOnly: true,
      // Scoped to the connector rather than one app, so per-app tool lists leave it out.
      route: {
        connectorId: GOOGLE_CONNECTOR_ID,
        toolName: GOOGLE_ACCESS_TOOL,
        resourceId: GOOGLE_CONNECTOR_ID,
      },
    };
  }

  private operationTool(
    service: GoogleServiceDefinition,
    operation: GoogleOperation,
    eligible: Binding[],
  ): ConnectorTool {
    const schema = z.toJSONSchema(operation.input, { io: "input" }) as Record<string, unknown>;
    delete schema.$schema;
    if (eligible.length > 1) {
      const labels = eligible.map(({ connection, account }) =>
        connection.displayName && connection.displayName !== account.email
          ? `${account.email} (${connection.displayName})`
          : account.email,
      );
      schema.properties = {
        ...(isRecord(schema.properties) ? schema.properties : {}),
        account: {
          type: "string",
          enum: eligible.map(({ account }) => account.email),
          description: `Google account to use: ${labels.join(", ")}`,
        },
      };
      schema.required = [
        ...(Array.isArray(schema.required) ? (schema.required as string[]) : []),
        "account",
      ];
    }
    return {
      name: operation.name,
      description: operation.description,
      inputSchema: schema,
      readOnly: operation.readOnly,
      route: {
        connectorId: GOOGLE_CONNECTOR_ID,
        toolName: operation.name,
        resourceId: service.slug,
        catalogGroup: service.name,
      },
    };
  }

  /** Only operations some connected account has granted; the rest are one authorization away. */
  private async serviceTools(context: AdapterContext): Promise<ConnectorTool[]> {
    const tools: ConnectorTool[] = [];
    for (const [slug, bindings] of await this.bindings(context)) {
      const service = googleService(slug);
      if (!service) continue;
      for (const operation of service.operations) {
        const eligible = bindings.filter(({ account }) =>
          grants(service, operation.requires, account.scopes),
        );
        if (eligible.length > 0) tools.push(this.operationTool(service, operation, eligible));
      }
    }
    return tools;
  }

  async discoverTools(context: AdapterContext): Promise<ConnectorTool[]> {
    const tools = await this.serviceTools(context);
    const access = this.accessTool();
    if (tools.length < DIRECT_TOOL_LIMIT) return [access, ...tools];
    return [
      access,
      ...lazyCatalogTools("google", GOOGLE_CONNECTOR_ID, "Google", catalogEntries(tools)),
    ];
  }

  async resolveCall(
    call: ConnectorCall,
    context: AdapterContext,
  ): Promise<{ call: ConnectorCall; tool: ConnectorTool } | undefined> {
    if (call.route?.resourceId || call.route?.toolName !== CATALOG_EXECUTE) return undefined;
    return resolveCatalogCall(call, catalogEntries(await this.serviceTools(context)));
  }

  async *execute(call: ConnectorCall, context: AdapterContext): AsyncIterable<ConnectorEvent> {
    if (isLazyCatalogControlRoute(call.route)) {
      try {
        yield* executeLazyCatalogControl(
          call,
          catalogEntries(await this.serviceTools(context)),
          (resolved) => this.execute(resolved, context),
        );
      } catch (error) {
        yield { type: "error", message: sanitizeConnectorError(error) };
      }
      return;
    }
    const name = call.route?.toolName ?? call.tool;
    if (name === GOOGLE_ACCESS_TOOL) {
      yield* this.executeAccess(call.args, context);
      return;
    }
    const found = googleOperationNamed(name);
    if (!found) {
      yield { type: "error", message: `Unknown Google tool ${name}` };
      return;
    }
    const { service, operation } = found;
    let binding: Binding;
    try {
      binding = this.chooseAccount(
        service,
        operation,
        (await this.bindings(context)).get(service.slug) ?? [],
        call.args.account,
      );
    } catch (error) {
      yield {
        type: "error",
        message:
          error instanceof GoogleReauthorizationRequiredError
            ? `${error.message} Or call ${GOOGLE_ACCESS_TOOL} with service "${service.slug}" to show the user a reconnect button.`
            : error instanceof Error
              ? error.message
              : String(error),
      };
      return;
    }
    const { account: _account, ...args } = call.args;
    const parsed = operation.input.safeParse(args);
    if (!parsed.success) {
      yield { type: "error", message: `Invalid arguments: ${z.prettifyError(parsed.error)}` };
      return;
    }
    const owner = { spaceId: context.spaceId, userId: context.userId };
    const activity = operation.tracked
      ? await this.record(owner, {
          provider: service.slug,
          accountId: binding.account.id,
          action: operation.name,
          status: "running",
          runId: context.runId,
        })
      : undefined;
    let lastProgress = 0;
    const api = new GoogleApi({
      accessToken: (options) => this.vault.accessToken(binding.account, options),
      onUnauthorized: async () => this.vault.forget(binding.account.id),
      secrets: [this.options.client.clientSecret],
      fetch: this.options.fetch,
      signal: context.signal,
      service: service.name,
    });
    try {
      const result = await operation.run(parsed.data as Record<string, unknown>, {
        api,
        account: { id: binding.account.id, email: binding.account.email },
        workspace: context.workspace,
        executionId: call.executionId,
        signal: context.signal,
        progress: async (message) => {
          if (!activity || this.now() - lastProgress < PROGRESS_INTERVAL_MS) return;
          lastProgress = this.now();
          await this.updateRecord(activity, { detail: message });
        },
      });
      const data = isRecord(result) ? result : { result };
      const link = typeof data.url === "string" ? data.url : undefined;
      if (activity) await this.updateRecord(activity, { status: "succeeded", detail: link ?? "" });
      else {
        await this.record(owner, {
          provider: service.slug,
          accountId: binding.account.id,
          action: operation.name,
          status: "succeeded",
          runId: context.runId,
        });
      }
      yield { type: "result", data: { account: binding.account.email, ...data } };
    } catch (error) {
      const message = this.errorMessage(error, service, operation, binding.account);
      if (activity) await this.updateRecord(activity, { status: "failed", error: message });
      else {
        await this.record(owner, {
          provider: service.slug,
          accountId: binding.account.id,
          action: operation.name,
          status: "failed",
          error: message,
          runId: context.runId,
        });
      }
      yield { type: "error", message };
    }
  }

  /** The account comes from this run's connections, never from model input alone. */
  private chooseAccount(
    service: GoogleServiceDefinition,
    operation: GoogleOperation,
    bindings: Binding[],
    requested: unknown,
  ): Binding {
    if (bindings.length === 0) {
      throw new Error(
        `${service.name} is not connected. Call ${GOOGLE_ACCESS_TOOL} with service "${service.slug}" to ask the user to connect it.`,
      );
    }
    const wanted = typeof requested === "string" ? requested.trim().toLowerCase() : "";
    const eligible = bindings.filter(({ account }) =>
      grants(service, operation.requires, account.scopes),
    );
    let binding: Binding | undefined;
    if (wanted) {
      binding = bindings.find(
        ({ account, connection }) =>
          account.email.toLowerCase() === wanted ||
          connection.displayName.trim().toLowerCase() === wanted,
      );
      if (!binding) {
        throw new Error(
          `No connected ${service.name} account matches ${String(requested)}. Connected: ${bindings.map(({ account }) => account.email).join(", ")}.`,
        );
      }
    } else if (eligible.length === 1) {
      binding = eligible[0];
    } else if (eligible.length > 1) {
      throw new Error(
        `Several ${service.name} accounts are connected. Pass account as one of: ${eligible.map(({ account }) => account.email).join(", ")}.`,
      );
    } else {
      binding = bindings[0];
    }
    if (!binding) throw new Error(`${service.name} is not connected.`);
    if (!grants(service, operation.requires, binding.account.scopes)) {
      const missing = operation.requires
        .map((id) => googlePermission(service, id))
        .filter(
          (permission): permission is GooglePermission =>
            Boolean(permission) && !hasGooglePermission(permission!, binding!.account.scopes),
        );
      throw new Error(
        `${binding.account.email} has not allowed ${service.name}: ${missing.map((permission) => permission.label).join(", ")}. Call ${GOOGLE_ACCESS_TOOL} with service "${service.slug}" and permission "${missing[0]?.id ?? operation.requires[0]}" to ask the user.`,
      );
    }
    if (binding.account.status !== "active") {
      throw new GoogleReauthorizationRequiredError(binding.account.email);
    }
    return binding;
  }

  private errorMessage(
    error: unknown,
    service: GoogleServiceDefinition,
    operation: GoogleOperation,
    account: GoogleAccountRecord,
  ): string {
    if (error instanceof GoogleReauthorizationRequiredError) {
      return `${error.message} Or call ${GOOGLE_ACCESS_TOOL} with service "${service.slug}" to show the user a reconnect button.`;
    }
    if (error instanceof GoogleApiError && error.kind === "permission") {
      return `${error.message} If ${account.email} needs another permission, call ${GOOGLE_ACCESS_TOOL} with service "${service.slug}" and permission "${operation.requires.at(-1)}".`;
    }
    if (error instanceof GoogleApiError) return error.message;
    return sanitizeConnectorError(error, [this.options.client.clientSecret]).slice(0, 600);
  }

  private async *executeAccess(
    args: Record<string, unknown>,
    context: AdapterContext,
  ): AsyncIterable<ConnectorEvent> {
    const parsed = AccessInput.safeParse(args);
    if (!parsed.success) {
      yield { type: "error", message: `Invalid arguments: ${z.prettifyError(parsed.error)}` };
      return;
    }
    const input = parsed.data;
    const bindings = await this.bindings(context);
    if (!input.service) {
      yield {
        type: "result",
        data: {
          connected: [...bindings].flatMap(([slug, list]) => {
            const service = googleService(slug);
            if (!service) return [];
            return [
              {
                service: slug,
                accounts: list.map(({ account }) => ({
                  account: account.email,
                  status: account.status === "active" ? "ok" : "reconnect",
                  granted: service.permissions
                    .filter((permission) => hasGooglePermission(permission, account.scopes))
                    .map((permission) => permission.id),
                  can_request: service.permissions
                    .filter((permission) => !hasGooglePermission(permission, account.scopes))
                    .map((permission) => permission.id),
                })),
              },
            ];
          }),
          available: GOOGLE_SERVICES.filter((service) => !bindings.has(service.slug)).map(
            (service) => ({
              service: service.slug,
              permissions: service.permissions.map((permission) => permission.id),
            }),
          ),
        },
      };
      return;
    }
    const service = googleService(input.service);
    if (!service) {
      yield { type: "error", message: `Unknown Google app ${input.service}` };
      return;
    }
    const permission = googlePermission(
      service,
      input.permission ?? service.defaultPermissions[0] ?? "read",
    );
    if (!permission) {
      yield {
        type: "error",
        message: `${service.name} permissions are: ${service.permissions.map((item) => item.id).join(", ")}.`,
      };
      return;
    }
    const wanted = input.account?.trim().toLowerCase();
    const candidates = (bindings.get(service.slug) ?? []).filter(
      ({ account }) => !wanted || account.email.toLowerCase() === wanted,
    );
    const ready = candidates.find(
      ({ account }) =>
        account.status === "active" && hasGooglePermission(permission, account.scopes),
    );
    if (ready) {
      yield {
        type: "result",
        data: {
          granted: true,
          service: service.slug,
          permission: permission.id,
          account: ready.account.email,
        },
      };
      return;
    }
    yield {
      type: "authorize",
      provider: service.slug,
      name: service.name,
      description: permission.label,
      permissions: [permission.id],
    };
    yield {
      type: "result",
      data: {
        requested: true,
        message: `The user was asked to authorize ${service.name} (${permission.label}) in the chat. Continue once they have.`,
      },
    };
  }
}
