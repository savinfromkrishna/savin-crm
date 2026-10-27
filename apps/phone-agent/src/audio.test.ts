import { describe, expect, it } from "vitest";
import {
  chunkPcm,
  decodeSpeechClip,
  downmixToMono,
  encodeWavPcm16,
  floatToMonoPcm16,
  parseWavPcm16,
  resampleLinear,
} from "./audio.js";

describe("phone audio helpers", () => {
  it("round-trips PCM through WAV", () => {
    const samples = Int16Array.from([0, 1000, -1000, 32767, -32768]);
    const wav = encodeWavPcm16(samples, 16_000, 1);
    expect(wav.length).toBe(44 + samples.length * 2);
    expect(parseWavPcm16(wav)).toEqual({ samples, sampleRate: 16_000, channels: 1 });
  });

  it("rejects clips that are not 16-bit PCM WAV", () => {
    expect(parseWavPcm16(new Uint8Array([1, 2, 3]))).toBeNull();
    const wav = encodeWavPcm16(Int16Array.from([1, 2]), 8_000, 1);
    wav[20] = 3; // IEEE float codec
    expect(parseWavPcm16(wav)).toBeNull();
  });

  it("downmixes interleaved stereo and resamples by linear interpolation", () => {
    expect(downmixToMono(Int16Array.from([100, 300, -200, 200]), 2)).toEqual(
      Int16Array.from([200, 0]),
    );
    const up = resampleLinear(Int16Array.from([0, 100]), 1, 2);
    expect(up.length).toBe(4);
    expect(up[0]).toBe(0);
    expect(up[2]).toBe(100);
    expect(resampleLinear(Int16Array.from([5, 6]), 24_000, 24_000)).toEqual(
      Int16Array.from([5, 6]),
    );
  });

  it("converts float channels to clipped mono PCM", () => {
    const pcm = floatToMonoPcm16([Float32Array.from([0, 1, -2]), Float32Array.from([0, 1, 0])]);
    expect(pcm).toEqual(Int16Array.from([0, 32767, -32767]));
  });

  it("decodes WAV and MP3 clips to phone-rate mono", async () => {
    const decoder = {
      decode: async () => ({ channelData: [Float32Array.from([0, 0.5])], sampleRate: 48_000 }),
    };
    const wav = encodeWavPcm16(Int16Array.from([0, 0, 0, 0]), 48_000, 1);
    expect((await decodeSpeechClip(wav, "audio/wav", decoder)).length).toBe(2);
    expect((await decodeSpeechClip(new Uint8Array([0]), "audio/mpeg", decoder)).length).toBe(1);
    await expect(decodeSpeechClip(new Uint8Array([0]), "audio/ogg", decoder)).rejects.toThrow(
      /Unsupported/,
    );
  });

  it("chunks PCM into 20 ms frames", () => {
    const chunks = chunkPcm(new Int16Array(24_000), 24_000);
    expect(chunks).toHaveLength(50);
    expect(chunks[0]!.length).toBe(480);
  });
});
