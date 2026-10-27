import type { ConnectorTool } from "@savingroup/adapter-kit";
import { PhoneNumberSchema } from "@savingroup/contracts";
import { z } from "zod";

export const PHONE_CALL_DEFAULT_MAX_MINUTES = 10;

export const phoneCallPlaceSchema = z
  .object({
    to: PhoneNumberSchema,
    purpose: z.string().trim().min(1).max(500),
    instructions: z.string().trim().max(4_000).optional(),
    greeting: z.string().trim().max(300).optional(),
    maxMinutes: z.number().int().min(1).max(30).optional(),
    language: z.string().trim().min(2).max(35).optional(),
  })
  .strict();
export type PhoneCallPlaceArgs = z.infer<typeof phoneCallPlaceSchema>;

const idSchema = z.object({ id: z.string().trim().min(1) }).strict();

/** Validate before effect logging: malformed numbers must never enter durable tool args. */
export function validPhoneCallArgs(name: string, args: unknown): boolean {
  const schema = name === "phone_call_place" ? phoneCallPlaceSchema : idSchema;
  return schema.safeParse(args).success;
}

export const PHONE_CALL_TOOL_NAMES = new Set([
  "phone_call_place",
  "phone_call_status",
  "phone_call_hangup",
]);

/** Drop phone tools when no telephony provider is configured. */
export function selectPhoneCallTools(tools: ConnectorTool[], configured: boolean): ConnectorTool[] {
  return configured ? tools : tools.filter((tool) => !PHONE_CALL_TOOL_NAMES.has(tool.name));
}
