import { Prisma } from "@savingroup/db";
import { describe, expect, it } from "vitest";
import { createFrappeGateway } from "../frappe/gateway.js";
import { MemoryOperationLedger } from "../frappe/ledger.js";
import { FakeFrappeSite } from "../frappe/testing/fake-frappe.js";
import { environmentRow, fakePrisma, fakeSecrets, fakeWorld } from "../frappe/testing/fakes.js";
import { formatMigrationReport, migrateLegacyBusinessData } from "./legacy.js";

const KEY = "gateway-key-aaaa";
const SECRET = "gateway-secret-bbbb";
const money = (value: number) => new Prisma.Decimal(value);

function world() {
  const now = new Date("2026-10-01T00:00:00Z");
  return fakeWorld({
    spaces: { "space-a": "org-a" },
    environments: {
      "org-a": environmentRow({
        id: "env-a",
        organizationId: "org-a",
        siteUrl: "http://site-a.test",
        companyName: "Acme Robotics Ltd",
        credentialSecretId: "cred",
        credentialCiphertext: `sealed:${Buffer.from(JSON.stringify({ apiKey: KEY, apiSecret: SECRET })).toString("base64")}`,
      }),
    },
    legacy: {
      crmCompany: [
        {
          id: "c1",
          spaceId: "space-a",
          name: "Acme Robotics",
          domain: "acme.example",
          phone: null,
          notes: null,
          createdAt: now,
        },
        {
          id: "c2",
          spaceId: "space-a",
          name: "Northwind Traders",
          domain: null,
          phone: null,
          notes: "Trade show",
          createdAt: now,
        },
      ],
      crmContact: [
        {
          id: "p1",
          spaceId: "space-a",
          firstName: "Dana",
          lastName: "Reyes",
          email: "dana@acme.example",
          phone: null,
          title: "Procurement",
          notes: null,
          companyId: "c1",
          createdAt: now,
        },
      ],
      crmLead: [
        {
          id: "l1",
          spaceId: "space-a",
          number: 1,
          title: "Line upgrade",
          status: "qualified",
          source: "inbound",
          notes: null,
          value: money(8500),
          companyId: "c1",
          contactId: "p1",
          assigneeUserId: null,
          assigneeBotId: null,
        },
        {
          id: "l2",
          spaceId: "space-a",
          number: 2,
          title: "Warehouse sensors",
          status: "new",
          source: null,
          notes: null,
          value: null,
          companyId: "c2",
          contactId: null,
          assigneeUserId: "owner",
          assigneeBotId: null,
        },
      ],
      crmDeal: [
        {
          id: "d1",
          spaceId: "space-a",
          number: 1,
          title: "Acme line 3",
          stage: "proposal",
          amount: money(8500),
          expectedCloseAt: null,
          notes: null,
          companyId: "c1",
          contactId: "p1",
          ownerUserId: null,
          ownerBotId: null,
        },
      ],
      erpProduct: [
        {
          id: "i1",
          spaceId: "space-a",
          sku: "SENSOR-X1",
          name: "X1 Sensor",
          description: null,
          unitPrice: money(149),
          active: true,
          stockOnHand: 40,
          createdAt: now,
        },
        {
          id: "i2",
          spaceId: "space-a",
          sku: "CABLE-5M",
          name: "5m Cable",
          description: "Shielded",
          unitPrice: money(24.99),
          active: true,
          stockOnHand: 200,
          createdAt: now,
        },
      ],
      erpSalesOrder: [{ id: "o1", spaceId: "space-a" }],
      erpInvoice: [{ id: "inv1", spaceId: "space-a", total: money(2980), amountPaid: money(1000) }],
    },
  });
}

describe("legacy migration", () => {
  it("inventories in a dry run, then migrates idempotently and links collisions", async () => {
    const site = new FakeFrappeSite({
      apiKey: KEY,
      apiSecret: SECRET,
      company: "Acme Robotics Ltd",
    });
    const handle = fakePrisma(world());
    const gateway = createFrappeGateway({
      prisma: handle.prisma,
      secrets: fakeSecrets(),
      fetch: site.fetch,
      ledger: new MemoryOperationLedger(),
      cacheTtlMs: 0,
    });
    // A company with the same name already lives on the site: it is linked, not duplicated.
    site.insert(
      "CRM Organization",
      { organization_name: "Northwind Traders" },
      "Northwind Traders",
    );

    const dry = await migrateLegacyBusinessData(
      { prisma: handle.prisma, gateway },
      { organizationId: "org-a", actorUserId: "owner", apply: false },
    );
    expect(dry.dryRun).toBe(true);
    expect(dry.counts.company).toMatchObject({ total: 2, created: 0 });
    expect(dry.counts.product.total).toBe(2);
    expect(dry.collisions).toEqual([
      { type: "company", legacyId: "c2", name: "Northwind Traders" },
    ]);
    expect(dry.manual).toEqual({
      orders: 1,
      invoices: 1,
      invoiceTotal: 2980,
      invoiceOutstanding: 1980,
    });
    expect(site.list("CRM Lead")).toHaveLength(0);
    expect(formatMigrationReport(dry)).toContain("Dry run");

    const applied = await migrateLegacyBusinessData(
      { prisma: handle.prisma, gateway },
      { organizationId: "org-a", actorUserId: "owner", apply: true },
    );
    expect(applied.failures).toEqual([]);
    expect(applied.counts.company).toMatchObject({ created: 1, linked: 1 });
    expect(applied.counts.contact).toMatchObject({ created: 1 });
    expect(applied.counts.lead).toMatchObject({ created: 2 });
    expect(applied.counts.deal).toMatchObject({ created: 1 });
    expect(applied.counts.product).toMatchObject({ created: 2 });
    expect(handle.mappings).toHaveLength(8);
    const lead = site.list("CRM Lead").find((row) => row.savingroup_title === "Line upgrade");
    expect(lead).toMatchObject({
      status: "Qualified",
      organization: "Acme Robotics",
      savingroup_legacy_id: "l1",
    });
    expect(site.find("Item", "SENSOR-X1")).toMatchObject({
      actual_qty: 40,
      savingroup_legacy_id: "i1",
    });
    const contact = site.list("Contact")[0];
    expect(contact).toMatchObject({
      savingroup_organization: "Acme Robotics",
      email_id: "dana@acme.example",
    });

    const again = await migrateLegacyBusinessData(
      { prisma: handle.prisma, gateway },
      { organizationId: "org-a", actorUserId: "owner", apply: true },
    );
    expect(again.counts.company).toMatchObject({ mapped: 2, created: 0, linked: 0 });
    expect(again.counts.lead).toMatchObject({ mapped: 2, created: 0 });
    expect(site.list("CRM Lead")).toHaveLength(2);
    expect(site.list("Item")).toHaveLength(2);
  });
});
