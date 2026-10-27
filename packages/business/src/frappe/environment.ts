import { randomUUID } from "node:crypto";
import type { SecretStore } from "@savingroup/adapter-kit";
import type {
  BusinessBlueprintId,
  BusinessEnvironment as BusinessEnvironmentDto,
  BusinessEnvironmentStatus,
  ConnectBusinessEnvironmentInput,
} from "@savingroup/contracts";
import type { BusinessEnvironment as BusinessEnvironmentRow, PrismaClient } from "@savingroup/db";
import { conflict, invalidState, notFound } from "../errors.js";
import { getBusinessBlueprint } from "./blueprints.js";
import type { FrappeClient } from "./client.js";
import { isFrappeRequestError } from "./client.js";
import type { BridgePing, ResolvedEnvironment } from "./types.js";
import { BRIDGE_METHODS, BRIDGE_PROTOCOL_VERSION } from "./types.js";

/**
 * Registry of business environments: which Frappe site answers for which
 * organization, with the gateway credentials sealed by the deployment's
 * secret store. Nothing routes to a site until it has been verified.
 */

export type SecretSealer = Pick<SecretStore, "put" | "load">;

export interface EnvironmentServiceOptions {
  prisma: PrismaClient;
  secrets: SecretSealer;
  clientFor: (input: { siteUrl: string; apiKey: string; apiSecret: string }) => FrappeClient;
  /** How long a resolved environment (with decrypted credentials) is reused. */
  /** Where the site posts signed events; omitted means no event delivery. */
  webhookBaseUrl?: string;
  cacheTtlMs?: number;
  now?: () => Date;
}

const DEFAULT_CACHE_TTL_MS = 30_000;
const MAX_ERROR_CHARS = 500;

export function environmentToDto(row: BusinessEnvironmentRow): BusinessEnvironmentDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    provider: "frappe",
    blueprintId: row.blueprintId as BusinessBlueprintId,
    blueprintVersion: row.blueprintVersion,
    siteUrl: row.siteUrl,
    siteName: row.siteName,
    companyName: row.companyName,
    companyAbbr: row.companyAbbr,
    country: row.country,
    currency: row.currency,
    status: row.status as BusinessEnvironmentStatus,
    installedApps: row.installedApps,
    lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface VerificationResult {
  ok: boolean;
  installedApps: string[];
  /** The company's name on the site now; differs from the stored one after a rename. */
  companyName?: string;
  error?: string;
}

/**
 * The company's current name on the site. A renamed company keeps its
 * abbreviation, which ERPNext will not change once the company has
 * transactions, so a rename is followed instead of losing the company.
 */
async function currentCompanyName(
  client: FrappeClient,
  companies: readonly string[],
  expected: { companyName: string; companyAbbr?: string },
): Promise<string | null> {
  if (companies.includes(expected.companyName)) return expected.companyName;
  if (!expected.companyAbbr) return null;
  const matches = await client
    .getList<{ name: string }>("Company", {
      fields: ["name"],
      filters: [["abbr", "=", expected.companyAbbr]],
      limit: 2,
    })
    .catch(() => []);
  const renamed = matches.map((row) => row.name).filter((name) => companies.includes(name));
  return renamed.length === 1 ? (renamed[0] ?? null) : null;
}

/**
 * A site is usable when the bridge answers with the protocol we speak, the
 * blueprint's apps are installed and the company exists. The check runs as the
 * gateway user, so it also proves the credentials.
 */
export async function verifyFrappeEnvironment(
  client: FrappeClient,
  expected: { blueprintId: BusinessBlueprintId; companyName: string; companyAbbr?: string },
): Promise<VerificationResult> {
  let ping: BridgePing;
  try {
    ping = await client.call<BridgePing>(BRIDGE_METHODS.ping);
  } catch (error) {
    return { ok: false, installedApps: [], error: describeError(error) };
  }
  const installedApps = Object.keys(ping.apps ?? {});
  if (!ping.ok) return { ok: false, installedApps, error: "The bridge reported it is not ready." };
  if (ping.protocol_version !== BRIDGE_PROTOCOL_VERSION) {
    return {
      ok: false,
      installedApps,
      error: `Bridge protocol ${ping.protocol_version} is not supported (expected ${BRIDGE_PROTOCOL_VERSION}).`,
    };
  }
  const blueprint = getBusinessBlueprint(expected.blueprintId);
  const missing = blueprint.apps.filter((app) => !installedApps.includes(app));
  if (missing.length) {
    return { ok: false, installedApps, error: `Apps missing on the site: ${missing.join(", ")}.` };
  }
  const companyName = await currentCompanyName(client, ping.companies ?? [], expected);
  if (!companyName) {
    return {
      ok: false,
      installedApps,
      error: `Company "${expected.companyName}" does not exist on the site.`,
    };
  }
  return { ok: true, installedApps, companyName };
}

