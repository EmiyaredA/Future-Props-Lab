import type { components } from "@generated/api";

export type VideoEditorProject = components["schemas"]["VideoEditorProjectOut"];
export type VideoEditorAsset = components["schemas"]["VideoEditorAssetOut"];
export type VideoEditorTimeline =
  components["schemas"]["VideoEditorTimelineOut"];
export type VideoEditorTimelineDocument =
  components["schemas"]["VideoEditorTimelineDocument"];
export type VideoEditorTrack = components["schemas"]["VideoEditorTrack"];
export type VideoEditorClip = components["schemas"]["VideoEditorClip"];
export type VideoEditorKeyframe = components["schemas"]["VideoEditorKeyframe"];
export type VideoEditorOperation =
  components["schemas"]["VideoEditorTimelineBatchIn"]["operations"][number];
export type VideoEditorTask = components["schemas"]["VideoEditorTaskOut"];
export type VideoEditorPreset =
  components["schemas"]["VideoEditorRenderPreviewIn"]["preset"];
