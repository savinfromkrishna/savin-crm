import * as z from "zod";
import {
  BUSINESS_NAME_MAX_LENGTH,
  BUSINESS_SEARCH_MAX_LENGTH,
  BUSINESS_SHORT_TEXT_MAX_LENGTH,
  BUSINESS_TEXT_MAX_LENGTH,
  BusinessActorSchema,
  BusinessListLimitSchema,
  IdempotentInput,
  MoneySchema,
} from "./business.js";
import { Id, IsoDate } from "./ids.js";

const Name = z.string().trim().min(1).max(BUSINESS_NAME_MAX_LENGTH);
const OptionalShortText = z.string().trim().max(BUSINESS_SHORT_TEXT_MAX_LENGTH);
const OptionalLongText = z.string().max(BUSINESS_TEXT_MAX_LENGTH);
const SearchText = z.string().trim().max(BUSINESS_SEARCH_MAX_LENGTH);
const Ref = z.string().trim().min(1).max(40);
/** Mutations accept the id or the human ref (L-3, D-2) a bot sees in results. */
const idOrRef = (value: { id?: string; ref?: string }) => Boolean(value.id) || Boolean(value.ref);
const ID_OR_REF_MESSAGE = "Provide the id or ref";

// --- Companies ---------------------------------------------------------------

