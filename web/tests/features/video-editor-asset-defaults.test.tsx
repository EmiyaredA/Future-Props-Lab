import { describe, expect, it } from "vitest";
import { operationsForAsset } from "@features/video-editor/editorModel";
import type {
  VideoEditorAsset,
  VideoEditorTrack,
} from "@features/video-editor/types";

const visualTrack = {
  id: "visual-1",
  kind: "visual",
  name: "画面",
  order: 0,
  locked: false,
  hidden: false,
  muted: false,
  clips: [],
} as VideoEditorTrack;

const asset = {
  id: "asset-1",
  displayName: "绿幕",
  originalFilename: "green.mp4",
  mediaKind: "video",
  mimeType: "video/mp4",
  byteSize: 10,
  processingStatus: "ready",
  probe: { durationUs: 2_000_000 },
  defaultEffects: {
    chromaKey: {
      enabled: true,
      color: "#00ff00",
      similarity: 42,
      softness: 18,
      despill: 30,
    },
  },
  revision: 1,
  createdAt: "2026-09-19T00:00:00Z",
} as VideoEditorAsset;

describe("asset default effects on timeline add", () => {
  it("injects chromaKey from asset defaultEffects into new clips", () => {
    const ops = operationsForAsset(asset, [visualTrack], 0);
    const clip = ops.find((operation) => operation.type === "addClip")?.clip;
    expect(clip?.chromaKey).toEqual(asset.defaultEffects?.chromaKey);
  });

  it("omits chromaKey when asset has no default effects", () => {
    const ops = operationsForAsset(
      { ...asset, defaultEffects: {} },
      [visualTrack],
      0,
    );
    const clip = ops.find((operation) => operation.type === "addClip")?.clip;
    expect(clip?.chromaKey).toBeUndefined();
  });
});
