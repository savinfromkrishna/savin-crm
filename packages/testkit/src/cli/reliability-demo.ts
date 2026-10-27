import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RunTrace } from "@savingroup/contracts";
import { MAX_UNFINISHED_RUN_ATTEMPTS } from "@savingroup/core";
import { loadRootEnv } from "@savingroup/core/node/load-root-env";
import { createScratchDatabase } from "../local-postgres.js";
import {
  answerApproval,
  createActor,
  isTerminalStatus,
  requireApprovalFor,
  rpc,
  type ScenarioActor,
  seedAbandonedRun,
  sendMessage,
  waitForRun,
  waitForThread,
} from "../reliability-scenario.js";
import { runProcess } from "./process.js";

loadRootEnv();

/**
 * Walks the reliability guarantees end to end against a scratch database on a local
 * Postgres server, through the product API and the real executor, with the scripted
 * runtime and the fake computer: approval before a side effect, once-only execution,
 * replay suppression, denial, lease reclaim with fences, the recovery budget, and the
 * run trace that records all of it. The same driver backs the regression suite.
 */
const PROMPT = "write this to the destination crm as a note";

function argValue(flag: string): string | undefined {
  const match = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  return match?.slice(flag.length + 1);
}

function heading(text: string) {
  console.log(`\n== ${text}`);
}

function showTrace(label: string, trace: RunTrace) {
  const effects = trace.summary.effects;
  console.log(`-- ${label}: run ${trace.status}${trace.error ? ` (${trace.error})` : ""}`);
  console.log(
    `   attempts ${trace.attempts.map((attempt) => `#${attempt.fence} ${attempt.status}`).join(", ") || "none"}`,
  );
  for (const step of trace.steps) {
    const duration = step.durationMs === null ? "" : ` ${step.durationMs}ms`;
    console.log(
      `   step  ${step.name} -> ${step.outcome}${duration} (attempt #${step.attemptFence})`,
    );
  }
  for (const effect of trace.effects) {
    console.log(`   effect ${effect.kind} ${effect.status}`);
  }
  console.log(
    `   events ${trace.events.map((event) => event.type).join(" > ")}\n   summary unfinished attempts ${trace.summary.unfinishedAttempts}, effects executed ${effects.executed}, reconciled ${effects.reconciled}, denied ${effects.denied}`,
  );
}

