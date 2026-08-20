import { describe, expect, test } from "vitest";
import { audioBufferRangeToWav } from "@features/audio-annotation/audioClip";

describe("audioBufferRangeToWav", () => {
  test("crops, mixes and resamples the selected range to 16 kHz mono PCM", async () => {
    const left = new Float32Array(48_000).fill(0.5);
    const right = new Float32Array(48_000).fill(-0.25);
    const wav = audioBufferRangeToWav(
      {
        duration: 1,
        numberOfChannels: 2,
        sampleRate: 48_000,
        getChannelData: (channel) => (channel === 0 ? left : right),
      },
      250,
      750,
    );

    expect(wav.type).toBe("audio/wav");
    expect(wav.size).toBe(44 + 8_000 * 2);
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () =>
        resolve(reader.result as ArrayBuffer),
      );
      reader.addEventListener("error", () => reject(reader.error));
      reader.readAsArrayBuffer(wav);
    });
    const view = new DataView(bytes);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(16_000);
    expect(view.getInt16(44, true)).toBeCloseTo(4_096, -1);
  });

  test("rejects an empty selection", () => {
    expect(() =>
      audioBufferRangeToWav(
        {
          duration: 1,
          numberOfChannels: 1,
          sampleRate: 16_000,
          getChannelData: () => new Float32Array(16_000),
        },
        500,
        500,
      ),
    ).toThrow("没有可转写的音频范围");
  });
});