function describeError(error: unknown): string {
  if (isFrappeRequestError(error)) {
    if (error.status === 401 || error.status === 403) {
      return "The site rejected the gateway credentials.";
    }
    return error.message.slice(0, MAX_ERROR_CHARS);
  }
  return (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_CHARS);
}

type Cached = { expires: number; value: ResolvedEnvironment | null };

export class BusinessEnvironmentService {
  private readonly cache = new Map<string, Cached>();
  private readonly now: () => Date;
  private readonly ttl: number;

  constructor(private readonly options: EnvironmentServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.ttl = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  }

  invalidate(): void {
    this.cache.clear();
  }

  async getForOrganization(organizationId: string): Promise<BusinessEnvironmentRow | null> {
    return this.options.prisma.businessEnvironment.findUnique({ where: { organizationId } });
  }

  async getById(id: string): Promise<BusinessEnvironmentRow | null> {
    return this.options.prisma.businessEnvironment.findUnique({ where: { id } });
  }

  async organizationIdForSpace(spaceId: string): Promise<string | null> {
    const space = await this.options.prisma.space.findUnique({
      where: { id: spaceId },
      select: { organizationId: true },
    });
    return space?.organizationId ?? null;
  }

  /**
   * The active environment for a space's organization, or null when the
   * prototype answers (none, or disabled). Throws when the environment failed,
   * is being checked, or its credentials cannot be opened: silently falling
   * back would split the data.
   */
  async resolveForSpace(spaceId: string): Promise<ResolvedEnvironment | null> {
    const cached = this.cache.get(spaceId);
    const nowMs = this.now().getTime();
    if (cached && cached.expires > nowMs) return cached.value;
    const space = await this.options.prisma.space.findUnique({
      where: { id: spaceId },
      select: { organization: { select: { businessEnvironment: true } } },
    });
    const row = space?.organization.businessEnvironment ?? null;
    // Nor may a failed or unchecked connection quietly hand the work to the
    // prototype tables; only disabling the environment does that.
    if (row && row.status !== "active" && row.status !== "disabled") {
      throw invalidState(
        row.status === "failed"
          ? `The connection to ${row.siteName} failed (${row.lastError ?? "no reason given"}). Check it on the ERP overview, or disable it to use Savingroup's own records.`
          : `The connection to ${row.siteName} is being checked.`,
      );
    }
    const value = row?.status === "active" ? await this.resolveRow(row) : null;
    this.cache.set(spaceId, { expires: nowMs + this.ttl, value });
    return value;
  }

  async resolveRow(row: BusinessEnvironmentRow): Promise<ResolvedEnvironment> {
    const credentials = await this.openCredentials(row);
    const blueprint = getBusinessBlueprint(row.blueprintId as BusinessBlueprintId);
    return {
      id: row.id,
      organizationId: row.organizationId,
      siteUrl: row.siteUrl,
      siteName: row.siteName,
      companyName: row.companyName,
      companyAbbr: row.companyAbbr,
      country: row.country,
      currency: row.currency,
      timezone: blueprint.timezone,
      blueprint,
      status: row.status as BusinessEnvironmentStatus,
      credentials,
    };
  }

  async openCredentials(
    row: BusinessEnvironmentRow,
  ): Promise<{ apiKey: string; apiSecret: string }> {
    if (!row.credentialCiphertext || !row.credentialSecretId) {
      throw invalidState("The business environment has no gateway credentials.");
    }
    const plaintext = await this.options.secrets.load(
      row.credentialCiphertext,
      row.credentialSecretId,
    );
    const parsed = JSON.parse(plaintext) as { apiKey?: unknown; apiSecret?: unknown };
    if (typeof parsed.apiKey !== "string" || typeof parsed.apiSecret !== "string") {
      throw invalidState("The stored gateway credentials are malformed.");
    }
    return { apiKey: parsed.apiKey, apiSecret: parsed.apiSecret };
  }

  async openWebhookSecret(row: BusinessEnvironmentRow): Promise<string | null> {
    if (!row.webhookSecretCiphertext || !row.webhookSecretId) return null;
    return this.options.secrets.load(row.webhookSecretCiphertext, row.webhookSecretId);
  }