export const CrmCompanySchema = z.object({
  id: Id,
  spaceId: Id,
  name: z.string(),
  domain: z.string().nullable(),
  phone: z.string().nullable(),
  notes: z.string().nullable(),
  createdBy: BusinessActorSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CrmCompany = z.infer<typeof CrmCompanySchema>;

export const CreateCompanyInput = IdempotentInput.extend({
  name: Name,
  domain: OptionalShortText.optional(),
  phone: OptionalShortText.optional(),
  notes: OptionalLongText.optional(),
});
export type CreateCompanyInput = z.infer<typeof CreateCompanyInput>;

export const UpdateCompanyInput = IdempotentInput.extend({
  id: Id,
  name: Name.optional(),
  domain: OptionalShortText.nullable().optional(),
  phone: OptionalShortText.nullable().optional(),
  notes: OptionalLongText.nullable().optional(),
});
export type UpdateCompanyInput = z.infer<typeof UpdateCompanyInput>;

export const SearchCompaniesInput = z.object({
  id: Id.optional(),
  q: SearchText.optional(),
  limit: BusinessListLimitSchema,
});
export type SearchCompaniesInput = z.infer<typeof SearchCompaniesInput>;
export const SearchCompaniesOutput = z.object({ companies: z.array(CrmCompanySchema) });

export const FindDuplicatesInput = z.object({
  limit: BusinessListLimitSchema,
});
export type FindDuplicatesInput = z.infer<typeof FindDuplicatesInput>;

export const CompanyDuplicateGroupSchema = z.object({
  reason: z.string(),
  matchKey: z.string(),
  companies: z.array(CrmCompanySchema),
});
export type CompanyDuplicateGroup = z.infer<typeof CompanyDuplicateGroupSchema>;
export const FindCompanyDuplicatesOutput = z.object({
  groups: z.array(CompanyDuplicateGroupSchema),
});
export type FindCompanyDuplicatesOutput = z.infer<typeof FindCompanyDuplicatesOutput>;

// --- Contacts ----------------------------------------------------------------

export const CrmContactSchema = z.object({
  id: Id,
  spaceId: Id,
  firstName: z.string(),
  lastName: z.string(),
  /** First and last name joined for display. */
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  title: z.string().nullable(),
  notes: z.string().nullable(),
  companyId: Id.nullable(),
  companyName: z.string().nullable(),
  createdBy: BusinessActorSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CrmContact = z.infer<typeof CrmContactSchema>;

const Email = z.string().trim().email().max(BUSINESS_SHORT_TEXT_MAX_LENGTH);

export const CreateContactInput = IdempotentInput.extend({
  firstName: Name,
  lastName: z.string().trim().max(BUSINESS_NAME_MAX_LENGTH).default(""),
  email: Email.optional(),
  phone: OptionalShortText.optional(),
  title: OptionalShortText.optional(),
  notes: OptionalLongText.optional(),
  companyId: Id.optional(),
});
export type CreateContactInput = z.infer<typeof CreateContactInput>;

export const UpdateContactInput = IdempotentInput.extend({
  id: Id,
  firstName: Name.optional(),
  lastName: z.string().trim().max(BUSINESS_NAME_MAX_LENGTH).optional(),
  email: Email.nullable().optional(),
  phone: OptionalShortText.nullable().optional(),
  title: OptionalShortText.nullable().optional(),
  notes: OptionalLongText.nullable().optional(),
  companyId: Id.nullable().optional(),
});
export type UpdateContactInput = z.infer<typeof UpdateContactInput>;

export const SearchContactsInput = z.object({
  id: Id.optional(),
  q: SearchText.optional(),
  email: Email.optional(),
  companyId: Id.optional(),
  limit: BusinessListLimitSchema,
});
export type SearchContactsInput = z.infer<typeof SearchContactsInput>;
export const SearchContactsOutput = z.object({ contacts: z.array(CrmContactSchema) });

export const ContactDuplicateGroupSchema = z.object({
  reason: z.string(),
  matchKey: z.string(),
  contacts: z.array(CrmContactSchema),
});
export type ContactDuplicateGroup = z.infer<typeof ContactDuplicateGroupSchema>;
export const FindContactDuplicatesOutput = z.object({
  groups: z.array(ContactDuplicateGroupSchema),
});
export type FindContactDuplicatesOutput = z.infer<typeof FindContactDuplicatesOutput>;

// --- Leads -------------------------------------------------------------------

export const LEAD_STATUSES = ["new", "contacted", "qualified", "unqualified", "converted"] as const;
export const LeadStatusSchema = z.enum(LEAD_STATUSES);
export type LeadStatus = z.infer<typeof LeadStatusSchema>;
/** Statuses a qualify call may set; `converted` only comes from crm.lead.convert. */
export const QUALIFY_LEAD_STATUSES = ["contacted", "qualified", "unqualified"] as const;
export const QualifyLeadStatusSchema = z.enum(QUALIFY_LEAD_STATUSES);

export const CrmLeadSchema = z.object({
  id: Id,
  spaceId: Id,
  number: z.number().int().positive(),
  ref: z.string(),
  title: z.string(),
  status: LeadStatusSchema,
  source: z.string().nullable(),
  notes: z.string().nullable(),
  value: z.number().nullable(),
  companyId: Id.nullable(),
  companyName: z.string().nullable(),
  contactId: Id.nullable(),
  contactName: z.string().nullable(),
  assignee: BusinessActorSchema,
  convertedDealId: Id.nullable(),
  createdBy: BusinessActorSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CrmLead = z.infer<typeof CrmLeadSchema>;

export const CreateLeadInput = IdempotentInput.extend({
  title: Name,
  source: OptionalShortText.optional(),
  notes: OptionalLongText.optional(),
  value: MoneySchema.optional(),
  companyId: Id.optional(),
  contactId: Id.optional(),
  assigneeUserId: Id.optional(),
  assigneeBotId: Id.optional(),
});
export type CreateLeadInput = z.infer<typeof CreateLeadInput>;

export const UpdateLeadInput = IdempotentInput.extend({
  id: Id.optional(),
  ref: Ref.optional(),
  title: Name.optional(),
  source: OptionalShortText.nullable().optional(),
  notes: OptionalLongText.nullable().optional(),
  value: MoneySchema.nullable().optional(),
  companyId: Id.nullable().optional(),
  contactId: Id.nullable().optional(),
}).refine(idOrRef, { message: ID_OR_REF_MESSAGE });
export type UpdateLeadInput = z.infer<typeof UpdateLeadInput>;

export const AssignLeadInput = IdempotentInput.extend({
  id: Id.optional(),
  ref: Ref.optional(),
  assigneeUserId: Id.optional(),
  assigneeBotId: Id.optional(),
})
  .refine(idOrRef, { message: ID_OR_REF_MESSAGE })
  .refine((value) => Boolean(value.assigneeUserId) !== Boolean(value.assigneeBotId), {
    message: "Provide exactly one of assigneeUserId or assigneeBotId",
  });
export type AssignLeadInput = z.infer<typeof AssignLeadInput>;

export const QualifyLeadInput = IdempotentInput.extend({
  id: Id.optional(),
  ref: Ref.optional(),
  status: QualifyLeadStatusSchema,
  notes: OptionalLongText.optional(),
  value: MoneySchema.optional(),
}).refine(idOrRef, { message: ID_OR_REF_MESSAGE });
export type QualifyLeadInput = z.infer<typeof QualifyLeadInput>;

export const ConvertLeadInput = IdempotentInput.extend({
  id: Id.optional(),
  ref: Ref.optional(),
  /** Deal title; defaults to the lead title. */
  title: Name.optional(),
  /** Deal amount; defaults to the lead value. */
  amount: MoneySchema.optional(),
}).refine(idOrRef, { message: ID_OR_REF_MESSAGE });
export type ConvertLeadInput = z.infer<typeof ConvertLeadInput>;

export const SearchLeadsInput = z.object({
  id: Id.optional(),
  ref: z.string().trim().max(40).optional(),
  q: SearchText.optional(),
  status: LeadStatusSchema.optional(),
  assigneeBotId: Id.optional(),
  assigneeUserId: Id.optional(),
  companyId: Id.optional(),
  limit: BusinessListLimitSchema,
});
export type SearchLeadsInput = z.infer<typeof SearchLeadsInput>;
export const SearchLeadsOutput = z.object({ leads: z.array(CrmLeadSchema) });

// --- Deals -------------------------------------------------------------------

export const DEAL_STAGES = ["qualification", "proposal", "negotiation", "won", "lost"] as const;
export const DealStageSchema = z.enum(DEAL_STAGES);
export type DealStage = z.infer<typeof DealStageSchema>;
export function isClosedDealStage(stage: DealStage): boolean {
  return stage === "won" || stage === "lost";
}

export const CrmDealSchema = z.object({
  id: Id,
  spaceId: Id,
  number: z.number().int().positive(),
  ref: z.string(),
  title: z.string(),
  stage: DealStageSchema,
  amount: z.number(),
  currency: z.string(),
  expectedCloseAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  notes: z.string().nullable(),
  companyId: Id.nullable(),
  companyName: z.string().nullable(),
  contactId: Id.nullable(),
  contactName: z.string().nullable(),
  sourceLeadId: Id.nullable(),
  owner: BusinessActorSchema,
  createdBy: BusinessActorSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CrmDeal = z.infer<typeof CrmDealSchema>;

export const CreateDealInput = IdempotentInput.extend({
  title: Name,
  amount: MoneySchema.default(0),
  stage: DealStageSchema.default("qualification"),
  expectedCloseAt: IsoDate.optional(),
  notes: OptionalLongText.optional(),
  companyId: Id.optional(),
  contactId: Id.optional(),
  ownerUserId: Id.optional(),
  ownerBotId: Id.optional(),
});
export type CreateDealInput = z.infer<typeof CreateDealInput>;

export const UpdateDealInput = IdempotentInput.extend({
  id: Id.optional(),
  ref: Ref.optional(),
  title: Name.optional(),
  amount: MoneySchema.optional(),
  expectedCloseAt: IsoDate.nullable().optional(),
  notes: OptionalLongText.nullable().optional(),
  companyId: Id.nullable().optional(),
  contactId: Id.nullable().optional(),
  ownerUserId: Id.nullable().optional(),
  ownerBotId: Id.nullable().optional(),
}).refine(idOrRef, { message: ID_OR_REF_MESSAGE });
export type UpdateDealInput = z.infer<typeof UpdateDealInput>;

export const UpdateDealStageInput = IdempotentInput.extend({
  id: Id.optional(),
  ref: Ref.optional(),
  stage: DealStageSchema,
  reason: OptionalShortText.optional(),
}).refine(idOrRef, { message: ID_OR_REF_MESSAGE });
export type UpdateDealStageInput = z.infer<typeof UpdateDealStageInput>;

export const SearchDealsInput = z.object({
  id: Id.optional(),
  ref: z.string().trim().max(40).optional(),
  q: SearchText.optional(),
  stage: DealStageSchema.optional(),
  companyId: Id.optional(),
  ownerBotId: Id.optional(),
  ownerUserId: Id.optional(),
  limit: BusinessListLimitSchema,
});
export type SearchDealsInput = z.infer<typeof SearchDealsInput>;
export const SearchDealsOutput = z.object({ deals: z.array(CrmDealSchema) });

// --- Activities --------------------------------------------------------------

export const ACTIVITY_KINDS = ["call", "email", "meeting", "note", "follow_up"] as const;
export const ActivityKindSchema = z.enum(ACTIVITY_KINDS);
export type ActivityKind = z.infer<typeof ActivityKindSchema>;

export const CrmActivitySchema = z.object({
  id: Id,
  spaceId: Id,
  kind: ActivityKindSchema,
  subject: z.string(),
  body: z.string().nullable(),
  dueAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  companyId: Id.nullable(),
  contactId: Id.nullable(),
  leadId: Id.nullable(),
  dealId: Id.nullable(),
  assignee: BusinessActorSchema,
  createdBy: BusinessActorSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CrmActivity = z.infer<typeof CrmActivitySchema>;

export const CreateActivityInput = IdempotentInput.extend({
  kind: ActivityKindSchema,
  subject: Name,
  body: OptionalLongText.optional(),
  dueAt: IsoDate.optional(),
  completed: z.boolean().default(false),
  companyId: Id.optional(),
  contactId: Id.optional(),
  leadId: Id.optional(),
  dealId: Id.optional(),
  assigneeUserId: Id.optional(),
  assigneeBotId: Id.optional(),
}).refine((value) => value.companyId || value.contactId || value.leadId || value.dealId, {
  message: "Link the activity to a company, contact, lead, or deal",
});
export type CreateActivityInput = z.infer<typeof CreateActivityInput>;

export const CompleteActivityInput = IdempotentInput.extend({
  id: Id,
  completed: z.boolean().default(true),
});
export type CompleteActivityInput = z.infer<typeof CompleteActivityInput>;

export const ListActivitiesInput = z.object({
  companyId: Id.optional(),
  contactId: Id.optional(),
  leadId: Id.optional(),
  dealId: Id.optional(),
  kind: ActivityKindSchema.optional(),
  /** Only open follow-ups (no completedAt). */
  openOnly: z.boolean().default(false),
  assigneeBotId: Id.optional(),
  assigneeUserId: Id.optional(),
  limit: BusinessListLimitSchema,
});
export type ListActivitiesInput = z.infer<typeof ListActivitiesInput>;
export const ListActivitiesOutput = z.object({ activities: z.array(CrmActivitySchema) });

export const CrmOverviewSchema = z.object({
  companies: z.number().int().nonnegative(),
  contacts: z.number().int().nonnegative(),
  openLeads: z.number().int().nonnegative(),
  openDeals: z.number().int().nonnegative(),
  openDealAmount: z.number(),
  wonDealAmount: z.number(),
  openFollowUps: z.number().int().nonnegative(),
  currency: z.string(),
});
export type CrmOverview = z.infer<typeof CrmOverviewSchema>;
