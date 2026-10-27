import { randomUUID } from "node:crypto";
import type {
  AdapterContext,
  BackgroundJobPayloads,
  PhoneCallSnapshot,
} from "@savingroup/adapter-kit";
import { PhoneCallRequestRejected, runContinueJob } from "@savingroup/adapter-kit";
import type { MessageBlock } from "@savingroup/contracts";
import { isPhoneCallTerminal } from "@savingroup/contracts";
import { appendEventInTransaction, type PhoneCall, type Prisma } from "@savingroup/db";
import { getLogger } from "@savingroup/logging";
import { phoneCallsEnabled } from "./phone-call-factory.js";
import {
  enqueuePhoneCall,
  issuePhoneAgentToken,
  type PhoneCallDeps,
  type PhoneCallEndStatus,
  phoneCallBlock,
  phoneCallBrief,
} from "./phone-call-service.js";

const LEASE_MS = 90_000;
const POLL_INTERVAL_MS = 5_000;
/** Grace past the requested ceiling before the poll hangs up a call the agent did not end. */
const MAX_DURATION_GRACE_MS = 120_000;

/** Reconcile one persisted call intent. A fenced lease serializes provider mutations. */
export async function pollPhoneCall(
  deps: PhoneCallDeps,
  payload: BackgroundJobPayloads["phone_call.poll"],
) {
  const connection = deps.phoneCalls;
  if (!connection) return;
  const stored = await deps.prisma.phoneCall.findFirst({
    where: { id: payload.callId, providerKey: connection.key },
  });
  if (!stored?.nextPollAt || !phoneCallsEnabled(connection)) return;
  const token = randomUUID();
  const claimed = await deps.prisma.phoneCall.updateMany({
    where: {
      id: stored.id,
      version: stored.version,
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: new Date() } }],
    },
    data: { leaseToken: token, leaseExpiresAt: new Date(Date.now() + LEASE_MS) },
  });
  if (!claimed.count) return;
  const call = { ...stored, leaseToken: token };
  const context: AdapterContext = {
    operationId: call.id,
    traceId: call.id,
    spaceId: call.spaceId,
    userId: call.userId,
    botId: call.botId,
    signal: AbortSignal.timeout(60_000),
  };
  const provider = connection.provider;
  try {
    const [card, member, bot] = await Promise.all([
      deps.prisma.message.findFirst({
        where: { id: call.messageId ?? "", threadId: call.threadId },
        select: { id: true },
      }),
      deps.prisma.spaceMember.findUnique({
        where: { spaceId_userId: { spaceId: call.spaceId, userId: call.userId } },
        select: { id: true },
      }),
      deps.prisma.bot.findFirst({
        where: { id: call.botId, spaceId: call.spaceId, userId: call.userId, archivedAt: null },
      }),
    ]);
    const abandoned = !card || !member || !bot;
    if (isPhoneCallTerminal(call.status)) {
      // The voice agent (or a hang-up) already ended the call; publish the outcome.
      await finishPoll(deps, call, {}, abandoned);
      return;
    }
    if (!call.remoteId) {
      if (abandoned || call.hangupRequested) {
        await finishPoll(
          deps,
          call,
          ended(call, "cancelled", "cancelled_before_dialing"),
          abandoned,
        );
        return;
      }
      // Write dispatch intent and the agent credential before I/O; a crash
      // replays the same idempotent placement with a fresh credential.
      const agent = issuePhoneAgentToken();
      const marked = await deps.prisma.phoneCall.updateMany({
        where: fence(call),
        data: { placeDispatched: true, agentTokenHash: agent.hash },
      });
      if (!marked.count) return;
      try {
        const handle = await provider.place(
          {
            idempotencyKey: call.id,
            callId: call.id,
            to: call.to,
            ...(call.from ? { from: call.from } : {}),
            brief: phoneCallBrief(call),
            maxDurationSec: call.maxDurationSec,
            agent: { apiUrl: connection.agentApiUrl, token: agent.token },
          },
          context,
        );
        await finishPoll(deps, call, { remoteId: handle.id, status: "ringing" }, abandoned);
      } catch (error) {
        if (!(error instanceof PhoneCallRequestRejected)) throw error;
        await finishPoll(deps, call, ended(call, "failed", error.message), abandoned);
      }
      return;
    }
    if (abandoned || call.hangupRequested) {
      await provider.hangup(call.remoteId, context);
      await finishPoll(deps, call, ended(call, "cancelled", "hung_up"), abandoned);
      return;
    }
    if (
      call.startedAt &&
      Date.now() - call.startedAt.getTime() > call.maxDurationSec * 1000 + MAX_DURATION_GRACE_MS
    ) {
      await provider.hangup(call.remoteId, context);
      await finishPoll(deps, call, ended(call, "completed", "max_duration"), abandoned);
      return;
    }
    const snapshot = await provider.get(call.remoteId, context);
    await finishPoll(deps, call, mergeSnapshot(call, snapshot), abandoned);
  } catch {
    // Provider response bodies never enter logs, cards, or model context.
    getLogger().warn("phone call operation deferred to reconciliation");
    await retryPoll(deps, call);
  } finally {
    await deps.prisma.phoneCall.updateMany({
      where: { id: call.id, leaseToken: token },
      data: { leaseToken: null, leaseExpiresAt: null },
    });
  }
}

