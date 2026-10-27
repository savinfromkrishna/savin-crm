import {
  CrmCompanySchema,
  CrmLeadSchema,
  ErpInvoiceSchema,
  ErpProductSchema,
  ErpSalesOrderSchema,
} from "@savingroup/contracts";
import { describe, expect, it } from "vitest";
import type { BusinessDeps } from "../context.js";
import { executeBusinessAction } from "../execute.js";
import { FrappeClient } from "./client.js";
import { verifyFrappeEnvironment } from "./environment.js";
import { createFrappeGateway } from "./gateway.js";
import { MemoryOperationLedger } from "./ledger.js";
import { environmentRow, fakePrisma, fakeSecrets, fakeWorld } from "./testing/fakes.js";
import { BRIDGE_METHODS } from "./types.js";

/**
 * Conformance of the real bridge against the same expectations the fake site
 * passes. Runs only against a provisioned site:
 *
 *   VERIFY_FRAPPE=1 FRAPPE_SITE_URL=http://localhost:8090 FRAPPE_API_KEY=… \
 *   FRAPPE_API_SECRET=… FRAPPE_COMPANY="…" FRAPPE_COMPANY_ABBR=… pnpm exec vitest run packages/business/src/frappe/live.frappe.test.ts
 *
 * Records it creates carry a unique suffix and stay on the site; the operation
 * ledger here is in memory, so a rerun creates a fresh set.
 */
const env = process.env;
const describeLive =
  env.VERIFY_FRAPPE === "1" && env.FRAPPE_SITE_URL && env.FRAPPE_API_KEY && env.FRAPPE_API_SECRET
    ? describe.sequential
    : describe.skip;

