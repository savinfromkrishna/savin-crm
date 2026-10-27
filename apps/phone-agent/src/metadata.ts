import * as z from "zod";

/** What the API attaches to the agent dispatch: enough to find the call, nothing more. */
export const PhoneAgentJobMetadata = z.object({
  callId: z.string().min(1),
  apiUrl: z.string().url(),
  token: z.string().min(16),
});
export type PhoneAgentJobMetadata = z.infer<typeof PhoneAgentJobMetadata>;

export function parsePhoneAgentMetadata(raw: string | undefined): PhoneAgentJobMetadata | null {
  if (!raw) return null;
  try {
    const parsed = PhoneAgentJobMetadata.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
