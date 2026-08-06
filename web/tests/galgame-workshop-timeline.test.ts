import { describe, expect, test } from "vitest";
import type { GalgameStoryFragment } from "@features/galgame-workshop/api";
import {
  activeTimelineCue,
  formatTimecode,
  moveTimelineCue,
  parseTimecode,
  resizeTimelineBoundary,
  setTimelineCueEdge,
  setTimelineGapEdge,
  timelineCues,
  timelineGaps,
  timelineStageMarkers,
} from "@features/galgame-workshop/editor/timeline";

function fragment(): GalgameStoryFragment {
  return {
    id: "timeline",
    title: "时间轴",
    timeline: { assetId: "track", durationMs: 10_000 },
    blocks: [
      {
        id: "scene",
        type: "scene",
        sceneId: "lab",
        backgroundId: null,
        clearCharacters: true,
      },
      {
        id: "show-hero",
        type: "showCharacter",
        characterId: "hero",
        expressionId: null,
        transform: {
          x: 50,
          y: 100,
          scale: 1,
          brightness: 1,
          opacity: 1,
          flipX: false,
          layer: 10,
        },
        transition: { durationMs: 240, fade: true },
      },
      {
        id: "cue-1",
        type: "dialogue",
        characterId: "hero",
        text: "第一句",
        startMs: 0,
        endMs: 3000,
      },
      {
        id: "cue-2",
        type: "dialogue",
        characterId: "partner",
        text: "第二句",
        startMs: 3000,
        endMs: 6000,
      },
      {
        id: "cue-3",
        type: "narration",
        text: "第三句",
        startMs: 6000,
        endMs: 9000,
      },
    ],
  };
}

describe("Galgame timeline editing", () => {
  test("formats and parses millisecond timecodes", () => {
    expect(formatTimecode(1_780_343)).toBe("29:40.343");
    expect(parseTimecode("29:40.343")).toBe(1_780_343);
    expect(parseTimecode("01:02.5")).toBe(62_500);
    expect(parseTimecode("01:65.000")).toBeUndefined();
  });

  test("moves one shared boundary atomically and enforces minimum duration", () => {
    const updated = resizeTimelineBoundary(fragment(), "cue-1", 4200, true);
    expect(
      timelineCues(updated).map(({ startMs, endMs }) => [startMs, endMs]),
    ).toEqual([
      [0, 4200],
      [4200, 6000],
      [6000, 9000],
    ]);

    const clamped = resizeTimelineBoundary(updated, "cue-1", 5999, true);
    expect(timelineCues(clamped)[0].endMs).toBe(5900);
    expect(timelineCues(clamped)[1].startMs).toBe(5900);
  });

  test("moves a cue while compensating adjacent continuous cues", () => {
    const updated = moveTimelineCue(fragment(), "cue-2", 500, {
      precise: true,
      keepContinuous: true,
    });
    expect(
      timelineCues(updated).map(({ startMs, endMs }) => [startMs, endMs]),
    ).toEqual([
      [0, 3500],
      [3500, 6500],
      [6500, 9000],
    ]);
  });

  test("derives and edits leading, internal, and trailing gaps", () => {
    let updated = setTimelineCueEdge(fragment(), "cue-1", "start", 1000, false);
    updated = setTimelineCueEdge(updated, "cue-2", "start", 3500, false);
    updated = setTimelineCueEdge(updated, "cue-3", "end", 8500, false);
    expect(
      timelineGaps(updated).map(({ kind, startMs, endMs }) => [
        kind,
        startMs,
        endMs,
      ]),
    ).toEqual([
      ["leading", 0, 1000],
      ["internal", 3000, 3500],
      ["trailing", 8500, 10_000],
    ]);

    const leading = timelineGaps(updated)[0];
    updated = setTimelineGapEdge(updated, leading.id, "end", 1200);
    expect(timelineCues(updated)[0].startMs).toBe(1200);
    const internal = timelineGaps(updated).find(
      (gap) => gap.kind === "internal",
    )!;
    updated = setTimelineGapEdge(updated, internal.id, "start", 2800);
    updated = setTimelineGapEdge(updated, internal.id, "end", 3700);
    expect(timelineCues(updated)[0].endMs).toBe(2800);
    expect(timelineCues(updated)[1].startMs).toBe(3700);
  });

  test("moves first and last cues to create edge gaps", () => {
    const firstMoved = moveTimelineCue(fragment(), "cue-1", 500, {
      precise: true,
      keepContinuous: true,
    });
    expect(
      timelineCues(firstMoved).map(({ startMs, endMs }) => [startMs, endMs]),
    ).toEqual([
      [500, 3500],
      [3500, 6000],
      [6000, 9000],
    ]);
    expect(timelineGaps(firstMoved)[0]).toMatchObject({
      kind: "leading",
      startMs: 0,
      endMs: 500,
    });

    const lastMoved = moveTimelineCue(fragment(), "cue-3", -500, {
      precise: true,
      keepContinuous: true,
    });
    expect(
      timelineCues(lastMoved).map(({ startMs, endMs }) => [startMs, endMs]),
    ).toEqual([
      [0, 3000],
      [3000, 5500],
      [5500, 8500],
    ]);
    expect(timelineGaps(lastMoved).at(-1)).toMatchObject({
      kind: "trailing",
      startMs: 8500,
      endMs: 10_000,
    });
  });

  test("ripple moves the selected and following cues without overlap", () => {
    const withRoom = setTimelineCueEdge(
      fragment(),
      "cue-3",
      "end",
      8000,
      false,
    );
    const updated = moveTimelineCue(withRoom, "cue-2", 1000, {
      precise: true,
      ripple: true,
    });
    expect(
      timelineCues(updated).map(({ startMs, endMs }) => [startMs, endMs]),
    ).toEqual([
      [0, 3000],
      [4000, 7000],
      [7000, 9000],
    ]);
  });

  test("tracks stage markers and leaves timeline gaps without an active cue", () => {
    const value = fragment();
    expect(
      timelineStageMarkers(value)
        .get("cue-1")
        ?.map((block) => block.id),
    ).toEqual(["scene", "show-hero"]);
    const withGap = setTimelineCueEdge(value, "cue-2", "start", 3500, false);
    expect(activeTimelineCue(withGap, 3200)).toBeUndefined();
    expect(activeTimelineCue(withGap, 3600)?.block.id).toBe("cue-2");
  });
});
