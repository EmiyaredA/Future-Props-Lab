import { describe, expect, it, vi } from "vitest";
import {
  findTimelineGaps,
  preciseGapTime,
} from "@features/video-editor/timelineGaps";
import { planGapEdits } from "@features/video-editor/gapEditPlan";
import { TimelineSaveQueue } from "@features/video-editor/timelineSaveQueue";
import type {
  VideoEditorTimeline,
  VideoEditorOperation,
} from "@features/video-editor/types";
import {
  gapAsset,
  gapClip,
  gapTimeline,
  gapTrack,
} from "./helpers/video-editor-gaps";

function apply(
  timeline: VideoEditorTimeline,
  operations: VideoEditorOperation[],
) {
  const next = structuredClone(timeline);
  next.revision++;
  for (const op of operations) {
    if (op.type !== "restoreClipStates") continue;
    for (const track of next.document.tracks ?? [])
      track.clips = (track.clips ?? []).map(
        (clip) => op.clips.find((state) => state.id === clip.id) ?? clip,
      );
  }
  return next;
}
const clips = (state: VideoEditorTimeline) =>
  new Map(
    state.document
      .tracks!.flatMap((track) => track.clips ?? [])
      .map((clip) => [clip.id, clip]),
  );

describe("picture gaps", () => {
  it("reports microsecond gaps per track, excluding text/audio/hidden and outer blank space", () => {
    const first = gapClip("first", 50_000);
    const next = gapClip("next", 1_099_710);
    const timeline = gapTimeline([
      gapTrack("v", [first, next, gapClip("last", 3_499_713)]),
      gapTrack("text", [
        gapClip("subtitle", 0, { kind: "text", durationUs: 5_000_000 }),
      ]),
      gapTrack("audio", [first, next], { kind: "audio" }),
      gapTrack("hidden", [first, next], { hidden: true }),
      gapTrack("underneath", [
        gapClip("covered", 0, { kind: "color", durationUs: 9_000_000 }),
      ]),
    ]);
    const gaps = findTimelineGaps(timeline);
    expect(gaps.map((gap) => [gap.trackId, gap.durationUs])).toEqual([
      ["v", 49_707],
      ["v", 1_400_000],
    ]);
    expect(gaps[0].startUs).toBe(1_050_003);
    expect(preciseGapTime(154_049_707)).toBe("02:34.049707");
  });
  it("treats exact seams, black color and repair freeze images as picture coverage", () => {
    expect(
      findTimelineGaps(
        gapTimeline([
          gapTrack("v", [
            gapClip("left", 0),
            gapClip("black", 1_000_003, { kind: "color", durationUs: 49_707 }),
            gapClip("freeze repair", 1_049_710, {
              kind: "image",
              durationUs: 101,
            }),
            gapClip("right", 1_049_811),
          ]),
        ]),
      ),
    ).toEqual([]);
  });
  it("ignores text covering the same track gap without permitting an overlapping extension", () => {
    const state = gapTimeline();
    state.document.tracks![0].clips!.push(
      gapClip("label", 1_000_003, { kind: "text", durationUs: 49_707 }),
    );
    const gaps = findTimelineGaps(state);
    expect(gaps[0].durationUs).toBe(49_707);
    expect(
      planGapEdits(state, [gapAsset()], [gaps[0]], "extend").issues.join(),
    ).toContain("重叠");
  });
});

