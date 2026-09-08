import { describe, expect, it } from "vitest";
import {
  paddedVideoProxyCrop,
  previewMediaGeometry,
} from "@features/video-editor/previewGeometry";
import type {
  VideoEditorAsset,
  VideoEditorClip,
} from "@features/video-editor/types";

const clip = {
  id: "clip-1",
  trackId: "visual-1",
  kind: "video",
  name: "视频",
  timelineStartUs: 0,
  durationUs: 1_000_000,
  sourceInUs: 0,
  sourceLoop: false,
  assetId: "asset-1",
  fontSize: 72,
  textColor: "#ffffff",
  fitMode: "native",
  flipX: false,
  volume: 1,
  transform: {
    x: 960,
    y: 540,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    opacity: 1,
    anchor: "center",
    brightness: 1,
  },
  keyframes: [],
} satisfies VideoEditorClip;

const asset = {
  id: "asset-1",
  displayName: "视频",
  originalFilename: "video.mp4",
  mediaKind: "video",
  mimeType: "video/mp4",
  byteSize: 100,
  processingStatus: "ready",
  probe: {
    streams: [
      { codec_type: "audio", channels: 2 },
      { codec_type: "video", width: 1920, height: 1080 },
    ],
  },
  createdAt: "2026-08-29T00:00:00Z",
} satisfies VideoEditorAsset;

describe("video editor live preview geometry", () => {
  it("maps a 1080p source to the full canvas instead of its half-size proxy", () => {
    const geometry = previewMediaGeometry(clip, asset);

    expect(geometry).toMatchObject({ width: 1920, height: 1080 });
    expect(geometry?.proxyCrop).toEqual({
      leftPercent: -0,
      topPercent: -0,
      widthPercent: 100,
      heightPercent: 100,
    });
  });

  it("matches contain and cover sizing used by exact-frame rendering", () => {
    const portraitAsset = {
      ...asset,
      probe: {
        streams: [{ codec_type: "video", width: 1080, height: 1920 }],
      },
    };

    expect(
      previewMediaGeometry({ ...clip, fitMode: "contain" }, portraitAsset),
    ).toMatchObject({ width: 607.5, height: 1080 });
    expect(
      previewMediaGeometry({ ...clip, fitMode: "cover" }, portraitAsset),
    ).toMatchObject({ width: 1920, height: 3413.333333333333 });
  });

  it("uses the timeline canvas instead of hard-coded 1920×1080 dimensions", () => {
    const geometry = previewMediaGeometry(
      { ...clip, fitMode: "cover" },
      { ...asset, probe: { width: 640, height: 480 } },
      { width: 1280, height: 720 },
    );

    expect(geometry).toMatchObject({ width: 1280, height: 960 });
  });

  it("crops letterboxing from portrait proxies before canvas transforms", () => {
    const crop = paddedVideoProxyCrop({ width: 1080, height: 1920 });

    expect(crop.topPercent).toBeCloseTo(0);
    expect(crop.heightPercent).toBeCloseTo(100);
    expect(crop.leftPercent).toBeCloseTo(-108.0247, 3);
    expect(crop.widthPercent).toBeCloseTo(316.0494, 3);
  });
});
