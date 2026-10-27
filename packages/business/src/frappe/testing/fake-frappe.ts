import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { BusinessErrorCode } from "@savingroup/contracts";

/**
 * A deterministic stand-in for a Frappe site with ERPNext, Frappe CRM and the
 * Savingroup bridge installed. It implements the slice of the REST API and the
 * bridge methods the gateway uses, with the same document shapes, statuses and
 * business rules the real bridge enforces (lead dedupe, approval before
 * confirmation, stock checks, one invoice per order).
 *
 * It exists so the gateway, the executor and the API can be tested offline
 * and with fault injection (delays past the client timeout, dropped
 * connections) that a live site cannot provide on demand.
 */

export type FakeDoc = Record<string, unknown> & { name: string; doctype: string };

type Filter = [string, string, unknown] | [string, string, string, unknown];

export interface FakeFrappeOptions {
  apiKey: string;
  apiSecret: string;
  company?: string;
  companyAbbr?: string;
  site?: string;
  apps?: Record<string, string>;
  now?: () => Date;
}

/** The real bridge's administration blocklist, mirrored for the tests. */
const ADMIN_BLOCKED_DOCTYPES = new Set([
  "user",
  "role",
  "has role",
  "system settings",
  "server script",
]);
const ADMIN_BLOCKED_METHOD_PREFIXES = ["frappe.core.doctype.user.", "frappe.client.delete"];
/** Doctypes every site has, even before a test creates documents of them. */
const ADMIN_KNOWN_DOCTYPES = [
  "Assignment Rule",
  "Custom Field",
  "Item Group",
  "Notification",
  "Warehouse",
  "Workflow",
];
const SUBMITTABLE_DOCTYPES = new Set([
  "Sales Order",
  "Sales Invoice",
  "Payment Entry",
  "Stock Entry",
  "Delivery Note",
]);

class BridgeError extends Error {
  constructor(
    readonly code: BusinessErrorCode,
    message: string,
  ) {
    super(message);
  }
}

interface StoredOperation {
  status: "succeeded" | "failed";
  result?: Record<string, unknown>;
  external?: { doctype: string; name: string } | null;
  error?: { code: string; message: string } | null;
}

export class FakeFrappeSite {
  readonly docs = new Map<string, Map<string, FakeDoc>>();
  readonly operations = new Map<string, StoredOperation>();
  readonly requests: Array<{ method: string; path: string; body: unknown }> = [];
  /** Fault injection: delay every response by this many ms (0 = none). */
  responseDelayMs = 0;
  /** Fault injection: destroy the socket after committing the next N writes. */
  dropAfterCommit = 0;
  private counters = new Map<string, number>();
  private readonly options: Required<Omit<FakeFrappeOptions, "now">> & { now: () => Date };
  private server?: ReturnType<typeof createServer>;
  private url?: string;

  constructor(options: FakeFrappeOptions) {
    this.options = {
      company: "Savingroup Demo Pvt Ltd",
      companyAbbr: "RD",
      site: "frontend",
      apps: {
        frappe: "16.51.1",
        erpnext: "16.51.1",
        crm: "1.88.0",
        india_compliance: "16.10.1",
        savingroup_business_bridge: "0.1.0",
      },
      now: () => new Date(),
      ...options,
    };
    // The company is a document, as on a real site, so it can be renamed.
    this.insert(
      "Company",
      { company_name: this.options.company, abbr: this.options.companyAbbr },
      this.options.company,
    );
  }

  get company(): string {
    return this.options.company;
  }

  /** Frappe's rename: the document keeps its fields under the new name. */
  renameDoc(doctype: string, from: string, to: string): void {
    const doc = this.get(doctype, from);
    this.table(doctype).delete(from);
    this.table(doctype).set(to, { ...doc, name: to, modified: this.stamp() });
  }

  // --- lifecycle -------------------------------------------------------------

  async listen(): Promise<string> {
    if (this.url) return this.url;
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        void this.handle({
          method: req.method ?? "GET",
          url: new URL(req.url ?? "/", "http://fake"),
          headers: Object.fromEntries(
            Object.entries(req.headers).map(([key, value]) => [
              key,
              Array.isArray(value) ? value[0] : value,
            ]),
          ) as Record<string, string | undefined>,
          body: raw,
        }).then((response) => {
          if (response.drop) {
            res.destroy();
            return;
          }
          res.writeHead(response.status, { "content-type": "application/json" });
          res.end(response.body);
        });
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    const { port } = this.server!.address() as AddressInfo;
    this.url = `http://127.0.0.1:${port}`;
    return this.url;
  }

  async close(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = undefined;
    this.url = undefined;
  }

