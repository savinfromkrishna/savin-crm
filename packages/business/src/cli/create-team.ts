import { loadRootEnv } from "@savingroup/core/node/load-root-env";

loadRootEnv();

import { createDb, createSpaceForMember, requireMembership } from "@savingroup/db";
import { createBusinessTeam } from "../team.js";
import { parseCliArgs } from "./args.js";

/**
 * Create the business team (Sales Executive, Operations, Finance, Business
 * Analyst) and the owner's approval policy in a space.
 *
 *   pnpm --filter @savingroup/business team -- --email you@example.com [--space-name Business | --space <spaceId>] [--sync] [--operator] [--autonomous [--allow-delete]]
 *
 * `--space-name` reuses a space of that name in the account's organization or
 * creates it; without a space option the default space is used. `--sync`
 * refreshes the role definition of bots that already exist. `--operator` adds
 * the Operator, who holds every CRM, ERP and site-administration tool.
 * `--autonomous` is the one-time grant for unattended operation: it adds the
 * Operator and replaces the pause rules for the consequential tools with
 * always-allow rules in that space; deleting site documents stays gated unless
 * `--allow-delete` is passed. Needs DATABASE_URL and BUSINESS_APPS_ENABLED=true
 * in the root .env. Rerunning is safe.
 */
async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const email = args.get("email");
  if (!email) throw new Error("Pass --email <account email> for the person who owns the team.");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  if (process.env.BUSINESS_APPS_ENABLED !== "true") {
    throw new Error("Set BUSINESS_APPS_ENABLED=true so the API and bots can see the records.");
  }
  const { prisma, pool } = createDb(process.env.DATABASE_URL, { poolMax: 2 });
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error(`No account with email ${email}.`);
    const home = await requireMembership(prisma, user.id, args.get("space") ?? null);
    let spaceId = home.spaceId;
    let spaceCreated = false;
    const spaceName = args.get("space-name");
    if (spaceName) {
      const organization = await prisma.space.findUniqueOrThrow({
        where: { id: home.spaceId },
        select: { organizationId: true },
      });
      const existing = await prisma.spaceMember.findFirst({
        where: {
          userId: user.id,
          organizationId: organization.organizationId,
          space: { name: spaceName.trim(), deletingAt: null },
        },
        select: { spaceId: true },
        orderBy: { createdAt: "asc" },
      });
      if (existing) {
        spaceId = existing.spaceId;
      } else {
        spaceId = (
          await createSpaceForMember(prisma, {
            currentSpaceId: home.spaceId,
            userId: user.id,
            name: spaceName,
          })
        ).id;
        spaceCreated = true;
      }
    }
    const actor = await requireMembership(prisma, user.id, spaceId);
    const autonomous = args.has("autonomous");
    const team = await createBusinessTeam(prisma, actor, {
      sync: args.has("sync"),
      operator: args.has("operator") || autonomous,
      autonomous,
      allowDelete: args.has("allow-delete"),
    });
    const space = await prisma.space.findUniqueOrThrow({
      where: { id: actor.spaceId },
      select: { name: true, organization: { select: { businessEnvironment: true } } },
    });
    const environment = space.organization.businessEnvironment;
    process.stdout.write(
      `${JSON.stringify(
        {
          space: { id: actor.spaceId, name: space.name, created: spaceCreated },
          bots: team.bots.map((bot) => ({ id: bot.id, name: bot.name })),
          created: team.created,
          updated: team.updated,
          autonomy: team.autonomy ?? null,
          environment: environment
            ? { status: environment.status, siteUrl: environment.siteUrl }
            : null,
        },
        null,
        2,
      )}\n`,
    );
    if (environment?.status !== "active") {
      process.stderr.write(
        "No active business environment: the team works on the prototype tables until the organization connects a site (business:connect).\n",
      );
    }
    if (team.autonomy) {
      const gated = team.autonomy.stillGated;
      process.stderr.write(
        `Autonomy granted in space "${space.name}": ${team.autonomy.allowed.length} tools run without approval` +
          (gated.length ? `; still gated: ${gated.join(", ")}` : "") +
          ".\n" +
          "Site-side grant (once, so the Operator can administer Savingroup ERP and CRM; one line, any shell):\n" +
          "  docker compose -f infra/frappe/compose.yaml --env-file infra/frappe/.env exec backend bench --site <site> execute savingroup_business_bridge.setup.grant_admin --kwargs \"{'email': '<gateway email>'}\"\n",
      );
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
