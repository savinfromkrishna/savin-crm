import {
  CrmCompanySchema,
  CrmDealSchema,
  CrmLeadSchema,
  ErpInvoiceSchema,
  ErpProductSchema,
  ErpSalesOrderSchema,
} from "@savingroup/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BusinessDeps } from "../context.js";
import { executeBusinessAction } from "../execute.js";
import { FrappeClient, FrappeRequestError } from "./client.js";
import { verifyFrappeEnvironment } from "./environment.js";
import { createFrappeGateway, type FrappeGateway } from "./gateway.js";
import { MemoryOperationLedger } from "./ledger.js";
import { reconcileBusinessOperationJob, sweepUnsettledOperations } from "./reconcile.js";
import { FakeFrappeSite } from "./testing/fake-frappe.js";
import {
  environmentRow,
  type FakePrismaHandle,
  fakePrisma,
  fakeSecrets,
  fakeWorld,
} from "./testing/fakes.js";
import {
  buildSignedBusinessDelivery,
  ingestBusinessWebhook,
  parseBusinessWebhookBody,
  verifyBusinessWebhookSignature,
} from "./webhook.js";

/**
 * The native business gateway against a fake Frappe site: routing, tenant
 * isolation, idempotency, lost responses, permissions and signed events. No
 * sockets and no database; the fake site mirrors the bridge's rules.
 */

const KEY = "gateway-key-aaaa";
const SECRET = "gateway-secret-bbbb";

function sealed(value: unknown): string {
  return `sealed:${Buffer.from(JSON.stringify(value), "utf8").toString("base64")}`;
}

interface Harness {
  site: FakeFrappeSite;
  siteB: FakeFrappeSite;
  gateway: FrappeGateway;
  deps: BusinessDeps;
  handle: FakePrismaHandle;
  ledger: MemoryOperationLedger;
  secrets: ReturnType<typeof fakeSecrets>;
  /** Reconcile jobs the gateway asked for. */
  jobs: Array<{ name: string; payload: unknown; availableAt?: Date }>;
}

function harness(options: { timeoutMs?: number } = {}): Harness {
  const site = new FakeFrappeSite({ apiKey: KEY, apiSecret: SECRET, company: "Acme Robotics Ltd" });
  const siteB = new FakeFrappeSite({ apiKey: KEY, apiSecret: SECRET, company: "Northwind LLC" });
  const world = fakeWorld({
    spaces: { "space-a": "org-a", "space-a2": "org-a", "space-b": "org-b", "space-proto": "org-p" },
    environments: {
      "org-a": environmentRow({
        id: "env-a",
        organizationId: "org-a",
        siteUrl: "http://site-a.test",
        companyName: "Acme Robotics Ltd",
        credentialSecretId: "cred-a",
        credentialCiphertext: sealed({ apiKey: KEY, apiSecret: SECRET }),
        webhookSecretId: "hook-a",
        webhookSecretCiphertext: `sealed:${Buffer.from("hook-secret-a").toString("base64")}`,
      }),
      "org-b": environmentRow({
        id: "env-b",
        organizationId: "org-b",
        siteUrl: "http://site-b.test",
        companyName: "Northwind LLC",
        credentialSecretId: "cred-b",
        credentialCiphertext: sealed({ apiKey: KEY, apiSecret: SECRET }),
      }),
    },
    bots: {
      "bot-sales": {
        spaceId: "space-a",
        disabledBuiltinTools: ["erp_order_confirm"],
        archivedAt: null,
      },
    },
  });
  const handle = fakePrisma(world);
  const secrets = fakeSecrets();
  const ledger = new MemoryOperationLedger();
  const fetchImpl: typeof fetch = (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    return url.host === "site-b.test" ? siteB.fetch(input, init) : site.fetch(input, init);
  };
  const jobs: Harness["jobs"] = [];
  const gateway = createFrappeGateway({
    prisma: handle.prisma,
    secrets,
    fetch: fetchImpl,
    ledger,
    timeoutMs: options.timeoutMs ?? 2_000,
    cacheTtlMs: 0,
    jobs: {
      enqueue: async (job) => {
        jobs.push({ name: job.name, payload: job.payload, availableAt: job.availableAt });
      },
    },
  });
  const deps: BusinessDeps = { prisma: handle.prisma, enabled: true, frappe: gateway };
  return { site, siteB, gateway, deps, handle, ledger, secrets, jobs };
}

