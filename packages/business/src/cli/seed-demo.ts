import { loadRootEnv } from "@savingroup/core/node/load-root-env";

loadRootEnv();

import { createDb, requireMembership } from "@savingroup/db";
import { seedBusinessDemo } from "../demo.js";
import { createBusinessTeam } from "../team.js";
import { parseCliArgs } from "./args.js";

/**
 * Seed an example company into a space and create the business team there.
 *
 *   pnpm --filter @savingroup/business demo -- --email you@example.com [--space <spaceId>]
 *
 * Needs DATABASE_URL and BUSINESS_APPS_ENABLED=true in the root .env (the same
 * flag the API reads). Rerunning is safe: records and bots are idempotent.
 * `pnpm --filter @savingroup/business team` creates the team without the example data.
 */
async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const email = args.get("email");
  if (!email) throw new Error("Pass --email <account email> for the user who owns the records.");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  if (process.env.BUSINESS_APPS_ENABLED !== "true") {
    throw new Error("Set BUSINESS_APPS_ENABLED=true so the API and bots can see the records.");
  }
  const { prisma, pool } = createDb(process.env.DATABASE_URL, { poolMax: 2 });
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      const accounts = await prisma.user.findMany({
        select: { email: true },
        orderBy: { createdAt: "asc" },
        take: 20,
      });
      const known = accounts.map((account) => account.email).join(", ");
      throw new Error(
        `No account with email ${email}.${known ? ` Accounts in this database: ${known}` : ""}`,
      );
    }
    const actor = await requireMembership(prisma, user.id, args.get("space") ?? null);
    const seeded = await seedBusinessDemo({ prisma, enabled: true }, actor);
    const team = await createBusinessTeam(prisma, actor);
    process.stdout.write(
      `${JSON.stringify(
        {
          spaceId: actor.spaceId,
          ...seeded,
          bots: team.bots.map((bot) => ({ id: bot.id, name: bot.name })),
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
