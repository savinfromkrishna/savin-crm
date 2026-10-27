import { loadRootEnv } from "@savingroup/core/node/load-root-env";

loadRootEnv();

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSecretStore } from "@savingroup/adapters";
import { createFrappeGateway, environmentToDto } from "@savingroup/business";
import type { BusinessBlueprintId } from "@savingroup/contracts";
import { resolveEncryptionKey } from "@savingroup/core";
import { createDb, requireMembership } from "@savingroup/db";

/**
 * Connect an organization to a provisioned Frappe site from the terminal,
 * the same way the ERP page's "Connect Savingroup ERP" does.
 *
 *   pnpm --filter @savingroup/api business:connect -- --email owner@example.com \
 *     --site-url http://localhost:8090 --state-file infra/frappe/state/frontend.gateway.json
 *
 * The state file is what infra/frappe/scripts/bootstrap-site.sh writes; pass
 * --api-key/--api-secret, --company, --abbr, --country, --currency and
 * --blueprint instead when connecting a site provisioned elsewhere. Needs
 * DATABASE_URL, ENCRYPTION_KEY and BUSINESS_APPS_ENABLED=true in the root .env.
 */
function parseArgs(): Map<string, string> {
  const args = new Map<string, string>();
  const tokens = process.argv.slice(2).filter((token) => token !== "--");
  for (let index = 0; index < tokens.length; index += 1) {
    const key = tokens[index];
    const value = tokens[index + 1];
    if (key?.startsWith("--") && value && !value.startsWith("--")) {
      args.set(key.slice(2), value);
      index += 1;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs();
  const email = args.get("email");
  const siteUrl = args.get("site-url");
  if (!email || !siteUrl)
    throw new Error("Pass --email <owner email> and --site-url <http(s) url>.");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  if (process.env.BUSINESS_APPS_ENABLED !== "true") {
    throw new Error("Set BUSINESS_APPS_ENABLED=true so the API routes to the environment.");
  }
  let state: Record<string, string> = {};
  const stateFile = args.get("state-file");
  if (stateFile) {
    const path = resolve(process.env.INIT_CWD ?? process.cwd(), stateFile);
    state = JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
  }
  const apiKey = args.get("api-key") ?? state.api_key;
  const apiSecret = args.get("api-secret") ?? state.api_secret;
  if (!apiKey || !apiSecret) throw new Error("Pass --api-key and --api-secret or --state-file.");
  const input = {
    siteUrl,
    apiKey,
    apiSecret,
    webhookSecret: args.get("webhook-secret") ?? randomBytes(24).toString("hex"),
    blueprintId: (args.get("blueprint") ?? state.blueprint ?? "india-smb") as BusinessBlueprintId,
    companyName: args.get("company") ?? state.company_name ?? "",
    companyAbbr: args.get("abbr") ?? state.company_abbr ?? "",
    country: args.get("country") ?? state.country ?? "India",
    currency: args.get("currency") ?? state.currency ?? "INR",
  };
  if (!input.companyName || !input.companyAbbr) {
    throw new Error("Pass --company and --abbr (or a state file that has them).");
  }

  const { prisma, pool } = createDb(process.env.DATABASE_URL, { poolMax: 2 });
  const secrets = createSecretStore(resolveEncryptionKey(), process.env);
  await secrets.start();
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error(`No account with email ${email}.`);
    const actor = await requireMembership(prisma, user.id, args.get("space") ?? null);
    const space = await prisma.space.findUniqueOrThrow({
      where: { id: actor.spaceId },
      select: { organizationId: true },
    });
    const gateway = createFrappeGateway({
      prisma,
      secrets,
      webhookBaseUrl: process.env.BUSINESS_WEBHOOK_BASE_URL ?? process.env.API_URL,
    });
    const row = await gateway.environments.connect(
      { userId: actor.userId, spaceId: actor.spaceId, organizationId: space.organizationId },
      input,
    );
    const dto = environmentToDto(row);
    process.stdout.write(`${JSON.stringify(dto, null, 2)}\n`);
    if (dto.status !== "active") process.exitCode = 1;
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
