import type { Prisma, PrismaClient } from "@savingroup/db";
import type { FrappeGateway } from "./frappe/gateway.js";
import type { BusinessEvents } from "./live.js";

/**
 * Who is acting. Both ids come from the authenticated execution context: the
 * API's membership-checked actor, or the Run row a bot is executing under.
 * They are never taken from tool arguments.
 */
export interface BusinessActor {
  userId: string;
  botId?: string;
}

export interface BusinessContext {
  spaceId: string;
  actor: BusinessActor;
  /** The bot run performing the action, for audit and effect correlation. */
  runId?: string;
  now: Date;
}

/** Either the root client (reads) or the transaction a write runs in. */
export type BusinessClient = PrismaClient | Prisma.TransactionClient;

export interface BusinessDeps {
  prisma: PrismaClient;
  /** Off by default; mirrors the BUSINESS_APPS_ENABLED flag. */
  enabled?: boolean;
  /** Live fanout for committed domain events; absent means no live refresh. */
  live?: BusinessEvents;
  /**
   * The native business gateway. When set, organizations with an active
   * business environment run their actions on that site instead of the
   * prototype tables.
   */
  frappe?: FrappeGateway;
}

export function actorColumns(actor: BusinessActor): {
  createdByUserId: string | null;
  createdByBotId: string | null;
} {
  return actor.botId
    ? { createdByUserId: null, createdByBotId: actor.botId }
    : { createdByUserId: actor.userId, createdByBotId: null };
}

export function actorIds(actor: BusinessActor): { userId: string | null; botId: string | null } {
  return actor.botId ? { userId: null, botId: actor.botId } : { userId: actor.userId, botId: null };
}
