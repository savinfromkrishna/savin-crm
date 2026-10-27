import type { MediaGenerationProvider } from "@savingroup/adapter-kit";
import {
  FakeMediaGenerationProvider,
  FalMediaGenerationProvider,
  GeminiMediaGenerationProvider,
} from "./media-generation-provider.js";

export function createMediaGenerationProvider(
  env: NodeJS.ProcessEnv = process.env,
): MediaGenerationProvider | undefined {
  const kind = env.MEDIA_GENERATION_PROVIDER?.trim().toLowerCase();
  if (!kind || kind === "disabled") return undefined;
  if (kind === "fake") return new FakeMediaGenerationProvider();
  if (kind === "gemini" || kind === "google") {
    const apiKey = (env.MEDIA_GENERATION_API_KEY ?? env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY)?.trim();
    if (!apiKey) throw new Error("Gemini media generation requires MEDIA_GENERATION_API_KEY or GEMINI_API_KEY");
    return new GeminiMediaGenerationProvider({
      apiKey,
      imageModel: env.MEDIA_GENERATION_IMAGE_MODEL?.trim() || "gemini-3.1-flash-lite-image",
      videoModel: env.MEDIA_GENERATION_VIDEO_MODEL?.trim() || "veo-2.0-generate-001",
      baseUrl: env.MEDIA_GENERATION_BASE_URL,
    });
  }
  if (kind !== "fal") throw new Error("Unknown media generation provider");
  const apiKey = env.MEDIA_GENERATION_API_KEY?.trim();
  const imageModel = env.MEDIA_GENERATION_IMAGE_MODEL?.trim();
  const videoModel = env.MEDIA_GENERATION_VIDEO_MODEL?.trim();
  if (!apiKey || (!imageModel && !videoModel))
    throw new Error("Media generation requires credentials and at least one model");
  return new FalMediaGenerationProvider({
    apiKey,
    imageModel,
    videoModel,
    baseUrl: env.MEDIA_GENERATION_BASE_URL,
  });
}