describeLive("live Frappe site", () => {
  const suffix = `${Date.now().toString(36)}`;
  // The describe body runs even when skipped; keep the fixtures valid without a site.
  const siteUrl = env.FRAPPE_SITE_URL ?? "http://frappe.invalid";
  const company = env.FRAPPE_COMPANY ?? "Savingroup Demo Pvt Ltd";
  const credentials = { apiKey: env.FRAPPE_API_KEY ?? "", apiSecret: env.FRAPPE_API_SECRET ?? "" };
  const sealed = `sealed:${Buffer.from(JSON.stringify(credentials), "utf8").toString("base64")}`;
  const world = fakeWorld({
    spaces: { "space-live": "org-live" },
    environments: {
      "org-live": environmentRow({
        id: "env-live",
        organizationId: "org-live",
        siteUrl,
        companyName: company,
        companyAbbr: env.FRAPPE_COMPANY_ABBR ?? "RD",
        blueprintId: (env.FRAPPE_BLUEPRINT as "india-smb" | "generic") ?? "india-smb",
        currency: env.FRAPPE_CURRENCY ?? "INR",
        credentialSecretId: "cred",
        credentialCiphertext: sealed,
      }),
    },
  });
  const handle = fakePrisma(world);
  const gateway = createFrappeGateway({
    prisma: handle.prisma,
    secrets: fakeSecrets(),
    ledger: new MemoryOperationLedger(),
    timeoutMs: 60_000,
    cacheTtlMs: 0,
  });
  const deps: BusinessDeps = { prisma: handle.prisma, enabled: true, frappe: gateway };
  const owner = { userId: "live-owner" };
  const run = async <T>(actionId: Parameters<typeof executeBusinessAction>[1], input: unknown) => {
    const result = await executeBusinessAction(deps, actionId, input, {
      spaceId: "space-live",
      actor: owner,
    });
    if (!result.ok) throw new Error(`${actionId}: ${result.error.code} ${result.error.message}`);
    return result.data as T;
  };

  it("verifies the site through the bridge", async () => {
    const client = new FrappeClient({
      baseUrl: siteUrl,
      ...credentials,
      timeoutMs: 60_000,
    });
    const ping = await client.call<{ apps: Record<string, string>; companies: string[] }>(
      BRIDGE_METHODS.ping,
    );
    expect(Object.keys(ping.apps)).toEqual(
      expect.arrayContaining(["erpnext", "crm", "savingroup_business_bridge"]),
    );
    expect(ping.companies).toContain(company);
    await expect(
      verifyFrappeEnvironment(client, {
        blueprintId: (env.FRAPPE_BLUEPRINT as "india-smb" | "generic") ?? "india-smb",
        companyName: company,
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("runs the lead → deal → order → delivery → invoice → payment chain on the real site", async () => {
    const organization = CrmCompanySchema.parse(
      await run("crm.company.create", {
        name: `Live Co ${suffix}`,
        domain: `live-${suffix}.example`,
      }),
    );
    const contact = await run<{ id: string }>("crm.contact.create", {
      firstName: "Live",
      lastName: suffix,
      email: `live-${suffix}@example.test`,
      companyId: organization.id,
    });
    const lead = CrmLeadSchema.parse(
      await run("crm.lead.create", {
        title: `Live lead ${suffix}`,
        value: 1200,
        companyId: organization.id,
        contactId: contact.id,
      }),
    );
    expect(lead.status).toBe("new");
    const duplicate = CrmLeadSchema.parse(
      await run("crm.lead.create", {
        title: `Live lead again ${suffix}`,
        companyId: organization.id,
        contactId: contact.id,
      }),
    );
    expect(duplicate.id).toBe(lead.id);
    await run("crm.lead.qualify", { id: lead.id, status: "qualified" });
    const converted = await run<{
      lead: unknown;
      deal: { id: string; stage: string; amount: number };
    }>("crm.lead.convert", { id: lead.id });
    expect(converted.deal).toMatchObject({ stage: "qualification", amount: 1200 });

    // GST sites require an HSN/SAC code; take one the site ships with.
    const client = gateway.clientFor({ siteUrl, ...credentials });
    const hsn = await client
      .getList<{ name: string }>("GST HSN Code", { fields: ["name"], limit: 200 })
      .then((rows) => rows.map((row) => row.name).find((name) => /^\d{6,8}$/.test(name)))
      .catch(() => undefined);
    expect(hsn, "a GST site ships HSN codes the gateway user can read").toBeDefined();
    const product = ErpProductSchema.parse(
      await run("erp.product.create", {
        sku: `LIVE-${suffix}`.toUpperCase(),
        name: `Live item ${suffix}`,
        unitPrice: 100,
        initialStock: 5,
        ...(hsn ? { hsnCode: hsn } : {}),
      }),
    );
    expect(product.stockOnHand).toBe(5);
    const level = await run<{ onHand: number; available: number }>("erp.inventory.check", {
      sku: product.sku,
    });
    expect(level.onHand).toBe(5);

    const order = ErpSalesOrderSchema.parse(
      await run("erp.order.create_draft", {
        dealRef: converted.deal.id,
        lines: [{ sku: product.sku, quantity: 2 }],
      }),
    );
    expect(order).toMatchObject({ status: "draft", subtotal: 200, dealId: converted.deal.id });
    await run("erp.order.request_approval", { id: order.id });
    await run("erp.order.approve", { id: order.id });
    const confirmed = ErpSalesOrderSchema.parse(await run("erp.order.confirm", { id: order.id }));
    expect(confirmed.status).toBe("confirmed");
    const after = await run<{ onHand: number }>("erp.inventory.check", { sku: product.sku });
    expect(after.onHand).toBe(3);
    const deals = await run<{ deals: Array<{ stage: string }> }>("crm.deal.search", {
      id: converted.deal.id,
    });
    expect(deals.deals[0]?.stage).toBe("won");

    const tooMany = await executeBusinessAction(
      deps,
      "erp.order.create_draft",
      { companyId: organization.id, lines: [{ sku: product.sku, quantity: 50 }] },
      { spaceId: "space-live", actor: owner },
    );
    expect(tooMany.ok).toBe(true);
    const big = tooMany.ok ? (tooMany.data as { id: string }) : { id: "" };
    await run("erp.order.request_approval", { id: big.id });
    await run("erp.order.approve", { id: big.id });
    const short = await executeBusinessAction(
      deps,
      "erp.order.confirm",
      { id: big.id },
      { spaceId: "space-live", actor: owner },
    );
    expect(short).toMatchObject({ ok: false, error: { code: "insufficient_stock" } });

    const invoice = ErpInvoiceSchema.parse(
      await run("erp.invoice.create_draft", { orderId: order.id }),
    );
    expect(invoice).toMatchObject({ status: "draft", orderId: order.id });
    const issued = ErpInvoiceSchema.parse(await run("erp.invoice.issue", { id: invoice.id }));
    expect(issued.status).toBe("issued");
    const paid = ErpInvoiceSchema.parse(
      await run("erp.invoice.record_payment", { id: invoice.id, amount: issued.total }),
    );
    expect(paid).toMatchObject({ status: "paid", paymentStatus: "paid" });
  });
});
