import { describe, expect, test } from "vitest";
import type { GalgameStoryFragment } from "@features/galgame-workshop/api";
import {
  activeTimelineCue,
  attachTimelineCharacterEvent,
  appendBlockToTimeline,
  effectivePointTime,
  enableFragmentTimeline,
  formatTimecode,
  moveTimelineCgRange,
  moveTimelineCue,
  parseTimecode,
  projectFragmentTimeline,
  resizeTimelineBoundary,
  resizeTimelineCueEnd,
  setTimelineCueEdge,
  setTimelineCgRangeEdge,
  setTimelineDuration,
  setTimelinePointTime,
  setTimelineGapEdge,
  timelineAudioStateAt,
  timelineCgRanges,
  timelineCharacterTiming,
  timelineCues,
  timelineEvents,
  timelineGaps,
  timelinePlaybackSteps,
  timelineStageMarkers,
} from "@features/galgame-workshop/editor/timeline";

function fragment(): GalgameStoryFragment {
  return {
    id: "timeline",
    title: "时间轴",
    timeline: { durationMs: 10_000 },
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
          anchor: "bottomCenter",
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
  test("derives CG ranges ending at hide, replacement, or the timeline end", () => {
    const value: GalgameStoryFragment = {
      id: "cg-timeline",
      title: "CG 时间轴",
      timeline: { durationMs: 8000 },
      blocks: [
        {
          id: "cg-one",
          type: "showCg",
          atMs: 500,
          cgId: "one",
          displayMode: "fullscreen",
          fit: "cover",
        },
        { id: "cg-one-hide", type: "hideCg", atMs: 2000 },
        {
          id: "cg-two",
          type: "showCg",
          atMs: 3000,
          cgId: "two",
          displayMode: "overlay",
          fit: "cover",
        },
        {
          id: "cg-three",
          type: "showCg",
          atMs: 5000,
          cgId: "three",
          displayMode: "overlay",
          fit: "cover",
        },
      ],
    };

    expect(
      timelineCgRanges(value).map((range) => [
        range.showBlock.id,
        range.startMs,
        range.endMs,
        range.endKind,
      ]),
    ).toEqual([
      ["cg-one", 500, 2000, "hide"],
      ["cg-two", 3000, 5000, "replace"],
      ["cg-three", 5000, 8000, "timeline"],
    ]);
  });

  test("edits shared CG range boundaries and materializes an implicit hide", () => {
    const value: GalgameStoryFragment = {
      id: "cg-timeline",
      title: "CG 时间轴",
      timeline: { durationMs: 8000 },
      blocks: [
        {
          id: "cg-one",
          type: "showCg",
          atMs: 1000,
          cgId: "one",
          displayMode: "overlay",
          fit: "cover",
        },
        {
          id: "cg-two",
          type: "showCg",
          atMs: 4000,
          cgId: "two",
          displayMode: "fullscreen",
          fit: "cover",
        },
      ],
    };
    const shared = setTimelineCgRangeEdge(value, "cg-one", "end", 4500);
    expect(shared.blocks?.find((block) => block.id === "cg-two")).toMatchObject(
      { atMs: 4500 },
    );

    const withHide = setTimelineCgRangeEdge(
      shared,
      "cg-two",
      "end",
      7000,
      false,
      () => "cg-two-hide",
    );
    expect(
      withHide.blocks?.find((block) => block.id === "cg-two-hide"),
    ).toMatchObject({ type: "hideCg", atMs: 7000 });
  });

  test("moves a CG range as one interval and keeps its duration", () => {
    const value: GalgameStoryFragment = {
      id: "cg-timeline",
      title: "CG 时间轴",
      timeline: { durationMs: 6000 },
      blocks: [
        {
          id: "cg-one",
          type: "showCg",
          atMs: 1000,
          cgId: "one",
          displayMode: "overlay",
          fit: "cover",
        },
        { id: "cg-one-hide", type: "hideCg", atMs: 3000 },
      ],
    };
    const moved = moveTimelineCgRange(value, "cg-one", 750);
    expect(moved.blocks?.find((block) => block.id === "cg-one")).toMatchObject({
      atMs: 1800,
    });
    expect(
      moved.blocks?.find((block) => block.id === "cg-one-hide"),
    ).toMatchObject({ atMs: 3800 });
  });

  test("resets a hide CG event to 100ms after its paired show event", () => {
    const value: GalgameStoryFragment = {
      id: "cg-timeline",
      title: "CG 时间轴",
      timeline: { durationMs: 6000 },
      blocks: [
        {
          id: "cg-one",
          type: "showCg",
          atMs: 2000,
          cgId: "one",
          displayMode: "overlay",
          fit: "cover",
        },
        { id: "cg-one-hide", type: "hideCg", atMs: 3000 },
      ],
    };

    const updated = setTimelinePointTime(value, "cg-one-hide", 1500, true);
    expect(
      updated.blocks?.find((block) => block.id === "cg-one-hide"),
    ).toMatchObject({ atMs: 2100 });

    const appended = appendBlockToTimeline(
      { ...value, blocks: value.blocks?.slice(0, 1) },
      { id: "new-hide", type: "hideCg" },
      1500,
    );
    expect(
      appended.blocks?.find((block) => block.id === "new-hide"),
    ).toMatchObject({ atMs: 2100 });
  });

  test("adds timed content before an existing branch or chapter ending", () => {
    const updated = appendBlockToTimeline(
      {
        ...fragment(),
        blocks: [
          ...(fragment().blocks ?? []),
          {
            id: "ending",
            type: "endChapter",
            endingId: "ending-main",
            label: "完",
          },
        ],
      },
      {
        id: "new-dialogue",
        type: "dialogue",
        characterId: "hero",
        text: "新对白",
      },
      9500,
    );

    expect(updated.blocks?.at(-1)).toMatchObject({
      id: "ending",
      type: "endChapter",
    });
    expect(updated.blocks?.at(-2)).toMatchObject({
      id: "new-dialogue",
      type: "dialogue",
      startMs: 9500,
    });
  });

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
    expect(updated.timeline?.durationMs).toBe(11_000);
  });

  test("ripple trims one cue and shifts every following cue", () => {
    const expanded = resizeTimelineCueEnd(fragment(), "cue-1", 3500, {
      precise: true,
      ripple: true,
    });
    expect(
      timelineCues(expanded).map(({ startMs, endMs }) => [startMs, endMs]),
    ).toEqual([
      [0, 3500],
      [3500, 6500],
      [6500, 9500],
    ]);

    const shortened = resizeTimelineCueEnd(fragment(), "cue-1", 2500, {
      precise: true,
      ripple: true,
    });
    expect(
      timelineCues(shortened).map(({ startMs, endMs }) => [startMs, endMs]),
    ).toEqual([
      [0, 2500],
      [2500, 5500],
      [5500, 8500],
    ]);
    expect(timelineGaps(shortened).at(-1)).toMatchObject({
      kind: "trailing",
      startMs: 8500,
      endMs: 10_000,
    });
    expect(shortened.timeline?.durationMs).toBe(10_000);
  });

  test("ripple trim preserves gaps and expands beyond the previous timeline end", () => {
    const withGap = setTimelineCueEdge(
      fragment(),
      "cue-2",
      "start",
      4000,
      false,
    );
    const expanded = resizeTimelineCueEnd(withGap, "cue-1", 3500, {
      precise: true,
      ripple: true,
    });
    expect(
      timelineCues(expanded).map(({ startMs, endMs }) => [startMs, endMs]),
    ).toEqual([
      [0, 3500],
      [4500, 6500],
      [6500, 9500],
    ]);
    expect(timelineGaps(expanded)[0]).toMatchObject({
      kind: "internal",
      startMs: 3500,
      endMs: 4500,
    });

    const trackExpanded = resizeTimelineCueEnd(fragment(), "cue-1", 5000, {
      precise: true,
      ripple: true,
    });
    expect(
      timelineCues(trackExpanded).map(({ startMs, endMs }) => [startMs, endMs]),
    ).toEqual([
      [0, 5000],
      [5000, 8000],
      [8000, 11_000],
    ]);
    expect(trackExpanded.timeline?.durationMs).toBe(12_000);

    const cueClamped = resizeTimelineCueEnd(fragment(), "cue-1", 0, {
      precise: true,
      ripple: true,
    });
    expect(timelineCues(cueClamped)[0]).toMatchObject({
      startMs: 0,
      endMs: 100,
    });
    expect(timelineCues(cueClamped)[1]).toMatchObject({
      startMs: 100,
      endMs: 3100,
    });
  });

  test("ripple trim can extend the final cue without moving earlier cues", () => {
    const updated = resizeTimelineCueEnd(fragment(), "cue-3", 9500, {
      precise: true,
      ripple: true,
    });
    expect(
      timelineCues(updated).map(({ startMs, endMs }) => [startMs, endMs]),
    ).toEqual([
      [0, 3000],
      [3000, 6000],
      [6000, 9500],
    ]);
  });

  test("ordinary end edits grow the timeline and manual duration keeps every cue", () => {
    const expanded = resizeTimelineCueEnd(fragment(), "cue-3", 12_500, {
      precise: true,
      keepContinuous: false,
    });
    expect(timelineCues(expanded).at(-1)).toMatchObject({
      startMs: 6000,
      endMs: 12_500,
    });
    expect(expanded.timeline?.durationMs).toBe(12_500);

    expect(setTimelineDuration(expanded, 20_000).timeline?.durationMs).toBe(
      20_000,
    );
    expect(setTimelineDuration(expanded, 8000).timeline?.durationMs).toBe(
      12_500,
    );

    const moved = moveTimelineCue(fragment(), "cue-3", 2500, {
      precise: true,
      keepContinuous: true,
    });
    expect(timelineCues(moved).at(-1)).toMatchObject({
      startMs: 8500,
      endMs: 11_500,
    });
    expect(moved.timeline?.durationMs).toBe(11_500);
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

  test("enables a timeline without a reference track and estimates ordered cue ranges", () => {
    const enabled = enableFragmentTimeline({
      id: "untimed",
      title: "无参考轨",
      blocks: [
        { id: "scene", type: "scene", sceneId: "lab" },
        { id: "first", type: "narration", text: "第一句" },
        {
          id: "show",
          type: "showCharacter",
          characterId: "hero",
          transform: {
            x: 50,
            y: 100,
            anchor: "bottomCenter",
            scale: 1,
            brightness: 1,
            opacity: 1,
            flipX: false,
            layer: 10,
          },
          transition: { durationMs: 240, fade: true },
        },
        { id: "second", type: "narration", text: "第二句" },
      ],
    });

    expect(enabled.timeline).toEqual({ durationMs: 3800 });
    expect(
      timelineCues(enabled).map(({ startMs, endMs }) => [startMs, endMs]),
    ).toEqual([
      [0, 1500],
      [1800, 3300],
    ]);
    expect(enabled.blocks?.[0]).toMatchObject({ atMs: 0 });
    expect(enabled.blocks?.[2]).not.toHaveProperty("atMs");
    expect(effectivePointTime(enabled, 2)).toBe(1800);
  });

  test("keeps character events attached until they are moved independently", () => {
    const value = fragment();
    expect(timelineCharacterTiming(value, "show-hero")).toEqual({
      mode: "dialogue",
      dialogueBlockId: "cue-1",
    });

    const movedCue = setTimelineCueEdge(
      value,
      "cue-1",
      "start",
      1000,
      false,
      true,
    );
    expect(effectivePointTime(movedCue, 1)).toBe(1000);
    expect(movedCue.blocks?.[1]).not.toHaveProperty("atMs");

    const independent = setTimelinePointTime(movedCue, "show-hero", 1500, true);
    expect(independent.blocks?.[1]).toMatchObject({ atMs: 1500 });
    expect(timelineCharacterTiming(independent, "show-hero")).toEqual({
      mode: "independent",
      timeMs: 1500,
    });

    const attached = attachTimelineCharacterEvent(
      independent,
      "show-hero",
      "cue-2",
    );
    const attachedIndex = attached.blocks!.findIndex(
      (block) => block.id === "show-hero",
    );
    expect(attached.blocks?.[attachedIndex]).not.toHaveProperty("atMs");
    expect(attached.blocks?.[attachedIndex + 1]?.id).toBe("cue-2");
    expect(timelineCharacterTiming(attached, "show-hero")).toEqual({
      mode: "dialogue",
      dialogueBlockId: "cue-2",
    });
  });

  test("derives legacy anchors and runs same-time events in deterministic order", () => {
    const value = fragment();
    value.blocks = [
      value.blocks![0],
      value.blocks![1],
      {
        id: "show-cg",
        type: "showCg",
        cgId: "cg-one",
        variantId: null,
        displayMode: "fullscreen",
        fit: "cover",
        transition: { durationMs: 400, fade: true },
        atMs: 0,
      },
      {
        id: "stop-bgm",
        type: "audio",
        action: "stop",
        channel: "bgm",
        assetId: null,
        volume: 70,
        loop: true,
        fadeMs: 100,
        atMs: 0,
      },
      {
        id: "play-bgm",
        type: "audio",
        action: "play",
        channel: "bgm",
        assetId: "bgm",
        volume: 70,
        loop: true,
        fadeMs: 100,
        atMs: 0,
      },
      {
        id: "sfx",
        type: "audio",
        action: "play",
        channel: "sfx",
        assetId: "click",
        volume: 100,
        loop: false,
        fadeMs: 0,
        atMs: 0,
      },
      ...value.blocks!.slice(2),
    ];

    expect(effectivePointTime(value, 0)).toBe(0);
    expect(effectivePointTime(value, 1)).toBe(0);
    expect(
      timelineEvents(value)
        .filter((event) => event.timeMs === 0)
        .map((event) =>
          event.block.type === "audio"
            ? `${event.block.action}:${event.block.channel}`
            : event.block.type,
        ),
    ).toEqual([
      "scene",
      "showCharacter",
      "showCg",
      "stop:bgm",
      "play:bgm",
      "play:sfx",
      "dialogue",
    ]);
  });

  test("seeks persistent audio state without replaying sound effects", () => {
    const value = fragment();
    value.blocks!.push(
      {
        id: "bgm-a",
        type: "audio",
        action: "play",
        channel: "bgm",
        assetId: "music-a",
        volume: 70,
        loop: true,
        fadeMs: 500,
        atMs: 1000,
      },
      {
        id: "sfx-once",
        type: "audio",
        action: "play",
        channel: "sfx",
        assetId: "bell",
        volume: 100,
        loop: false,
        fadeMs: 0,
        atMs: 2000,
      },
      {
        id: "bgm-stop",
        type: "audio",
        action: "stop",
        channel: "bgm",
        assetId: null,
        volume: 70,
        loop: true,
        fadeMs: 500,
        atMs: 4000,
      },
    );

    expect(timelineAudioStateAt(value, 3000).bgm?.id).toBe("bgm-a");
    expect(timelineAudioStateAt(value, 3000)).not.toHaveProperty("sfx");
    expect(timelineAudioStateAt(value, 5000).bgm).toBeUndefined();
    const moved = setTimelinePointTime(value, "sfx-once", 2555, true);
    expect(
      moved.blocks?.find((block) => block.id === "sfx-once"),
    ).toMatchObject({
      atMs: 2555,
    });
  });

  test("derives playback steps for opening, dialogue gaps and the timeline tail", () => {
    const value = fragment();
    value.blocks = value.blocks?.map((block) =>
      block.id === "cue-1" ? { ...block, startMs: 1000, endMs: 2500 } : block,
    );

    expect(timelinePlaybackSteps(value)).toEqual([
      { startMs: 0, endMs: 1000 },
      { startMs: 1000, endMs: 3000, contentBlockIndex: 2 },
      { startMs: 3000, endMs: 6000, contentBlockIndex: 3 },
      { startMs: 6000, endMs: 10_000, contentBlockIndex: 4 },
    ]);
  });

  test("creates one playback step for a performance-only timeline", () => {
    const value: GalgameStoryFragment = {
      id: "performance",
      title: "纯演出",
      timeline: { durationMs: 2000 },
      blocks: [
        {
          id: "scene",
          type: "scene",
          sceneId: "lab",
          backgroundId: null,
          clearCharacters: true,
          atMs: 0,
        },
      ],
    };

    expect(timelinePlaybackSteps(value)).toEqual([{ startMs: 0, endMs: 2000 }]);
  });

  test("returns no playback steps for an empty zero-length timeline", () => {
    expect(
      timelinePlaybackSteps({
        id: "empty",
        title: "空 Fragment",
        timeline: { durationMs: 0 },
        blocks: [],
      }),
    ).toEqual([]);
  });

  test("projects an untimed fragment without mutating its persisted shape", () => {
    const legacy: GalgameStoryFragment = {
      id: "legacy",
      title: "旧剧本",
      blocks: [{ id: "line", type: "narration", text: "估算时间" }],
    };
    const projected = projectFragmentTimeline(legacy);
    expect(legacy.timeline).toBeUndefined();
    expect(legacy.blocks?.[0]).not.toHaveProperty("startMs");
    expect(projected.timeline?.durationMs).toBeGreaterThan(0);
    expect(projected.blocks?.[0]).toMatchObject({ startMs: 0 });
  });
});
