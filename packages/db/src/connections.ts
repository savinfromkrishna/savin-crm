import type { Prisma } from "./generated/prisma/client.js";

/**
 * Serialize connection begin, completion, and revoke for one user's app. The
 * advisory lock covers rows inserted after it is taken, which row locks miss.
 */
export async function lockProviderConnectionScope(
  tx: Prisma.TransactionClient,
  owner: { spaceId: string; userId: string },
  connectorId: string,
  provider: string,
): Promise<void> {
  // Avoid NUL separators in the lock key; text params may truncate at a zero byte and break begin.
  const scope = `space:${owner.spaceId}|user:${owner.userId}|connector:${connectorId}|provider:${provider}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('connection-provider'), hashtext(${scope}))`;
}
