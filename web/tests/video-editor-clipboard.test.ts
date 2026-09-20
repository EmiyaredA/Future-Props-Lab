import { describe, expect, it } from "vitest";
import {
  pasteClipOperations,
  pasteClipsOperations,
  snapshotClipForClipboard,
  snapshotClipsForClipboard,
} from "@features/video-editor/clipClipboard";
import { snapUs } from "@features/video-editor/editorModel";
import type {
  VideoEditorClip,
  VideoEditorTrack,
} from "@features/video-editor/types";

const textClip = (
  overrides: Partial<VideoEditorClip> = {},
): VideoEditorClip => ({
  id: "text-1",
  trackId: "text-track",
  kind: "text",
  name: "底部字幕",
  timelineStartUs: 1_000_000,
  durationUs: 3_000_000,
  sourceInUs: 0,
  sourceLoop: false,
  playbackRate: 1,
  text: "真是顽固呢",
  fontSize: 48,
  textColor: "#ffffff",
  textMaxWidth: 1600,
  textStyle: {
    align: "center",
    strokeColor: "#000000",
    strokeWidth: 2,
    backgroundColor: "#000000",
    backgroundOpacity: 0,
  },
  fitMode: "native",
  flipX: false,
  volume: 1,
  keyframes: [
    {
      id: "kf-1",
      property: "opacity",
      timeUs: 0,
      value: 1,
      interpolation: "linear",
    },
  ],
  transform: {
    x: 960,
    y: 1000,
    anchor: "bottomCenter",
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    opacity: 1,
    brightness: 1,
  },
  linkGroupId: "group-1",
  ...overrides,
});

const visualTrack = (
  overrides: Partial<VideoEditorTrack> = {},
): VideoEditorTrack => ({
  id: "text-track",
  kind: "visual",
  name: "文字",
  order: 0,
  locked: false,
  hidden: false,
  muted: false,
  clips: [],
  ...overrides,
});

describe("video editor clip clipboard", () => {
  it("pastes a subtitle clip at the snapped playhead on the original track", () => {
    const snapshot = snapshotClipForClipboard(textClip());
    const result = pasteClipOperations({
      snapshot,
      tracks: [visualTrack({ clips: [textClip()] })],
      playheadUs: 4_300_000,
      fps: 30,
      newClipId: "pasted-1",
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.newClipId).toBe("pasted-1");
    expect(result.redo).toHaveLength(1);
    expect(result.undo).toEqual([{ type: "removeClip", clipId: "pasted-1" }]);
    const operation = result.redo[0];
    expect(operation?.type).toBe("addClip");
    if (operation?.type !== "addClip") return;
    expect(operation.clip.id).toBe("pasted-1");
    expect(operation.clip.trackId).toBe("text-track");
    expect(operation.clip.timelineStartUs).toBe(snapUs(4_300_000, 30));
    expect(operation.clip.text).toBe("真是顽固呢");
    expect(operation.clip.textStyle?.strokeWidth).toBe(2);
    expect(operation.clip.linkGroupId).toBeNull();
    expect(operation.clip.keyframes?.[0]?.id).not.toBe("kf-1");
  });

  it("falls back to another unlocked compatible track when the source track is locked", () => {
    const snapshot = snapshotClipForClipboard(textClip());
    const result = pasteClipOperations({
      snapshot,
      tracks: [
        visualTrack({ locked: true, clips: [textClip()] }),
        visualTrack({
          id: "text-track-2",
          name: "文字 2",
          order: 1,
          clips: [],
        }),
      ],
      playheadUs: 0,
      fps: 30,
      newClipId: "pasted-2",
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    const operation = result.redo[0];
    expect(operation?.type).toBe("addClip");
    if (operation?.type !== "addClip") return;
    expect(operation.clip.trackId).toBe("text-track-2");
  });

  it("rejects paste when the visual track position overlaps", () => {
    const existing = textClip({
      timelineStartUs: 4_000_000,
      durationUs: 2_000_000,
    });
    const result = pasteClipOperations({
      snapshot: snapshotClipForClipboard(textClip()),
      tracks: [visualTrack({ clips: [existing] })],
      playheadUs: 5_000_000,
      fps: 30,
    });
    expect(result).toEqual({
      error: "该位置与其他片段重叠，无法粘贴",
    });
  });

  it("clears linkGroupId on paste even when the snapshot still has one", () => {
    const snapshot = snapshotClipForClipboard(
      textClip({ linkGroupId: "linked-av" }),
    );
    expect(snapshot[0]?.linkGroupId).toBe("linked-av");
    const result = pasteClipOperations({
      snapshot,
      tracks: [visualTrack()],
      playheadUs: 0,
      fps: 30,
      newClipId: "pasted-3",
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    const operation = result.redo[0];
    if (operation?.type !== "addClip") throw new Error("expected addClip");
    expect(operation.clip.linkGroupId).toBeNull();
  });

  it("pastes multiple clips with relative timeline offsets from the playhead", () => {
    const first = textClip({
      id: "a",
      timelineStartUs: 2_000_000,
      durationUs: 1_000_000,
      name: "A",
    });
    const second = textClip({
      id: "b",
      timelineStartUs: 5_000_000,
      durationUs: 1_000_000,
      name: "B",
    });
    const result = pasteClipsOperations({
      snapshot: snapshotClipsForClipboard([second, first]),
      tracks: [visualTrack()],
      playheadUs: 10_000_000,
      fps: 30,
      newClipIds: ["paste-a", "paste-b"],
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.newClipIds).toEqual(["paste-a", "paste-b"]);
    expect(result.redo).toHaveLength(2);
    const starts = result.redo.map((operation) => {
      if (operation.type !== "addClip") throw new Error("expected addClip");
      return operation.clip.timelineStartUs;
    });
    expect(starts[0]).toBe(snapUs(10_000_000, 30));
    expect(starts[1]).toBe(snapUs(13_000_000, 30));
  });

  it("rejects the whole multi-paste when any clip would overlap", () => {
    const first = textClip({
      id: "a",
      timelineStartUs: 0,
      durationUs: 1_000_000,
    });
    const second = textClip({
      id: "b",
      timelineStartUs: 2_000_000,
      durationUs: 1_000_000,
    });
    const blocking = textClip({
      id: "blocker",
      timelineStartUs: 11_000_000,
      durationUs: 2_000_000,
    });
    const result = pasteClipsOperations({
      snapshot: snapshotClipsForClipboard([first, second]),
      tracks: [visualTrack({ clips: [blocking] })],
      playheadUs: 10_000_000,
      fps: 30,
    });
    expect(result).toEqual({
      error: "该位置与其他片段重叠，无法粘贴",
    });
  });
});
