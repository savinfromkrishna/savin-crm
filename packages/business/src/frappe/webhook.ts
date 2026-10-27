import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { BusinessEventType, BusinessRecordType } from "@savingroup/contracts";
import { BUSINESS_EVENT_TYPES, BUSINESS_EXTERNAL_EVENT_TYPES } from "@savingroup/contracts";
import type { PrismaClient } from "@savingroup/db";
import type { BusinessEvents } from "../live.js";
import { publishPendingBusinessEvents } from "../live.js";
import type { OperationLedger } from "./ledger.js";

/**
 * Signed event deliveries from a business environment. The bridge app posts
 * one JSON body per document event; Savingroup verifies the signature and the
 * timestamp, stores the delivery id before acting (replay protection), settles
 * any operation the event confirms, and republishes a live change signal.
 */

export const BUSINESS_WEBHOOK_SIGNATURE_HEADER = "x-savingroup-signature";
export const BUSINESS_WEBHOOK_TIMESTAMP_HEADER = "x-savingroup-timestamp";
export const BUSINESS_WEBHOOK_DELIVERY_HEADER = "x-savingroup-delivery";
export const BUSINESS_WEBHOOK_MAX_SKEW_SECONDS = 300;
export const BUSINESS_WEBHOOK_MAX_BODY_BYTES = 256 * 1024;

export function signBusinessWebhook(secret: string, timestamp: string, rawBody: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
}

export function verifyBusinessWebhookSignature(input: {
  secret: string;
  timestamp: string | undefined;
  signature: string | undefined;
  rawBody: string;
  now?: Date;
}): { ok: true } | { ok: false; reason: "missing" | "stale" | "mismatch" } {
  if (!input.timestamp || !input.signature) return { ok: false, reason: "missing" };
  const sent = Number(input.timestamp);
  if (!Number.isFinite(sent)) return { ok: false, reason: "missing" };
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - sent) > BUSINESS_WEBHOOK_MAX_SKEW_SECONDS) {
    return { ok: false, reason: "stale" };
  }
  const expected = signBusinessWebhook(input.secret, input.timestamp, input.rawBody);
  const a = Buffer.from(input.signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "mismatch" };
  return { ok: true };
}

export interface BusinessWebhookDeliveryBody {
  delivery_id: string;
  type: string;
  doctype: string;
  name: string;
  operation_id?: string | null;
  occurred_at?: string;
  payload?: Record<string, unknown>;
}

export function parseBusinessWebhookBody(raw: string): BusinessWebhookDeliveryBody | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const body = parsed as Record<string, unknown>;
  const text = (key: string) => (typeof body[key] === "string" ? (body[key] as string) : "");
  if (!text("delivery_id") || !text("type") || !text("doctype") || !text("name")) return null;
  return {
    delivery_id: text("delivery_id").slice(0, 120),
    type: text("type").slice(0, 80),
    doctype: text("doctype").slice(0, 80),
    name: text("name").slice(0, 200),
    operation_id: typeof body.operation_id === "string" ? body.operation_id : null,
    occurred_at: text("occurred_at") || undefined,
    payload:
      body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
        ? (body.payload as Record<string, unknown>)
        : {},
  };
}

const RECORD_TYPE_BY_DOCTYPE: Record<string, BusinessRecordType> = {
  "CRM Lead": "lead",
  "CRM Deal": "deal",
  "CRM Organization": "company",
  Customer: "company",
  Contact: "contact",
  "CRM Task": "activity",
  Item: "product",
  Bin: "product",
  "Stock Ledger Entry": "product",
  "Stock Entry": "product",
  Quotation: "order",
  "Sales Order": "order",
  "Delivery Note": "order",
  "Sales Invoice": "invoice",
  "Payment Entry": "invoice",
};

export function recordTypeForDoctype(doctype: string): BusinessRecordType | undefined {
  return RECORD_TYPE_BY_DOCTYPE[doctype];
}

const knownEventTypes: ReadonlySet<string> = new Set([
  ...BUSINESS_EVENT_TYPES,
  ...BUSINESS_EXTERNAL_EVENT_TYPES,
]);

export function isKnownBusinessEventType(type: string): type is BusinessEventType {
  return knownEventTypes.has(type);
}

export interface IngestDeps {
  prisma: PrismaClient;
  ledger: OperationLedger;
  live?: BusinessEvents;
}

export type IngestOutcome =
  | { status: "stored"; spaces: number; settledOperation: boolean }
  | { status: "duplicate" }
  | { status: "ignored"; reason: "unknown_type" | "unknown_doctype" };

/**
 * Persist first, act second. The unique (environment, delivery id) index is
 * the replay guard; a second delivery of the same id does nothing.
 */
export async function ingestBusinessWebhook(
  deps: IngestDeps,
  environment: { id: string; organizationId: string },
  body: BusinessWebhookDeliveryBody,
): Promise<IngestOutcome> {
  if (!isKnownBusinessEventType(body.type)) return { status: "ignored", reason: "unknown_type" };
  const recordType = recordTypeForDoctype(body.doctype);
  if (!recordType) return { status: "ignored", reason: "unknown_doctype" };
  try {
    await deps.prisma.businessWebhookDelivery.create({
      data: { environmentId: environment.id, deliveryId: body.delivery_id, eventType: body.type },
    });
  } catch (error) {
    if ((error as { code?: unknown }).code === "P2002") return { status: "duplicate" };
    throw error;
  }

  let settledOperation = false;
  if (body.operation_id) {
    const operation = await deps.ledger.get(body.operation_id);
    if (
      operation &&
      operation.environmentId === environment.id &&
      (operation.status === "outcome_unknown" || operation.status === "executing")
    ) {
      await deps.ledger.update(operation.id, {
        status: "succeeded",
        externalDoctype: body.doctype,
        externalName: body.name,
        completedAt: new Date(),
        errorCode: null,
        errorMessage: null,
      });
      settledOperation = true;
    }
  }

  const spaces = await deps.prisma.space.findMany({
    where: { organizationId: environment.organizationId, deletingAt: null },
    select: { id: true },
  });
  for (const space of spaces) {
    await deps.prisma.businessEvent.create({
      data: {
        spaceId: space.id,
        type: body.type,
        recordType,
        recordId: body.name,
        payload: {
          source: "frappe",
          doctype: body.doctype,
          deliveryId: body.delivery_id,
          operationId: body.operation_id ?? null,
          ...(body.payload ?? {}),
        },
      },
    });
  }
  for (const space of spaces) {
    await publishPendingBusinessEvents(deps.prisma, deps.live, space.id).catch(() => undefined);
  }
  return { status: "stored", spaces: spaces.length, settledOperation };
}

/** Build a signed delivery the way the bridge does; used by tests and the fake site. */
export function buildSignedBusinessDelivery(
  secret: string,
  body: Omit<BusinessWebhookDeliveryBody, "delivery_id"> & { delivery_id?: string },
  now: Date = new Date(),
): { headers: Record<string, string>; rawBody: string } {
  const delivery = { delivery_id: body.delivery_id ?? randomUUID(), ...body };
  const rawBody = JSON.stringify(delivery);
  const timestamp = String(Math.floor(now.getTime() / 1000));
  return {
    rawBody,
    headers: {
      "content-type": "application/json",
      [BUSINESS_WEBHOOK_DELIVERY_HEADER]: delivery.delivery_id,
      [BUSINESS_WEBHOOK_TIMESTAMP_HEADER]: timestamp,
      [BUSINESS_WEBHOOK_SIGNATURE_HEADER]: signBusinessWebhook(secret, timestamp, rawBody),
    },
  };
}
