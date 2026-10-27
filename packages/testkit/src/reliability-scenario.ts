import type { PrismaClient } from "@savingroup/db";
import type { BotIntroHarness } from "./discard-bot-intro.js";
import { discardBotIntroFromCreate } from "./discard-bot-intro.js";
import { sessionCookieHeader } from "./index.js";

/**
 * Shared driver for the reliability regressions and the local demonstration: the
 * same product calls (sign-up, bot, approval rule, send, answer) and the same seeded
 * failure shapes, so what the demo shows is what the tests assert.
 */

export type ScenarioApp = BotIntroHarness & {
  prisma: PrismaClient;
};

export type ThreadSnapshot = {
  messages: Array<{
    id: string;
    seq: number;
    runId?: string | null;
    blocks: Array<{ kind?: string; approvalEffectId?: string; actions?: unknown[] }>;
  }>;
  run: { id: string; status: string } | null;
};

const ORIGIN = "http://127.0.0.1:5173";
const TERMINAL = new Set(["completed", "failed", "cancelled"]);

export async function signup(harness: ScenarioApp, email: string, name: string): Promise<string> {
  const response = await harness.app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ email, password: "password12", name }),
  });
  if (response.status >= 400) {
    throw new Error(`signup failed ${response.status}: ${await response.text()}`);
  }
  return sessionCookieHeader(response);
}

export async function rpc<T>(
  harness: ScenarioApp,
  cookie: string,
  procedure: string,
  body: unknown = {},
): Promise<T> {
  const response = await harness.app.request(`/rpc/${procedure}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, origin: ORIGIN },
    body: JSON.stringify({ json: body }),
  });
  const text = await response.text();
  let parsed: { json?: T; error?: { message?: string } };
  try {
    parsed = JSON.parse(text) as { json?: T; error?: { message?: string } };
  } catch {
    throw new Error(`${procedure} ${response.status}: ${text}`);
  }
  if (response.status >= 400 || parsed.error) {
    throw new Error(`${procedure} ${response.status}: ${parsed.error?.message ?? text}`);
  }
  return discardBotIntroFromCreate(harness, cookie, procedure, parsed.json as T);
}

export type ScenarioActor = {
  cookie: string;
  userId: string;
  spaceId: string;
  botId: string;
  threadId: string;
};

/** A fresh account with one bot whose creation intro has already been discarded. */
export async function createActor(
  harness: ScenarioApp,
  label: string,
  options: { notifyOnFinish?: boolean } = {},
): Promise<ScenarioActor> {
  const cookie = await signup(harness, `${label}@savingroup.test`, label);
  const me = await rpc<{ userId: string; spaceId: string }>(harness, cookie, "me");
  const bot = await rpc<{ id: string }>(harness, cookie, "bots/create", {
    name: `Bot ${label.slice(0, 20)}`,
    title: "",
    description: "",
    instructions: "",
    notifyOnFinish: options.notifyOnFinish ?? false,
  });
  const thread = await harness.prisma.thread.findUniqueOrThrow({ where: { botId: bot.id } });
  return { cookie, userId: me.userId, spaceId: me.spaceId, botId: bot.id, threadId: thread.id };
}

export async function requireApprovalFor(
  harness: ScenarioApp,
  actor: ScenarioActor,
  toolName: string,
): Promise<void> {
  await rpc(harness, actor.cookie, "approvalRules/set", {
    effect: "require_approval",
    matchKind: "tool",
    matchValue: toolName,
  });
}

export async function waitForThread(
  harness: ScenarioApp,
  actor: ScenarioActor,
  predicate: (snapshot: ThreadSnapshot) => boolean,
  timeoutMs = 20_000,
): Promise<ThreadSnapshot> {
  const start = Date.now();
  let last: ThreadSnapshot | null = null;
  while (Date.now() - start < timeoutMs) {
    last = await rpc<ThreadSnapshot>(harness, actor.cookie, "threads/get", { botId: actor.botId });
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timeout waiting for thread: ${JSON.stringify(last)}`);
}

export async function waitForRun(
  harness: ScenarioApp,
  runId: string,
  predicate: (run: { status: string; error: string | null }) => boolean,
  timeoutMs = 20_000,
): Promise<{ status: string; error: string | null }> {
  const start = Date.now();
  let last: { status: string; error: string | null } | null = null;
  while (Date.now() - start < timeoutMs) {
    last = await harness.prisma.run.findUnique({
      where: { id: runId },
      select: { status: true, error: true },
    });
    if (last && predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timeout waiting for run ${runId}: ${JSON.stringify(last)}`);
}

export const isTerminalStatus = (status: string) => TERMINAL.has(status);

export async function sendMessage(
  harness: ScenarioApp,
  actor: ScenarioActor,
  text: string,
): Promise<string> {
  const sent = await rpc<{ runId: string }>(harness, actor.cookie, "threads/send", {
    botId: actor.botId,
    text,
  });
  return sent.runId;
}

/** Wait for the approval card of `runId` and answer it. */
export async function answerApproval(
  harness: ScenarioApp,
  actor: ScenarioActor,
  runId: string,
  answer: "allow" | "always" | "deny",
): Promise<{ approvalEffectId: string }> {
  const waiting = await waitForThread(
    harness,
    actor,
    (snapshot) => snapshot.run?.id === runId && snapshot.run.status === "waiting_input",
  );
  let approvalEffectId: string | undefined;
  const message = [...waiting.messages].reverse().find((candidate) => {
    if (candidate.runId !== runId) return false;
    const card = candidate.blocks.find(
      (block) =>
        block.kind === "ask" &&
        typeof block.approvalEffectId === "string" &&
        Array.isArray(block.actions),
    );
    approvalEffectId = card?.approvalEffectId;
    return Boolean(card);
  });
  if (!message || !approvalEffectId) {
    throw new Error(`run ${runId} did not expose an approval card`);
  }
  await rpc(harness, actor.cookie, "threads/answer", {
    botId: actor.botId,
    runId,
    messageId: message.id,
    answer,
  });
  return { approvalEffectId };
}

export type SeededAttempt = { status: string; error?: string | null };

/**
 * A run that earlier workers left behind: its lease has expired and each seeded
 * attempt records how the previous worker ended. The next continueRun reclaims it.
 */
export async function seedAbandonedRun(
  harness: ScenarioApp,
  actor: ScenarioActor,
  prompt: string,
  attempts: readonly SeededAttempt[],
): Promise<string> {
  const now = Date.now();
  const task = await harness.prisma.task.create({
    data: {
      spaceId: actor.spaceId,
      botId: actor.botId,
      threadId: actor.threadId,
      userId: actor.userId,
      prompt,
      status: "running",
    },
  });
  const run = await harness.prisma.run.create({
    data: {
      spaceId: actor.spaceId,
      botId: actor.botId,
      threadId: actor.threadId,
      taskId: task.id,
      userId: actor.userId,
      status: "running",
      trigger: "user",
      leaseOwner: "dead-worker",
      leaseFence: attempts.length,
      leaseExpiresAt: new Date(now - 60_000),
      startedAt: new Date(now - 120_000),
    },
  });
  for (const [index, attempt] of attempts.entries()) {
    const startedAt = new Date(now - 120_000 + index * 10_000);
    await harness.prisma.attempt.create({
      data: {
        runId: run.id,
        fence: index + 1,
        status: attempt.status,
        error: attempt.error ?? null,
        startedAt,
        finishedAt: attempt.status === "running" ? null : new Date(startedAt.getTime() + 5_000),
      },
    });
  }
  return run.id;
}