async function main() {
  const adminUrl = argValue("--database-url") ?? process.env.DATABASE_URL;
  if (!adminUrl)
    throw new Error("No Postgres connection. Pass --database-url or set DATABASE_URL.");
  const keep = process.argv.includes("--keep");
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
  const dbRequire = createRequire(path.join(repoRoot, "packages/db/package.json"));
  const prisma = dbRequire.resolve("prisma/build/index.js");
  const dataDir = path.join(repoRoot, "test-report", "reliability", "demo-data");
  await rm(dataDir, { recursive: true, force: true });
  await mkdir(dataDir, { recursive: true });

  Object.assign(process.env, {
    WAKEUP_DRIVER: "memory",
    SANDBOX_PROVIDER: "fake",
    AGENT_RUNTIME: "scripted",
    CLOUD_AGENT_PROVIDER: "emulator",
    CURSOR_API_KEY: "",
    COMPOSIO_API_KEY: "",
    OPENROUTER_API_KEY: "",
    MODEL_API_KEY: "",
    BETTER_AUTH_SECRET: "demo-secret-demo-secret-32chars!",
    ENCRYPTION_KEY: "demo-encryption-key-demo-encryption-key",
    SCREEN_PROXY_SECRET: "demo-screen-proxy-secret-demo-32chars",
    SIGNUPS_ENABLED: "true",
    SIGNUP_ALLOWLIST: "",
    // Request logs would bury the walkthrough; the suite is where failures get detail.
    LOG_LEVEL: "warn",
  });

  heading("scratch database");
  const database = await createScratchDatabase(
    adminUrl,
    `savingroup_demo_${Date.now().toString(36)}`,
  );
  console.log(`created ${database.name}; applying migrations`);
  let stop: (() => Promise<void>) | undefined;
  try {
    await runProcess(
      process.execPath,
      [prisma, "migrate", "deploy"],
      { ...process.env, DATABASE_URL: database.url },
      { cwd: path.join(repoRoot, "packages/db") },
    );
    const { createApp } = await import("../../../../apps/api/src/app.ts");
    const handles = await createApp({
      databaseUrl: database.url,
      realtimeDatabaseUrl: database.url,
      dataDir,
      sandboxProvider: "fake",
      agentRuntime: "scripted",
      wakeupDriver: "memory",
      defaultProvider: "scripted",
      defaultModel: "scripted",
    });
    stop = handles.stop;
    const records = () => handles.connector.records.length;
    const trace = (actor: ScenarioActor, runId: string) =>
      rpc<RunTrace>(handles, actor.cookie, "runs/trace", { runId });
    const stamp = Date.now().toString(36);

    heading("1. a side effect waits for approval");
    const actor = await createActor(handles, `demo-${stamp}`);
    await requireApprovalFor(handles, actor, "destination.write");
    const before = records();
    const runId = await sendMessage(handles, actor, PROMPT);
    await waitForThread(handles, actor, (snapshot) => snapshot.run?.status === "waiting_input");
    console.log(`destination records: ${records()} (unchanged from ${before})`);
    showTrace("paused", await trace(actor, runId));

    heading("2. approval executes the effect exactly once");
    await answerApproval(handles, actor, runId, "allow");
    await waitForRun(handles, runId, (run) => isTerminalStatus(run.status));
    console.log(`destination records: ${records()} (one more than ${before})`);
    showTrace("after approval", await trace(actor, runId));

    heading("3. a worker that died after the write is reclaimed and replays the stored outcome");
    await handles.prisma.run.update({
      where: { id: runId },
      data: {
        status: "running",
        completedAt: null,
        leaseOwner: "dead-worker",
        leaseExpiresAt: new Date(Date.now() - 60_000),
      },
    });
    await handles.executor.continueRun(runId, "late-worker");
    console.log(`destination records: ${records()} (still one more than ${before})`);
    showTrace("after replay", await trace(actor, runId));

    heading("4. a denied approval performs nothing");
    const deniedRunId = await sendMessage(handles, actor, PROMPT);
    await answerApproval(handles, actor, deniedRunId, "deny");
    await waitForRun(handles, deniedRunId, (run) => isTerminalStatus(run.status));
    console.log(`destination records: ${records()} (unchanged)`);
    showTrace("denied", await trace(actor, deniedRunId));

    heading(
      `5. a run whose workers keep dying stops after ${MAX_UNFINISHED_RUN_ATTEMPTS} attempts`,
    );
    const poisoned = await seedAbandonedRun(
      handles,
      actor,
      PROMPT,
      Array.from({ length: MAX_UNFINISHED_RUN_ATTEMPTS }, () => ({ status: "interrupted" })),
    );
    await handles.executor.continueRun(poisoned, "recovery-worker");
    showTrace("budget spent", await trace(actor, poisoned));
    await handles.executor.continueRun(poisoned, "another-worker");
    console.log(
      `   attempts after a second reclaim: ${await handles.prisma.attempt.count({ where: { runId: poisoned } })} (terminal, no new attempt)`,
    );
    console.log(`destination records: ${records()} (unchanged)`);

    heading("6. one attempt under the budget still recovers and finishes");
    const recoverable = await seedAbandonedRun(
      handles,
      actor,
      PROMPT,
      Array.from({ length: MAX_UNFINISHED_RUN_ATTEMPTS - 1 }, () => ({ status: "interrupted" })),
    );
    await handles.executor.continueRun(recoverable, "recovery-worker");
    showTrace("recovered and paused for approval", await trace(actor, recoverable));
    await answerApproval(handles, actor, recoverable, "allow");
    await waitForRun(handles, recoverable, (run) => isTerminalStatus(run.status));
    showTrace("finished", await trace(actor, recoverable));
    console.log(`destination records: ${records()} (one more)`);

    heading("done");
  } finally {
    await stop?.().catch(() => undefined);
    if (keep) console.log(`scratch database kept: ${database.name}`);
    else await database.drop().catch(() => undefined);
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
  },
);
