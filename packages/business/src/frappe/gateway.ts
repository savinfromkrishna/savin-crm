import type { JobPublisher, SecretStore } from "@savingroup/adapter-kit";
import type { PrismaClient } from "@savingroup/db";
import { FrappeClient } from "./client.js";
import { BusinessEnvironmentService } from "./environment.js";
import type { OperationLedger } from "./ledger.js";
import { PrismaOperationLedger } from "./ledger.js";
import type { ResolvedEnvironment } from "./types.js";

/**
 * The native business gateway's composition root: environment registry,
 * operation ledger and a client factory. The API, the worker and the bot
 * executor share one instance so caches and ledgers agree.
 */
export interface FrappeGatewayOptions {
  prisma: PrismaClient;
  secrets: Pick<SecretStore, "put" | "load">;
  /** Durable jobs for reconciling operations with an unknown outcome. */
  jobs?: Pick<JobPublisher, "enqueue">;
  /** Public base URL the site posts signed events to (this API's URL). */
  webhookBaseUrl?: string;
  /** Injected in tests to reach a fake site without sockets. */
  fetch?: typeof fetch;
  timeoutMs?: number;
  ledger?: OperationLedger;
  cacheTtlMs?: number;
  now?: () => Date;
}

export class FrappeGateway {
  readonly ledger: OperationLedger;
  readonly environments: BusinessEnvironmentService;
  readonly jobs: Pick<JobPublisher, "enqueue"> | undefined;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly timeoutMs: number | undefined;

  constructor(options: FrappeGatewayOptions) {
    this.fetchImpl = options.fetch;
    this.timeoutMs = options.timeoutMs;
    this.jobs = options.jobs;
    this.ledger = options.ledger ?? new PrismaOperationLedger(options.prisma);
    this.environments = new BusinessEnvironmentService({
      prisma: options.prisma,
      secrets: options.secrets,
      clientFor: (input) => this.clientFor(input),
      webhookBaseUrl: options.webhookBaseUrl,
      cacheTtlMs: options.cacheTtlMs,
      now: options.now,
    });
  }

  /** The active environment for the space's organization, or null for the prototype. */
  resolve(spaceId: string): Promise<ResolvedEnvironment | null> {
    return this.environments.resolveForSpace(spaceId);
  }

  clientFor(input: { siteUrl: string; apiKey: string; apiSecret: string }): FrappeClient {
    return new FrappeClient({
      baseUrl: input.siteUrl,
      apiKey: input.apiKey,
      apiSecret: input.apiSecret,
      fetch: this.fetchImpl,
      timeoutMs: this.timeoutMs,
    });
  }

  clientForEnvironment(env: ResolvedEnvironment): FrappeClient {
    return this.clientFor({ siteUrl: env.siteUrl, ...env.credentials });
  }
}

export function createFrappeGateway(options: FrappeGatewayOptions): FrappeGateway {
  return new FrappeGateway(options);
}
