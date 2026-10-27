import type { Actor, Bot, BusinessActionId } from "@savingroup/contracts";
import {
  BUSINESS_ACTION_IDS,
  BUSINESS_CONSEQUENTIAL_TOOL_NAMES,
  BUSINESS_TEAM_SPAWN_KEYS,
  BUSINESS_TOOL_NAMES,
  businessToolName,
  isBusinessToolName,
} from "@savingroup/contracts";
import type { PrismaClient } from "@savingroup/db";
import { createRepos } from "@savingroup/db";

/**
 * The business team: role-scoped digital employees for CRM OS and ERP OS. Each
 * role's allowed set is the complement of its disabled list, so the server
 * enforces the role without trusting the prompt. The same team works on the
 * prototype tables and on a connected ERPNext + Frappe CRM site.
 */
export interface BusinessTeamRole {
  spawnKey: string;
  name: string;
  title: string;
  description: string;
  instructions: string;
  allowedActions: readonly BusinessActionId[];
}

const CRM_READS: readonly BusinessActionId[] = [
  "crm.company.search",
  "crm.company.find_duplicates",
  "crm.contact.search",
  "crm.contact.find_duplicates",
  "crm.lead.search",
  "crm.deal.search",
  "crm.activity.list",
];
const ERP_READS: readonly BusinessActionId[] = [
  "erp.product.search",
  "erp.inventory.check",
  "erp.order.get",
  "erp.order.search",
  "erp.invoice.get",
  "erp.invoice.search",
];

const GROUND_RULES = [
  "Records live in the company's CRM and ERP, which you reach only through the crm_* and erp_* tools.",
  "Every id you quote comes from a tool result (for example CRM-LEAD-2026-00012 or SAL-ORD-2026-00003); never invent one.",
  "Search before you create so you do not duplicate a company, contact, product, lead or order.",
  "When a required detail is missing or the request is ambiguous, ask one short question instead of guessing.",
  "Report back briefly: what changed, the ids involved, and anything that needs a person's decision.",
];

function instructions(role: readonly string[]): string {
  return [...role, ...GROUND_RULES].join(" ");
}

export const BUSINESS_TEAM: readonly BusinessTeamRole[] = [
  {
    spawnKey: BUSINESS_TEAM_SPAWN_KEYS.sales,
    name: "Sales Executive",
    title: "Sales",
    description: "Owns the pipeline: companies, contacts, leads, deals and the activity log.",
    instructions: instructions([
      "You are the Sales Executive. You own the pipeline: companies, contacts, leads, deals and the activity log.",
      "Lead statuses go new → contacted → qualified or unqualified; convert a qualified lead with crm_lead_convert, which returns the deal.",
      "Move deals through qualification, proposal and negotiation. Mark a deal lost only when the customer says so; a deal becomes won when Operations confirms its order.",
      "Check stock with erp_inventory_check before promising quantities or dates.",
      "Log every customer touch as an activity (call, email, meeting, note or follow_up) on the lead or deal.",
      "You do not create orders, adjust stock or touch invoices: hand orders and stock to Operations and invoices and payments to Finance, and say so.",
    ]),
    allowedActions: [
      ...CRM_READS,
      ...ERP_READS,
      "crm.company.create",
      "crm.company.update",
      "crm.contact.create",
      "crm.contact.update",
      "crm.lead.create",
      "crm.lead.update",
      "crm.lead.assign",
      "crm.lead.qualify",
      "crm.lead.convert",
      "crm.deal.create",
      "crm.deal.update",
      "crm.deal.update_stage",
      "crm.activity.create",
      "crm.activity.complete",
    ],
  },
  {
    spawnKey: BUSINESS_TEAM_SPAWN_KEYS.operations,
    name: "Operations",
    title: "Operations",
    description: "Owns the catalog, stock and sales orders.",
    instructions: instructions([
      "You are Operations. You own the product catalog, stock and sales orders.",
      "A product needs a unique SKU, a name and a unit price; on a GST site it also needs an HSN or SAC code of at least six digits, so ask for the code rather than guessing it.",
      "Order flow: erp_order_create_draft for a company or its deal, add or remove lines, erp_order_request_approval, the owner approves, then erp_order_confirm. Confirming re-validates and deducts stock and marks a linked deal won.",
      "Confirming or cancelling an order and adjusting stock pause for the owner's approval; wait for the answer and never work around it.",
      "You do not issue invoices or record payments (Finance does), and you do not create leads or deals (Sales does).",
    ]),
    allowedActions: [
      ...CRM_READS,
      ...ERP_READS,
      "erp.product.create",
      "erp.product.update",
      "erp.inventory.adjust",
      "erp.order.create_draft",
      "erp.order.add_item",
      "erp.order.remove_item",
      "erp.order.request_approval",
      "erp.order.confirm",
      "erp.order.cancel",
      "crm.activity.create",
    ],
  },
  {
    spawnKey: BUSINESS_TEAM_SPAWN_KEYS.finance,
    name: "Finance",
    title: "Finance",
    description: "Owns invoices and payments.",
    instructions: instructions([
      "You are Finance. You own invoices and payments.",
      "Create a draft invoice from a confirmed order with erp_invoice_create_draft, issue it with erp_invoice_issue and record money received with erp_invoice_record_payment. Issuing and payments pause for the owner's approval; wait for the answer.",
      "Report totals, paid and outstanding amounts exactly as the tools return them.",
      "You do not change orders, stock, leads or deals: ask Operations or Sales.",
    ]),
    allowedActions: [
      ...CRM_READS,
      ...ERP_READS,
      "erp.invoice.create_draft",
      "erp.invoice.issue",
      "erp.invoice.record_payment",
      "crm.activity.create",
    ],
  },
  {
    spawnKey: BUSINESS_TEAM_SPAWN_KEYS.analyst,
    name: "Business Analyst",
    title: "Reporting",
    description:
      "Answers questions about the pipeline, stock, orders and invoices; changes nothing.",
    instructions: instructions([
      "You are the Business Analyst. You only read: search companies, contacts, leads, deals, activities, products, stock, orders and invoices, and answer with short summaries such as pipeline by stage, open leads, stock positions or unpaid invoices.",
      "You never change a record. When a change is needed, name the teammate who owns it: Sales for leads and deals, Operations for products, stock and orders, Finance for invoices and payments.",
    ]),
    allowedActions: [...CRM_READS, ...ERP_READS],
  },
  {
    spawnKey: BUSINESS_TEAM_SPAWN_KEYS.steward,
    name: "CRM Data Steward",
    title: "Data Hygiene",
    description:
      "Audits companies, contacts, and leads for duplicates, missing fields, and stale follow-ups.",
    instructions: instructions([
      "You are the CRM Data Steward. You keep the company's CRM clean, enriched, and free of duplicates.",
      "Use crm_company_find_duplicates and crm_contact_find_duplicates to find duplicate records and report each match group with its reason.",
      "Standardize domains, phone numbers, titles, and lead sources using crm_company_update, crm_contact_update, and crm_lead_update.",
      "Log hygiene notes or follow-up tasks with crm_activity_create and mark completed cleanup tasks done with crm_activity_complete.",
    ]),
    allowedActions: [
      ...CRM_READS,
      "crm.company.update",
      "crm.contact.update",
      "crm.lead.update",
      "crm.activity.create",
      "crm.activity.complete",
    ],
  },
];

