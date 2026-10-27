import type { RealtimeFanout } from "@savingroup/adapter-kit";
import type { BusinessChange } from "@savingroup/contracts";
import type { PrismaClient } from "@savingroup/db";

/** A transient "business records changed" signal. Clients refetch on any frame. */
export interface BusinessEvents {
  notify(change: BusinessChange): Promise<void>;
  follow(spaceId: string, signal?: AbortSignal): AsyncGenerator<BusinessChange>;
}

export function businessEventTopic(spaceId: string): string {
  return `business:${spaceId}`;
}

/**
 * Build the notifier and the subscription stream. Without a realtime fanout the
 * notifier does nothing and the stream stays open and empty.
 */
export function createBusinessEvents(realtime?: RealtimeFanout): BusinessEvents {
  return {
    async notify(change) {
      await realtime
        ?.publish(businessEventTopic(change.spaceId), JSON.stringify(change))
        .catch(() => undefined);
    },
    async *follow(spaceId, signal) {
      const queue: BusinessChange[] = [];
      const waiters = new Set<() => void>();
      const push = (event: BusinessChange) => {
        queue.push(event);
        for (const wake of [...waiters]) wake();
      };
      const unsubscribe = realtime
        ? await realtime
            .subscribe(businessEventTopic(spaceId), (payload) => {
              let change: Partial<BusinessChange> = {};
              try {
                change = JSON.parse(payload) as Partial<BusinessChange>;
              } catch {
                change = {};
              }
              push({
                spaceId,
                ...(change.type ? { type: change.type } : {}),
                ...(change.recordType ? { recordType: change.recordType } : {}),
                ...(change.recordId ? { recordId: change.recordId } : {}),
                createdAt: new Date().toISOString(),
              });
            })
            .catch(() => async () => {})
        : async () => {};
      try {
        while (!signal?.aborted) {
          const next = queue.shift();
          if (next) {
            yield next;
            continue;
          }
          await new Promise<void>((resolve) => {
            const wake = () => {
              waiters.delete(wake);
              signal?.removeEventListener("abort", wake);
              resolve();
            };
            waiters.add(wake);
            signal?.addEventListener("abort", wake, { once: true });
            if (signal?.aborted) wake();
          });
        }
      } finally {
        waiters.clear();
        await unsubscribe();
      }
    },
  };
}

const PUBLISH_BATCH = 100;

/**
 * Outbox drain: domain events are committed with the state they describe, then
 * published here. A failed publish leaves `publishedAt` null, so the next
 * write in the same space (or a later sweep) delivers it again. Delivery is
 * therefore at-least-once; clients treat frames as refetch hints.
 */
export async function publishPendingBusinessEvents(
  prisma: PrismaClient,
  live: BusinessEvents | undefined,
  spaceId: string,
): Promise<number> {
  const pending = await prisma.businessEvent.findMany({
    where: { spaceId, publishedAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: PUBLISH_BATCH,
    select: { id: true, type: true, recordType: true, recordId: true, createdAt: true },
  });
  let published = 0;
  for (const event of pending) {
    if (live) {
      await live.notify({
        spaceId,
        type: event.type as BusinessChange["type"],
        recordType: event.recordType as BusinessChange["recordType"],
        recordId: event.recordId,
        createdAt: event.createdAt.toISOString(),
      });
    }
    await prisma.businessEvent.update({
      where: { id: event.id },
      data: { publishedAt: new Date() },
    });
    published += 1;
  }
  return published;
}
