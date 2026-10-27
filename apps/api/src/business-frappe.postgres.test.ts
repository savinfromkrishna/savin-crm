import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSignedBusinessDelivery } from "@savingroup/business";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeFrappeSite } from "../../../packages/business/src/frappe/testing/fake-frappe.js";
import { sessionCookieHeader } from "../../../packages/testkit/src/index.js";
import { createApp } from "./app.js";

/**
 * The native business gateway over HTTP, against a fake Frappe site listening
 * on a real socket: an owner connects the organization's site, CRM and ERP
 * calls land there, a second organization cannot see it, signed events are
 * stored once, and the ledger shows every write. PostgreSQL-gated.
 */
const describePostgres =
  process.env.VERIFY_DATABASE === "1" && process.env.DATABASE_URL
    ? describe.sequential
    : describe.skip;
const origin = "http://127.0.0.1:5173";

type Handles = Awaited<ReturnType<typeof createApp>>;

async function startApp() {
  vi.stubEnv("BUSINESS_APPS_ENABLED", "true");
  const dataDir = await mkdtemp(join(tmpdir(), "savingroup-business-frappe-"));
  const handles = await createApp({
    databaseUrl: process.env.DATABASE_URL!,
    dataDir,
    sandboxProvider: "fake",
    agentRuntime: "scripted",
    wakeupDriver: "memory",
    signupsEnabled: "true",
    webOrigin: origin,
    authUrl: origin,
  });
  const stop = async () => {
    await handles.stop();
    await rm(dataDir, { recursive: true, force: true });
  };
  return { handles, stop };
}

async function signUp(handles: Handles, label: string) {
  const response = await handles.app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({
      email: `${label}-${randomUUID()}@savingroup.test`,
      password: "test-password-123",
      name: `${label} tester`,
    }),
  });
  expect(response.status).toBeLessThan(400);
  return sessionCookieHeader(response);
}

