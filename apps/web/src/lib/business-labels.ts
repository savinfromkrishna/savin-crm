import { useLingui } from "@lingui/react/macro";
import type {
  ActivityKind,
  BusinessHistoryEntry,
  DealStage,
  ErpInvoice,
  InvoiceStatus,
  LeadStatus,
  OrderStatus,
  PaymentStatus,
} from "@savingroup/contracts";
import { DEAL_STAGES, LEAD_STATUSES } from "@savingroup/contracts";
import { useMemo } from "react";

/**
 * How a status reads at a glance. The app is monochrome, so only outcomes get
 * color: success, warning (waiting on someone) and destructive. `progress` is
 * an open record that moved forward; `muted` is closed without an outcome.
 */
export type StatusTone = "neutral" | "progress" | "success" | "warning" | "destructive" | "muted";

export const LEAD_STATUS_TONES: Record<LeadStatus, StatusTone> = {
  new: "neutral",
  contacted: "progress",
  qualified: "progress",
  converted: "success",
  unqualified: "muted",
};

export const DEAL_STAGE_TONES: Record<DealStage, StatusTone> = {
  qualification: "neutral",
  proposal: "progress",
  negotiation: "progress",
  won: "success",
  lost: "destructive",
};

export const ORDER_STATUS_TONES: Record<OrderStatus, StatusTone> = {
  draft: "neutral",
  pending_approval: "warning",
  approved: "progress",
  confirmed: "success",
  cancelled: "muted",
};

export const INVOICE_STATUS_TONES: Record<InvoiceStatus, StatusTone> = {
  draft: "neutral",
  issued: "progress",
  paid: "success",
};

/** An unpaid draft is not overdue money yet; an unpaid issued invoice is. */
export function paymentTone(invoice: Pick<ErpInvoice, "status" | "paymentStatus">): StatusTone {
  if (invoice.paymentStatus === "paid") return "success";
  if (invoice.status === "draft") return "muted";
  return "warning";
}

export function useLeadStatusLabels(): Record<LeadStatus, string> {
  const { t } = useLingui();
  return useMemo(
    () => ({
      new: t`New`,
      contacted: t`Contacted`,
      qualified: t`Qualified`,
      unqualified: t`Unqualified`,
      converted: t`Converted`,
    }),
    [t],
  );
}

export function useDealStageLabels(): Record<DealStage, string> {
  const { t } = useLingui();
  return useMemo(
    () => ({
      qualification: t`Qualification`,
      proposal: t`Proposal`,
      negotiation: t`Negotiation`,
      won: t`Won`,
      lost: t`Lost`,
    }),
    [t],
  );
}

export function useActivityKindLabels(): Record<ActivityKind, string> {
  const { t } = useLingui();
  return useMemo(
    () => ({
      call: t`Call`,
      email: t`Email`,
      meeting: t`Meeting`,
      note: t`Note`,
      follow_up: t`Follow-up`,
    }),
    [t],
  );
}

export function useOrderStatusLabels(): Record<OrderStatus, string> {
  const { t } = useLingui();
  return useMemo(
    () => ({
      draft: t`Draft`,
      pending_approval: t`Pending approval`,
      approved: t`Approved`,
      confirmed: t`Confirmed`,
      cancelled: t`Cancelled`,
    }),
    [t],
  );
}

export function useInvoiceStatusLabels(): Record<InvoiceStatus, string> {
  const { t } = useLingui();
  return useMemo(() => ({ draft: t`Draft`, issued: t`Issued`, paid: t`Paid` }), [t]);
}

export function usePaymentStatusLabels(): Record<PaymentStatus, string> {
  const { t } = useLingui();
  return useMemo(() => ({ unpaid: t`Unpaid`, partial: t`Partially paid`, paid: t`Paid` }), [t]);
}

function isLeadStatus(value: unknown): value is LeadStatus {
  return (LEAD_STATUSES as readonly unknown[]).includes(value);
}

function isDealStage(value: unknown): value is DealStage {
  return (DEAL_STAGES as readonly unknown[]).includes(value);
}

/**
 * A readable name for an action-log entry. Status and stage changes name the
 * state they moved to; anything unrecognised keeps its action id.
 */
export function useHistoryActionLabel(): (
  entry: Pick<BusinessHistoryEntry, "actionId" | "input">,
) => string {
  const { t } = useLingui();
  const leadStatuses = useLeadStatusLabels();
  const dealStages = useDealStageLabels();
  return useMemo(() => {
    const verbs: Record<string, string> = {
      create: t`Created`,
      update: t`Updated`,
      assign: t`Assigned`,
      qualify: t`Status changed`,
      update_stage: t`Stage changed`,
      convert: t`Converted`,
      adjust: t`Stock adjusted`,
      create_draft: t`Draft created`,
      add_item: t`Line added`,
      remove_item: t`Line removed`,
      request_approval: t`Approval requested`,
      approve: t`Approved`,
      confirm: t`Confirmed`,
      cancel: t`Cancelled`,
      issue: t`Issued`,
      record_payment: t`Payment recorded`,
    };
    return ({ actionId, input }) => {
      if (actionId === "crm.lead.qualify" && isLeadStatus(input.status)) {
        return leadStatuses[input.status];
      }
      if (actionId === "crm.deal.update_stage" && isDealStage(input.stage)) {
        return dealStages[input.stage];
      }
      if (actionId.startsWith("admin.")) return actionId;
      return verbs[actionId.split(".").at(-1) ?? ""] ?? actionId;
    };
  }, [t, leadStatuses, dealStages]);
}
