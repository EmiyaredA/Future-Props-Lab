import type {
  VideoEditorAsset,
  VideoEditorClip,
  VideoEditorTimeline,
  VideoEditorTrack,
} from "@features/video-editor/types";

export const gapClip = (
  id: string,
  start: number,
  patch: Partial<VideoEditorClip> = {},
): VideoEditorClip => ({
  id,
  name: id,
  trackId: "v",
  kind: "video",
  assetId: "media",
  timelineStartUs: start,
  durationUs: 1_000_003,
  sourceInUs: 23,
  sourceLoop: false,
  playbackRate: 1,
  fitMode: "cover",
  flipX: false,
  fontSize: 72,
  textColor: "#ffffff",
  volume: 1,
  keyframes: [],
  ...patch,
});
export const gapTrack = (
  id: string,
  clips: VideoEditorClip[],
  patch: Partial<VideoEditorTrack> = {},
): VideoEditorTrack => ({
  id,
  name: id,
  order: 0,
  kind: "visual",
  clips: clips.map((clip) => ({ ...clip, trackId: id })),
  hidden: false,
  locked: false,
  muted: false,
  ...patch,
});
export const gapTimeline = (
  tracks = [
    gapTrack("v", [
      gapClip("left", 0),
      gapClip("middle", 1_049_710),
      gapClip("right", 2_449_713),
    ]),
  ],
  fps: 30 | 60 = 30,
): VideoEditorTimeline => ({
  projectId: "gap-test",
  revision: 4,
  updatedAt: "now",
  document: {
    schemaVersion: "1.0",
    settings: { fps, width: 1920, height: 1080, backgroundColor: "#000000" },
    tracks,
  },
});
export const gapAsset = (
  patch: Partial<VideoEditorAsset> = {},
): VideoEditorAsset =>
  ({
    id: "media",
    projectId: "gap-test",
    displayName: "media",
    kind: "video",
    revision: 0,
    processingStatus: "ready",
    probe: { durationUs: 10_000_000 },
    ...patch,
  }) as VideoEditorAsset;
