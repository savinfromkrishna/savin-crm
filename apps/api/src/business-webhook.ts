import type { BusinessEvents, FrappeGateway } from "@savingroup/business";
import {
  BUSINESS_WEBHOOK_MAX_BODY_BYTES,
  BUSINESS_WEBHOOK_SIGNATURE_HEADER,
  BUSINESS_WEBHOOK_TIMESTAMP_HEADER,
  ingestBusinessWebhook,
  parseBusinessWebhookBody,
  verifyBusinessWebhookSignature,
} from "@savingroup/business";
import type { PrismaClient } from "@savingroup/db";
import { getLogger } from "@savingroup/logging";
import type { Hono } from "hono";
import { readBoundedBody } from "./http-body.js";

/**
 * Signed event deliveries from an organization's business site. The path names
 * the environment; the signature proves the site; the delivery id guards
 * against replays. Unknown or disabled environments get the same 404 so the
 * route leaks nothing about which ids exist.
 */
export function mountBusinessWebhookRoutes(
  app: Hono,
  deps: { prisma: PrismaClient; gateway: FrappeGateway; live?: BusinessEvents },
): void {
  app.post("/webhooks/business/frappe/:environmentId", async (c) => {
    const raw = await readBoundedBody(c.req.raw, BUSINESS_WEBHOOK_MAX_BODY_BYTES);
    if (raw === null) return c.json({ error: "body too large" }, 413);
    const environment = await deps.gateway.environments.getById(c.req.param("environmentId"));
    if (!environment || environment.status === "disabled") {
      return c.json({ error: "unknown environment" }, 404);
    }
    const secret = await deps.gateway.environments.openWebhookSecret(environment).catch(() => null);
    if (!secret) return c.json({ error: "unknown environment" }, 404);
    const verified = verifyBusinessWebhookSignature({
      secret,
      timestamp: c.req.header(BUSINESS_WEBHOOK_TIMESTAMP_HEADER),
      signature: c.req.header(BUSINESS_WEBHOOK_SIGNATURE_HEADER),
      rawBody: raw,
    });
    if (!verified.ok) return c.json({ error: verified.reason }, 401);
    const body = parseBusinessWebhookBody(raw);
    if (!body) return c.json({ error: "malformed delivery" }, 400);
    try {
      const outcome = await ingestBusinessWebhook(
        { prisma: deps.prisma, ledger: deps.gateway.ledger, live: deps.live },
        environment,
        body,
      );
      return c.json(outcome, 200);
    } catch (error) {
      getLogger().error("business webhook ingest failed", error);
      return c.json({ error: "ingest failed" }, 500);
    }
  });
}
