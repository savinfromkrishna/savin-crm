import { createDb } from "@savingroup/db";

const DATABASE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

export type ScratchDatabase = {
  name: string;
  url: string;
  drop(): Promise<void>;
};

async function withAdminConnection(adminUrl: string, statements: string[]): Promise<void> {
  const { pool } = createDb(adminUrl, {
    poolMax: 1,
    applicationName: "savingroup-scratch-database",
  });
  try {
    const client = await pool.connect();
    try {
      for (const statement of statements) await client.query(statement);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

/**
 * A throwaway database on an existing Postgres server, for verification that needs a
 * real schema but must never touch a development or production database. `adminUrl`
 * is any database on that server the role may create databases from; the scratch
 * database is created beside it and dropped with `drop()`. Cloning from `template`
 * copies an already migrated database in one statement.
 */
export async function createScratchDatabase(
  adminUrl: string,
  name: string,
  options: { template?: string } = {},
): Promise<ScratchDatabase> {
  if (!DATABASE_NAME.test(name)) throw new Error(`Invalid scratch database name: ${name}`);
  if (options.template && !DATABASE_NAME.test(options.template)) {
    throw new Error(`Invalid template database name: ${options.template}`);
  }
  const template = options.template ? ` TEMPLATE "${options.template}"` : "";
  await withAdminConnection(adminUrl, [
    `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`,
    `CREATE DATABASE "${name}"${template}`,
  ]);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return {
    name,
    url: url.toString(),
    drop: () => withAdminConnection(adminUrl, [`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`]),
  };
}