describe.each([30, 60] as const)("precise batch planning at %i FPS", (fps) => {
  it("extends multiple linked media, preserving source/rate/followers, music and subtitles, with exact inverses", () => {
    const timeline = gapTimeline(undefined, fps);
    timeline.document.tracks![0].clips![0].linkGroupId = "left-av";
    timeline.document.tracks![0].clips![0].playbackRate = 2;
    timeline.document.tracks!.push(
      gapTrack(
        "a",
        [
          gapClip("left-a", 0, {
            kind: "audio",
            linkGroupId: "left-av",
            playbackRate: 2,
          }),
          gapClip("music", 0, { kind: "audio", durationUs: 8_000_000 }),
        ],
        { kind: "audio" },
      ),
      gapTrack("s", [
        gapClip("subtitle", 0, { kind: "text", durationUs: 7_000_000 }),
      ]),
    );
    const gaps = findTimelineGaps(timeline);
    const plan = planGapEdits(timeline, [gapAsset()], gaps, "extend");
    expect(plan.issues).toEqual([]);
    expect(plan.redo).toHaveLength(1);
    expect(plan.affectedClipIds.sort()).toEqual(["left", "left-a", "middle"]);
    const after = apply(timeline, plan.redo);
    expect(findTimelineGaps(after)).toEqual([]);
    for (const id of ["left", "left-a", "middle"]) {
      expect(clips(after).get(id)!.sourceInUs).toBe(
        clips(timeline).get(id)!.sourceInUs,
      );
      expect(clips(after).get(id)!.playbackRate).toBe(
        clips(timeline).get(id)!.playbackRate,
      );
      expect(clips(after).get(id)!.timelineStartUs).toBe(
        clips(timeline).get(id)!.timelineStartUs,
      );
    }
    for (const id of ["right", "music", "subtitle"])
      expect(clips(after).get(id)).toEqual(clips(timeline).get(id));
    expect(apply(after, plan.undo).document).toEqual(timeline.document);
  });
  it("ripple accumulates selected gaps, retains unselected intervals, and moves linked followers only", () => {
    const timeline = gapTimeline(undefined, fps);
    const v = timeline.document.tracks![0].clips!;
    v[1].linkGroupId = "middle-av";
    v.push(gapClip("last", 3_499_423)); // second short gap after a long unselected gap
    timeline.document.tracks!.push(
      gapTrack(
        "a",
        [
          gapClip("middle-a", 1_049_710, {
            kind: "audio",
            linkGroupId: "middle-av",
          }),
          gapClip("music", 0, { kind: "audio", durationUs: 8_000_000 }),
        ],
        { kind: "audio" },
      ),
    );
    const gaps = findTimelineGaps(timeline);
    const selected = [gaps[0], gaps[2]];
    const plan = planGapEdits(timeline, [], selected, "ripple");
    expect(plan.issues).toEqual([]);
    const after = apply(timeline, plan.redo);
    expect(findTimelineGaps(after).map((gap) => gap.durationUs)).toEqual([
      400_000,
    ]);
    expect(clips(after).get("middle-a")!.timelineStartUs).toBe(1_000_003);
    expect(clips(after).get("right")!.timelineStartUs).toBe(2_400_006);
    expect(clips(after).get("music")).toEqual(clips(timeline).get("music"));
    expect(apply(after, plan.undo).document).toEqual(timeline.document);
  });
});