function fence(call: PhoneCall) {
  return { id: call.id, version: call.version, leaseToken: call.leaseToken };
}

function ended(
  call: PhoneCall,
  status: PhoneCallEndStatus,
  endReason: string,
  extra: Prisma.PhoneCallUpdateManyMutationInput = {},
): Prisma.PhoneCallUpdateManyMutationInput {
  const endedAt = new Date();
  return {
    status,
    endReason,
    endedAt,
    durationSec: call.startedAt
      ? Math.max(0, Math.round((endedAt.getTime() - call.startedAt.getTime()) / 1000))
      : null,
    ...extra,
  };
}

/** Provider state plus what the agent already reported; the row never regresses. */
export function mergeSnapshot(
  call: PhoneCall,
  snapshot: PhoneCallSnapshot,
): Prisma.PhoneCallUpdateManyMutationInput {
  // Prisma JSON columns take plain values; copy the turns out of the provider's objects.
  const transcript = snapshot.transcript
    ? {
        transcript: snapshot.transcript.map((turn) => ({
          role: turn.role,
          text: turn.text,
          at: turn.at,
        })),
      }
    : {};
  if (isPhoneCallTerminal(snapshot.status)) {
    // The provider cannot tell "nobody answered" from "hung up"; the row can.
    const status =
      snapshot.status === "completed" && !call.startedAt && call.status !== "in_progress"
        ? "no_answer"
        : (snapshot.status as PhoneCallEndStatus);
    return ended(call, status, snapshot.endReason ?? "ended", {
      ...transcript,
      ...(snapshot.summary ? { summary: snapshot.summary } : {}),
    });
  }
  if (snapshot.status === "in_progress") {
    return {
      status: "in_progress",
      ...(call.startedAt ? {} : { startedAt: new Date() }),
      ...transcript,
    };
  }
  return { status: call.status === "in_progress" ? "in_progress" : "ringing", ...transcript };
}

async function retryPoll(deps: PhoneCallDeps, call: PhoneCall) {
  const nextPollAt = new Date(
    Date.now() + Math.min(60_000, 5_000 * 2 ** Math.min(call.errorCount, 4)),
  );
  const saved = await deps.prisma.phoneCall.updateMany({
    where: fence(call),
    data: { nextPollAt, errorCount: { increment: 1 }, leaseToken: null, leaseExpiresAt: null },
  });
  if (saved.count) await enqueuePhoneCall(deps, call.id, nextPollAt);
}