const owner = { userId: "owner" };

async function ok<T>(
  h: Harness,
  spaceId: string,
  actionId: Parameters<typeof executeBusinessAction>[1],
  input: unknown,
) {
  const result = await executeBusinessAction(h.deps, actionId, input, { spaceId, actor: owner });
  if (!result.ok) throw new Error(`${actionId}: ${result.error.code} ${result.error.message}`);
  return result.data as T;
}

describe("FrappeClient", () => {
  it("authenticates with the gateway token and maps bridge errors to business codes", async () => {
    const site = new FakeFrappeSite({ apiKey: KEY, apiSecret: SECRET });
    const wrong = new FrappeClient({
      baseUrl: "http://x",
      apiKey: KEY,
      apiSecret: "nope",
      fetch: site.fetch,
    });
    await expect(wrong.call("savingroup_business_bridge.api.ping")).rejects.toMatchObject({
      status: 401,
      excType: "AuthenticationError",
      outcomeUnknown: false,
    });
    const client = new FrappeClient({
      baseUrl: "http://x",
      apiKey: KEY,
      apiSecret: SECRET,
      fetch: site.fetch,
    });
    await expect(
      client.call("savingroup_business_bridge.api.execute", {
        operation_id: "op-1",
        action: "crm.company.update",
        payload: { id: "Missing" },
      }),
    ).rejects.toMatchObject({ businessCode: "not_found", status: 417 });
  });

  it("treats a timeout as an unknown outcome, never as a failure", async () => {
    const client = new FrappeClient({
      baseUrl: "http://x",
      apiKey: KEY,
      apiSecret: SECRET,
      timeoutMs: 20,
      fetch: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    });
    const error = (await client
      .call("savingroup_business_bridge.api.ping")
      .catch((e: unknown) => e)) as FrappeRequestError;
    expect(error).toBeInstanceOf(FrappeRequestError);
    expect(error.kind).toBe("timeout");
    expect(error.outcomeUnknown).toBe(true);
  });
});

