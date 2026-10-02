import { describe, expect, it } from "vitest";
import {
  emptySeamsForTrack,
  seamTransitionStyle,
} from "@features/video-editor/timelineSeams";
import type {
  VideoEditorClip,
  VideoEditorTimelineTransition,
} from "@features/video-editor/types";

const clip = (id: string, timelineStartUs: number): VideoEditorClip =>
  ({
    id,
    trackId: "music",
    kind: "audio",
    timelineStartUs,
    durationUs: 1_000_000,
  }) as VideoEditorClip;

describe("audio seam markers", () => {
  it("offers touching and overlapping audio pairs, but skips gaps", () => {
    const from = clip("a", 0);
    const touching = clip("b", 1_000_000);
    expect(
      emptySeamsForTrack(
        "music",
        new Map([
          ["a", from],
          ["b", touching],
        ]),
        [],
        "audio",
      ),
    ).toEqual([{ from, to: touching }]);
    expect(
      emptySeamsForTrack(
        "music",
        new Map([
          ["a", from],
          ["b", clip("b", 1_100_000)],
        ]),
        [],
        "audio",
      ),
    ).toEqual([]);
  });

  it("draws the applied marker across the true overlap", () => {
    const from = clip("a", 0);
    const to = clip("b", 750_000);
    const transition = {
      kind: "audio-equal-power",
      durationUs: 1,
      fromClipId: "a",
      toClipId: "b",
    } as VideoEditorTimelineTransition;
    expect(
      seamTransitionStyle(
        transition,
        new Map([
          ["a", from],
          ["b", to],
        ]),
        100,
      ),
    ).toEqual({ left: "75px", width: "25px" });
  });
});
