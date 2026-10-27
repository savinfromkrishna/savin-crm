import type { BusinessEnvironmentStatus } from "@savingroup/contracts";
import type { BusinessBlueprint } from "./blueprints.js";

/** An active environment with its credentials, resolved for one request. */
export interface ResolvedEnvironment {
  id: string;
  organizationId: string;
  siteUrl: string;
  siteName: string;
  companyName: string;
  companyAbbr: string;
  country: string;
  currency: string;
  timezone: string;
  blueprint: BusinessBlueprint;
  status: BusinessEnvironmentStatus;
  credentials: { apiKey: string; apiSecret: string };
}

/** Whitelisted methods of the `savingroup_business_bridge` Frappe app. */
export const BRIDGE_METHODS = {
  ping: "savingroup_business_bridge.api.ping",
  execute: "savingroup_business_bridge.api.execute",
  getOperation: "savingroup_business_bridge.api.get_operation",
  query: "savingroup_business_bridge.api.query",
  configureWebhook: "savingroup_business_bridge.api.configure_webhook",
} as const;

export const BRIDGE_PROTOCOL_VERSION = 1;

export interface BridgePing {
  ok: boolean;
  site: string;
  user: string;
  /** Installed app name to version. */
  apps: Record<string, string>;
  bridge_version: string;
  protocol_version: number;
  companies: string[];
  /** True when the gateway user holds the site's administrative roles (admin.* actions). */
  admin?: boolean;
}

export interface BridgeExternalRef {
  doctype: string;
  name: string;
}

export interface BridgeExecuteResult {
  status: "succeeded";
  /** True when the bridge found the operation already committed and returned it. */
  replayed: boolean;
  result: Record<string, unknown>;
  external?: BridgeExternalRef | null;
}

export interface BridgeOperationLookup {
  found: boolean;
  status?: "succeeded" | "failed";
  result?: Record<string, unknown>;
  external?: BridgeExternalRef | null;
  error?: { code?: string; message?: string } | null;
}

/** Everything the bridge needs to act for the organization without site config. */
export interface BridgeCallContext {
  company: string;
  company_abbr: string;
  currency: string;
  defaults: {
    warehouse: string;
    item_group: string;
    uom: string;
    customer_group: string;
    territory: string;
    price_list: string;
  };
  policy: {
    allow_negative_stock: boolean;
    order_approval_required: boolean;
    invoice_approval_required: boolean;
  };
  actor: { user_id: string | null; bot_id: string | null; run_id: string | null };
}
