/** Mono 16-bit PCM the LiveKit audio track consumes; speech clips are converted into it. */
export const PHONE_SAMPLE_RATE = 24_000;

export interface PcmClip {
  samples: Int16Array;
  sampleRate: number;
  channels: number;
}

export interface Mp3Decoder {
  decode(bytes: Uint8Array): Promise<{ channelData: Float32Array[]; sampleRate: number }>;
}

export function encodeWavPcm16(samples: Int16Array, sampleRate: number, channels: number) {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  new Int16Array(buffer, 44).set(samples);
  return new Uint8Array(buffer);
}

/** PCM 16-bit WAV only; anything else returns null so the caller can report it. */
export function parseWavPcm16(bytes: Uint8Array): PcmClip | null {
  if (bytes.length < 12) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let offset = 12;
  let format: { channels: number; sampleRate: number; bits: number; codec: number } | null = null;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (id === "fmt ") {
      format = {
        codec: view.getUint16(start, true),
        channels: view.getUint16(start + 2, true),
        sampleRate: view.getUint32(start + 4, true),
        bits: view.getUint16(start + 14, true),
      };
    } else if (id === "data") {
      if (format?.codec !== 1 || format.bits !== 16) return null;
      const end = Math.min(bytes.length, start + size);
      const sampleBytes = bytes.subarray(start, end - ((end - start) % 2));
      const samples = new Int16Array(sampleBytes.length / 2);
      for (let i = 0; i < samples.length; i += 1) {
        samples[i] = view.getInt16(start + i * 2, true);
      }
      return { samples, sampleRate: format.sampleRate, channels: format.channels };
    }
    offset = start + size + (size % 2);
  }
  return null;
}

export function downmixToMono(samples: Int16Array, channels: number): Int16Array {
  if (channels <= 1) return samples;
  const frames = Math.floor(samples.length / channels);
  const mono = new Int16Array(frames);
  for (let i = 0; i < frames; i += 1) {
    let sum = 0;
    for (let c = 0; c < channels; c += 1) sum += samples[i * channels + c]!;
    mono[i] = Math.round(sum / channels);
  }
  return mono;
}

export function resampleLinear(samples: Int16Array, from: number, to: number): Int16Array {
  if (from === to || samples.length === 0) return samples;
  const length = Math.max(1, Math.round((samples.length * to) / from));
  const out = new Int16Array(length);
  const step = from / to;
  for (let i = 0; i < length; i += 1) {
    const position = i * step;
    const index = Math.floor(position);
    const next = Math.min(index + 1, samples.length - 1);
    const fraction = position - index;
    out[i] = Math.round(samples[index]! * (1 - fraction) + samples[next]! * fraction);
  }
  return out;
}

export function floatToMonoPcm16(channelData: Float32Array[]): Int16Array {
  const frames = channelData[0]?.length ?? 0;
  const mono = new Int16Array(frames);
  for (let i = 0; i < frames; i += 1) {
    let sum = 0;
    for (const channel of channelData) sum += channel[i] ?? 0;
    const sample = Math.max(-1, Math.min(1, sum / channelData.length));
    mono[i] = Math.round(sample * 32767);
  }
  return mono;
}

/** Any clip the speech provider returns, as mono PCM at the phone sample rate. */
export async function decodeSpeechClip(
  bytes: Uint8Array,
  mimeType: string,
  decoder: Mp3Decoder,
  targetRate = PHONE_SAMPLE_RATE,
): Promise<Int16Array> {
  const kind = mimeType.split(";")[0]!.trim().toLowerCase();
  if (kind === "audio/wav" || kind === "audio/x-wav" || kind === "audio/wave") {
    const wav = parseWavPcm16(bytes);
    if (!wav) throw new Error("Speech clip is not 16-bit PCM WAV");
    return resampleLinear(downmixToMono(wav.samples, wav.channels), wav.sampleRate, targetRate);
  }
  if (kind === "audio/mpeg" || kind === "audio/mp3") {
    const decoded = await decoder.decode(bytes);
    return resampleLinear(floatToMonoPcm16(decoded.channelData), decoded.sampleRate, targetRate);
  }
  throw new Error(`Unsupported speech clip type ${kind}`);
}

/** Split PCM into frames of the given duration so playback starts before the clip is fully queued. */
export function chunkPcm(samples: Int16Array, sampleRate: number, frameMs = 20): Int16Array[] {
  const size = Math.max(1, Math.round((sampleRate * frameMs) / 1000));
  const chunks: Int16Array[] = [];
  for (let offset = 0; offset < samples.length; offset += size) {
    chunks.push(samples.subarray(offset, Math.min(samples.length, offset + size)));
  }
  return chunks;
}