  /** A fetch-compatible function for the gateway, without sockets. */
  fetch: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const headers: Record<string, string | undefined> = {};
    const source = init?.headers ?? (input instanceof Request ? input.headers : undefined);
    if (source instanceof Headers) {
      source.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
    } else if (Array.isArray(source)) for (const [k, v] of source) headers[k.toLowerCase()] = v;
    else if (source) for (const [k, v] of Object.entries(source)) headers[k.toLowerCase()] = v;
    const signal = init?.signal ?? undefined;
    const handled = this.handle({
      method: init?.method ?? "GET",
      url,
      headers,
      body: typeof init?.body === "string" ? init.body : "",
    });
    const response = await (signal
      ? Promise.race([
          handled,
          new Promise<never>((_resolve, reject) => {
            const abort = () =>
              reject(new DOMException("The operation was aborted.", "AbortError"));
            if (signal.aborted) abort();
            else signal.addEventListener("abort", abort, { once: true });
          }),
        ])
      : handled);
    if (response.drop) throw new TypeError("fetch failed: socket hang up");
    return new Response(response.body, {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  };

  // --- request handling -------------------------------------------------------

  private async handle(request: {
    method: string;
    url: URL;
    headers: Record<string, string | undefined>;
    body: string;
  }): Promise<{ status: number; body: string; drop?: boolean }> {
    const body = request.body ? safeJson(request.body) : {};
    this.requests.push({ method: request.method, path: request.url.pathname, body });
    const auth = request.headers.authorization;
    if (auth !== `token ${this.options.apiKey}:${this.options.apiSecret}`) {
      return frappeError(401, "AuthenticationError", "Invalid API key or secret.");
    }
    if (this.responseDelayMs > 0) {
      // The site keeps working while the client gives up; that is the point.
      await new Promise<void>((resolve) => setTimeout(resolve, this.responseDelayMs));
    }
    try {
      const path = request.url.pathname;
      if (path.startsWith("/api/method/")) {
        const method = path.slice("/api/method/".length);
        const result = this.callMethod(method, body as Record<string, unknown>);
        const drop = this.consumeDrop(method);
        return { status: 200, body: JSON.stringify({ message: result }), drop };
      }
      if (path.startsWith("/api/resource/")) {
        const [doctypeRaw, nameRaw] = path.slice("/api/resource/".length).split("/");
        const doctype = decodeURIComponent(doctypeRaw ?? "");
        const name = nameRaw === undefined ? undefined : decodeURIComponent(nameRaw);
        return {
          status: 200,
          body: JSON.stringify({
            data: this.resource(request.method, doctype, name, request.url.searchParams, body),
          }),
        };
      }
      return frappeError(404, "DoesNotExistError", "Not found");
    } catch (error) {
      if (error instanceof BridgeError) {
        return frappeError(
          417,
          "SavingroupBusinessError",
          JSON.stringify({ code: error.code, message: error.message }),
        );
      }
      if (error instanceof NotFound) return frappeError(404, "DoesNotExistError", error.message);
      return frappeError(500, "Exception", error instanceof Error ? error.message : String(error));
    }
  }

  private consumeDrop(method: string): boolean {
    if (this.dropAfterCommit > 0 && method.endsWith(".execute")) {
      this.dropAfterCommit -= 1;
      return true;
    }
    return false;
  }

  // --- REST resources ---------------------------------------------------------

  private table(doctype: string): Map<string, FakeDoc> {
    let table = this.docs.get(doctype);
    if (!table) {
      table = new Map();
      this.docs.set(doctype, table);
    }
    return table;
  }

  get(doctype: string, name: string): FakeDoc {
    const doc = this.table(doctype).get(name);
    if (!doc) throw new NotFound(`${doctype} ${name} not found`);
    return doc;
  }

  find(doctype: string, name: string): FakeDoc | undefined {
    return this.table(doctype).get(name);
  }

  list(doctype: string): FakeDoc[] {
    return [...this.table(doctype).values()];
  }

  private resource(
    method: string,
    doctype: string,
    name: string | undefined,
    params: URLSearchParams,
    body: unknown,
  ): unknown {
    if (method === "GET" && name !== undefined) return this.get(doctype, name);
    if (method === "GET") {
      const filters = (safeJson(params.get("filters") ?? "[]") as Filter[]) ?? [];
      const orFilters = (safeJson(params.get("or_filters") ?? "[]") as Filter[]) ?? [];
      const limit = Number(params.get("limit_page_length") ?? 20);
      let rows = this.list(doctype).filter((doc) => filters.every((f) => matches(doc, f)));
      if (orFilters.length) rows = rows.filter((doc) => orFilters.some((f) => matches(doc, f)));
      const orderBy = params.get("order_by") ?? "modified desc";
      const [field, direction] = orderBy.split(" ");
      rows.sort((a, b) => {
        const av = String(a[field ?? "modified"] ?? "");
        const bv = String(b[field ?? "modified"] ?? "");
        return direction === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      });
      return rows.slice(0, limit).map((doc) => stripChildren(doc));
    }
    if (method === "POST") return this.insert(doctype, body as Record<string, unknown>);
    if (method === "PUT" && name !== undefined) {
      return this.update(doctype, name, body as Record<string, unknown>);
    }
    if (method === "DELETE" && name !== undefined) {
      this.get(doctype, name);
      this.table(doctype).delete(name);
      return "ok";
    }
    throw new NotFound("Unsupported resource request");
  }

  // --- document helpers -------------------------------------------------------

  private stamp(): string {
    const now = this.options.now();
    return now.toISOString().replace("T", " ").replace("Z", "");
  }

  private nextName(series: string): string {
    const count = (this.counters.get(series) ?? 0) + 1;
    this.counters.set(series, count);
    return `${series}-${String(count).padStart(5, "0")}`;
  }

  insert(doctype: string, values: Record<string, unknown>, name?: string): FakeDoc {
    const docName =
      name ??
      (typeof values.name === "string" ? values.name : undefined) ??
      this.nextName(seriesFor(doctype));
    if (this.table(doctype).has(docName)) {
      throw new BridgeError("conflict", `${doctype} ${docName} already exists.`);
    }
    const doc: FakeDoc = {
      ...values,
      name: docName,
      doctype,
      docstatus: typeof values.docstatus === "number" ? values.docstatus : 0,
      creation: this.stamp(),
      modified: this.stamp(),
    };
    this.table(doctype).set(docName, doc);
    return doc;
  }

  update(doctype: string, name: string, values: Record<string, unknown>): FakeDoc {
    const doc = this.get(doctype, name);
    Object.assign(doc, values, { modified: this.stamp() });
    return doc;
  }

  // --- bridge methods ---------------------------------------------------------

  private callMethod(method: string, args: Record<string, unknown>): unknown {
    switch (method) {
      case "savingroup_business_bridge.api.ping":
        return {
          ok: true,
          site: this.options.site,
          user: "savingroup-gateway@example.test",
          apps: this.options.apps,
          bridge_version: "0.1.0",
          protocol_version: 1,
          companies: this.list("Company").map((doc) => doc.name),
        };
      case "savingroup_business_bridge.api.get_operation": {
        const stored = this.operations.get(String(args.operation_id));
        if (!stored) return { found: false };
        return { found: true, ...stored };
      }
      case "savingroup_business_bridge.api.execute":
        return this.execute(args);
      case "savingroup_business_bridge.api.query":
        return this.query(String(args.kind), (args.params ?? {}) as Record<string, unknown>);
      default:
        throw new NotFound(`Method ${method} not found`);
    }
  }

  private execute(args: Record<string, unknown>): unknown {
    const operationId = String(args.operation_id ?? "");
    if (!operationId) throw new BridgeError("invalid_input", "operation_id is required.");
    const stored = this.operations.get(operationId);
    if (stored) {
      if (stored.status === "failed") {
        throw new BridgeError(
          (stored.error?.code as BusinessErrorCode) ?? "conflict",
          stored.error?.message ?? "The operation failed before.",
        );
      }
      return {
        status: "succeeded",
        replayed: true,
        result: stored.result,
        external: stored.external,
      };
    }
    const action = String(args.action);
    const payload = (args.payload ?? {}) as Record<string, unknown>;
    const context = (args.context ?? {}) as {
      actor?: { user_id?: string | null; bot_id?: string | null };
      policy?: {
        allow_negative_stock?: boolean;
        order_approval_required?: boolean;
        invoice_approval_required?: boolean;
      };
    };
    try {
      const { result, external } = this.runAction(action, payload, context, operationId);
      this.operations.set(operationId, { status: "succeeded", result, external });
      return { status: "succeeded", replayed: false, result, external };
    } catch (error) {
      if (error instanceof BridgeError) {
        // Frappe rolls the request back; the bridge records failures outside it.
        this.operations.set(operationId, {
          status: "failed",
          error: { code: error.code, message: error.message },
        });
      }
      throw error;
    }
  }

  private actorFields(
    context: { actor?: { user_id?: string | null; bot_id?: string | null } },
    prefix = "savingroup_created_by",
  ): Record<string, unknown> {
    return {
      [`${prefix}_user`]: context.actor?.user_id ?? null,
      [`${prefix}_bot`]: context.actor?.bot_id ?? null,
    };
  }

  private runAction(
    action: string,
    p: Record<string, unknown>,
    context: {
      actor?: { user_id?: string | null; bot_id?: string | null };
      policy?: {
        allow_negative_stock?: boolean;
        order_approval_required?: boolean;
        invoice_approval_required?: boolean;
      };
    },
    operationId: string,
  ): { result: Record<string, unknown>; external: { doctype: string; name: string } | null } {
    const created = { ...this.actorFields(context), savingroup_operation_id: operationId };
    const text = (key: string) => (typeof p[key] === "string" ? (p[key] as string) : undefined);
    const number = (key: string) => (typeof p[key] === "number" ? (p[key] as number) : undefined);
    switch (action) {
      case "crm.company.create": {
        const name = text("name")!;
        if (this.find("CRM Organization", name)) {
          throw new BridgeError("conflict", `Company ${name} already exists.`);
        }
        const doc = this.insert(
          "CRM Organization",
          {
            organization_name: name,
            website: text("domain") ?? null,
            savingroup_phone: text("phone") ?? null,
            savingroup_notes: text("notes") ?? null,
            ...created,
          },
          name,
        );
        return { result: { organization: doc }, external: ref(doc) };
      }
      case "crm.company.update": {
        const doc = this.require("CRM Organization", text("id")!);
        if (text("name") && text("name") !== doc.name) {
          this.table("CRM Organization").delete(doc.name);
          doc.name = text("name")!;
          doc.organization_name = doc.name;
          this.table("CRM Organization").set(doc.name, doc);
        }
        if ("domain" in p) doc.website = p.domain ?? null;
        if ("phone" in p) doc.savingroup_phone = p.phone ?? null;
        if ("notes" in p) doc.savingroup_notes = p.notes ?? null;
        doc.modified = this.stamp();
        return { result: { organization: doc }, external: ref(doc) };
      }
      case "crm.contact.create": {
        const organization = text("companyId");
        if (organization) this.require("CRM Organization", organization);
        const first = text("firstName")!;
        const last = text("lastName") ?? "";
        const doc = this.insert("Contact", {
          first_name: first,
          last_name: last,
          full_name: `${first} ${last}`.trim(),
          email_id: text("email")?.toLowerCase() ?? null,
          mobile_no: text("phone") ?? null,
          designation: text("title") ?? null,
          company_name: organization ?? null,
          savingroup_organization: organization ?? null,
          savingroup_notes: text("notes") ?? null,
          ...created,
        });
        return { result: { contact: doc }, external: ref(doc) };
      }
      case "crm.contact.update": {
        const doc = this.require("Contact", text("id")!);
        if (text("firstName")) doc.first_name = text("firstName");
        if (typeof p.lastName === "string") doc.last_name = p.lastName;
        doc.full_name = `${doc.first_name} ${doc.last_name}`.trim();
        if ("email" in p) doc.email_id = typeof p.email === "string" ? p.email.toLowerCase() : null;
        if ("phone" in p) doc.mobile_no = p.phone ?? null;
        if ("title" in p) doc.designation = p.title ?? null;
        if ("notes" in p) doc.savingroup_notes = p.notes ?? null;
        if ("companyId" in p) {
          if (typeof p.companyId === "string") this.require("CRM Organization", p.companyId);
          doc.savingroup_organization = p.companyId ?? null;
          doc.company_name = p.companyId ?? null;
        }
        doc.modified = this.stamp();
        return { result: { contact: doc }, external: ref(doc) };
      }
      case "crm.lead.create": {
        const organization = text("companyId");
        if (organization) this.require("CRM Organization", organization);
        const contact = text("contactId") ? this.require("Contact", text("contactId")!) : undefined;
        const email = (contact?.email_id as string | null) ?? null;
        if (email) {
          const existing = this.list("CRM Lead").find(
            (lead) => lead.email === email && !lead.converted && lead.status !== "Unqualified",
          );
          if (existing)
            return { result: { lead: existing, duplicate: true }, external: ref(existing) };
        }
        const doc = this.insert("CRM Lead", {
          first_name: (contact?.first_name as string | undefined) ?? text("title")!,
          last_name: (contact?.last_name as string | undefined) ?? "",
          lead_name: (contact?.full_name as string | undefined) ?? text("title")!,
          email,
          mobile_no: (contact?.mobile_no as string | null) ?? null,
          status: "New",
          converted: 0,
          organization: organization ?? null,
          source: text("source") ?? null,
          savingroup_title: text("title")!,
          savingroup_value: number("value") ?? null,
          savingroup_notes: text("notes") ?? null,
          savingroup_contact: contact?.name ?? null,
          savingroup_organization: organization ?? null,
          savingroup_assignee_user: text("assigneeUserId") ?? null,
          savingroup_assignee_bot: text("assigneeBotId") ?? null,
          savingroup_deal: null,
          ...created,
        });
        return { result: { lead: doc, duplicate: false }, external: ref(doc) };
      }
      case "crm.lead.assign": {
        const doc = this.require("CRM Lead", text("id") ?? text("ref")!);
        doc.savingroup_assignee_user = text("assigneeUserId") ?? null;
        doc.savingroup_assignee_bot = text("assigneeBotId") ?? null;
        doc.modified = this.stamp();
        return { result: { lead: doc }, external: ref(doc) };
      }
      case "crm.lead.qualify": {
        const doc = this.require("CRM Lead", text("id") ?? text("ref")!);
        if (doc.converted)
          throw new BridgeError("invalid_state", "A converted lead cannot change status.");
        const status = {
          contacted: "Contacted",
          qualified: "Qualified",
          unqualified: "Unqualified",
        }[text("status") ?? ""];
        if (!status) throw new BridgeError("invalid_input", "Unknown lead status.");
        doc.status = status;
        if (text("notes") !== undefined) doc.savingroup_notes = text("notes");
        if (number("value") !== undefined) doc.savingroup_value = number("value");
        doc.modified = this.stamp();
        return { result: { lead: doc }, external: ref(doc) };
      }
      case "crm.lead.convert": {
        const lead = this.require("CRM Lead", text("id") ?? text("ref")!);
        if (lead.converted)
          throw new BridgeError("invalid_state", "The lead is already converted.");
        if (lead.status !== "Qualified") {
          throw new BridgeError("invalid_state", "Qualify the lead before converting it.");
        }
        const deal = this.insert("CRM Deal", {
          organization: lead.organization ?? null,
          status: "Qualification",
          deal_value: number("amount") ?? (lead.savingroup_value as number | null) ?? 0,
          currency: null,
          lead: lead.name,
          lead_name: lead.lead_name,
          contacts: lead.savingroup_contact
            ? [{ name: `row-${lead.name}`, contact: lead.savingroup_contact, is_primary: 1 }]
            : [],
          savingroup_title: text("title") ?? lead.savingroup_title,
          savingroup_notes: lead.savingroup_notes ?? null,
          savingroup_owner_user: lead.savingroup_assignee_user ?? null,
          savingroup_owner_bot: lead.savingroup_assignee_bot ?? null,
          ...created,
        });
        lead.status = "Converted";
        lead.converted = 1;
        lead.savingroup_deal = deal.name;
        lead.modified = this.stamp();
        return { result: { lead, deal }, external: ref(deal) };
      }
      case "crm.deal.create": {
        const organization = text("companyId");
        if (organization) this.require("CRM Organization", organization);
        const contact = text("contactId");
        if (contact) this.require("Contact", contact);
        const doc = this.insert("CRM Deal", {
          organization: organization ?? null,
          status: dealStatus(text("stage") ?? "qualification"),
          deal_value: number("amount") ?? 0,
          expected_closure_date: text("expectedCloseAt")?.slice(0, 10) ?? null,
          closed_date: null,
          contacts: contact ? [{ name: `row-${contact}`, contact, is_primary: 1 }] : [],
          savingroup_title: text("title")!,
          savingroup_notes: text("notes") ?? null,
          savingroup_owner_user: text("ownerUserId") ?? null,
          savingroup_owner_bot: text("ownerBotId") ?? null,
          ...created,
        });
        return { result: { deal: doc }, external: ref(doc) };
      }
      case "crm.deal.update": {
        const doc = this.require("CRM Deal", text("id") ?? text("ref")!);
        if (text("title")) doc.savingroup_title = text("title");
        if (number("amount") !== undefined) doc.deal_value = number("amount");
        if ("expectedCloseAt" in p)
          doc.expected_closure_date =
            typeof p.expectedCloseAt === "string" ? p.expectedCloseAt.slice(0, 10) : null;
        if ("notes" in p) doc.savingroup_notes = p.notes ?? null;
        if ("companyId" in p) doc.organization = p.companyId ?? null;
        if ("ownerUserId" in p) doc.savingroup_owner_user = p.ownerUserId ?? null;
        if ("ownerBotId" in p) doc.savingroup_owner_bot = p.ownerBotId ?? null;
        doc.modified = this.stamp();
        return { result: { deal: doc }, external: ref(doc) };
      }
      case "crm.deal.update_stage": {
        const doc = this.require("CRM Deal", text("id") ?? text("ref")!);
        if (doc.status === "Won" || doc.status === "Lost") {
          throw new BridgeError("invalid_state", "A closed deal cannot change stage.");
        }
        doc.status = dealStatus(text("stage")!);
        if (doc.status === "Won" || doc.status === "Lost")
          doc.closed_date = this.stamp().slice(0, 10);
        if (text("reason")) doc.savingroup_stage_reason = text("reason");
        doc.modified = this.stamp();
        return { result: { deal: doc }, external: ref(doc) };
      }
      case "crm.activity.create": {
        const referenceDoctype = text("leadId") ? "CRM Lead" : text("dealId") ? "CRM Deal" : null;
        const referenceName = text("leadId") ?? text("dealId") ?? null;
        if (referenceDoctype && referenceName) this.require(referenceDoctype, referenceName);
        const completed = p.completed === true;
        const doc = this.insert("CRM Task", {
          title: text("subject")!,
          description: text("body") ?? null,
          status: completed ? "Done" : "Todo",
          due_date: text("dueAt") ? text("dueAt")!.replace("T", " ").replace("Z", "") : null,
          reference_doctype: referenceDoctype,
          reference_docname: referenceName,
          savingroup_kind: text("kind") ?? "note",
          savingroup_contact: text("contactId") ?? null,
          savingroup_organization: text("companyId") ?? null,
          savingroup_completed_at: completed ? this.stamp() : null,
          savingroup_assignee_user: text("assigneeUserId") ?? null,
          savingroup_assignee_bot: text("assigneeBotId") ?? null,
          ...created,
        });
        return { result: { task: doc }, external: ref(doc) };
      }
      case "erp.product.create": {
        const sku = text("sku")!;
        if (this.find("Item", sku))
          throw new BridgeError("conflict", `Item ${sku} already exists.`);
        const item = this.insert(
          "Item",
          {
            item_code: sku,
            item_name: text("name")!,
            description: text("description") ?? null,
            disabled: 0,
            standard_rate: number("unitPrice") ?? 0,
            price_list_rate: number("unitPrice") ?? 0,
            actual_qty: number("initialStock") ?? 0,
            reserved_qty: 0,
            gst_hsn_code: text("hsnCode") ?? null,
            ...created,
          },
          sku,
        );
        return { result: { product: item }, external: ref(item) };
      }
      case "erp.product.update": {
        const item = this.requireItem(text("id") ?? text("sku")!);
        if (text("name")) item.item_name = text("name");
        if ("description" in p) item.description = p.description ?? null;
        if (number("unitPrice") !== undefined) {
          item.standard_rate = number("unitPrice");
          item.price_list_rate = number("unitPrice");
        }
        if (typeof p.active === "boolean") item.disabled = p.active ? 0 : 1;
        if ("hsnCode" in p) item.gst_hsn_code = text("hsnCode") ?? null;
        item.modified = this.stamp();
        return { result: { product: item }, external: ref(item) };
      }
      case "erp.inventory.adjust": {
        const item = this.requireItem(text("productId") ?? text("sku")!);
        const delta = number("delta") ?? 0;
        const after = (item.actual_qty as number) + delta;
        if (after < 0 && !context.policy?.allow_negative_stock) {
          throw new BridgeError(
            "insufficient_stock",
            `Only ${item.actual_qty} of ${item.item_code} on hand; cannot remove ${Math.abs(delta)}.`,
          );
        }
        item.actual_qty = after;
        item.modified = this.stamp();
        const entry = this.insert("Stock Entry", {
          item_code: item.item_code,
          item_name: item.item_name,
          delta,
          quantity_after: after,
          reason: text("reason"),
          sales_order: null,
          docstatus: 1,
          ...created,
        });
        return { result: { adjustment: entry }, external: ref(entry) };
      }
      case "erp.order.create_draft": {
        const deal = text("dealId") ?? text("dealRef");
        const dealDoc = deal ? this.require("CRM Deal", deal) : undefined;
        const customer = text("companyId") ?? (dealDoc?.organization as string | null) ?? null;
        if (!customer)
          throw new BridgeError(
            "invalid_input",
            "An order needs a customer: pass companyId or a deal with an organization.",
          );
        this.require("CRM Organization", customer);
        if (!this.find("Customer", customer)) {
          this.insert(
            "Customer",
            { customer_name: customer, customer_type: "Company", ...created },
            customer,
          );
        }
        const lines = Array.isArray(p.lines) ? (p.lines as Record<string, unknown>[]) : [];
        const order = this.insert("Sales Order", {
          customer,
          customer_name: customer,
          currency: null,
          items: [],
          total: 0,
          savingroup_deal: dealDoc?.name ?? null,
          savingroup_contact: text("contactId") ?? null,
          savingroup_notes: text("notes") ?? null,
          savingroup_approval_status: "draft",
          savingroup_invoice: null,
          ...created,
        });
        for (const line of lines) this.addLine(order, line);
        return { result: { sales_order: order }, external: ref(order) };
      }
      case "erp.order.add_item": {
        const order = this.requireDraftOrder(text("orderId")!);
        this.addLine(order, p);
        return { result: { sales_order: order }, external: ref(order) };
      }
      case "erp.order.remove_item": {
        const order = this.requireDraftOrder(text("orderId")!);
        const items = order.items as Record<string, unknown>[];
        const index = items.findIndex((row) => row.name === text("lineId"));
        if (index < 0) throw new BridgeError("not_found", "Order line not found.");
        items.splice(index, 1);
        this.retotal(order);
        return { result: { sales_order: order }, external: ref(order) };
      }
      case "erp.order.request_approval": {
        const order = this.requireDraftOrder(text("id") ?? text("ref")!);
        if (!(order.items as unknown[]).length)
          throw new BridgeError(
            "invalid_state",
            "Add at least one line before requesting approval.",
          );
        order.savingroup_approval_status = "pending_approval";
        order.savingroup_approval_requested_at = this.stamp();
        order.modified = this.stamp();
        return { result: { sales_order: order }, external: ref(order) };
      }
      case "erp.order.approve": {
        const order = this.requireDraftOrder(text("id") ?? text("ref")!);
        if (order.savingroup_approval_status !== "pending_approval") {
          throw new BridgeError("invalid_state", "Only an order pending approval can be approved.");
        }
        order.savingroup_approval_status = "approved";
        order.savingroup_approved_at = this.stamp();
        Object.assign(order, this.actorFields(context, "savingroup_approved_by"));
        order.modified = this.stamp();
        return { result: { sales_order: order }, external: ref(order) };
      }
      case "erp.order.confirm": {
        const order = this.requireDraftOrder(text("id") ?? text("ref")!);
        if (
          context.policy?.order_approval_required &&
          order.savingroup_approval_status !== "approved"
        ) {
          throw new BridgeError("invalid_state", "Approve the order before confirming it.");
        }
        const items = order.items as Record<string, unknown>[];
        if (!items.length)
          throw new BridgeError("invalid_state", "An order needs at least one line.");
        for (const row of items) {
          const item = this.requireItem(row.item_code as string);
          const after = (item.actual_qty as number) - (row.qty as number);
          if (after < 0 && !context.policy?.allow_negative_stock) {
            throw new BridgeError(
              "insufficient_stock",
              `Only ${item.actual_qty} of ${item.item_code} on hand; the order needs ${row.qty}.`,
            );
          }
        }
        for (const row of items) {
          const item = this.requireItem(row.item_code as string);
          item.actual_qty = (item.actual_qty as number) - (row.qty as number);
          this.insert("Stock Entry", {
            item_code: item.item_code,
            item_name: item.item_name,
            delta: -(row.qty as number),
            quantity_after: item.actual_qty,
            reason: `Delivered for ${order.name}`,
            sales_order: order.name,
            docstatus: 1,
            ...created,
          });
        }
        order.docstatus = 1;
        order.savingroup_confirmed_at = this.stamp();
        order.modified = this.stamp();
        const deliveryNote = this.insert("Delivery Note", {
          sales_order: order.name,
          docstatus: 1,
          ...created,
        });
        if (typeof order.savingroup_deal === "string") {
          const deal = this.find("CRM Deal", order.savingroup_deal);
          if (deal && deal.status !== "Lost") {
            deal.status = "Won";
            deal.closed_date = this.stamp().slice(0, 10);
            deal.modified = this.stamp();
          }
        }
        return {
          result: { sales_order: order, delivery_note: deliveryNote },
          external: ref(order),
        };
      }
      case "erp.order.cancel": {
        const order = this.require("Sales Order", text("id") ?? text("ref")!);
        if (order.docstatus === 1)
          throw new BridgeError(
            "invalid_state",
            "A confirmed order cannot be cancelled; reverse it with an adjustment.",
          );
        if (order.savingroup_approval_status === "cancelled")
          throw new BridgeError("invalid_state", "The order is already cancelled.");
        order.savingroup_approval_status = "cancelled";
        order.savingroup_cancelled_at = this.stamp();
        order.modified = this.stamp();
        return { result: { sales_order: order }, external: ref(order) };
      }
      case "erp.invoice.create_draft": {
        const order = this.require("Sales Order", text("orderId") ?? text("orderRef")!);
        if (order.docstatus !== 1)
          throw new BridgeError("invalid_state", "Confirm the order before invoicing it.");
        if (order.savingroup_invoice)
          throw new BridgeError(
            "conflict",
            `Order ${order.name} already has invoice ${order.savingroup_invoice}.`,
          );
        const items = (order.items as Record<string, unknown>[]).map((row, index) => ({
          ...row,
          name: `inv-row-${index + 1}`,
          sales_order: order.name,
        }));
        const total = order.total as number;
        const invoice = this.insert("Sales Invoice", {
          customer: order.customer,
          customer_name: order.customer_name,
          currency: null,
          items,
          total,
          grand_total: total,
          outstanding_amount: total,
          posting_date: this.stamp().slice(0, 10),
          due_date: text("dueAt")?.slice(0, 10) ?? null,
          savingroup_notes: text("notes") ?? null,
          ...created,
        });
        order.savingroup_invoice = invoice.name;
        return { result: { sales_invoice: invoice }, external: ref(invoice) };
      }
      case "erp.invoice.issue": {
        const invoice = this.require("Sales Invoice", text("id") ?? text("ref")!);
        if (context.policy?.invoice_approval_required && context.actor?.bot_id) {
          throw new BridgeError(
            "permission_denied",
            "A person must issue invoices while invoice approval is required for this workspace.",
          );
        }
        if (invoice.docstatus !== 0)
          throw new BridgeError("invalid_state", "Only a draft invoice can be issued.");
        invoice.docstatus = 1;
        if (text("dueAt")) invoice.due_date = text("dueAt")!.slice(0, 10);
        Object.assign(invoice, this.actorFields(context, "savingroup_approved_by"));
        invoice.modified = this.stamp();
        return { result: { sales_invoice: invoice }, external: ref(invoice) };
      }
      case "erp.invoice.record_payment": {
        const invoice = this.require("Sales Invoice", text("id") ?? text("ref")!);
        if (context.policy?.invoice_approval_required && context.actor?.bot_id) {
          throw new BridgeError(
            "permission_denied",
            "A person must record a payment on invoices while invoice approval is required for this workspace.",
          );
        }
        if (invoice.docstatus !== 1)
          throw new BridgeError("invalid_state", "Issue the invoice before recording a payment.");
        const amount = number("amount") ?? 0;
        const outstanding = invoice.outstanding_amount as number;
        if (amount > outstanding + 0.005)
          throw new BridgeError("invalid_input", `Only ${outstanding} is outstanding.`);
        invoice.outstanding_amount = Math.max(0, outstanding - amount);
        invoice.modified = this.stamp();
        const payment = this.insert("Payment Entry", {
          reference_name: invoice.name,
          paid_amount: amount,
          docstatus: 1,
          ...created,
        });
        return {
          result: { sales_invoice: invoice, payment_entry: payment },
          external: ref(invoice),
        };
      }
      case "admin.document.insert":
      case "admin.document.update":
      case "admin.document.submit":
      case "admin.document.cancel":
      case "admin.document.delete":
      case "admin.method.call":
        return this.runAdminAction(action, p, created);
      default:
        throw new BridgeError("unavailable", `Unknown bridge action ${action}.`);
    }
  }

  // --- site administration (the Operator's admin.* actions) -------------------

  private adminDoctype(value: unknown): string {
    const doctype = typeof value === "string" ? value.trim() : "";
    if (!doctype) throw new BridgeError("invalid_input", "doctype is required.");
    if (ADMIN_BLOCKED_DOCTYPES.has(doctype.toLowerCase())) {
      throw new BridgeError(
        "permission_denied",
        `${doctype} is not administrable through Savingroup.`,
      );
    }
    return doctype;
  }

  private runAdminAction(
    action: string,
    p: Record<string, unknown>,
    created: Record<string, unknown>,
  ): { result: Record<string, unknown>; external: { doctype: string; name: string } | null } {
    const documentResult = (doc: FakeDoc) => ({
      result: { doctype: doc.doctype, name: doc.name, document: doc },
      external: ref(doc),
    });
    if (action === "admin.method.call") {
      const method = String(p.method ?? "");
      const args = (p.args ?? {}) as Record<string, unknown>;
      if (ADMIN_BLOCKED_METHOD_PREFIXES.some((prefix) => method.startsWith(prefix))) {
        throw new BridgeError("permission_denied", `${method} is not callable through Savingroup.`);
      }
      if (method === "frappe.client.get_count") {
        return {
          result: { method, result: this.list(this.adminDoctype(args.doctype)).length },
          external: null,
        };
      }
      if (method === "frappe.ping") return { result: { method, result: "pong" }, external: null };
      if (method === "frappe.model.rename_doc.update_document_title") {
        const doctype = this.adminDoctype(args.doctype);
        const next = String(args.name ?? "");
        this.renameDoc(doctype, String(args.docname ?? ""), next);
        return { result: { method, result: next }, external: null };
      }
      throw new BridgeError("not_found", `Method ${method} not found.`);
    }
    const doctype = this.adminDoctype(p.doctype);
    const values = (p.values ?? {}) as Record<string, unknown>;
    const name = String(p.name ?? "");
    switch (action) {
      case "admin.document.insert": {
        const doc = this.insert(doctype, { ...values, ...created });
        if (p.submit) doc.docstatus = 1;
        return documentResult(doc);
      }
      case "admin.document.update": {
        const doc = this.require(doctype, name);
        Object.assign(doc, values, { modified: this.stamp() });
        return documentResult(doc);
      }
      case "admin.document.submit": {
        const doc = this.require(doctype, name);
        if (doc.docstatus !== 0) {
          throw new BridgeError("invalid_state", `${doctype} ${doc.name} is not a draft.`);
        }
        doc.docstatus = 1;
        doc.modified = this.stamp();
        return documentResult(doc);
      }
      case "admin.document.cancel": {
        const doc = this.require(doctype, name);
        if (doc.docstatus !== 1) {
          throw new BridgeError("invalid_state", `${doctype} ${doc.name} is not submitted.`);
        }
        doc.docstatus = 2;
        doc.modified = this.stamp();
        return documentResult(doc);
      }
      case "admin.document.delete": {
        const doc = this.require(doctype, name);
        this.table(doctype).delete(doc.name);
        return { result: { doctype, name: doc.name, deleted: true }, external: ref(doc) };
      }
      default:
        throw new BridgeError("unavailable", `Unknown admin action ${action}.`);
    }
  }

  private require(doctype: string, name: string): FakeDoc {
    const doc = this.find(doctype, name);
    if (!doc) throw new BridgeError("not_found", `${doctype} ${name} not found.`);
    return doc;
  }

  private requireItem(code: string): FakeDoc {
    return this.require("Item", code.toUpperCase());
  }

  private requireDraftOrder(name: string): FakeDoc {
    const order = this.require("Sales Order", name);
    if (order.docstatus !== 0)
      throw new BridgeError("invalid_state", "The order is already confirmed.");
    if (order.savingroup_approval_status === "cancelled")
      throw new BridgeError("invalid_state", "The order is cancelled.");
    return order;
  }

  private addLine(order: FakeDoc, line: Record<string, unknown>): void {
    const item = this.requireItem(String(line.sku ?? line.productId));
    const qty = Number(line.quantity);
    const rate =
      typeof line.unitPrice === "number" ? line.unitPrice : (item.price_list_rate as number);
    const items = order.items as Record<string, unknown>[];
    items.push({
      name: `${order.name}-row-${items.length + 1}-${Math.random().toString(36).slice(2, 6)}`,
      idx: items.length + 1,
      item_code: item.item_code,
      item_name: item.item_name,
      qty,
      rate,
      amount: Math.round(qty * rate * 100) / 100,
    });
    this.retotal(order);
  }

  private retotal(order: FakeDoc): void {
    const items = order.items as Record<string, unknown>[];
    items.forEach((row, index) => {
      row.idx = index + 1;
    });
    order.total =
      Math.round(items.reduce((sum, row) => sum + (row.amount as number), 0) * 100) / 100;
    order.modified = this.stamp();
  }

  // --- composite reads --------------------------------------------------------

  private query(kind: string, params: Record<string, unknown>): unknown {
    const limit = typeof params.limit === "number" ? params.limit : 50;
    switch (kind) {
      case "products": {
        let rows = this.list("Item");
        if (typeof params.id === "string") rows = rows.filter((row) => row.name === params.id);
        if (typeof params.sku === "string")
          rows = rows.filter((row) => row.item_code === String(params.sku).toUpperCase());
        if (typeof params.q === "string") {
          const q = params.q.toLowerCase();
          rows = rows.filter(
            (row) =>
              String(row.item_code).toLowerCase().includes(q) ||
              String(row.item_name).toLowerCase().includes(q),
          );
        }
        if (!params.include_inactive) rows = rows.filter((row) => !row.disabled);
        return rows.slice(0, limit);
      }
      case "inventory": {
        const code = String(params.item_code ?? "").toUpperCase();
        return this.find("Item", code) ?? null;
      }
      case "adjustments": {
        let rows = this.list("Stock Entry");
        if (typeof params.item_code === "string")
          rows = rows.filter((row) => row.item_code === params.item_code);
        return rows.reverse().slice(0, limit);
      }
      case "order":
        return this.find("Sales Order", String(params.name)) ?? null;
      case "orders": {
        let rows = this.list("Sales Order");
        if (typeof params.status === "string")
          rows = rows.filter((row) => orderStatus(row) === params.status);
        if (typeof params.customer === "string")
          rows = rows.filter((row) => row.customer === params.customer);
        if (typeof params.deal === "string")
          rows = rows.filter((row) => row.savingroup_deal === params.deal);
        if (typeof params.q === "string") {
          const q = params.q.toLowerCase();
          rows = rows.filter(
            (row) =>
              row.name.toLowerCase().includes(q) || String(row.customer).toLowerCase().includes(q),
          );
        }
        return rows.reverse().slice(0, limit);
      }
      case "invoice":
        return this.find("Sales Invoice", String(params.name)) ?? null;
      case "invoices": {
        let rows = this.list("Sales Invoice");
        if (typeof params.status === "string")
          rows = rows.filter((row) => invoiceStatus(row) === params.status);
        if (typeof params.customer === "string")
          rows = rows.filter((row) => row.customer === params.customer);
        return rows.reverse().slice(0, limit);
      }
      case "crm_overview": {
        const leads = this.list("CRM Lead");
        const deals = this.list("CRM Deal");
        const openDeals = deals.filter((d) => d.status !== "Won" && d.status !== "Lost");
        return {
          companies: this.list("CRM Organization").length,
          contacts: this.list("Contact").length,
          open_leads: leads.filter((l) => !l.converted && l.status !== "Unqualified").length,
          open_deals: openDeals.length,
          open_deal_amount: openDeals.reduce((s, d) => s + Number(d.deal_value ?? 0), 0),
          won_deal_amount: deals
            .filter((d) => d.status === "Won")
            .reduce((s, d) => s + Number(d.deal_value ?? 0), 0),
          open_follow_ups: this.list("CRM Task").filter((t) => t.status !== "Done" && t.due_date)
            .length,
        };
      }
      case "erp_overview": {
        const items = this.list("Item").filter((i) => !i.disabled);
        const orders = this.list("Sales Order");
        const invoices = this.list("Sales Invoice");
        const confirmed = orders.filter((o) => o.docstatus === 1);
        return {
          products: items.length,
          low_stock_products: items.filter((i) => Number(i.actual_qty) <= 5).length,
          draft_orders: orders.filter((o) => orderStatus(o) === "draft").length,
          pending_approval_orders: orders.filter((o) => orderStatus(o) === "pending_approval")
            .length,
          confirmed_orders: confirmed.length,
          confirmed_order_amount: confirmed.reduce((s, o) => s + Number(o.total), 0),
          draft_invoices: invoices.filter((i) => i.docstatus === 0).length,
          outstanding_invoice_amount: invoices
            .filter((i) => i.docstatus === 1)
            .reduce((s, i) => s + Number(i.outstanding_amount), 0),
        };
      }
      case "admin_doctypes": {
        const q = typeof params.q === "string" ? params.q.toLowerCase() : "";
        return [...new Set([...ADMIN_KNOWN_DOCTYPES, ...this.docs.keys()])]
          .filter((name) => !ADMIN_BLOCKED_DOCTYPES.has(name.toLowerCase()))
          .filter((name) => !q || name.toLowerCase().includes(q))
          .sort()
          .slice(0, limit)
          .map((name) => ({
            name,
            module: "Core",
            isSubmittable: SUBMITTABLE_DOCTYPES.has(name),
            isSingle: false,
            isChild: false,
            custom: false,
          }));
      }
      case "admin_doctype": {
        const doctype = this.adminDoctype(params.doctype);
        const sample = this.list(doctype)[0] ?? {};
        const hidden = new Set(["name", "doctype", "docstatus", "creation", "modified"]);
        return {
          doctype,
          module: "Core",
          isSubmittable: SUBMITTABLE_DOCTYPES.has(doctype),
          isSingle: false,
          naming: null,
          fields: Object.keys(sample)
            .filter((key) => !hidden.has(key))
            .map((fieldname) => ({
              fieldname,
              label: fieldname,
              fieldtype: "Data",
              options: null,
              required: false,
              readOnly: false,
              default: null,
            })),
          permissions: {
            read: true,
            write: true,
            create: true,
            delete: true,
            submit: true,
            cancel: true,
          },
          workflow: null,
        };
      }
      case "admin_documents": {
        const doctype = this.adminDoctype(params.doctype);
        const filters = params.filters;
        let rows = this.list(doctype);
        if (Array.isArray(filters)) {
          rows = rows.filter((row) => (filters as Filter[]).every((f) => matches(row, f)));
        } else if (filters && typeof filters === "object") {
          const wanted = Object.entries(filters as Record<string, unknown>);
          rows = rows.filter((row) => wanted.every(([key, value]) => row[key] === value));
        }
        const offset = typeof params.offset === "number" ? params.offset : 0;
        return rows.slice(offset, offset + limit);
      }
      case "admin_document":
        return this.require(this.adminDoctype(params.doctype), String(params.name ?? ""));
      default:
        throw new BridgeError("invalid_input", `Unknown query ${kind}.`);
    }
  }
}

class NotFound extends Error {}

function ref(doc: FakeDoc): { doctype: string; name: string } {
  return { doctype: doc.doctype, name: doc.name };
}

function seriesFor(doctype: string): string {
  const year = new Date().getUTCFullYear();
  switch (doctype) {
    case "CRM Lead":
      return `CRM-LEAD-${year}`;
    case "CRM Deal":
      return `CRM-DEAL-${year}`;
    case "CRM Task":
      return `CRM-TASK-${year}`;
    case "Sales Order":
      return `SAL-ORD-${year}`;
    case "Sales Invoice":
      return `ACC-SINV-${year}`;
    case "Delivery Note":
      return `MAT-DN-${year}`;
    case "Stock Entry":
      return `MAT-STE-${year}`;
    case "Payment Entry":
      return `ACC-PAY-${year}`;
    case "Contact":
      return "CONTACT";
    default:
      return doctype.toUpperCase().replaceAll(" ", "-");
  }
}

function dealStatus(stage: string): string {
  return (
    {
      qualification: "Qualification",
      proposal: "Proposal/Quotation",
      negotiation: "Negotiation",
      won: "Won",
      lost: "Lost",
    }[stage] ?? "Qualification"
  );
}

function orderStatus(order: FakeDoc): string {
  if (order.docstatus === 2) return "cancelled";
  if (order.docstatus === 1) return "confirmed";
  const approval = order.savingroup_approval_status;
  return approval === "pending_approval" || approval === "approved" || approval === "cancelled"
    ? (approval as string)
    : "draft";
}

function invoiceStatus(invoice: FakeDoc): string {
  if (invoice.docstatus !== 1) return "draft";
  return Number(invoice.outstanding_amount) <= 0.005 ? "paid" : "issued";
}

function stripChildren(doc: FakeDoc): FakeDoc {
  const out: FakeDoc = { ...doc };
  for (const [key, value] of Object.entries(out)) if (Array.isArray(value)) delete out[key];
  return out;
}

function matches(doc: FakeDoc, filter: Filter): boolean {
  const [field, operator, value] =
    filter.length === 4 ? [filter[1], filter[2], filter[3]] : [filter[0], filter[1], filter[2]];
  const actual = doc[field];
  switch (operator) {
    case "=":
      return actual === value || String(actual ?? "") === String(value ?? "");
    case "!=":
      return String(actual ?? "") !== String(value ?? "");
    case "in":
      return Array.isArray(value) && value.map(String).includes(String(actual ?? ""));
    case "like": {
      const needle = String(value).replaceAll("%", "").toLowerCase();
      return String(actual ?? "")
        .toLowerCase()
        .includes(needle);
    }
    default:
      return false;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function frappeError(
  status: number,
  excType: string,
  message: string,
): { status: number; body: string } {
  return {
    status,
    body: JSON.stringify({
      exc_type: excType,
      exception: `${excType}: ${message}`,
      _server_messages: JSON.stringify([JSON.stringify({ message, title: "Message" })]),
    }),
  };
}
