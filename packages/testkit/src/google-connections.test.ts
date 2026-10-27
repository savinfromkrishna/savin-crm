import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { createApp } from "../../../apps/api/src/app.ts";
import { GoogleEmulator } from "../../adapters/src/testing/google-emulator.js";
import { discardBotIntroRun } from "./discard-bot-intro.js";
import { sessionCookieHeader } from "./index.js";

type App = { request: (input: string, init?: RequestInit) => Promise<Response> };
type AppHandles = Awaited<ReturnType<typeof createApp>>;
type Actor = { spaceId: string; userId: string };
type Connection = {
  id: string;
  connectorId: string;
  provider: string;
  status: string;
  account?: { email: string; status: string; permissions: Array<{ id: string; granted: boolean }> };
};

process.env.WAKEUP_DRIVER = "memory";
process.env.SANDBOX_PROVIDER = "fake";
process.env.AGENT_RUNTIME = "scripted";

const hasDb = process.env.VERIFY_DATABASE === "1" && Boolean(process.env.DATABASE_URL);
const describeWithDatabase = hasDb ? describe : describe.skip;
const WEB_ORIGIN = "http://127.0.0.1:5173";
const ALICE = { subject: "alice-google-sub", email: "alice@example.test" };

describeWithDatabase("Google connections through the API", () => {
  let handles: AppHandles;
  let app: App;
  const google = new GoogleEmulator();
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const dataDir = mkdtempSync(path.join(tmpdir(), "savingroup-google-"));

  beforeAll(async () => {
    const { createApp } = await import("../../../apps/api/src/app.ts");
    handles = await createApp({
      databaseUrl: process.env.DATABASE_URL!,
      dataDir,
      sandboxProvider: "fake",
      agentRuntime: "scripted",
      encryptionKey: "offline-google-journey-encryption-key",
      signupsEnabled: "true",
      webOrigin: WEB_ORIGIN,
      googleClientId: google.clientId,
      googleClientSecret: google.clientSecret,
      googleFetch: google.fetch,
    });
    app = handles.app;
  });

  afterAll(async () => {
    await handles?.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function begin(cookie: string, provider: string) {
    return rpc<{ connectionId: string; authorizationUrl: string }>(
      app,
      cookie,
      "connections/begin",
      { connectorId: "google", provider, displayName: provider },
    );
  }

  async function callback(cookie: string, params: { state: string; code?: string }) {
    const query = new URLSearchParams({ state: params.state, code: params.code ?? "" });
    const response = await app.request(`/api/integrations/google/callback?${query}`, {
      headers: { cookie },
      redirect: "manual",
    });
    expect(response.status).toBe(303);
    return new URL(response.headers.get("location") ?? "").searchParams.get("result");
  }

  async function connect(cookie: string, provider: string) {
    const started = await begin(cookie, provider);
    const consent = google.consent(started.authorizationUrl, ALICE);
    expect(await callback(cookie, consent)).toBe("connected");
    return started.connectionId;
  }

  it("connects Gmail through the callback, only for the browser that started it", async () => {
    const owner = await signup(app, `google-owner-${stamp}@savingroup.test`, "Owner");
    const other = await signup(app, `google-other-${stamp}@savingroup.test`, "Other");
    const ownerActor = await rpc<Actor>(app, owner, "me");

    const catalog = await rpc<Array<{ slug: string; connected: boolean }>>(
      app,
      owner,
      "connections/catalog",
      { connectorId: "google" },
    );
    expect(catalog.map((item) => item.slug)).toEqual(
      expect.arrayContaining(["gmail", "google_drive", "google_calendar", "youtube"]),
    );

    const started = await begin(owner, "gmail");
    expect(new URL(started.authorizationUrl).origin).toBe("https://accounts.google.com");
    const consent = google.consent(started.authorizationUrl, ALICE);

    // Someone else's browser holding the same link cannot finish it, and does not burn it.
    expect(await callback(other, consent)).toBe("session");
    expect(await callback(owner, consent)).toBe("connected");
    expect(await callback(owner, consent)).toBe("expired");

    const completed = await rpc<Connection>(app, owner, "connections/complete", {
      connectionId: started.connectionId,
    });
    expect(completed.status).toBe("connected");
    const [row] = (await rpc<Connection[]>(app, owner, "connections/list")).filter(
      (connection) => connection.connectorId === "google",
    );
    expect(row).toMatchObject({
      provider: "gmail",
      status: "connected",
      account: { email: ALICE.email, status: "ok" },
    });
    expect(row?.account?.permissions).toContainEqual(
      expect.objectContaining({ id: "read", granted: true }),
    );
    expect(await rpc<Connection[]>(app, other, "connections/list")).toEqual([]);

    const tools = await rpc<Array<{ name: string }>>(app, owner, "connections/tools", {
      connectorId: "google",
      provider: "gmail",
    });
    expect(tools.map((tool) => tool.name)).toContain("gmail_search_messages");
    expect(tools.map((tool) => tool.name)).not.toContain("google_get_access");

    const secret = await handles.prisma.secret.findFirst({
      where: { userId: ownerActor.userId, kind: "connector:google" },
    });
    expect(secret?.ciphertext).toMatch(/^v2:/);
    expect(secret?.ciphertext).not.toContain("1//emulator");

    const activity = await rpc<Array<{ action: string; status: string }>>(
      app,
      owner,
      "connections/activity",
      { connectorId: "google", provider: "gmail" },
    );
    expect(activity[0]).toMatchObject({ action: "authorize", status: "succeeded" });
  });

  it("runs a Gmail tool for the bot's owner with the stored grant", async () => {
    const owner = await signup(app, `google-bot-${stamp}@savingroup.test`, "Bot owner");
    await connect(owner, "gmail");
    const bot = await rpc<{ id: string }>(app, owner, "bots/create", {
      name: "Mail",
      title: "Mail",
      description: "Reads mail",
      instructions: "Read mail.",
    });
    await discardBotIntroRun(handles, owner, bot.id);

    const { runId } = await rpc<{ runId: string }>(app, owner, "threads/send", {
      botId: bot.id,
      text: "search my gmail for invoices",
    });
    await waitForDatabase(async () => {
      const run = await handles.prisma.run.findUnique({
        where: { id: runId },
        select: { status: true },
      });
      return ["completed", "failed", "cancelled"].includes(run?.status ?? "");
    });
    const run = await handles.prisma.run.findUniqueOrThrow({
      where: { id: runId },
      select: { status: true, error: true },
    });
    expect(run).toEqual({ status: "completed", error: null });
    expect(
      google.requests.some(
        (request) =>
          request.url.pathname === "/gmail/v1/users/me/messages" &&
          request.url.searchParams.get("q") === "invoices",
      ),
    ).toBe(true);
    const activity = await rpc<Array<{ action: string; status: string }>>(
      app,
      owner,
      "connections/activity",
      { connectorId: "google", provider: "gmail" },
    );
    expect(activity).toContainEqual(
      expect.objectContaining({ action: "gmail_search_messages", status: "succeeded" }),
    );
  });

  it("revokes the Google grant only when the last app on the account is removed", async () => {
    const owner = await signup(app, `google-revoke-${stamp}@savingroup.test`, "Revoker");
    const ownerActor = await rpc<Actor>(app, owner, "me");
    const gmail = await connect(owner, "gmail");
    const drive = await connect(owner, "google_drive");
    const revokedBefore = google.revoked.length;

    await rpc(app, owner, "connections/revoke", { connectionId: gmail });
    expect(google.revoked.length).toBe(revokedBefore);
    expect(
      await handles.prisma.connectorAccount.count({ where: { userId: ownerActor.userId } }),
    ).toBe(1);

    await rpc(app, owner, "connections/revoke", { connectionId: drive });
    expect(google.revoked.length).toBe(revokedBefore + 1);
    expect(
      await handles.prisma.connectorAccount.count({ where: { userId: ownerActor.userId } }),
    ).toBe(0);
    expect(
      await handles.prisma.secret.count({
        where: { userId: ownerActor.userId, kind: "connector:google" },
      }),
    ).toBe(0);
  });
});

async function signup(app: App, email: string, name: string) {
  const response = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: WEB_ORIGIN },
    body: JSON.stringify({ email, password: "password12", name }),
  });
  if (!response.ok) throw new Error(`signup failed ${response.status}: ${await response.text()}`);
  return sessionCookieHeader(response);
}

async function rpc<T>(app: App, cookie: string, procedure: string, body: unknown = {}): Promise<T> {
  const response = await app.request(`/rpc/${procedure}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, origin: WEB_ORIGIN },
    body: JSON.stringify({ json: body }),
  });
  const text = await response.text();
  const parsed = JSON.parse(text) as { json?: T; error?: { message?: string } };
  if (!response.ok || parsed.error) {
    throw new Error(`${procedure} ${response.status}: ${parsed.error?.message ?? text}`);
  }
  return parsed.json as T;
}

async function waitForDatabase(pred: () => Promise<boolean>) {
  const start = Date.now();
  while (Date.now() - start < 20_000) {
    if (await pred()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("timeout waiting for database state");
}
