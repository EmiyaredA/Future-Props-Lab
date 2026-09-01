import { describe, expect, it } from "vitest";
import {
  getTimelineRulerStepSeconds,
  MIN_TIMELINE_ZOOM,
} from "@features/video-editor/timelineScale";

describe("video editor timeline scale", () => {
  it("supports a coarser overview without crowding ruler labels", () => {
    expect(MIN_TIMELINE_ZOOM).toBe(10);
    expect(getTimelineRulerStepSeconds(10)).toBe(5);
    expect(getTimelineRulerStepSeconds(30)).toBe(2);
    expect(getTimelineRulerStepSeconds(80)).toBe(1);
  });
});
