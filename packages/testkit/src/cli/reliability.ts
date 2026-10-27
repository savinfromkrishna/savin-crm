import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv } from "@savingroup/core/node/load-root-env";
import { createScratchDatabase } from "../local-postgres.js";
import { runProcess } from "./process.js";

loadRootEnv();

/**
 * Reliability regressions against a Postgres server that is already running, with no
 * Docker and no Testcontainers: approval gating, once-only side effects, replay
 * suppression, lease reclaim with fences, the recovery budget, the run trace, the
 * Graphile queue and reconciliation leadership. Each suite gets its own clone of one
 * migrated scratch database and every database is dropped afterwards.
 */
const SUITES = [
  "packages/testkit/src/reliability.postgres.test.ts",
  "packages/testkit/src/executor-lifecycle.test.ts",
  "packages/testkit/src/computer-approval.postgres.test.ts",
  "packages/adapters/src/wakeup.postgres.test.ts",
  "packages/adapters/src/job-reconciler.postgres.test.ts",
];

const USAGE = `Usage: tsx packages/testkit/src/cli/reliability.ts [--database-url=<url>] [--suite=<text>]... [--keep]

  --database-url  Admin connection on a reachable Postgres server. Defaults to DATABASE_URL
                  from the environment or the checkout's .env. Scratch databases are created
                  next to that database and dropped afterwards; it is never written to itself.
  --suite         Only run suites whose path contains this text (repeatable).
  --keep          Leave the scratch databases in place for inspection.`;

function argValue(flag: string): string | undefined {
  const match = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  return match?.slice(flag.length + 1);
}

function argValues(flag: string): string[] {
  return process.argv
    .filter((arg) => arg.startsWith(`${flag}=`))
    .map((arg) => arg.slice(flag.length + 1))
    .filter(Boolean);
}

/**
 * A file inside an installed package that its export map does not list (vitest's CLI
 * entry). Resolve the package's main entry, then walk up to the package directory.
 */
export function packageFile(resolver: NodeJS.Require, name: string, file: string): string {
  let dir = path.dirname(resolver.resolve(name));
  while (path.basename(dir) !== name) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`Could not locate the ${name} package directory`);
    dir = parent;
  }
  return path.join(dir, file);
}

export function scratchDatabaseName(prefix: string, now = new Date()): string {
  return `${prefix}_${now.getTime().toString(36)}`;
}

export function selectSuites(all: readonly string[], filters: readonly string[]): string[] {
  if (filters.length === 0) return [...all];
  return all.filter((suite) => filters.some((filter) => suite.includes(filter)));
}

async function main() {
  if (process.argv.includes("--help")) {
    console.log(USAGE);
    return;
  }
  const adminUrl = argValue("--database-url") ?? process.env.DATABASE_URL;
  if (!adminUrl) {
    throw new Error(`No Postgres connection. Pass --database-url or set DATABASE_URL.\n\n${USAGE}`);
  }
  const suites = selectSuites(SUITES, argValues("--suite"));
  if (suites.length === 0) throw new Error("No suite matches the --suite filters");
  const keep = process.argv.includes("--keep");

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
  const rootRequire = createRequire(path.join(repoRoot, "package.json"));
  const dbRequire = createRequire(path.join(repoRoot, "packages/db/package.json"));
  const vitest = packageFile(rootRequire, "vitest", "vitest.mjs");
  const prisma = dbRequire.resolve("prisma/build/index.js");
  const reportDir = path.join(repoRoot, "test-report", "reliability");
  await mkdir(reportDir, { recursive: true });

  const base = await createScratchDatabase(adminUrl, scratchDatabaseName("savingroup_reliability"));
  const results: Array<{ suite: string; ok: boolean; durationMs: number; error?: string }> = [];
  try {
    await runProcess(
      process.execPath,
      [prisma, "migrate", "deploy"],
      { ...process.env, DATABASE_URL: base.url },
      { cwd: path.join(repoRoot, "packages/db") },
    );
    for (const [index, suite] of suites.entries()) {
      const clone = await createScratchDatabase(adminUrl, `${base.name}_${index}`, {
        template: base.name,
      });
      const started = Date.now();
      try {
        await runProcess(
          process.execPath,
          [vitest, "run", suite],
          {
            ...process.env,
            VERIFY_DATABASE: "1",
            DATABASE_URL: clone.url,
            REALTIME_DATABASE_URL: clone.url,
            WAKEUP_DRIVER: "memory",
            SANDBOX_PROVIDER: "fake",
            AGENT_RUNTIME: "scripted",
            CLOUD_AGENT_PROVIDER: "emulator",
            CURSOR_API_KEY: "",
            COMPOSIO_API_KEY: "",
            OPENROUTER_API_KEY: "",
            MODEL_API_KEY: "",
            BETTER_AUTH_SECRET: "test-secret-test-secret-32chars!",
            ENCRYPTION_KEY: "test-encryption-key-test-encryption-key",
            SANDBOX_SUPERVISOR_TOKEN: "test-supervisor-token-test-32chars",
            SCREEN_PROXY_SECRET: "test-screen-proxy-secret-test-32chars",
            SIGNUPS_ENABLED: "true",
            SIGNUP_ALLOWLIST: "",
            DATA_DIR: path.join(reportDir, "data", String(index)),
            CI: "1",
          },
          { cwd: repoRoot },
        );
        results.push({ suite, ok: true, durationMs: Date.now() - started });
      } catch (error) {
        results.push({
          suite,
          ok: false,
          durationMs: Date.now() - started,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        if (!keep) await clone.drop().catch(() => undefined);
      }
    }
  } finally {
    if (!keep) await base.drop().catch(() => undefined);
  }

  const ok = results.every((result) => result.ok);
  await writeFile(
    path.join(reportDir, "summary.json"),
    JSON.stringify({ ok, at: new Date().toISOString(), results }, null, 2),
  );
  for (const result of results) {
    const seconds = (result.durationMs / 1000).toFixed(1);
    console.log(`${result.ok ? "pass" : "FAIL"}  ${seconds}s  ${result.suite}`);
  }
  if (keep) console.log(`Scratch databases kept with prefix ${base.name}`);
  if (!ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    () => process.exit(process.exitCode ?? 0),
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
