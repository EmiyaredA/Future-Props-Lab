import { describe, expect, it } from "vitest";
import {
  formatTime,
  frameUs,
  operationsForAsset,
  snapUs,
  timelineDuration,
} from "@features/video-editor/editorModel";
import {
  canPlaceClip,
  linkedClipIds,
  snapClipStartUs,
} from "@features/video-editor/timelineSnap";
import type {
  VideoEditorAsset,
  VideoEditorTimeline,
  VideoEditorTrack,
} from "@features/video-editor/types";

const tracks: VideoEditorTrack[] = [
  {
    id: "v1",
    kind: "visual",
    name: "V1",
    order: 0,
    locked: false,
    hidden: false,
    muted: false,
    clips: [],
  },
  {
    id: "a1",
    kind: "audio",
    name: "A1",
    order: 1,
    locked: false,
    hidden: false,
    muted: false,
    clips: [],
  },
];

const video: VideoEditorAsset = {
  id: "asset-video",
  displayName: "采访",
  originalFilename: "interview.mp4",
  mediaKind: "video",
  mimeType: "video/mp4",
  byteSize: 100,
  processingStatus: "ready",
  probe: { durationUs: 8_000_000 },
  createdAt: "2026-08-24T00:00:00Z",
};

describe("video editor timeline model", () => {
  it("snaps microseconds to exact 30/60 fps grids", () => {
    expect(frameUs(30)).toBe(33_333);
    expect(frameUs(60)).toBe(16_667);
    expect(snapUs(34_000, 30)).toBe(33_333);
    expect(snapUs(49_000, 60)).toBe(50_001);
    expect(formatTime(61_234_000)).toBe("01:01.234");
  });

  it("creates linked picture and original audio clips for video", () => {
    const operations = operationsForAsset(video, tracks, 1_000_000);
    expect(operations).toHaveLength(2);
    expect(operations[0]?.type).toBe("addClip");
    expect(operations[1]?.type).toBe("addClip");
    if (operations[0]?.type !== "addClip" || operations[1]?.type !== "addClip")
      throw new Error("unexpected operation");
    expect(operations[0].clip.trackId).toBe("v1");
    expect(operations[1].clip.trackId).toBe("a1");
    expect(operations[0].clip.linkGroupId).toBe(operations[1].clip.linkGroupId);
    expect(operations[0].clip.durationUs).toBe(8_000_000);
  });

  it("derives the visible duration from every track", () => {
    const operation = operationsForAsset(video, tracks, 2_000_000)[0];
    if (operation?.type !== "addClip") throw new Error("unexpected operation");
    const timeline = {
      projectId: "project",
      revision: 1,
      updatedAt: "2026-08-24T00:00:00Z",
      document: {
        schemaVersion: "1.0",
        tracks: [
          {
            ...tracks[0],
            clips: [operation.clip],
          },
        ],
      },
    } as unknown as VideoEditorTimeline;
    expect(timelineDuration(timeline)).toBe(10_000_000);
  });

  it("snaps clip starts to the timeline edge and neighboring seams", () => {
    const firstOperation = operationsForAsset(video, tracks, 1_000_000)[0];
    if (firstOperation?.type !== "addClip")
      throw new Error("unexpected operation");
    const first = {
      ...firstOperation.clip,
      id: "first",
      timelineStartUs: 1_000_000,
      durationUs: 2_000_000,
      trackId: "v1",
    };
    const second = { ...first, id: "second", timelineStartUs: 5_000_000 };
    const visualTracks = [{ ...tracks[0]!, clips: [first, second] }];
    const moving = new Set([first.id]);
    expect(
      snapClipStartUs({
        candidateUs: 2_960_000,
        durationUs: first.durationUs,
        targetTrackId: "v1",
        tracks: visualTracks,
        movingClipIds: moving,
        fps: 30,
        zoom: 80,
        timelineEndUs: 30_000_000,
        enabled: true,
      }),
    ).toBe(snapUs(3_000_000, 30));
    expect(
      snapClipStartUs({
        candidateUs: 40_000,
        durationUs: first.durationUs,
        targetTrackId: "v1",
        tracks: visualTracks,
        movingClipIds: moving,
        fps: 30,
        zoom: 80,
        timelineEndUs: 30_000_000,
        enabled: false,
      }),
    ).toBe(33_333);
    expect(
      snapClipStartUs({
        candidateUs: 27_960_000,
        durationUs: first.durationUs,
        targetTrackId: "v1",
        tracks: visualTracks,
        movingClipIds: moving,
        fps: 30,
        zoom: 80,
        timelineEndUs: 30_000_000,
        enabled: true,
      }),
    ).toBe(snapUs(28_000_000, 30));
    expect(
      snapClipStartUs({
        candidateUs: 27_800_000,
        durationUs: first.durationUs,
        targetTrackId: "v1",
        tracks: visualTracks,
        movingClipIds: moving,
        fps: 30,
        zoom: 80,
        timelineEndUs: 30_000_000,
        enabled: true,
      }),
    ).toBe(snapUs(27_800_000, 30));
  });

  it("expands selected linked clips and rejects visual overlaps", () => {
    const operations = operationsForAsset(video, tracks, 0);
    if (operations[0]?.type !== "addClip" || operations[1]?.type !== "addClip")
      throw new Error("unexpected operation");
    const picture = {
      ...operations[0].clip,
      id: "picture",
      trackId: "v1",
      linkGroupId: "group",
    };
    const audio = {
      ...operations[1].clip,
      id: "audio",
      trackId: "a1",
      linkGroupId: "group",
    };
    const blocker = {
      ...picture,
      id: "blocker",
      linkGroupId: undefined,
      timelineStartUs: 2_000_000,
    };
    const allTracks = [
      { ...tracks[0]!, clips: [picture, blocker] },
      { ...tracks[1]!, clips: [audio] },
    ];
    expect(linkedClipIds([picture, audio, blocker], ["picture"])).toEqual(
      new Set(["picture", "audio"]),
    );
    expect(
      canPlaceClip(
        picture,
        1_000_000,
        "v1",
        allTracks,
        new Set(["picture", "audio"]),
      ),
    ).toBe(false);
  });
});
