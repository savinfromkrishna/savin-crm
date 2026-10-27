import type { Actor, PhoneCall as PhoneCallDto, PhoneCallTurn } from "@savingroup/contracts";
import { PhoneCallStatusSchema, PhoneCallTurnSchema } from "@savingroup/contracts";
import type { PhoneCall, PrismaClient } from "./generated/prisma/client.js";
import { IsolationError } from "./scope.js";

export function phoneCallTranscript(value: unknown): PhoneCallTurn[] {
  if (!Array.isArray(value)) return [];
  const turns: PhoneCallTurn[] = [];
  for (const entry of value) {
    const parsed = PhoneCallTurnSchema.safeParse(entry);
    if (parsed.success) turns.push(parsed.data);
  }
  return turns;
}

export function toPhoneCallDto(row: PhoneCall): PhoneCallDto {
  const status = PhoneCallStatusSchema.safeParse(row.status);
  return {
    id: row.id,
    botId: row.botId,
    threadId: row.threadId,
    to: row.to,
    from: row.from,
    purpose: row.purpose,
    status: status.success ? status.data : "failed",
    endReason: row.endReason,
    summary: row.summary,
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    durationSec: row.durationSec,
    transcript: phoneCallTranscript(row.transcript),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listPhoneCalls(
  prisma: PrismaClient,
  actor: Actor,
  botId: string,
): Promise<PhoneCallDto[]> {
  const rows = await prisma.phoneCall.findMany({
    where: { spaceId: actor.spaceId, userId: actor.userId, botId },
    orderBy: [{ createdAt: "desc" }],
    take: 50,
  });
  return rows.map(toPhoneCallDto);
}

/** The caller's own call in the caller's Space, or an isolation failure. */
export async function getPhoneCall(
  prisma: PrismaClient,
  actor: Actor,
  callId: string,
): Promise<PhoneCall> {
  const row = await prisma.phoneCall.findFirst({
    where: { id: callId, spaceId: actor.spaceId, userId: actor.userId },
  });
  if (!row) throw new IsolationError();
  return row;
}