describe("gateway routing", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it("runs actions on the organization's site and returns contract-shaped records", async () => {
    const company = await ok<unknown>(h, "space-a", "crm.company.create", {
      name: "Acme Robotics",
      domain: "acme.example",
    });
    expect(CrmCompanySchema.parse(company)).toMatchObject({
      id: "Acme Robotics",
      name: "Acme Robotics",
    });
    expect(h.site.find("CRM Organization", "Acme Robotics")).toBeDefined();
    // Savingroup still owns the audit trail and the live event.
    expect(h.handle.actionLogs).toHaveLength(1);
    expect(h.handle.events.map((event) => event.type)).toEqual(["crm.company.created"]);
    const ops = await h.ledger.list({ limit: 10 });
    expect(ops[0]).toMatchObject({ status: "succeeded", externalDoctype: "CRM Organization" });
  });

  it("falls back to the prototype tables for an organization without an environment", async () => {
    const result = await executeBusinessAction(
      h.deps,
      "crm.company.search",
      {},
      {
        spaceId: "space-proto",
        actor: owner,
      },
    );
    expect(result).toMatchObject({ ok: true, data: { companies: [] } });
    expect(h.site.requests).toHaveLength(0);
  });

  it("keeps two organizations' sites apart, including by id", async () => {
    await ok(h, "space-a", "crm.company.create", { name: "Acme Robotics" });
    await ok(h, "space-b", "crm.company.create", { name: "Northwind" });
    const fromB = await ok<{ companies: unknown[] }>(h, "space-b", "crm.company.search", {});
    expect(fromB.companies.map((c) => (c as { id: string }).id)).toEqual(["Northwind"]);
    const leak = await ok<{ companies: unknown[] }>(h, "space-b", "crm.company.search", {
      id: "Acme Robotics",
    });
    expect(leak.companies).toEqual([]);
    expect(h.siteB.find("CRM Organization", "Acme Robotics")).toBeUndefined();
    // Every space of the organization shares the environment.
    const sibling = await ok<{ companies: unknown[] }>(h, "space-a2", "crm.company.search", {});
    expect(sibling.companies).toHaveLength(1);
  });

  it("replays an idempotent write instead of acting twice", async () => {
    const input = { name: "Acme Robotics", idempotencyKey: "run-1:create" };
    const first = await executeBusinessAction(h.deps, "crm.company.create", input, {
      spaceId: "space-a",
      actor: owner,
    });
    const second = await executeBusinessAction(h.deps, "crm.company.create", input, {
      spaceId: "space-a",
      actor: owner,
    });
    expect(first).toMatchObject({ ok: true, replayed: false });
    expect(second).toMatchObject({ ok: true, replayed: true });
    expect(h.site.list("CRM Organization")).toHaveLength(1);
    expect(h.site.requests.filter((r) => r.path.endsWith(".execute"))).toHaveLength(1);
  });

  it("reconciles a committed write whose response was lost, without a duplicate", async () => {
    h.site.dropAfterCommit = 1;
    const result = await executeBusinessAction(
      h.deps,
      "crm.company.create",
      { name: "Acme Robotics", idempotencyKey: "run-2:create" },
      { spaceId: "space-a", actor: owner },
    );
    // The site committed, the connection dropped, the gateway asked and got the answer.
    expect(result).toMatchObject({ ok: true, replayed: true });
    expect(h.site.list("CRM Organization")).toHaveLength(1);
    const op = await h.ledger.find("env-a", "run-2:create");
    expect(op?.status).toBe("succeeded");
  });

  it("holds an unconfirmed write until the site answers, then settles it on retry", async () => {
    const slow = harness({ timeoutMs: 30 });
    slow.site.responseDelayMs = 200;
    const first = await executeBusinessAction(
      slow.deps,
      "crm.company.create",
      { name: "Acme Robotics", idempotencyKey: "run-3:create" },
      { spaceId: "space-a", actor: owner },
    );
    expect(first).toMatchObject({ ok: false, error: { code: "unavailable" } });
    expect((await slow.ledger.find("env-a", "run-3:create"))?.status).toBe("outcome_unknown");
    // The write did commit on the site side even though the answer never arrived.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(slow.site.list("CRM Organization")).toHaveLength(1);

    slow.site.responseDelayMs = 0;
    const second = await executeBusinessAction(
      slow.deps,
      "crm.company.create",
      { name: "Acme Robotics", idempotencyKey: "run-3:create" },
      { spaceId: "space-a", actor: owner },
    );
    expect(second).toMatchObject({ ok: true, replayed: true });
    expect(slow.site.list("CRM Organization")).toHaveLength(1);
    expect((await slow.ledger.find("env-a", "run-3:create"))?.status).toBe("succeeded");
  });

  it("records a committed write whose bookkeeping failed once the reconciler settles it", async () => {
    // The site commits, then Savingroup's own ledger write fails (a saturated database).
    const update = h.ledger.update.bind(h.ledger);
    let failures = 1;
    h.ledger.update = async (id, input) => {
      if (input.status === "succeeded" && failures-- > 0) throw new Error("too many clients");
      return update(id, input);
    };
    const result = await executeBusinessAction(
      h.deps,
      "crm.company.create",
      { name: "Acme Robotics", idempotencyKey: "run-4:create" },
      { spaceId: "space-a", actor: owner },
    );
    // No false failure and no silent "executing" row: an unknown outcome with a reconcile job.
    expect(result).toMatchObject({ ok: false, error: { code: "unavailable" } });
    expect(h.site.list("CRM Organization")).toHaveLength(1);
    const op = await h.ledger.find("env-a", "run-4:create");
    expect(op?.status).toBe("outcome_unknown");
    expect(h.jobs.map((job) => job.name)).toEqual(["business.operation.reconcile"]);
    expect(h.handle.actionLogs).toHaveLength(0);

    const outcome = await reconcileBusinessOperationJob(
      { gateway: h.gateway, prisma: h.handle.prisma },
      op!.id,
    );
    expect(outcome).toBe("settled");
    expect((await h.ledger.get(op!.id))?.status).toBe("succeeded");
    // The audit row and the event the caller never got to write exist exactly once.
    expect(h.handle.actionLogs).toMatchObject([
      { actionId: "crm.company.create", idempotencyKey: "run-4:create", outcome: "succeeded" },
    ]);
    expect(h.handle.events.map((event) => event.type)).toEqual(["crm.company.created"]);
    expect(h.site.list("CRM Organization")).toHaveLength(1);
    // The same key now replays from the ledger and the audit log without touching the site.
    const replay = await executeBusinessAction(
      h.deps,
      "crm.company.create",
      { name: "Acme Robotics", idempotencyKey: "run-4:create" },
      { spaceId: "space-a", actor: owner },
    );
    expect(replay).toMatchObject({ ok: true, replayed: true });
    expect(h.handle.actionLogs).toHaveLength(1);
  });

  it("sweeps stale executing rows into the reconciler, leaving fresh ones alone", async () => {
    const stale = await h.ledger.create({
      environmentId: "env-a",
      spaceId: "space-a",
      actionId: "crm.company.create",
      actionVersion: 1,
      idempotencyKey: "orphan",
      actorUserId: "owner",
      actorBotId: null,
      runId: null,
      request: { name: "Orphan" },
    });
    await h.ledger.update(stale.id, { status: "executing" });
    const fresh = await h.ledger.create({
      environmentId: "env-a",
      spaceId: "space-a",
      actionId: "crm.company.create",
      actionVersion: 1,
      idempotencyKey: "in-flight",
      actorUserId: "owner",
      actorBotId: null,
      runId: null,
      request: { name: "In flight" },
    });
    await h.ledger.update(fresh.id, { status: "executing" });
    const later = new Date(Date.now() + 3 * 60 * 1000);
    (await h.ledger.get(fresh.id))!.updatedAt = later;
    expect(await sweepUnsettledOperations(h.gateway, "env-a", later)).toBe(1);
    expect(h.jobs).toMatchObject([
      { name: "business.operation.reconcile", payload: { operationId: stale.id } },
    ]);
  });

  it("lets the reconcile job release an operation the site never saw", async () => {
    const op = await h.ledger.create({
      environmentId: "env-a",
      spaceId: "space-a",
      actionId: "crm.company.create",
      actionVersion: 1,
      idempotencyKey: "lost-forever",
      actorUserId: "owner",
      actorBotId: null,
      runId: null,
      request: { name: "Ghost" },
    });
    await h.ledger.update(op.id, { status: "outcome_unknown" });
    const outcome = await reconcileBusinessOperationJob(
      { gateway: h.gateway, prisma: h.handle.prisma },
      op.id,
    );
    expect(outcome).toBe("released");
    expect((await h.ledger.get(op.id))?.status).toBe("requested");
  });

  it("replays a rejected write's failure for the same key", async () => {
    await ok(h, "space-a", "crm.company.create", { name: "Acme Robotics" });
    await ok(h, "space-a", "erp.product.create", {
      sku: "SENSOR-X1",
      name: "Sensor",
      unitPrice: 10,
      initialStock: 1,
    });
    const order = await ok<{ id: string }>(h, "space-a", "erp.order.create_draft", {
      companyId: "Acme Robotics",
      lines: [{ sku: "SENSOR-X1", quantity: 5 }],
    });
    await ok(h, "space-a", "erp.order.request_approval", { id: order.id });
    await ok(h, "space-a", "erp.order.approve", { id: order.id });
    const input = { id: order.id, idempotencyKey: "confirm-1" };
    const first = await executeBusinessAction(h.deps, "erp.order.confirm", input, {
      spaceId: "space-a",
      actor: owner,
    });
    expect(first).toMatchObject({ ok: false, error: { code: "insufficient_stock" } });
    const executes = h.site.requests.filter((r) => r.path.endsWith(".execute")).length;
    const second = await executeBusinessAction(h.deps, "erp.order.confirm", input, {
      spaceId: "space-a",
      actor: owner,
    });
    expect(second).toMatchObject({ ok: false, error: { code: "insufficient_stock" } });
    expect(h.site.requests.filter((r) => r.path.endsWith(".execute"))).toHaveLength(executes);
    expect(h.site.find("Sales Order", order.id)?.docstatus).toBe(0);
  });

  it("administers the site for the Operator: describe, insert, update, list, call, delete", async () => {
    const described = await ok<{ doctype: string; permissions: { create: boolean } }>(
      h,
      "space-a",
      "admin.doctype.describe",
      { doctype: "Notification" },
    );
    expect(described).toMatchObject({ doctype: "Notification", permissions: { create: true } });

    const inserted = await ok<{ doctype: string; name: string; document: Record<string, unknown> }>(
      h,
      "space-a",
      "admin.document.insert",
      {
        doctype: "Notification",
        values: {
          name: "Low stock alert",
          document_type: "Item",
          event: "Value Change",
          enabled: 1,
        },
      },
    );
    expect(inserted).toMatchObject({ doctype: "Notification", name: "Low stock alert" });
    expect(h.site.find("Notification", "Low stock alert")).toMatchObject({
      enabled: 1,
      savingroup_created_by_user: "owner",
    });

    const updated = await ok<{ document: Record<string, unknown> }>(
      h,
      "space-a",
      "admin.document.update",
      { doctype: "Notification", name: "Low stock alert", values: { enabled: 0 } },
    );
    expect(updated.document.enabled).toBe(0);

    const listed = await ok<{ documents: Array<{ name: string }> }>(
      h,
      "space-a",
      "admin.document.list",
      { doctype: "Notification", filters: { enabled: 0 } },
    );
    expect(listed.documents.map((doc) => doc.name)).toEqual(["Low stock alert"]);

    const doctypes = await ok<{ doctypes: Array<{ name: string }> }>(
      h,
      "space-a",
      "admin.doctype.list",
      { q: "notif" },
    );
    expect(doctypes.doctypes.map((doc) => doc.name)).toEqual(["Notification"]);

    const count = await ok<{ result: unknown }>(h, "space-a", "admin.method.call", {
      method: "frappe.client.get_count",
      args: { doctype: "Notification" },
    });
    expect(count.result).toBe(1);

    const deleted = await ok<{ deleted: true }>(h, "space-a", "admin.document.delete", {
      doctype: "Notification",
      name: "Low stock alert",
    });
    expect(deleted.deleted).toBe(true);
    expect(h.site.find("Notification", "Low stock alert")).toBeUndefined();

    // Savingroup keeps the audit trail, the live event and the ledger for every administrative write.
    const writes = new Set([
      "admin.document.insert",
      "admin.document.update",
      "admin.method.call",
      "admin.document.delete",
    ]);
    expect(h.handle.actionLogs.filter((log) => writes.has(String(log.actionId)))).toHaveLength(4);
    expect(h.handle.events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["admin.document.changed"]),
    );
    const ops = await h.ledger.list({ limit: 10 });
    expect(ops.filter((op) => String(op.actionId).startsWith("admin."))).toHaveLength(4);
  });

  it("keeps identity, credential and script doctypes out of the Operator's reach", async () => {
    const insert = await executeBusinessAction(
      h.deps,
      "admin.document.insert",
      { doctype: "User", values: { email: "x@example.com" } },
      { spaceId: "space-a", actor: owner },
    );
    expect(insert).toMatchObject({ ok: false, error: { code: "permission_denied" } });
    const method = await executeBusinessAction(
      h.deps,
      "admin.method.call",
      { method: "frappe.core.doctype.user.user.reset_password", args: {} },
      { spaceId: "space-a", actor: owner },
    );
    expect(method).toMatchObject({ ok: false, error: { code: "permission_denied" } });
    expect(h.site.find("User", "x@example.com")).toBeUndefined();
  });

  it("enforces a bot's allowed actions before any site call", async () => {
    const result = await executeBusinessAction(
      h.deps,
      "erp.order.confirm",
      { ref: "SAL-ORD-2026-00001" },
      {
        spaceId: "space-a",
        actor: { userId: "owner", botId: "bot-sales" },
        runId: "run-9",
      },
    );
    expect(result).toMatchObject({ ok: false, error: { code: "permission_denied" } });
    expect(h.site.requests).toHaveLength(0);
  });

  it("walks lead → deal → order → delivery → invoice → payment on the site", async () => {
    await ok(h, "space-a", "crm.company.create", { name: "Acme Robotics" });
    const contact = await ok<{ id: string }>(h, "space-a", "crm.contact.create", {
      firstName: "Dana",
      lastName: "Reyes",
      email: "dana@acme.example",
      companyId: "Acme Robotics",
    });
    const lead = CrmLeadSchema.parse(
      await ok(h, "space-a", "crm.lead.create", {
        title: "Line upgrade",
        value: 5000,
        companyId: "Acme Robotics",
        contactId: contact.id,
      }),
    );
    expect(lead.status).toBe("new");
    // The same contact again is a duplicate, not a second lead.
    const again = CrmLeadSchema.parse(
      await ok(h, "space-a", "crm.lead.create", {
        title: "Line upgrade (dup)",
        companyId: "Acme Robotics",
        contactId: contact.id,
      }),
    );
    expect(again.id).toBe(lead.id);
    expect(h.site.list("CRM Lead")).toHaveLength(1);

    const notQualified = await executeBusinessAction(
      h.deps,
      "crm.lead.convert",
      { id: lead.id },
      { spaceId: "space-a", actor: owner },
    );
    expect(notQualified).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    await ok(h, "space-a", "crm.lead.qualify", { id: lead.id, status: "qualified" });
    const converted = await ok<{ lead: unknown; deal: unknown }>(h, "space-a", "crm.lead.convert", {
      id: lead.id,
    });
    const deal = CrmDealSchema.parse(converted.deal);
    expect(CrmLeadSchema.parse(converted.lead)).toMatchObject({
      status: "converted",
      convertedDealId: deal.id,
    });
    expect(deal).toMatchObject({
      stage: "qualification",
      amount: 5000,
      companyId: "Acme Robotics",
    });

    const product = ErpProductSchema.parse(
      await ok(h, "space-a", "erp.product.create", {
        sku: "sensor-x1",
        name: "Sensor",
        unitPrice: 149,
        initialStock: 40,
      }),
    );
    expect(product).toMatchObject({ sku: "SENSOR-X1", stockOnHand: 40, unitPrice: 149 });

    const order = ErpSalesOrderSchema.parse(
      await ok(h, "space-a", "erp.order.create_draft", {
        dealRef: deal.id,
        lines: [{ sku: "SENSOR-X1", quantity: 20 }],
      }),
    );
    expect(order).toMatchObject({
      status: "draft",
      companyId: "Acme Robotics",
      dealId: deal.id,
      subtotal: 2980,
    });

    const early = await executeBusinessAction(
      h.deps,
      "erp.order.confirm",
      { id: order.id },
      { spaceId: "space-a", actor: owner },
    );
    expect(early).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    await ok(h, "space-a", "erp.order.request_approval", { id: order.id });
    await ok(h, "space-a", "erp.order.approve", { id: order.id });
    const confirmed = ErpSalesOrderSchema.parse(
      await ok(h, "space-a", "erp.order.confirm", { id: order.id }),
    );
    expect(confirmed.status).toBe("confirmed");
    const level = await ok<{ onHand: number }>(h, "space-a", "erp.inventory.check", {
      sku: "SENSOR-X1",
    });
    expect(level.onHand).toBe(20);
    const wonDeal = await ok<{ deals: Array<{ stage: string }> }>(h, "space-a", "crm.deal.search", {
      id: deal.id,
    });
    expect(wonDeal.deals[0]?.stage).toBe("won");

    const invoice = ErpInvoiceSchema.parse(
      await ok(h, "space-a", "erp.invoice.create_draft", { orderId: order.id }),
    );
    expect(invoice).toMatchObject({ status: "draft", orderId: order.id, total: 2980 });
    const twice = await executeBusinessAction(
      h.deps,
      "erp.invoice.create_draft",
      { orderId: order.id },
      { spaceId: "space-a", actor: owner },
    );
    expect(twice).toMatchObject({ ok: false, error: { code: "conflict" } });
    const issued = ErpInvoiceSchema.parse(
      await ok(h, "space-a", "erp.invoice.issue", { id: invoice.id }),
    );
    expect(issued.status).toBe("issued");
    const paid = ErpInvoiceSchema.parse(
      await ok(h, "space-a", "erp.invoice.record_payment", { id: invoice.id, amount: 2980 }),
    );
    expect(paid).toMatchObject({ status: "paid", paymentStatus: "paid", amountPaid: 2980 });
    expect(h.handle.events.map((event) => event.type)).toContain("erp.invoice.payment_recorded");
  });
});

