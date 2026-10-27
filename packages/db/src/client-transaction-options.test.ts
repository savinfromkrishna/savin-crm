import { afterEach, describe, expect, it, vi } from "vitest";

const { constructed } = vi.hoisted(() => ({
  constructed: [] as Array<Record<string, unknown>>,
}));

vi.mock("./generated/prisma/client.js", () => ({
  PrismaClient: class {
    constructor(options: Record<string, unknown>) {
      constructed.push(options);
    }
  },
}));

import { createDb, DB_TRANSACTION_OPTIONS } from "./client.js";

const pools: Array<{ end: () => Promise<void> }> = [];

afterEach(async () => {
  constructed.length = 0;
  await Promise.all(pools.splice(0).map((pool) => pool.end()));
});

describe("createDb transaction budget", () => {
  it("gives interactive transactions more than Prisma's 5 s default on a slow database", () => {
    const { pool } = createDb("postgres://savingroup:savingroup@127.0.0.1:9/savingroup");
    pools.push(pool);
    expect(constructed).toHaveLength(1);
    expect(constructed[0]?.transactionOptions).toEqual(DB_TRANSACTION_OPTIONS);
    expect(DB_TRANSACTION_OPTIONS.timeout).toBeGreaterThan(5_000);
    expect(DB_TRANSACTION_OPTIONS.maxWait).toBeGreaterThan(2_000);
  });
});
