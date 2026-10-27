import type { MessageBlock } from "@savingroup/contracts";
import { instructionUpdateDiff, redactSecrets } from "@savingroup/core";

const MAX_APPROVAL_SUMMARY_LENGTH = 500;
const MAX_APPROVAL_DETAIL_LENGTH = 4_000;
// What a computer action would run, open, or change, so the person approving can see it.
const COMPUTER_SCOPE_KEYS = ["command", "url", "path", "application", "uri"] as const;
const APPROVAL_DETAIL_KEYS = [
  "collection",
  "title",
  "to",
  "subject",
  "amount",
  "body",
  ...COMPUTER_SCOPE_KEYS,
  "cwd",
  "actions",
  "content",
] as const;

export function buildApprovalAskBlock(
  effectId: string,
  toolName: string,
  args: Record<string, unknown>,
  secrets: string[],
  options?: { reviewReason?: string; allowAlways?: boolean },
): MessageBlock {
  if (toolName === "propose_instructions_update") {
    const before = redactSecrets(String(args.previousInstructions ?? ""), secrets);
    const after = redactSecrets(String(args.instructions ?? ""), secrets);
    const reason = redactSecrets(String(args.reason), secrets);
    return {
      kind: "ask",
      approvalEffectId: effectId,
      text: "Update instructions?",
      detail: instructionUpdateDiff(before, after, reason),
      instructionUpdate: {
        botId: String(args.botId ?? ""),
        before,
        after,
        reason,
      },
      status: "pending",
      actions: [
        { id: "allow", label: "Apply" },
        { id: "deny", label: "Dismiss" },
      ],
    };
  }
  const summary = describeApprovalAction(toolName, args);
  const detail = formatApprovalDetail(toolName, args, options?.reviewReason);
  const safeDetail = detail ? redactSecrets(detail, secrets) : undefined;
  return {
    kind: "ask",
    approvalEffectId: effectId,
    text: truncate(
      redactSecrets(
        toolName === "create_space" ? `${summary}?` : `Review before ${summary}`,
        secrets,
      ),
      MAX_APPROVAL_SUMMARY_LENGTH,
    ),
    detail: safeDetail ? truncate(safeDetail, MAX_APPROVAL_DETAIL_LENGTH) : undefined,
    status: "pending",
    actions:
      toolName === "create_space"
        ? [
            { id: "allow", label: "Create space", outcome: "created" },
            { id: "deny", label: "Cancel", outcome: "cancelled" },
          ]
        : [
            { id: "allow", label: "Allow once" },
            ...(options?.allowAlways === false
              ? []
              : [{ id: "always", label: "Always allow this tool" }]),
            { id: "deny", label: "Deny" },
          ],
  };
}

function describeApprovalAction(toolName: string, args: Record<string, unknown>): string {
  if (toolName === "destination.write") {
    const collection = args.collection ? String(args.collection) : "records";
    const title = args.title ? ` "${String(args.title)}"` : "";
    return `writing${title} to ${collection}`;
  }
  if (toolName === "delete_bot" || toolName === "archive_bot") {
    const name = args.confirm_name ?? args.confirmName;
    return name ? `${toolName.replace("_", " ")} (${String(name)})` : toolName.replace("_", " ");
  }
  if (toolName === "create_space") {
    const name = args.name ? String(args.name) : "Untitled";
    return `Create space “${name}”`;
  }
  const target = pickScopeLabel(args);
  return target ? `${toolName} → ${target}` : toolName;
}

function formatApprovalDetail(
  toolName: string,
  args: Record<string, unknown>,
  reviewReason?: string,
): string | undefined {
  const lines: string[] = [];
  if (reviewReason?.trim()) {
    lines.push(reviewReason.trim().replace(/\u2014|\u2013/g, "-"));
  }
  if (toolName === "create_space") {
    lines.push(
      "Bots, groups, chats, files, memory, and integrations in this space stay separate from other spaces.",
    );
  }
  for (const key of APPROVAL_DETAIL_KEYS) {
    const value = args[key];
    if (value == null || value === "") continue;
    lines.push(`${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
  }
  if (lines.length === 0) return undefined;
  return lines.join("\n");
}

function pickScopeLabel(args: Record<string, unknown>): string | undefined {
  for (const key of ["to", "title", "collection", "subject", "amount", ...COMPUTER_SCOPE_KEYS]) {
    const value = args[key];
    if (value != null && value !== "") return String(value);
  }
  return undefined;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}
