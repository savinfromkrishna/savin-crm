import { loadRootEnv } from "@savingroup/core/node/load-root-env";

loadRootEnv();

import { createSecretStore } from "@savingroup/adapters";
import {
  createFrappeGateway,
  formatMigrationReport,
  migrateLegacyBusinessData,
} from "@savingroup/business";
import { resolveEncryptionKey } from "@savingroup/core";
import { createDb, requireMembership } from "@savingroup/db";

/**
 * Move an organization's prototype CRM/ERP records to its connected site.
 *
 *   pnpm --filter @savingroup/api business:migrate -- --email owner@example.com          # dry run
 *   pnpm --filter @savingroup/api business:migrate -- --email owner@example.com --apply [--hsn 8471]
 *
 * Dry run prints the inventory, collisions and totals and writes nothing. Apply
 * is idempotent; rerun it after fixing failures. Orders and invoices are
 * reported, not recreated (ADR 0004).
 */
function parseArgs(): { values: Map<string, string>; flags: Set<string> } {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const tokens = process.argv.slice(2).filter((token) => token !== "--");
  for (let index = 0; index < tokens.length; index += 1) {
    const key = tokens[index];
    if (!key?.startsWith("--")) continue;
    const value = tokens[index + 1];
    if (value && !value.startsWith("--")) {
      values.set(key.slice(2), value);
      index += 1;
    } else {
      flags.add(key.slice(2));
    }
  }
  return { values, flags };
}

async function main() {
  const { values, flags } = parseArgs();
  const email = values.get("email");
  if (!email) throw new Error("Pass --email <owner email>.");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  const { prisma, pool } = createDb(process.env.DATABASE_URL, { poolMax: 2 });
  const secrets = createSecretStore(resolveEncryptionKey(), process.env);
  await secrets.start();
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error(`No account with email ${email}.`);
    const actor = await requireMembership(prisma, user.id, values.get("space") ?? null);
    const space = await prisma.space.findUniqueOrThrow({
      where: { id: actor.spaceId },
      select: { organizationId: true },
    });
    const gateway = createFrappeGateway({ prisma, secrets });
    const report = await migrateLegacyBusinessData(
      { prisma, gateway },
      {
        organizationId: space.organizationId,
        actorUserId: actor.userId,
        apply: flags.has("apply"),
        defaultHsnCode: values.get("hsn"),
      },
    );
    process.stdout.write(`${formatMigrationReport(report)}\n`);
    if (report.failures.length) process.exitCode = 1;
  } finally {
    await secrets.close();
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
