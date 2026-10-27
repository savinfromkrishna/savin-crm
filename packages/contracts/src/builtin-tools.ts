import * as z from "zod";
import { BUSINESS_TOOL_NAMES } from "./business.js";

/** Built-in tool names a bot may disable. Kept aligned with the adapter tool list. */
const CORE_BUILTIN_TOOL_NAMES = [
  "computer_observe",
  "computer_act",
  "browser_navigate",
  "browser_snapshot",
  "browser_act",
  "list_files",
  "read_file",
  "write_file",
  "attach_file",
  "shell",
  "open_path",
  "launch_app",
  "request_takeover",
  "ask_user",
  "message_user",
  "request_secret",
  "list_secrets",
  "secret_request",
  "forget_secret",
  "render_plot",
  "generate_image",
  "generate_video",
  "add_mcp_server",
  "remember",
  "save_shared_memory",
  "web_search",
  "web_fetch",
  "cloud_agent_launch",
  "cloud_agent_status",
  "cloud_agent_reply",
  "cloud_agent_cancel",
  "phone_call_place",
  "phone_call_status",
  "phone_call_hangup",
  "search_history",
  "read_history",
  "save_memory",
  "recall_memory",
  "forget_memory",
  "task_catalog",
  "scratchpad_list",
  "scratchpad_add",
  "scratchpad_update",
  "scratchpad_complete",
  "scratchpad_remove",
  "board_tickets",
  "ticket_get",
  "ticket_create",
  "ticket_update",
  "ticket_comment",
  "schedule_create",
  "schedule_list",
  "schedule_cancel",
  "end_call",
  "skill_read",
  "skill_create",
  "skill_update",
  "skill_delete",
  "run_subagent",
  "propose_instructions_update",
  "create_space",
  "spawn_bot",
  "update_bot",
  "archive_bot",
  "message_bot",
  "handoff_to_bot",
  "connect_agent",
  "respond_agent_connection",
  "message_agent",
] as const;

/** Core tools plus the CRM OS, ERP OS and site-administration actions (crm_*, erp_* and admin_*). */
export const BUILTIN_TOOL_NAMES = [...CORE_BUILTIN_TOOL_NAMES, ...BUSINESS_TOOL_NAMES] as const;

export const BuiltinToolNameSchema = z.enum(BUILTIN_TOOL_NAMES);
export type BuiltinToolName = z.infer<typeof BuiltinToolNameSchema>;

const builtinToolNameSet: ReadonlySet<string> = new Set(BUILTIN_TOOL_NAMES);

export function isBuiltinToolName(name: string): name is BuiltinToolName {
  return builtinToolNameSet.has(name);
}

export function disabledBuiltinToolSet(names: readonly string[] | undefined): Set<string> {
  const disabled = new Set<string>();
  if (!names) return disabled;
  for (const raw of names) {
    const name = raw.trim();
    if (isBuiltinToolName(name)) disabled.add(name);
  }
  return disabled;
}

/** Built-in tools that reach the bot's computer, grouped the way people switch them. */
export const COMPUTER_TOOL_GROUPS = {
  screen: ["computer_observe", "computer_act", "open_path", "launch_app", "request_takeover"],
  browser: ["browser_navigate", "browser_snapshot", "browser_act"],
  files: ["list_files", "read_file", "write_file", "attach_file"],
  shell: ["shell"],
} as const satisfies Record<string, readonly BuiltinToolName[]>;
export type ComputerToolGroup = keyof typeof COMPUTER_TOOL_GROUPS;
export const COMPUTER_TOOL_GROUP_NAMES = Object.keys(COMPUTER_TOOL_GROUPS) as ComputerToolGroup[];

/** Every built-in tool that runs on the bot's computer; render_plot draws its charts there. */
export const COMPUTER_TOOL_NAMES: ReadonlySet<string> = new Set<string>([
  ...Object.values(COMPUTER_TOOL_GROUPS).flat(),
  "render_plot",
]);

const groupedComputerToolNames: ReadonlySet<string> = new Set<string>(
  Object.values(COMPUTER_TOOL_GROUPS).flat(),
);

export function isComputerToolGroupName(name: string): boolean {
  return groupedComputerToolNames.has(name);
}

/** A group is on only while none of its tools is disabled. */
export function computerToolGroupEnabled(
  disabled: readonly string[],
  group: ComputerToolGroup,
): boolean {
  return COMPUTER_TOOL_GROUPS[group].every((name) => !disabled.includes(name));
}

export function setComputerToolGroup(
  disabled: readonly string[],
  group: ComputerToolGroup,
  enabled: boolean,
): string[] {
  const names: readonly string[] = COMPUTER_TOOL_GROUPS[group];
  const rest = disabled.filter((name) => !names.includes(name));
  return enabled ? rest : [...rest, ...names];
}

export const DisabledBuiltinToolsSchema = z
  .array(z.string().trim().min(1).max(64))
  .max(BUILTIN_TOOL_NAMES.length)
  .superRefine((names, ctx) => {
    names.forEach((name, index) => {
      if (!isBuiltinToolName(name)) {
        ctx.addIssue({
          code: "custom",
          message: `Unknown built-in tool: ${name}`,
          path: [index],
        });
      }
    });
  })
  .transform((names) => [...new Set(names)]);
