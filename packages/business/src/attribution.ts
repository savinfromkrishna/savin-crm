import type { BusinessActor as BusinessActorDto } from "@savingroup/contracts";
import type { BusinessClient } from "./context.js";

/**
 * Resolves display names for user and bot ids in one batch per response, so a
 * list of fifty records costs two queries rather than a hundred.
 */
export class AttributionResolver {
  private readonly userIds = new Set<string>();
  private readonly botIds = new Set<string>();
  private users = new Map<string, string>();
  private bots = new Map<string, string>();

  constructor(
    private readonly client: BusinessClient,
    private readonly spaceId: string,
  ) {}

  collect(ids: { userId?: string | null; botId?: string | null }): void {
    if (ids.userId) this.userIds.add(ids.userId);
    if (ids.botId) this.botIds.add(ids.botId);
  }

  /** Runs inside transactions too, so the two lookups never overlap on one connection. */
  async load(): Promise<void> {
    const users = this.userIds.size
      ? await this.client.user.findMany({
          where: { id: { in: [...this.userIds] } },
          select: { id: true, name: true },
        })
      : [];
    const bots = this.botIds.size
      ? await this.client.bot.findMany({
          // Bots from another space never resolve, even if an id leaked in.
          where: { id: { in: [...this.botIds] }, spaceId: this.spaceId },
          select: { id: true, name: true },
        })
      : [];
    this.users = new Map(users.map((user) => [user.id, user.name]));
    this.bots = new Map(bots.map((bot) => [bot.id, bot.name]));
  }

  actor(ids: { userId?: string | null; botId?: string | null }): BusinessActorDto {
    const userId = ids.userId ?? null;
    const botId = ids.botId ?? null;
    const name = botId
      ? (this.bots.get(botId) ?? null)
      : userId
        ? (this.users.get(userId) ?? null)
        : null;
    return { userId, botId, name };
  }
}

export async function resolveAttribution<Row>(
  client: BusinessClient,
  spaceId: string,
  rows: readonly Row[],
  collect: (row: Row, resolver: AttributionResolver) => void,
): Promise<AttributionResolver> {
  const resolver = new AttributionResolver(client, spaceId);
  for (const row of rows) collect(row, resolver);
  await resolver.load();
  return resolver;
}
