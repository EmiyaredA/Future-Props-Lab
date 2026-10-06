import { describe, expect, it } from "vitest";
import {
  COMFORT_MIN_TIMELINE_ZOOM,
  clampTimelineZoom,
  fittedTimelineZoom,
  getTimelineRulerStepSeconds,
  MIN_TIMELINE_ZOOM,
  timelineScrollLeftAfterZoom,
  timelineZoomMinimum,
} from "@features/video-editor/timelineScale";

describe("video editor timeline scale", () => {
  it("keeps a hard floor below the comfort overview while labeling long spans", () => {
    expect(MIN_TIMELINE_ZOOM).toBe(1);
    expect(COMFORT_MIN_TIMELINE_ZOOM).toBe(10);
    expect(getTimelineRulerStepSeconds(1)).toBe(60);
    expect(getTimelineRulerStepSeconds(10)).toBe(5);
    expect(getTimelineRulerStepSeconds(30)).toBe(2);
    expect(getTimelineRulerStepSeconds(80)).toBe(1);
  });

  it("fits zoom to the effective sequence length in the current viewport", () => {
    expect(fittedTimelineZoom(800, 200)).toBe(4);
    expect(fittedTimelineZoom(800, 10)).toBe(80);
    expect(fittedTimelineZoom(0, 10)).toBe(1);
  });

  it("lowers the slider floor only when the sequence outgrows the comfort min", () => {
    expect(timelineZoomMinimum(800, 200)).toBe(4);
    expect(timelineZoomMinimum(800, 10)).toBe(COMFORT_MIN_TIMELINE_ZOOM);
    expect(timelineZoomMinimum(0, 200)).toBe(COMFORT_MIN_TIMELINE_ZOOM);
  });

  it("clamps stored zoom against a dynamic floor", () => {
    expect(clampTimelineZoom(4, 4)).toBe(4);
    expect(clampTimelineZoom(3, 4)).toBe(4);
    expect(clampTimelineZoom(999, 4)).toBe(240);
    expect(clampTimelineZoom(Number.NaN, 4)).toBe(4);
  });

  it("keeps the playhead at the same viewport coordinate across zoom changes", () => {
    const playheadUs = 82_500_000;
    let zoom = 68;
    let scrollLeft = 5_000;
    const anchor = (playheadUs / 1_000_000) * zoom - scrollLeft;
    for (const nextZoom of [120, 119, 30, 10, 240]) {
      scrollLeft = timelineScrollLeftAfterZoom(
        scrollLeft,
        playheadUs,
        zoom,
        nextZoom,
      );
      zoom = nextZoom;
      expect((playheadUs / 1_000_000) * zoom - scrollLeft).toBeCloseTo(anchor);
    }
  });

  it("stops at the sequence start when the playhead anchor needs negative scroll", () => {
    expect(timelineScrollLeftAfterZoom(0, 2_000_000, 80, 10)).toBe(0);
    expect(timelineScrollLeftAfterZoom(400, 0, 80, 120)).toBe(400);
    expect(timelineScrollLeftAfterZoom(123, 82_500_000, 68, 68)).toBe(123);
  });
});