/** The Operator decides within policy instead of pausing for a person. */
const OPERATOR_GROUND_RULES = GROUND_RULES.filter(
  (rule) => !rule.startsWith("When a required detail is missing"),
);

/**
 * The Operator: runs CRM OS and ERP OS end to end. Every business tool is
 * allowed, including site administration, so the server-side role is "no
 * business tool disabled"; the autonomy grant decides whether its consequential
 * tools pause. Not part of the default team: created with `operator` or
 * `autonomous`.
 */
export const BUSINESS_OPERATOR_ROLE: BusinessTeamRole = {
  spawnKey: BUSINESS_TEAM_SPAWN_KEYS.operator,
  name: "Operator",
  title: "ERP & CRM operator",
  description:
    "Runs CRM OS and ERP OS end to end: sets up and automates the business site and directs the team.",
  instructions: [
    "You are the Operator. You run the company's CRM and ERP end to end with as little human involvement as possible: you configure the business site, keep its masters, workflow rules and automations in shape, and direct the Sales Executive, Operations, Finance and Business Analyst bots.",
    "Setup and administration go through the admin_* tools. Call admin_doctype_describe before your first write to a doctype and admin_document_list to see what already exists. Use admin_document_insert and admin_document_update for masters (Company settings, Fiscal Year, Warehouse, Price List, Item Group, Customer Group, Territory, UOM, tax templates, Payment Terms), workflow rules (Workflow with its states and transitions), automations (Notification, Assignment Rule, Auto Email Report, Auto Repeat, Webhook) and customisation (Custom Field, Property Setter, Print Format, Email Template). admin_method_call reaches whitelisted site methods when no document covers the need.",
    "Delegate day-to-day work: send teammates concrete requests with message_bot, give specialists you create with spawn_bot precise instructions and a first task, and use schedule_create for recurring jobs of your own.",
    "Decide within policy instead of pausing: when a detail is missing, take the standard ERP default, say which one you chose, and move on. Involve the person only when an action is irreversible and the intent is genuinely unclear.",
    "Prefer reversible changes: disable rather than delete, cancel rather than remove, and never touch users, roles, permissions, credentials or scripts.",
    "Work in small verified steps: read back what you changed and report the document names involved.",
    ...OPERATOR_GROUND_RULES,
  ].join(" "),
  allowedActions: [...BUSINESS_ACTION_IDS],
};

/** Disabled list = every business tool the role is not allowed to run. */
export function disabledToolsForRole(allowed: readonly BusinessActionId[]): string[] {
  const allowedTools = new Set(allowed.map((id) => businessToolName(id)));
  return BUSINESS_TOOL_NAMES.filter((name) => !allowedTools.has(name));
}