describe("environment verification", () => {
  it("accepts a site with the blueprint's apps and company, rejects others", async () => {
    const site = new FakeFrappeSite({
      apiKey: KEY,
      apiSecret: SECRET,
      company: "Acme Robotics Ltd",
    });
    const client = new FrappeClient({
      baseUrl: "http://x",
      apiKey: KEY,
      apiSecret: SECRET,
      fetch: site.fetch,
    });
    await expect(
      verifyFrappeEnvironment(client, {
        blueprintId: "india-smb",
        companyName: "Acme Robotics Ltd",
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      verifyFrappeEnvironment(client, { blueprintId: "india-smb", companyName: "Someone Else" }),
    ).resolves.toMatchObject({ ok: false, error: expect.stringContaining("does not exist") });
    const bare = new FakeFrappeSite({
      apiKey: KEY,
      apiSecret: SECRET,
      apps: { frappe: "16", erpnext: "16" },
    });
    const bareClient = new FrappeClient({
      baseUrl: "http://x",
      apiKey: KEY,
      apiSecret: SECRET,
      fetch: bare.fetch,
    });
    await expect(
      verifyFrappeEnvironment(bareClient, {
        blueprintId: "generic",
        companyName: "Savingroup Demo Pvt Ltd",
      }),
    ).resolves.toMatchObject({ ok: false, error: expect.stringContaining("Apps missing") });
  });

  it("connects, stores sealed credentials and activates only after verification", async () => {
    const h = harness();
    const result = await h.gateway.environments.connect(
      { userId: "owner", spaceId: "space-proto", organizationId: "org-p" },
      {
        siteUrl: "http://site-a.test",
        apiKey: KEY,
        apiSecret: SECRET,
        webhookSecret: "hook-secret-new",
        blueprintId: "india-smb",
        companyName: "Acme Robotics Ltd",
        companyAbbr: "AR",
        country: "India",
        currency: "INR",
      },
    );
    expect(result.status).toBe("active");
    expect(result.credentialCiphertext).not.toContain(SECRET);
    expect(h.secrets.puts).toBe(2);
    const wrong = await h.gateway.environments
      .connect(
        { userId: "owner", spaceId: "space-proto", organizationId: "org-p" },
        {
          siteUrl: "http://site-a.test",
          apiKey: KEY,
          apiSecret: "wrong-secret",
          webhookSecret: "hook-secret-new",
          blueprintId: "india-smb",
          companyName: "Acme Robotics Ltd",
          companyAbbr: "AR",
          country: "India",
          currency: "INR",
        },
      )
      .catch((error) => error);
    // The first connection is active, so a second one is refused until it is disabled.
    expect(wrong).toMatchObject({ code: "conflict" });
    await h.gateway.environments.disable(result.id);
    const retried = await h.gateway.environments.connect(
      { userId: "owner", spaceId: "space-proto", organizationId: "org-p" },
      {
        siteUrl: "http://site-a.test",
        apiKey: KEY,
        apiSecret: "wrong-secret",
        webhookSecret: "hook-secret-new",
        blueprintId: "india-smb",
        companyName: "Acme Robotics Ltd",
        companyAbbr: "AR",
        country: "India",
        currency: "INR",
      },
    );
    expect(retried.status).toBe("failed");
    expect(retried.lastError).toContain("rejected the gateway credentials");
  });

  it("follows a company renamed on the site instead of failing", async () => {
    const h = harness();
    // ERPNext keeps the abbreviation through a rename, which is how it is recognised.
    h.site.renameDoc("Company", "Acme Robotics Ltd", "Acme Robotics Group");
    await expect(h.gateway.environments.verify("env-a")).resolves.toMatchObject({
      status: "active",
      companyName: "Acme Robotics Group",
      lastError: null,
    });
  });

  it("takes the new company name as soon as an admin tool renames it", async () => {
    const h = harness();
    await ok(h, "space-a", "admin.method.call", {
      method: "frappe.model.rename_doc.update_document_title",
      args: { doctype: "Company", docname: "Acme Robotics Ltd", name: "Acme Robotics Group" },
    });
    const row = await h.gateway.environments.getById("env-a");
    expect(row).toMatchObject({ status: "active", companyName: "Acme Robotics Group" });
  });

  it("refuses work on a failed connection until it is fixed or disabled", async () => {
    const h = harness();
    await h.handle.prisma.businessEnvironment.update({
      where: { id: "env-a" },
      data: { status: "failed", lastError: "HTTP 404" },
    });
    const refused = await executeBusinessAction(
      h.deps,
      "crm.company.search",
      {},
      { spaceId: "space-a", actor: owner },
    );
    // Not the built-in tables, whose records would differ from the site's.
    expect(refused).toMatchObject({
      ok: false,
      error: { code: "unavailable", message: expect.stringContaining("HTTP 404") },
    });
    await h.gateway.environments.disable("env-a");
    await expect(ok(h, "space-a", "crm.company.search", {})).resolves.toMatchObject({
      companies: [],
    });
    expect(h.site.requests).toHaveLength(0);
  });
});

describe("signed events", () => {
  const secret = "hook-secret-a";
  const now = new Date("2026-10-18T12:00:00Z");

  it("verifies signatures and rejects stale or forged deliveries", () => {
    const { headers, rawBody } = buildSignedBusinessDelivery(
      secret,
      { type: "crm.lead.created", doctype: "CRM Lead", name: "CRM-LEAD-2026-00001" },
      now,
    );
    expect(
      verifyBusinessWebhookSignature({
        secret,
        timestamp: headers["x-savingroup-timestamp"],
        signature: headers["x-savingroup-signature"],
        rawBody,
        now,
      }),
    ).toEqual({ ok: true });
    expect(
      verifyBusinessWebhookSignature({
        secret: "other",
        timestamp: headers["x-savingroup-timestamp"],
        signature: headers["x-savingroup-signature"],
        rawBody,
        now,
      }),
    ).toEqual({ ok: false, reason: "mismatch" });
    expect(
      verifyBusinessWebhookSignature({
        secret,
        timestamp: headers["x-savingroup-timestamp"],
        signature: headers["x-savingroup-signature"],
        rawBody,
        now: new Date(now.getTime() + 10 * 60 * 1000),
      }),
    ).toEqual({ ok: false, reason: "stale" });
  });

  it("stores a delivery once, fans out to the organization's spaces and settles the operation", async () => {
    const h = harness();
    const op = await h.ledger.create({
      environmentId: "env-a",
      spaceId: "space-a",
      actionId: "crm.lead.create",
      actionVersion: 1,
      idempotencyKey: "lead-1",
      actorUserId: "owner",
      actorBotId: null,
      runId: null,
      request: {},
    });
    await h.ledger.update(op.id, { status: "outcome_unknown" });
    const { rawBody } = buildSignedBusinessDelivery(secret, {
      delivery_id: "d-1",
      type: "crm.lead.created",
      doctype: "CRM Lead",
      name: "CRM-LEAD-2026-00001",
      operation_id: op.id,
    });
    const body = parseBusinessWebhookBody(rawBody)!;
    const deps = { prisma: h.handle.prisma, ledger: h.ledger };
    const env = { id: "env-a", organizationId: "org-a" };
    expect(await ingestBusinessWebhook(deps, env, body)).toEqual({
      status: "stored",
      spaces: 2,
      settledOperation: true,
    });
    expect(await ingestBusinessWebhook(deps, env, body)).toEqual({ status: "duplicate" });
    expect((await h.ledger.get(op.id))?.status).toBe("succeeded");
    expect(h.handle.events.filter((event) => event.type === "crm.lead.created")).toHaveLength(2);
    expect(
      await ingestBusinessWebhook(deps, env, { ...body, delivery_id: "d-2", type: "not.an.event" }),
    ).toEqual({ status: "ignored", reason: "unknown_type" });
  });
});

afterEach(() => undefined);
