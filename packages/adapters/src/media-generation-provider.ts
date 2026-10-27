import { setTimeout as delay } from "node:timers/promises";
import type {
  AdapterContext,
  GeneratedMedia,
  MediaGenerationInput,
  MediaGenerationProvider,
  MediaVideoJob,
} from "@savingroup/adapter-kit";
import { MediaGenerationError } from "@savingroup/adapter-kit";
import { ATTACHMENT_MAX_BYTES } from "@savingroup/contracts";
import { z } from "zod";
import { FAKE_VIDEO_BASE64 } from "./fake-media-assets.js";
import type { ResolveHostname } from "./web-ssrf.js";
import { fetchSafeWebBytes } from "./web-ssrf.js";

export const mediaPromptSchema = z.object({ prompt: z.string().trim().min(1).max(4000) });
export function validateGeneratedMedia(
  output: GeneratedMedia,
  mimeType: GeneratedMedia["mimeType"],
) {
  if (output.mimeType !== mimeType || !output.bytes.byteLength) {
    throw new MediaGenerationError("provider_failure");
  }
  if (output.bytes.byteLength > ATTACHMENT_MAX_BYTES) {
    throw new MediaGenerationError("output_limit");
  }
}

async function boundedBytes(response: Response, limit: number): Promise<Uint8Array> {
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw new MediaGenerationError("output_limit");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new MediaGenerationError("provider_failure");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) throw new MediaGenerationError("output_limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length);
}

const queueJob = z.object({
  request_id: z.string().min(1),
  status_url: z.string(),
  response_url: z.string(),
});
const savedQueueJob = z.object({ status: z.string(), response: z.string() });
const queueStatus = z.object({
  status: z.enum(["IN_QUEUE", "IN_PROGRESS", "COMPLETED"]),
  error: z.unknown().optional(),
});
const fileResult = z.object({ url: z.string().url() });