async function call<T = unknown>(
  handles: Handles,
  cookie: string,
  procedure: string,
  input: unknown = {},
): Promise<{ status: number; json?: T; error?: { code?: string; message?: string } }> {
  const response = await handles.app.request(`/rpc/${procedure}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, origin },
    body: JSON.stringify({ json: input }),
  });
  const body = (await response.json()) as { json?: unknown };
  if (response.status >= 400) {
    return { status: response.status, error: body.json as { code?: string; message?: string } };
  }
  return { status: response.status, json: body.json as T };
}

async function must<T>(handles: Handles, cookie: string, procedure: string, input: unknown = {}) {
  const result = await call<T>(handles, cookie, procedure, input);
  if (result.status >= 400 || result.error) {
    throw new Error(`${procedure}: ${result.status} ${result.error?.message ?? ""}`);
  }
  return result.json as T;
}

const KEY = "gateway-key-aaaa";
const SECRET = "gateway-secret-bbbb";
const HOOK = "hook-secret-cccc";

describePostgres("business gateway over HTTP", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("connects an organization to its site, routes CRM and ERP there, and isolates tenants", async () => {
    const site = new FakeFrappeSite({
      apiKey: KEY,
      apiSecret: SECRET,
      company: "Acme Robotics Ltd",
    });
    const siteUrl = await site.listen();
    const { handles, stop } = await startApp();
    try {
      const owner = await signUp(handles, "owner");
      const other = await signUp(handles, "other");

      expect(await must(handles, owner, "business/environment/get")).toBeNull();
      const connected = await must<{ status: string; id: string; lastError: string | null }>(
        handles,
        owner,
        "business/environment/connect",
        {
          siteUrl,
          apiKey: KEY,
          apiSecret: SECRET,
          webhookSecret: HOOK,
          blueprintId: "india-smb",
          companyName: "Acme Robotics Ltd",
          companyAbbr: "AR",
          country: "India",
          currency: "INR",
        },
      );
      expect(connected.status).toBe("active");
      // The site was told where to deliver events, with this environment's id in the path.
      const configure = site.requests.find((r) => r.path.endsWith(".configure_webhook"));
      expect(configure?.body).toMatchObject({
        url: expect.stringContaining(`/webhooks/business/frappe/${connected.id}`),
      });

      const company = await must<{ id: string }>(handles, owner, "crm/companies/create", {
        name: "Acme Robotics",
        domain: "acme.example",
      });
      expect(company.id).toBe("Acme Robotics");
      expect(site.find("CRM Organization", "Acme Robotics")).toBeDefined();
      const product = await must<{ sku: string; stockOnHand: number }>(
        handles,
        owner,
        "erp/products/create",
        {
          sku: "SENSOR-X1",
          name: "Sensor",
          unitPrice: 149,
          initialStock: 10,
        },
      );
      expect(product).toMatchObject({ sku: "SENSOR-X1", stockOnHand: 10 });
      const overview = await must<{ products: number; currency: string }>(
        handles,
        owner,
        "erp/overview",
      );
      expect(overview).toMatchObject({ products: 1, currency: "INR" });
      const settings = await must<{ currency: string }>(handles, owner, "business/settings");
      expect(settings.currency).toBe("INR");

      // Another organization: no environment, nothing from the site.
      expect(await must(handles, other, "business/environment/get")).toBeNull();
      const theirs = await must<{ companies: unknown[] }>(handles, other, "crm/companies/list", {});
      expect(theirs.companies).toEqual([]);
      const byId = await must<{ companies: unknown[] }>(handles, other, "crm/companies/list", {
        id: "Acme Robotics",
      });
      expect(byId.companies).toEqual([]);
      const forbidden = await call(handles, other, "business/environment/connect", {
        siteUrl,
        apiKey: KEY,
        apiSecret: SECRET,
        webhookSecret: HOOK,
        blueprintId: "generic",
        companyName: "Acme Robotics Ltd",
        companyAbbr: "AR",
        country: "United States",
        currency: "USD",
      });
      // The other account owns its own workspace, so it may connect; but it is a different organization.
      expect([200, 403]).toContain(forbidden.status);

      // The ledger shows the writes, newest first.
      const operations = await must<Array<{ actionId: string; status: string }>>(
        handles,
        owner,
        "business/environment/operations",
        { limit: 10 },
      );
      expect(operations.map((op) => op.actionId)).toEqual([
        "erp.product.create",
        "crm.company.create",
      ]);
      expect(operations.every((op) => op.status === "succeeded")).toBe(true);

      // Signed event delivery: stored once, replay ignored, bad signature refused.
      const delivery = buildSignedBusinessDelivery(HOOK, {
        type: "crm.lead.created",
        doctype: "CRM Lead",
        name: "CRM-LEAD-2026-00001",
      });
      const post = (headers: Record<string, string>, body: string) =>
        handles.app.request(`/webhooks/business/frappe/${connected.id}`, {
          method: "POST",
          headers,
          body,
        });
      const first = await post(delivery.headers, delivery.rawBody);
      expect(first.status).toBe(200);
      expect(await first.json()).toMatchObject({ status: "stored" });
      const second = await post(delivery.headers, delivery.rawBody);
      expect(await second.json()).toMatchObject({ status: "duplicate" });
      const forged = await post(
        { ...delivery.headers, "x-savingroup-signature": `sha256=${"0".repeat(64)}` },
        delivery.rawBody,
      );
      expect(forged.status).toBe(401);
      const unknown = await post(delivery.headers, delivery.rawBody).then(() =>
        handles.app.request("/webhooks/business/frappe/does-not-exist", {
          method: "POST",
          headers: delivery.headers,
          body: delivery.rawBody,
        }),
      );
      expect(unknown.status).toBe(404);
      const events = await must<Array<{ type: string }>>(handles, owner, "business/events", {
        limit: 20,
      });
      expect(events.map((event) => event.type)).toContain("crm.lead.created");

      // Rollback switch: disabling returns the organization to the prototype tables.
      const disabled = await must<{ status: string }>(
        handles,
        owner,
        "business/environment/disable",
      );
      expect(disabled.status).toBe("disabled");
      const prototype = await must<{ companies: unknown[] }>(
        handles,
        owner,
        "crm/companies/list",
        {},
      );
      expect(prototype.companies).toEqual([]);
    } finally {
      await stop();
      await site.close();
    }
  });
});
