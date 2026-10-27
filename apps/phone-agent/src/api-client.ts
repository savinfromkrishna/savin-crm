import type { PhoneAgentJobMetadata } from "./metadata.js";

export interface PhoneCallBriefResponse {
  id: string;
  status: string;
  to: string;
  from: string | null;
  maxDurationSec: number;
  botName: string;
  greeting: string;
  language: string | null;
}

export interface PhoneCallOutcome {
  status?: "completed" | "no_answer" | "busy" | "failed" | "cancelled";
  endReason?: string;
  summary?: string;
}

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * The agent's only way back into Savingroup: the per-call endpoints, authenticated
 * with the token minted for this call. It never sees deployment secrets.
 */
export class PhoneCallApi {
  constructor(
    private readonly metadata: PhoneAgentJobMetadata,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  brief(signal?: AbortSignal): Promise<PhoneCallBriefResponse> {
    return this.json<PhoneCallBriefResponse>("GET", "", undefined, signal);
  }

  async answered(): Promise<void> {
    await this.json("POST", "/answered", {});
  }

  turn(text: string, signal?: AbortSignal): Promise<{ reply: string; endCall: boolean }> {
    return this.json("POST", "/turn", { text }, signal);
  }

  async speak(
    text: string,
    signal?: AbortSignal,
  ): Promise<{ bytes: Uint8Array; mimeType: string }> {
    const response = await this.request("POST", "/speak", { text }, signal);
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      mimeType: (response.headers.get("content-type") ?? "audio/mpeg").split(";")[0]!.trim(),
    };
  }

  async transcribe(wav: Uint8Array, language?: string, signal?: AbortSignal): Promise<string> {
    const body = await this.json<{ text: string }>(
      "POST",
      "/transcribe",
      {
        audioBase64: Buffer.from(wav).toString("base64"),
        mimeType: "audio/wav",
        ...(language ? { language } : {}),
      },
      signal,
    );
    return body.text ?? "";
  }

  async ended(outcome: PhoneCallOutcome): Promise<void> {
    await this.json("POST", "/ended", outcome);
  }

  private url(suffix: string) {
    return new URL(
      `/api/internal/phone-calls/${encodeURIComponent(this.metadata.callId)}${suffix}`,
      this.metadata.apiUrl,
    );
  }

  private async request(
    method: "GET" | "POST",
    suffix: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<Response> {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const response = await this.fetchImpl(this.url(suffix), {
      method,
      redirect: "error",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: {
        authorization: `Bearer ${this.metadata.token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    // Status only: response bodies may carry callee speech or audio.
    if (!response.ok)
      throw new Error(`phone call api ${suffix || "/"} returned ${response.status}`);
    return response;
  }

  private async json<T>(
    method: "GET" | "POST",
    suffix: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await this.request(method, suffix, body, signal);
    return (await response.json()) as T;
  }
}
