import { describe, expect, it } from "vitest";
import {
  formatTime,
  frameUs,
  operationsForAsset,
  snapUs,
  timelineDuration,
} from "@features/video-editor/editorModel";
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
});
