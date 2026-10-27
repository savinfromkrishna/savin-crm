import "dotenv/config";
import { createBusinessTeam, seedBusinessDemo } from "@savingroup/business";
import { createDb } from "@savingroup/db";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Missing DATABASE_URL in environment.");
  }
  const { prisma, pool } = createDb(databaseUrl);
  try {
    const spaceMember = await prisma.spaceMember.findFirst({
      where: { role: "owner" },
      orderBy: { createdAt: "asc" },
    });
    if (!spaceMember) {
      console.log(
        "Database is migrated and ready. Sign up in the web UI first (or click Seed Demo / Provision Team in the CRM workspace) to seed your workspace.",
      );
      return;
    }
    const user = await prisma.user.findUnique({
      where: { id: spaceMember.userId },
      select: { email: true },
    });
    const actor = {
      userId: spaceMember.userId,
      spaceId: spaceMember.spaceId,
      email: user?.email ?? "owner@example.com",
      isDeploymentOwner: true,
    };
    const team = await createBusinessTeam(prisma, actor, { operator: true, sync: true });
    const seeded = await seedBusinessDemo(
      { prisma, enabled: true },
      { spaceId: actor.spaceId, userId: actor.userId },
    );
    console.log(
      JSON.stringify(
        {
          spaceId: actor.spaceId,
          botsCreated: team.created,
          botsUpdated: team.updated,
          seeded,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

void main();