  /**
   * Register (or re-register) the organization's site and verify it. The row
   * is written before verification so a failed check is visible with its
   * reason; only a passing check makes it active.
   */
  async connect(
    actor: { userId: string; spaceId: string; organizationId: string },
    input: ConnectBusinessEnvironmentInput,
  ): Promise<BusinessEnvironmentRow> {
    const existing = await this.getForOrganization(actor.organizationId);
    if (existing && existing.status === "active") {
      throw conflict("Disable the current business environment before connecting another.");
    }
    const blueprint = getBusinessBlueprint(input.blueprintId);
    const context = {
      operationId: `business.environment.connect:${randomUUID()}`,
      traceId: randomUUID(),
      spaceId: actor.spaceId,
      userId: actor.userId,
      signal: new AbortController().signal,
    };
    const credentialRecordId = randomUUID().replaceAll("-", "").slice(0, 24);
    const credential = await this.options.secrets.put(
      JSON.stringify({ apiKey: input.apiKey, apiSecret: input.apiSecret }),
      context,
      { recordId: credentialRecordId },
    );
    const webhookRecordId = randomUUID().replaceAll("-", "").slice(0, 24);
    const webhook = await this.options.secrets.put(input.webhookSecret, context, {
      recordId: webhookRecordId,
    });
    const siteName = new URL(input.siteUrl).host;
    const data = {
      provider: "frappe",
      blueprintId: blueprint.id,
      blueprintVersion: blueprint.version,
      siteUrl: input.siteUrl,
      siteName,
      companyName: input.companyName,
      companyAbbr: input.companyAbbr,
      country: input.country,
      currency: input.currency,
      status: "verifying",
      installedApps: [] as string[],
      credentialSecretId: credential.id,
      credentialCiphertext: credential.ciphertext,
      webhookSecretId: webhook.id,
      webhookSecretCiphertext: webhook.ciphertext,
      lastError: null,
      createdByUserId: actor.userId,
    };
    const row = existing
      ? await this.options.prisma.businessEnvironment.update({
          where: { id: existing.id },
          data,
        })
      : await this.options.prisma.businessEnvironment.create({
          data: { organizationId: actor.organizationId, ...data },
        });
    this.invalidate();
    const verified = await this.verify(row.id);
    if (verified.status !== "active" || !this.options.webhookBaseUrl) return verified;
    return this.configureWebhook(verified, input.webhookSecret);
  }

  /** Tell the site where to deliver signed events; failure keeps the environment usable. */
  private async configureWebhook(
    row: BusinessEnvironmentRow,
    secret: string,
  ): Promise<BusinessEnvironmentRow> {
    const base = (this.options.webhookBaseUrl ?? "").replace(/\/+$/, "");
    try {
      const credentials = await this.openCredentials(row);
      const client = this.options.clientFor({ siteUrl: row.siteUrl, ...credentials });
      await client.call(BRIDGE_METHODS.configureWebhook, {
        url: `${base}/webhooks/business/frappe/${row.id}`,
        secret,
        enabled: 1,
      });
      return row;
    } catch (error) {
      const updated = await this.options.prisma.businessEnvironment.update({
        where: { id: row.id },
        data: { lastError: `Event delivery is not configured: ${describeError(error)}` },
      });
      this.invalidate();
      return updated;
    }
  }

  async verify(environmentId: string): Promise<BusinessEnvironmentRow> {
    const row = await this.getById(environmentId);
    if (!row) throw notFound("Business environment");
    if (row.status === "disabled") return row;
    let result: VerificationResult;
    try {
      const credentials = await this.openCredentials(row);
      const client = this.options.clientFor({ siteUrl: row.siteUrl, ...credentials });
      result = await verifyFrappeEnvironment(client, {
        blueprintId: row.blueprintId as BusinessBlueprintId,
        companyName: row.companyName,
        companyAbbr: row.companyAbbr,
      });
    } catch (error) {
      result = { ok: false, installedApps: [], error: describeError(error) };
    }
    const updated = await this.options.prisma.businessEnvironment.update({
      where: { id: row.id },
      data: result.ok
        ? {
            status: "active",
            companyName: result.companyName ?? row.companyName,
            installedApps: result.installedApps,
            lastVerifiedAt: this.now(),
            lastError: null,
          }
        : {
            status: "failed",
            installedApps: result.installedApps,
            lastError: result.error ?? "Verification failed.",
          },
    });
    this.invalidate();
    return updated;
  }

  /**
   * After a change to the site's Company, take its new name if it was renamed,
   * so the next write names the right company. Never fails the environment:
   * the full check stays with `verify`.
   */
  async followCompanyRename(environmentId: string): Promise<void> {
    const row = await this.getById(environmentId);
    if (row?.status !== "active") return;
    const credentials = await this.openCredentials(row);
    const client = this.options.clientFor({ siteUrl: row.siteUrl, ...credentials });
    const ping = await client.call<BridgePing>(BRIDGE_METHODS.ping);
    const companyName = await currentCompanyName(client, ping.companies ?? [], row);
    if (!companyName || companyName === row.companyName) return;
    await this.options.prisma.businessEnvironment.update({
      where: { id: row.id },
      data: { companyName },
    });
    this.invalidate();
  }

  /** Rollback switch: the prototype tables answer again; nothing is deleted. */
  async disable(environmentId: string): Promise<BusinessEnvironmentRow> {
    const row = await this.getById(environmentId);
    if (!row) throw notFound("Business environment");
    const updated = await this.options.prisma.businessEnvironment.update({
      where: { id: row.id },
      data: { status: "disabled" },
    });
    this.invalidate();
    return updated;
  }
}
