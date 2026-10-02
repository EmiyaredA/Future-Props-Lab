import { describe, expect, it } from "vitest";
import {
  audioSweepFrequency,
  audioTransitionGain,
  audioTransitionKinds,
  audioTransitionProgress,
} from "@features/video-editor/audioTransitionCurves";

describe("audio transition curves", () => {
  it.each(audioTransitionKinds)(
    "keeps %s aligned at both seam ends",
    (kind) => {
      expect(audioTransitionGain(kind, 0, false)).toBeCloseTo(1);
      expect(audioTransitionGain(kind, 0, true)).toBeCloseTo(0);
      expect(audioTransitionGain(kind, 1, false)).toBeCloseTo(0);
      expect(audioTransitionGain(kind, 1, true)).toBeCloseTo(1);
    },
  );

  it("uses distinct midpoint gains", () => {
    expect(audioTransitionGain("audio-crossfade", 0.5, false)).toBe(0.5);
    expect(audioTransitionGain("audio-equal-power", 0.5, false)).toBeCloseTo(
      Math.SQRT1_2,
    );
    expect(audioTransitionGain("audio-dip", 0.5, false)).toBe(0);
    expect(audioTransitionGain("audio-dip", 0.5, true)).toBe(0);
  });

  it("closes the outgoing low-pass and opens the incoming high-pass", () => {
    expect(audioSweepFrequency(0, false)).toBe(18_000);
    expect(audioSweepFrequency(1, false)).toBe(300);
    expect(audioSweepFrequency(0, true)).toBe(3_000);
    expect(audioSweepFrequency(1, true)).toBe(30);
    expect(audioTransitionProgress(0.5, "ease-in")).toBe(0.25);
  });
});
