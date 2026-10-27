import { createHash } from "node:crypto";
import type { BusinessActionId } from "@savingroup/contracts";
import type { BusinessDeps } from "./context.js";
import { executeBusinessAction } from "./execute.js";

export interface DemoSeedResult {
  companyIds: string[];
  contactIds: string[];
  productIds: string[];
  leadRefs: string[];
  dealRefs: string[];
  orderRefs: string[];
}

/**
 * Seeds a workspace through the public actions, so the audit log and events
 * look exactly like real use. Idempotent per space: rerunning returns the
 * already-created records.
 */
export async function seedBusinessDemo(
  deps: BusinessDeps,
  actor: { spaceId: string; userId: string },
): Promise<DemoSeedResult> {
  const run = async <T>(actionId: BusinessActionId, input: Record<string, unknown>) => {
    const digest = createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 32);
    const result = await executeBusinessAction(
      deps,
      actionId,
      { ...input, idempotencyKey: `business-demo:${actionId}:${digest}` },
      { spaceId: actor.spaceId, actor: { userId: actor.userId } },
    );
    if (!result.ok) throw new Error(`${actionId}: ${result.error.message}`);
    return result.data as T;
  };
  type Rec = { id: string; ref?: string };

  const acme = await run<Rec>("crm.company.create", {
    name: "Acme Robotics",
    domain: "acme-robotics.example",
    phone: "+1 555 0100",
  });
  const northwind = await run<Rec>("crm.company.create", {
    name: "Northwind Traders",
    domain: "northwind.example",
  });
  const dana = await run<Rec>("crm.contact.create", {
    firstName: "Dana",
    lastName: "Reyes",
    email: "dana@acme-robotics.example",
    title: "Head of Procurement",
    companyId: acme.id,
  });
  const lee = await run<Rec>("crm.contact.create", {
    firstName: "Lee",
    lastName: "Okafor",
    email: "lee@northwind.example",
    title: "Operations Manager",
    companyId: northwind.id,
  });
  const sam = await run<Rec>("crm.contact.create", {
    firstName: "Sam",
    lastName: "Ito",
    email: "sam@acme-robotics.example",
    companyId: acme.id,
  });

  const sensor = await run<Rec>("erp.product.create", {
    sku: "SENSOR-X1",
    name: "X1 Proximity Sensor",
    description: "Industrial proximity sensor, 24V.",
    unitPrice: 149.0,
    initialStock: 40,
  });
  const controller = await run<Rec>("erp.product.create", {
    sku: "CTRL-200",
    name: "Series 200 Controller",
    unitPrice: 1299.5,
    initialStock: 6,
  });
  const cable = await run<Rec>("erp.product.create", {
    sku: "CABLE-5M",
    name: "5m Shielded Cable",
    unitPrice: 24.99,
    initialStock: 200,
  });

  const lead1 = await run<Rec & { ref: string }>("crm.lead.create", {
    title: "Acme line upgrade",
    source: "inbound email",
    value: 8500,
    companyId: acme.id,
    contactId: dana.id,
  });
  await run("crm.lead.qualify", { id: lead1.id, status: "qualified" });
  const lead2 = await run<Rec & { ref: string }>("crm.lead.create", {
    title: "Northwind warehouse sensors",
    source: "trade show",
    value: 3200,
    companyId: northwind.id,
    contactId: lee.id,
  });
  await run("crm.activity.create", {
    kind: "call",
    subject: "Intro call with Dana",
    body: "Discussed replacing 20 sensors on line 3.",
    leadId: lead1.id,
    contactId: dana.id,
    completed: true,
  });
  await run("crm.activity.create", {
    kind: "follow_up",
    subject: "Send Northwind the sensor datasheet",
    leadId: lead2.id,
    contactId: lee.id,
    dueAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
  });

  const deal = await run<Rec & { ref: string }>("crm.deal.create", {
    title: "Acme line 3 sensors",
    amount: 8500,
    stage: "proposal",
    expectedCloseAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    companyId: acme.id,
    contactId: dana.id,
  });
  const order = await run<Rec & { ref: string }>("erp.order.create_draft", {
    companyId: acme.id,
    contactId: dana.id,
    dealId: deal.id,
    notes: "Line 3 upgrade, deliver to dock B.",
    lines: [
      { productId: sensor.id, quantity: 20 },
      { productId: cable.id, quantity: 20 },
      { productId: controller.id, quantity: 1 },
    ],
  });

  // Additional enterprise CRM & ERP records so pipelines, charts, notes, calls,
  // orders, and invoices are richly populated out of the box.
  const globex = await run<Rec>("crm.company.create", {
    name: "Globex Industrial Systems",
    domain: "globex-industrial.example",
    phone: "+1 555 0142",
    notes: "Tier-1 manufacturing automation account (4 plants across Midwest).",
  });
  const initech = await run<Rec>("crm.company.create", {
    name: "Initech Cloud Infrastructure",
    domain: "initech-cloud.example",
    phone: "+1 555 0188",
    notes: "Enterprise data center telemetry & power monitoring customer.",
  });
  const stark = await run<Rec>("crm.company.create", {
    name: "Stark Precision Manufacturing",
    domain: "stark-mfg.example",
    phone: "+1 555 0199",
    notes: "Strategic aerospace & robotics hardware partner.",
  });
  const wayne = await run<Rec>("crm.company.create", {
    name: "Wayne Global Logistics",
    domain: "wayne-logistics.example",
    phone: "+1 555 0210",
    notes: "Cold-chain warehouse fleet automation rollout.",
  });

  const priya = await run<Rec>("crm.contact.create", {
    firstName: "Priya",
    lastName: "Natarajan",
    email: "priya.natarajan@globex-industrial.example",
    phone: "+1 555 0143",
    title: "VP of Manufacturing Engineering",
    companyId: globex.id,
  });
  const marcus = await run<Rec>("crm.contact.create", {
    firstName: "Marcus",
    lastName: "Vance",
    email: "m.vance@initech-cloud.example",
    phone: "+1 555 0189",
    title: "Chief Infrastructure Officer",
    companyId: initech.id,
  });
  const elena = await run<Rec>("crm.contact.create", {
    firstName: "Elena",
    lastName: "Rostova",
    email: "elena@stark-mfg.example",
    phone: "+1 555 0195",
    title: "Director of Robotics Supply Chain",
    companyId: stark.id,
  });
  const arjun = await run<Rec>("crm.contact.create", {
    firstName: "Arjun",
    lastName: "Mehta",
    email: "arjun.mehta@wayne-logistics.example",
    phone: "+1 555 0215",
    title: "SVP of Warehouse Operations",
    companyId: wayne.id,
  });

  const gatewayUnit = await run<Rec>("erp.product.create", {
    sku: "GW-EDGE-500",
    name: "Edge Telemetry Gateway 500",
    description: "Modbus/OPC-UA industrial edge gateway with dual Ethernet & LTE failover.",
    unitPrice: 2450.0,
    initialStock: 18,
  });
  const visionCam = await run<Rec>("erp.product.create", {
    sku: "CAM-VIS-4K",
    name: "4K Machine Vision Inspection Camera",
    description: "High-speed global shutter camera for automated QA lines.",
    unitPrice: 1850.0,
    initialStock: 4,
  });
  const plcRack = await run<Rec>("erp.product.create", {
    sku: "PLC-RACK-16",
    name: "16-Channel Modular PLC I/O Rack",
    description: "Hot-swappable DIN-rail industrial PLC rack.",
    unitPrice: 890.0,
    initialStock: 25,
  });

  const lead3 = await run<Rec & { ref: string }>("crm.lead.create", {
    title: "Globex Plant 2 Vision QA Rollout",
    source: "Enterprise Outbound",
    value: 48000,
    companyId: globex.id,
    contactId: priya.id,
    notes: "Replacing legacy optical sensors across 6 assembly lines in Q4.",
  });
  await run("crm.lead.qualify", { id: lead3.id, status: "qualified" });

  const lead4 = await run<Rec & { ref: string }>("crm.lead.create", {
    title: "Initech Data Center Rack Telemetry",
    source: "Inbound Demo Request",
    value: 64500,
    companyId: initech.id,
    contactId: marcus.id,
    notes: "Needs 25 Edge Telemetry Gateways + 50 Proximity Sensors for US-East facility.",
  });
  await run("crm.lead.qualify", { id: lead4.id, status: "contacted" });

  const lead5 = await run<Rec & { ref: string }>("crm.lead.create", {
    title: "Stark Aerospace Cleanroom Controllers",
    source: "Partner Referral",
    value: 112000,
    companyId: stark.id,
    contactId: elena.id,
    notes: "Multi-year framework agreement for Series 200 Controllers.",
  });
  await run("crm.lead.qualify", { id: lead5.id, status: "qualified" });

  const lead6 = await run<Rec & { ref: string }>("crm.lead.create", {
    title: "Wayne Cold-Chain Dock Automation",
    source: "Gartner Supply Chain Summit",
    value: 29500,
    companyId: wayne.id,
    contactId: arjun.id,
    notes: "Initial pilot for 12 loading docks.",
  });

  const deal2 = await run<Rec & { ref: string }>("crm.deal.create", {
    title: "Globex Multi-Line Vision & PLC Upgrade",
    amount: 54200,
    stage: "negotiation",
    expectedCloseAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    companyId: globex.id,
    contactId: priya.id,
    notes: "Final legal review on SLA terms; procurement approved budget.",
  });
  const deal3 = await run<Rec & { ref: string }>("crm.deal.create", {
    title: "Initech US-East Edge Gateway Deployment",
    amount: 72800,
    stage: "qualification",
    expectedCloseAt: new Date(Date.now() + 18 * 24 * 60 * 60 * 1000).toISOString(),
    companyId: initech.id,
    contactId: marcus.id,
    notes: "Technical architecture review scheduled for Thursday.",
  });
  const deal4 = await run<Rec & { ref: string }>("crm.deal.create", {
    title: "Stark Robotics Phase 1 Controller Supply",
    amount: 96500,
    stage: "won",
    expectedCloseAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    companyId: stark.id,
    contactId: elena.id,
    notes: "Signed master supply agreement; PO issued.",
  });

  const deal5 = await run<Rec & { ref: string }>("crm.deal.create", {
    title: "Northwind Regional Hub Sensor Kit",
    amount: 24600,
    stage: "won",
    expectedCloseAt: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(),
    companyId: northwind.id,
    contactId: lee.id,
    notes: "Closed and fulfilled for regional distribution hub.",
  });

  const deal6 = await run<Rec & { ref: string }>("crm.deal.create", {
    title: "Wayne Logistics Automated Dock Pilot",
    amount: 38400,
    stage: "proposal",
    expectedCloseAt: new Date(Date.now() + 11 * 24 * 60 * 60 * 1000).toISOString(),
    companyId: wayne.id,
    contactId: arjun.id,
    notes: "Sent commercial quotation with volume tier discounts.",
  });

  await run("crm.activity.create", {
    kind: "note",
    subject: "Architecture & Compliance Review Notes — Globex",
    body: "Confirmed GST HSN codes (851762 / 903180) and 24V safety interlock specs with Priya's engineering team. Ready for final commercial sign-off.",
    companyId: globex.id,
    contactId: priya.id,
    dealId: deal2.id,
    completed: true,
  });
  await run("crm.activity.create", {
    kind: "call",
    subject: "[Outbound] Commercial negotiation call with Priya (18m)",
    body: "Agreed on net-30 payment terms and 2-year hardware warranty.",
    companyId: globex.id,
    contactId: priya.id,
    dealId: deal2.id,
    completed: true,
  });
  await run("crm.activity.create", {
    kind: "email",
    subject: "Re: Proposal & Pricing Follow-up — Stark Phase 1",
    body: "Hi Elena,\n\nAttached is the countersigned master supply schedule and delivery timeline for the Series 200 Controllers.",
    companyId: stark.id,
    contactId: elena.id,
    dealId: deal4.id,
    completed: true,
  });
  await run("crm.activity.create", {
    kind: "follow_up",
    subject: "Finalize SLA redlines with Globex legal",
    companyId: globex.id,
    contactId: priya.id,
    dealId: deal2.id,
    dueAt: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString(),
  });

  const order2 = await run<Rec & { ref: string }>("erp.order.create_draft", {
    companyId: stark.id,
    contactId: elena.id,
    dealId: deal4.id,
    notes: "Stark Phase 1 PO — Priority air freight.",
    lines: [
      { productId: controller.id, quantity: 2 },
      { productId: gatewayUnit.id, quantity: 4 },
      { productId: plcRack.id, quantity: 6 },
    ],
  });
  await run("erp.order.approve", { id: order2.id });
  await run("erp.order.confirm", { id: order2.id });
  const inv1 = await run<Rec & { ref: string }>("erp.invoice.create_draft", {
    orderId: order2.id,
    dueAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
  });
  await run("erp.invoice.issue", { id: inv1.id });

  const order3 = await run<Rec & { ref: string }>("erp.order.create_draft", {
    companyId: northwind.id,
    contactId: lee.id,
    dealId: deal5.id,
    notes: "Regional hub sensor kit fulfillment.",
    lines: [
      { productId: sensor.id, quantity: 10 },
      { productId: cable.id, quantity: 25 },
      { productId: plcRack.id, quantity: 4 },
    ],
  });
  await run("erp.order.approve", { id: order3.id });
  await run("erp.order.confirm", { id: order3.id });
  const inv2 = await run<Rec & { ref: string }>("erp.invoice.create_draft", {
    orderId: order3.id,
    dueAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  });
  await run("erp.invoice.issue", { id: inv2.id });
  await run("erp.invoice.record_payment", { id: inv2.id, amount: 5674.75 });

  const order4 = await run<Rec & { ref: string }>("erp.order.create_draft", {
    companyId: globex.id,
    contactId: priya.id,
    dealId: deal2.id,
    notes: "Globex Plant 2 pre-production vision & gateway batch.",
    lines: [
      { productId: visionCam.id, quantity: 2 },
      { productId: gatewayUnit.id, quantity: 3 },
    ],
  });
  await run("erp.order.request_approval", { id: order4.id });

  return {
    companyIds: [acme.id, northwind.id, globex.id, initech.id, stark.id, wayne.id],
    contactIds: [dana.id, lee.id, sam.id, priya.id, marcus.id, elena.id, arjun.id],
    productIds: [sensor.id, controller.id, cable.id, gatewayUnit.id, visionCam.id, plcRack.id],
    leadRefs: [lead1.ref, lead2.ref, lead3.ref, lead4.ref, lead5.ref, lead6.ref],
    dealRefs: [deal.ref, deal2.ref, deal3.ref, deal4.ref, deal5.ref, deal6.ref],
    orderRefs: [order.ref, order2.ref, order3.ref, order4.ref],
  };
}
