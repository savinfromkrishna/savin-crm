import { randomUUID } from "node:crypto";
import type { APIConnectOptions, AudioBuffer } from "@livekit/agents";
import { DEFAULT_API_CONNECT_OPTIONS, llm, mergeFrames, stt, tts } from "@livekit/agents";
import { AudioFrame } from "@livekit/rtc-node";
import type { PhoneCallApi } from "./api-client.js";
import {
  chunkPcm,
  decodeSpeechClip,
  encodeWavPcm16,
  type Mp3Decoder,
  PHONE_SAMPLE_RATE,
} from "./audio.js";

/**
 * Speech recognition through Savingroup's configured voice provider. The VAD-backed
 * StreamAdapter hands over one utterance at a time; each becomes a WAV upload.
 */
export class SavingroupStt extends stt.STT {
  label = "savingroup-phone-stt";

  constructor(
    private readonly api: PhoneCallApi,
    private readonly language?: string,
  ) {
    super({ streaming: false, interimResults: false });
  }

  protected async _recognize(
    frame: AudioBuffer,
    abortSignal?: AbortSignal,
  ): Promise<stt.SpeechEvent> {
    const merged = mergeFrames(frame);
    const wav = encodeWavPcm16(merged.data, merged.sampleRate, merged.channels);
    const text = await this.api.transcribe(wav, this.language, abortSignal);
    return {
      type: stt.SpeechEventType.FINAL_TRANSCRIPT,
      alternatives: [
        {
          text,
          language: (this.language ?? "") as stt.SpeechData["language"],
          startTime: 0,
          endTime: 0,
          confidence: 1,
        },
      ],
    };
  }

  stream(): stt.SpeechStream {
    throw new Error("SavingroupStt is not streaming; wrap it in stt.StreamAdapter with a VAD.");
  }
}

/** Speech synthesis through Savingroup's configured voice provider, decoded to phone PCM. */
export class SavingroupTts extends tts.TTS {
  label = "savingroup-phone-tts";

  constructor(
    private readonly api: PhoneCallApi,
    private readonly decoder: Mp3Decoder,
  ) {
    super(PHONE_SAMPLE_RATE, 1, { streaming: false });
  }

  synthesize(text: string, connOptions?: APIConnectOptions, abortSignal?: AbortSignal) {
    return new SavingroupChunkedStream(
      text,
      this,
      this.api,
      this.decoder,
      connOptions,
      abortSignal,
    );
  }

  stream(): tts.SynthesizeStream {
    throw new Error("SavingroupTts is not streaming; wrap it in tts.StreamAdapter.");
  }
}

class SavingroupChunkedStream extends tts.ChunkedStream {
  label = "savingroup-phone-tts";

  constructor(
    private readonly text: string,
    owner: SavingroupTts,
    private readonly api: PhoneCallApi,
    private readonly decoder: Mp3Decoder,
    connOptions?: APIConnectOptions,
    private readonly signal?: AbortSignal,
  ) {
    super(text, owner, connOptions, signal);
  }

  protected async run(): Promise<void> {
    const clip = await this.api.speak(this.text, this.signal);
    const pcm = await decodeSpeechClip(clip.bytes, clip.mimeType, this.decoder);
    const requestId = randomUUID();
    const chunks = chunkPcm(pcm, PHONE_SAMPLE_RATE);
    chunks.forEach((chunk, index) => {
      this.queue.put({
        requestId,
        segmentId: requestId,
        frame: new AudioFrame(chunk, PHONE_SAMPLE_RATE, 1, chunk.length),
        final: index === chunks.length - 1,
      });
    });
    this.queue.close();
  }
}

/**
 * The bot's next line comes from the API, which holds the brief, the transcript
 * and the model credential. The agent only forwards what the callee said.
 */
export class SavingroupLlm extends llm.LLM {
  constructor(
    private readonly api: PhoneCallApi,
    private readonly onEndCall: () => void,
  ) {
    super();
  }

  label() {
    return "savingroup-phone-llm";
  }

  chat({
    chatCtx,
    toolCtx,
    connOptions,
  }: {
    chatCtx: llm.ChatContext;
    toolCtx?: llm.ToolContextLike;
    connOptions?: APIConnectOptions;
  }): llm.LLMStream {
    return new SavingroupLlmStream(
      this,
      { chatCtx, toolCtx, connOptions: connOptions ?? DEFAULT_API_CONNECT_OPTIONS },
      this.api,
      this.onEndCall,
    );
  }
}

class SavingroupLlmStream extends llm.LLMStream {
  constructor(
    owner: SavingroupLlm,
    options: {
      chatCtx: llm.ChatContext;
      toolCtx?: llm.ToolContextLike;
      connOptions: APIConnectOptions;
    },
    private readonly api: PhoneCallApi,
    private readonly onEndCall: () => void,
  ) {
    super(owner, options);
  }

  protected async run(): Promise<void> {
    const latest = [...this.chatCtx.items]
      .reverse()
      .find((item): item is llm.ChatMessage => item.type === "message" && item.role === "user");
    const text = latest?.textContent ?? "";
    const turn = await this.api.turn(text, this.abortController.signal);
    this.queue.put({ id: randomUUID(), delta: { role: "assistant", content: turn.reply } });
    this.queue.close();
    if (turn.endCall) this.onEndCall();
  }
}