/** fal queue HTTP protocol; model-specific parameters stay within this adapter. */
export class FalMediaGenerationProvider implements MediaGenerationProvider {
  readonly id = "fal";
  readonly capabilities;
  private readonly baseUrl: string;
  constructor(
    private readonly options: {
      apiKey: string;
      baseUrl?: string;
      imageModel?: string;
      videoModel?: string;
      fetch?: typeof fetch;
      resolveHostname?: ResolveHostname;
    },
  ) {
    const url = new URL(options.baseUrl ?? "https://queue.fal.run");
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("Invalid media generation base URL");
    this.baseUrl = url.href.replace(/\/$/, "");
    for (const model of [options.imageModel, options.videoModel]) {
      if (model && !/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*(?:\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*)+$/.test(model))
        throw new Error("Invalid media model endpoint");
    }
    this.capabilities = {
      images: Boolean(options.imageModel),
      video: Boolean(options.videoModel),
      offline: false,
    };
  }
  private path(raw: string) {
    const url = new URL(raw, `${this.baseUrl}/`);
    if (
      url.origin !== new URL(this.baseUrl).origin ||
      !url.href.startsWith(`${this.baseUrl}/`) ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new MediaGenerationError("provider_failure");
    return url.href;
  }
  private async request(path: string, context: AdapterContext, body?: unknown): Promise<unknown> {
    context.signal.throwIfAborted();
    try {
      const response = await (this.options.fetch ?? fetch)(this.path(path), {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Key ${this.options.apiKey}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.any([context.signal, AbortSignal.timeout(30_000)]),
        redirect: "error",
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new MediaGenerationError(
          response.status === 429
            ? "rate_limit"
            : [401, 403].includes(response.status)
              ? "authentication"
              : "provider_failure",
        );
      }
      return JSON.parse(new TextDecoder().decode(await boundedBytes(response, 100_000)));
    } catch (error) {
      context.signal.throwIfAborted();
      if (error instanceof MediaGenerationError) throw error;
      throw new MediaGenerationError("provider_failure");
    }
  }
  private async submit(input: MediaGenerationInput, video: boolean, context: AdapterContext) {
    const model = video ? this.options.videoModel : this.options.imageModel;
    if (!model) throw new MediaGenerationError("unsupported");
    const parsed = mediaPromptSchema.safeParse(input);
    if (!parsed.success) throw new MediaGenerationError("invalid_input");
    const job = queueJob.safeParse(
      await this.request(`${this.baseUrl}/${model}`, context, {
        prompt: parsed.data.prompt,
        ...(video
          ? { num_frames: 65, frames_per_second: 16, resolution: "480p" }
          : { num_images: 1, image_size: "square", output_format: "png" }),
      }),
    );
    if (!job.success) throw new MediaGenerationError("provider_failure");
    return JSON.stringify({
      status: this.path(job.data.status_url),
      response: this.path(job.data.response_url),
    });
  }
  private async poll(id: string, context: AdapterContext) {
    let job: z.infer<typeof savedQueueJob>;
    try {
      job = savedQueueJob.parse(JSON.parse(id));
    } catch {
      throw new MediaGenerationError("invalid_input");
    }
    const status = queueStatus.safeParse(await this.request(job.status, context));
    if (!status.success) throw new MediaGenerationError("provider_failure");
    if (status.data.error) return { status: "failed" as const };
    if (status.data.status !== "COMPLETED")
      return {
        status: status.data.status === "IN_QUEUE" ? ("queued" as const) : ("running" as const),
      };
    return { status: "completed" as const, value: await this.request(job.response, context) };
  }
  private async download(
    value: unknown,
    video: boolean,
    context: AdapterContext,
  ): Promise<GeneratedMedia> {
    const parsed = (
      video
        ? z.object({ video: fileResult }).transform((v) => v.video)
        : z.object({ images: z.array(fileResult).length(1) }).transform((v) => v.images[0]!)
    ).safeParse(value);
    if (!parsed.success) throw new MediaGenerationError("provider_failure");
    try {
      // Output URLs are untrusted. Pin public DNS, reject private addresses and redirects;
      // no API credential is ever sent to the output host.
      const result = await fetchSafeWebBytes(parsed.data.url, {
        fetch: this.options.fetch,
        resolveHostname: this.options.resolveHostname,
        signal: context.signal,
        maxBytes: ATTACHMENT_MAX_BYTES,
        maxRedirects: 0,
        timeoutMs: 60_000,
      });
      const mimeType = video ? "video/mp4" : "image/png";
      if (result.contentType?.split(";")[0] !== mimeType)
        throw new MediaGenerationError("provider_failure");
      const output = { bytes: result.body, mimeType } as GeneratedMedia;
      validateGeneratedMedia(output, mimeType);
      return output;
    } catch (error) {
      context.signal.throwIfAborted();
      if (error instanceof MediaGenerationError) throw error;
      throw new MediaGenerationError(
        error instanceof Error && error.message.includes("too large")
          ? "output_limit"
          : "provider_failure",
      );
    }
  }
  async generateImage(
    input: MediaGenerationInput,
    context: AdapterContext,
  ): Promise<GeneratedMedia> {
    context = {
      ...context,
      signal: AbortSignal.any([context.signal, AbortSignal.timeout(180_000)]),
    };
    const id = await this.submit(input, false, context);
    for (let attempt = 0; attempt < 120; attempt++) {
      const job = await this.poll(id, context);
      if (job.status === "completed") return this.download(job.value, false, context);
      if (job.status === "failed") throw new MediaGenerationError("provider_failure");
      await delay(1000, undefined, { signal: context.signal });
    }
    throw new MediaGenerationError("provider_failure");
  }
  async generateVideo(
    input: MediaGenerationInput,
    context: AdapterContext,
  ): Promise<MediaVideoJob> {
    return { id: await this.submit(input, true, context), status: "queued" };
  }
  async pollVideo(id: string, context: AdapterContext): Promise<MediaVideoJob> {
    const job = await this.poll(id, context);
    return job.status === "completed"
      ? { id, status: "completed", output: await this.download(job.value, true, context) }
      : { id, status: job.status };
  }
}

/** Deterministic provider; no network or billing. */
export class FakeMediaGenerationProvider implements MediaGenerationProvider {
  readonly id = "fake";
  readonly capabilities = { images: true, video: true, offline: true };
  async generateImage(
    _input: MediaGenerationInput,
    context: AdapterContext,
  ): Promise<GeneratedMedia> {
    context.signal.throwIfAborted();
    return {
      mimeType: "image/png",
      bytes: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0u8AAAAASUVORK5CYII=",
        "base64",
      ),
    };
  }
  async generateVideo(
    _input: MediaGenerationInput,
    context: AdapterContext,
  ): Promise<MediaVideoJob> {
    context.signal.throwIfAborted();
    return { id: "fake-video", status: "queued", progress: 0 };
  }
  async pollVideo(id: string, context: AdapterContext): Promise<MediaVideoJob> {
    context.signal.throwIfAborted();
    return {
      id,
      status: "completed",
      output: {
        mimeType: "video/mp4",
        bytes: Buffer.from(FAKE_VIDEO_BASE64, "base64"),
      },
    };
  }
}

const geminiOperationResponse = z.object({
  name: z.string().min(1),
  done: z.boolean().optional(),
  error: z.unknown().optional(),
  response: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Native Google Gemini / Veo / Imagen media generation provider (`MEDIA_GENERATION_PROVIDER=gemini`).
 * Uses `veo-2.0-generate-001` (or configured `MEDIA_GENERATION_VIDEO_MODEL`) via `:predictLongRunning`
 * for 9:16 vertical video generation and Gemini native image generation / Imagen 3 for images.
 */
export class GeminiMediaGenerationProvider implements MediaGenerationProvider {
  readonly id = "gemini";
  readonly capabilities;
  private readonly baseUrl: string;
  private readonly imageModel: string;
  private readonly videoModel: string;

  constructor(
    private readonly options: {
      apiKey: string;
      baseUrl?: string;
      imageModel?: string;
      videoModel?: string;
      fetch?: typeof fetch;
    },
  ) {
    const url = new URL(options.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta");
    this.baseUrl = url.href.replace(/\/$/, "");
    this.imageModel = options.imageModel?.trim() || "gemini-3.1-flash-lite-image";
    this.videoModel = options.videoModel?.trim() || "veo-2.0-generate-001";
    this.capabilities = {
      images: Boolean(this.imageModel),
      video: Boolean(this.videoModel),
      offline: false,
    };
  }

  private async requestJson(
    endpointPath: string,
    context: AdapterContext,
    body?: unknown,
  ): Promise<unknown> {
    context.signal.throwIfAborted();
    const sep = endpointPath.includes("?") ? "&" : "?";
    const url = `${this.baseUrl}/${endpointPath.replace(/^\/+/, "")}${sep}key=${encodeURIComponent(this.options.apiKey)}`;
    try {
      const response = await (this.options.fetch ?? fetch)(url, {
        method: body ? "POST" : "GET",
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.any([context.signal, AbortSignal.timeout(60_000)]),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new MediaGenerationError(
          response.status === 429
            ? "rate_limit"
            : [401, 403].includes(response.status)
              ? "authentication"
              : "provider_failure",
        );
      }
      return JSON.parse(new TextDecoder().decode(await boundedBytes(response, 15_000_000)));
    } catch (error) {
      context.signal.throwIfAborted();
      if (error instanceof MediaGenerationError) throw error;
      throw new MediaGenerationError("provider_failure");
    }
  }

  async generateImage(
    input: MediaGenerationInput,
    context: AdapterContext,
  ): Promise<GeneratedMedia> {
    const parsed = mediaPromptSchema.safeParse(input);
    if (!parsed.success) throw new MediaGenerationError("invalid_input");

    if (this.imageModel.startsWith("imagen-")) {
      const raw = (await this.requestJson(
        `models/${this.imageModel}:predict`,
        context,
        {
          instances: [{ prompt: parsed.data.prompt }],
          parameters: { sampleCount: 1, aspectRatio: "9:16", outputOptions: { mimeType: "image/png" } },
        },
      )) as { predictions?: Array<{ bytesBase64Encoded?: string }> };
      const b64 = raw.predictions?.[0]?.bytesBase64Encoded;
      if (!b64) throw new MediaGenerationError("provider_failure");
      const output: GeneratedMedia = {
        mimeType: "image/png",
        bytes: Buffer.from(b64, "base64"),
      };
      validateGeneratedMedia(output, "image/png");
      return output;
    }

    const raw = (await this.requestJson(
      `models/${this.imageModel}:generateContent`,
      context,
      {
        contents: [{ parts: [{ text: parsed.data.prompt }] }],
        generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
      },
    )) as {
      candidates?: Array<{
        content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> };
      }>;
    };
    const parts = raw.candidates?.[0]?.content?.parts ?? [];
    const imgPart = parts.find((p) => p.inlineData?.data);
    if (!imgPart?.inlineData?.data) throw new MediaGenerationError("provider_failure");
    const output: GeneratedMedia = {
      mimeType: "image/png",
      bytes: Buffer.from(imgPart.inlineData.data, "base64"),
    };
    validateGeneratedMedia(output, "image/png");
    return output;
  }

  async generateVideo(
    input: MediaGenerationInput,
    context: AdapterContext,
  ): Promise<MediaVideoJob> {
    const parsed = mediaPromptSchema.safeParse(input);
    if (!parsed.success) throw new MediaGenerationError("invalid_input");
    const raw = await this.requestJson(
      `models/${this.videoModel}:predictLongRunning`,
      context,
      {
        instances: [{ prompt: parsed.data.prompt }],
        parameters: { aspectRatio: "9:16", sampleCount: 1 },
      },
    );
    const op = geminiOperationResponse.safeParse(raw);
    if (!op.success) throw new MediaGenerationError("provider_failure");
    return { id: op.data.name, status: "queued" };
  }

  async pollVideo(id: string, context: AdapterContext): Promise<MediaVideoJob> {
    const raw = await this.requestJson(id, context);
    const op = geminiOperationResponse.safeParse(raw);
    if (!op.success) throw new MediaGenerationError("provider_failure");
    if (op.data.error) return { id, status: "failed" };
    if (!op.data.done) return { id, status: "running" };

    const resp = op.data.response ?? {};
    const videoResp = (resp.generateVideoResponse ?? resp) as {
      generatedSamples?: Array<{ video?: { uri?: string; bytesBase64Encoded?: string } }>;
      videos?: Array<{ uri?: string; bytesBase64Encoded?: string }>;
    };
    const sample =
      videoResp.generatedSamples?.[0]?.video ?? videoResp.videos?.[0];
    if (!sample) throw new MediaGenerationError("provider_failure");

    if (sample.bytesBase64Encoded) {
      const output: GeneratedMedia = {
        mimeType: "video/mp4",
        bytes: Buffer.from(sample.bytesBase64Encoded, "base64"),
      };
      validateGeneratedMedia(output, "video/mp4");
      return { id, status: "completed", output };
    }
    if (sample.uri) {
      const sep = sample.uri.includes("?") ? "&" : "?";
      const dlUrl = `${sample.uri}${sep}key=${encodeURIComponent(this.options.apiKey)}`;
      const response = await (this.options.fetch ?? fetch)(dlUrl, {
        signal: AbortSignal.any([context.signal, AbortSignal.timeout(60_000)]),
      });
      if (!response.ok) throw new MediaGenerationError("provider_failure");
      const bytes = await boundedBytes(response, ATTACHMENT_MAX_BYTES);
      const output: GeneratedMedia = { mimeType: "video/mp4", bytes };
      validateGeneratedMedia(output, "video/mp4");
      return { id, status: "completed", output };
    }
    throw new MediaGenerationError("provider_failure");
  }
}