async function finishPoll(
  deps: PhoneCallDeps,
  call: PhoneCall,
  data: Prisma.PhoneCallUpdateManyMutationInput,
  abandoned = false,
) {
  const committed = await deps.prisma.$transaction(async (tx) => {
    // Same lock order as clearing chat: thread first, then message/run changes.
    const thread = await tx.thread.updateMany({
      where: { id: call.threadId, spaceId: call.spaceId, userId: call.userId },
      data: { nextEventSeq: { increment: 0 } },
    });
    const message = thread.count
      ? await tx.message.findFirst({
          where: { id: call.messageId ?? "", threadId: call.threadId },
        })
      : null;
    const [member, bot] = await Promise.all([
      tx.spaceMember.findUnique({
        where: { spaceId_userId: { spaceId: call.spaceId, userId: call.userId } },
        select: { id: true },
      }),
      tx.bot.findFirst({
        where: { id: call.botId, spaceId: call.spaceId, userId: call.userId, archivedAt: null },
        select: { id: true },
      }),
    ]);
    const detached = abandoned || !message || !member || !bot;
    const status = typeof data.status === "string" ? data.status : call.status;
    const terminal = isPhoneCallTerminal(status);
    const nextPollAt = terminal ? null : new Date(Date.now() + POLL_INTERVAL_MS);
    const updated = await tx.phoneCall.updateMany({
      where: fence(call),
      data: {
        ...data,
        nextPollAt,
        errorCount: 0,
        leaseToken: null,
        leaseExpiresAt: null,
        version: { increment: 1 },
      },
    });
    if (!updated.count) return null;
    const saved = await tx.phoneCall.findUniqueOrThrow({ where: { id: call.id } });
    let seq: number | undefined;
    let wakeRunId: string | undefined;
    if (message && !detached) {
      const nextBlock = phoneCallBlock(saved);
      const blocks = (message.blocks as MessageBlock[]).map((block) =>
        block.kind === "phone_call" && block.callId === call.id ? nextBlock : block,
      );
      if (JSON.stringify(blocks) !== JSON.stringify(message.blocks)) {
        await tx.message.update({ where: { id: message.id }, data: { blocks } });
        const event = await appendEventInTransaction(tx, {
          spaceId: call.spaceId,
          threadId: call.threadId,
          botId: call.botId,
          type: "thread.phone_call",
          payload: { messageId: message.id, ...nextBlock },
        });
        seq = event.seq;
      }
      if (terminal && !saved.woken) {
        // Callee speech is untrusted. Wake with local identity and status only.
        const summary = `Phone call ${call.id} to ${call.to} is ${status.replace("_", " ")}. Use phone_call_status to read its transcript, then continue the task.`;
        const task = await tx.task.create({
          data: {
            spaceId: call.spaceId,
            botId: call.botId,
            threadId: call.threadId,
            userId: call.userId,
            prompt: summary,
            status: "queued",
          },
        });
        const run = await tx.run.create({
          data: {
            spaceId: call.spaceId,
            botId: call.botId,
            threadId: call.threadId,
            userId: call.userId,
            taskId: task.id,
            status: "queued",
            trigger: "phone_call",
            clientNonce: `phone-call-wake-run:${call.id}`,
          },
        });
        await tx.phoneCall.update({ where: { id: call.id }, data: { woken: true } });
        wakeRunId = run.id;
      }
    }
    return { seq, wakeRunId, nextPollAt };
  });
  if (!committed) return;
  if (committed.seq !== undefined)
    await deps.events.notify(call.threadId, committed.seq).catch(() => undefined);
  if (committed.wakeRunId) {
    // The existing run reconciler recovers a queued wake after an enqueue failure.
    await deps.jobs.enqueue(runContinueJob(committed.wakeRunId)).catch(() => {
      getLogger().warn("phone call wake deferred to reconciliation");
    });
  }
  if (committed.nextPollAt) await enqueuePhoneCall(deps, call.id, committed.nextPollAt);
}