export interface CreateBusinessTeamOptions {
  /** Refresh the role definition of bots that already exist. */
  sync?: boolean;
  /** Also create the Operator, who holds every tool and directs the team. */
  operator?: boolean;
  /** Create the Operator and stop the consequential tools pausing for the owner. */
  autonomous?: boolean;
  /** With `autonomous`, also let site documents be deleted unattended. */
  allowDelete?: boolean;
}

export interface BusinessAutonomyGrant {
  /** Tools that now run without a pause in the space. */
  allowed: string[];
  /** Consequential tools that still pause for the owner. */
  stillGated: string[];
}

export interface CreateBusinessTeamResult {
  bots: Bot[];
  /** Bot names created by this call. */
  created: string[];
  /** Bot names whose role definition was refreshed (`sync`). */
  updated: string[];
  /** Present when the call granted autonomy. */
  autonomy?: BusinessAutonomyGrant;
}

/**
 * Tools the autonomy grant lets run unattended: every consequential business
 * tool, plus archiving a bot the Operator created. Deleting site documents is
 * the one irreversible action that stays with a person unless asked for.
 */
export function businessAutonomyToolNames(options: { allowDelete?: boolean }): string[] {
  const business = BUSINESS_CONSEQUENTIAL_TOOL_NAMES.filter(
    (name) => options.allowDelete || name !== "admin_document_delete",
  );
  return [...business, "archive_bot"];
}

/**
 * The single human involvement: the owner's pause rules for those tools are
 * replaced by always-allow rules in the space. Rules beat the default path, so
 * nothing else (Auto Review included) asks again. Reversible by removing the
 * rules in the space's approval settings.
 */
export async function grantBusinessAutonomy(
  prisma: PrismaClient,
  actor: Actor,
  options: { allowDelete?: boolean } = {},
): Promise<BusinessAutonomyGrant> {
  const allowed = businessAutonomyToolNames(options);
  await prisma.actionApprovalRule.deleteMany({
    where: {
      spaceId: actor.spaceId,
      createdByUserId: actor.userId,
      effect: "require_approval",
      matchKind: "tool",
      matchValue: { in: allowed },
    },
  });
  await prisma.actionApprovalRule.createMany({
    data: allowed.map((toolName) => ({
      spaceId: actor.spaceId,
      createdByUserId: actor.userId,
      effect: "always_allow",
      matchKind: "tool",
      matchValue: toolName,
    })),
    skipDuplicates: true,
  });
  const allowedSet = new Set(allowed);
  return {
    allowed,
    stillGated: BUSINESS_CONSEQUENTIAL_TOOL_NAMES.filter((name) => !allowedSet.has(name)),
  };
}

/**
 * Creates the team in the actor's space and the owner's approval policy: every
 * consequential business tool pauses for the owner, using the existing action
 * approval rules, unless `autonomous` lifts that for the space. Idempotent per
 * space through each bot's spawn key; existing bots keep their instructions
 * unless `sync` asks to refresh the role.
 */
export async function createBusinessTeam(
  prisma: PrismaClient,
  actor: Actor,
  options: CreateBusinessTeamOptions = {},
): Promise<CreateBusinessTeamResult> {
  const repos = createRepos(prisma);
  await prisma.actionApprovalRule.createMany({
    data: BUSINESS_CONSEQUENTIAL_TOOL_NAMES.map((toolName) => ({
      spaceId: actor.spaceId,
      createdByUserId: actor.userId,
      effect: "require_approval",
      matchKind: "tool",
      matchValue: toolName,
    })),
    skipDuplicates: true,
  });
  const roles =
    options.operator || options.autonomous
      ? [...BUSINESS_TEAM, BUSINESS_OPERATOR_ROLE]
      : BUSINESS_TEAM;
  const result: CreateBusinessTeamResult = { bots: [], created: [], updated: [] };
  for (const role of roles) {
    const definition = {
      title: role.title,
      description: role.description,
      instructions: role.instructions,
      disabledBuiltinTools: disabledToolsForRole(role.allowedActions),
    };
    const existing = await prisma.bot.findUnique({
      where: { spaceId_spawnKey: { spaceId: actor.spaceId, spawnKey: role.spawnKey } },
      select: { id: true, disabledBuiltinTools: true },
    });
    if (existing && options.sync) {
      // The role owns the business tools; the owner's other switches (computer, web, ...) stay.
      const ownerDisabled = existing.disabledBuiltinTools.filter(
        (name) => !isBusinessToolName(name),
      );
      await prisma.bot.update({
        where: { id: existing.id },
        data: {
          ...definition,
          disabledBuiltinTools: [...ownerDisabled, ...definition.disabledBuiltinTools],
        },
      });
      result.updated.push(role.name);
    } else if (!existing) {
      result.created.push(role.name);
    }
    result.bots.push(
      await repos.createBot(actor, {
        name: role.name,
        notifyOnFinish: true,
        spawnKey: role.spawnKey,
        ...definition,
      }),
    );
  }
  if (options.autonomous) {
    result.autonomy = await grantBusinessAutonomy(prisma, actor, {
      allowDelete: options.allowDelete,
    });
  }
  return result;
}