describe("gap constraints", () => {
  it.each([
    [gapAsset({ processingStatus: "processing" }), "尚未准备好"],
    [gapAsset({ probe: {} }), "长度未知"],
    [gapAsset({ probe: { durationUs: 1_049_732 } }), "剩余长度不足"],
  ])("rejects unavailable handles (%s)", (asset, message) => {
    const state = gapTimeline();
    expect(
      planGapEdits(
        state,
        [asset],
        [findTimelineGaps(state)[0]],
        "extend",
      ).issues.join(),
    ).toContain(message);
  });
  it("checks fast playback and every linked source, supports ready images and colors", () => {
    const state = gapTimeline();
    const first = state.document.tracks![0].clips![0];
    first.linkGroupId = "av";
    state.document.tracks!.push(
      gapTrack(
        "a",
        [
          gapClip("sound", 0, {
            kind: "audio",
            assetId: "short",
            linkGroupId: "av",
          }),
        ],
        { kind: "audio" },
      ),
    );
    expect(
      planGapEdits(
        state,
        [
          gapAsset(),
          gapAsset({ id: "short", probe: { durationUs: 1_000_100 } }),
        ],
        [findTimelineGaps(state)[0]],
        "extend",
      ).issues.join(),
    ).toContain("sound");
    first.playbackRate = 4;
    expect(
      planGapEdits(
        state,
        [
          gapAsset({ probe: { durationUs: 4_000_100 } }),
          gapAsset({ id: "short" }),
        ],
        [findTimelineGaps(state)[0]],
        "extend",
      ).issues.join(),
    ).toContain("left");
    for (const kind of ["image", "color"] as const) {
      const picture = gapTimeline();
      picture.document.tracks![0].clips![0].kind = kind;
      expect(
        planGapEdits(
          picture,
          [gapAsset({ probe: {} })],
          [findTimelineGaps(picture)[0]],
          "extend",
        ).issues,
      ).toEqual([]);
    }
  });
  it.each(["extend", "ripple"] as const)(
    "rejects locked linked tracks atomically in %s",
    (mode) => {
      const state = gapTimeline();
      for (const clip of state.document.tracks![0].clips!)
        clip.linkGroupId = clip.id;
      state.document.tracks!.push(
        gapTrack(
          "a",
          state.document.tracks![0].clips!.map((clip) => ({
            ...clip,
            id: clip.id + "-audio",
            kind: "audio",
          })),
          { kind: "audio", locked: true },
        ),
      );
      const plan = planGapEdits(
        state,
        [gapAsset()],
        findTimelineGaps(state),
        mode,
      );
      expect(plan.issues.join()).toContain("锁定");
      expect(plan.redo).toEqual([]);
    },
  );
  it("unifies linked multi-track shifts, rejects inconsistent group shifts, overlaps and negative times", () => {
    const state = gapTimeline();
    state.document.tracks![0].clips![1].linkGroupId = "pair";
    state.document.tracks!.push(
      gapTrack("v2", [
        gapClip("left2", 0),
        gapClip("middle2", 1_049_710, { linkGroupId: "pair" }),
      ]),
    );
    const gaps = findTimelineGaps(state);
    expect(
      planGapEdits(state, [], [gaps[0], gaps[2]], "ripple").issues,
    ).toEqual([]);
    state.document.tracks![1].clips![1].timelineStartUs += 5;
    expect(
      planGapEdits(state, [], findTimelineGaps(state), "ripple").issues.join(),
    ).toContain("不同调整量");
    state.document.tracks![1].clips![1].timelineStartUs = 1_000_010;
    expect(
      planGapEdits(
        state,
        [],
        [findTimelineGaps(state)[0]],
        "ripple",
      ).issues.join(),
    ).toContain("重叠");
    state.document.tracks![1].clips![1].timelineStartUs = 2;
    expect(
      planGapEdits(
        state,
        [],
        [findTimelineGaps(state)[0]],
        "ripple",
      ).issues.join(),
    ).toContain("起点之前");
  });
  it("rejects stale seam results", () => {
    const state = gapTimeline();
    const gaps = findTimelineGaps(state);
    state.document.tracks![0].clips![0].durationUs++;
    expect(
      planGapEdits(state, [gapAsset()], gaps, "extend").issues.join(),
    ).toContain("接点已变化");
  });
});

describe("batch saving", () => {
  it("creates one undo/redo entry for multiple gaps and restores exact states", async () => {
    let current = gapTimeline();
    const initial = structuredClone(current);
    const write = vi.fn(
      async (_revision: number, ops: VideoEditorOperation[]) =>
        apply(current, ops),
    );
    const queue = new TimelineSaveQueue({
      read: () => current,
      write,
      saved: (next) => {
        current = next;
      },
      failed: vi.fn(),
      changed: vi.fn(),
    });
    await queue.enqueue("edit", (state) =>
      planGapEdits(state, [gapAsset()], findTimelineGaps(state), "extend"),
    );
    const completed = structuredClone(current.document);
    expect(write).toHaveBeenCalledOnce();
    await queue.enqueue("undo");
    expect(current.document).toEqual(initial.document);
    expect(queue.canUndo).toBe(false);
    await queue.enqueue("redo");
    expect(current.document).toEqual(completed);
  });
  it.each(["409 conflict", "network failure"])(
    "pauses %s without partial state or automatic replay",
    async (message) => {
      let current = gapTimeline();
      const initial = structuredClone(current);
      const write = vi.fn(async () => {
        throw new Error(message);
      });
      const queue = new TimelineSaveQueue({
        read: () => current,
        write,
        saved: (next) => {
          current = next;
        },
        failed: vi.fn(),
        changed: vi.fn(),
      });
      await expect(
        queue.enqueue("edit", (state) =>
          planGapEdits(state, [gapAsset()], findTimelineGaps(state), "extend"),
        ),
      ).rejects.toThrow(message);
      expect(current).toEqual(initial);
      expect(queue.canUndo).toBe(false);
      await expect(
        queue.enqueue("edit", () => ({ redo: [], undo: [] })),
      ).rejects.toThrow("未保存");
      expect(write).toHaveBeenCalledOnce();
    },
  );
});
