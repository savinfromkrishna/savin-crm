import * as z from "zod";
import { Id, IsoDate } from "./ids.js";

/** queued, then ringing, then in_progress, then exactly one terminal status. */
export const PHONE_CALL_STATUSES = [
  "queued",
  "ringing",
  "in_progress",
  "completed",
  "no_answer",
  "busy",
  "failed",
  "cancelled",
] as const;
export const PhoneCallStatusSchema = z.enum(PHONE_CALL_STATUSES);
export type PhoneCallStatus = z.infer<typeof PhoneCallStatusSchema>;

const TERMINAL_PHONE_CALL_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "no_answer",
  "busy",
  "failed",
  "cancelled",
]);

export function isPhoneCallTerminal(status: string): boolean {
  return TERMINAL_PHONE_CALL_STATUSES.has(status);
}

/** An international number: a plus sign and 7 to 15 digits. */
export const PhoneNumberSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, "Use an international number such as +14155550123");

export const PhoneCallTurnSchema = z.object({
  role: z.enum(["bot", "callee"]),
  text: z.string(),
  at: IsoDate,
});
export type PhoneCallTurn = z.infer<typeof PhoneCallTurnSchema>;

export const PhoneCallSchema = z.object({
  id: Id,
  botId: Id,
  threadId: Id,
  to: z.string(),
  from: z.string().nullable(),
  purpose: z.string(),
  status: PhoneCallStatusSchema,
  endReason: z.string().nullable(),
  summary: z.string().nullable(),
  startedAt: IsoDate.nullable(),
  endedAt: IsoDate.nullable(),
  durationSec: z.number().int().nonnegative().nullable(),
  transcript: z.array(PhoneCallTurnSchema),
  createdAt: IsoDate,
});
export type PhoneCall = z.infer<typeof PhoneCallSchema>;

export const PhoneCallsStatusSchema = z.object({
  enabled: z.boolean(),
  fromNumber: z.string().nullable(),
});
export type PhoneCallsStatus = z.infer<typeof PhoneCallsStatusSchema>;
