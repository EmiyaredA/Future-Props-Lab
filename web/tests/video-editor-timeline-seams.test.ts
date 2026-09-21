import { describe, expect, it } from "vitest";
import {
  clipEdgeTransitionWidthPercent,
  seamTransitionStyle,
} from "@features/video-editor/timelineSeams";
import type { VideoEditorClip } from "@features/video-editor/types";

const clip = (id: string, start: number): VideoEditorClip =>
  ({
    id,
    trackId: "v1",
    kind: "video",
    name: id,
    assetId: `${id}-asset`,
    timelineStartUs: start,
    durationUs: 2_000_000,
    sourceInUs: 0,
    sourceLoop: false,
    fitMode: "cover",
    flipX: false,
    fontSize: 72,
    textColor: "#ffffff",
    volume: 1,
    keyframes: [],
  }) as VideoEditorClip;

describe("seamTransitionStyle", () => {
  it("sizes the capsule to the real duration centered on the seam", () => {
    const left = clip("a", 0);
    const right = clip("b", 2_000_000);
    const style = seamTransitionStyle(
      {
        id: "t1",
        kind: "flash",
        durationUs: 500_000,
        placement: "between",
        fromClipId: left.id,
        toClipId: right.id,
        direction: "in",
        easing: "linear",
      },
      new Map([
        [left.id, left],
        [right.id, right],
      ]),
      30,
    );
    // 0.5s * 30px/s = 15px, centered on the 2s seam → starts at 1.75s.
    expect(style.width).toBe("15px");
    expect(style.left).toBe("52.5px");
  });
});

describe("clipEdgeTransitionWidthPercent", () => {
  it("maps edge duration to a percent of the clip body", () => {
    expect(clipEdgeTransitionWidthPercent(500_000, 2_000_000)).toBe(25);
  });

  it("caps at 100 percent and ignores non-positive values", () => {
    expect(clipEdgeTransitionWidthPercent(5_000_000, 2_000_000)).toBe(100);
    expect(clipEdgeTransitionWidthPercent(0, 2_000_000)).toBe(0);
    expect(clipEdgeTransitionWidthPercent(500_000, 0)).toBe(0);
  });
});
