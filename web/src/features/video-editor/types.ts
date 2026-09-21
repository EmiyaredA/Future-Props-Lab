import type { components } from "@generated/api";

export type VideoEditorProject = components["schemas"]["VideoEditorProjectOut"];
export type VideoEditorAsset = components["schemas"]["VideoEditorAssetOut"];
export type VideoEditorTimeline =
  components["schemas"]["VideoEditorTimelineOut"];
export type VideoEditorTimelineDocument =
  components["schemas"]["VideoEditorTimelineDocument"];
export type VideoEditorAssetFolder =
  components["schemas"]["VideoEditorAssetFolder"];
export type VideoEditorAssetOrganization =
  components["schemas"]["VideoEditorAssetOrganization"];
export type VideoEditorTrack = components["schemas"]["VideoEditorTrack"];
export type VideoEditorClip = components["schemas"]["VideoEditorClip"];
export type VideoEditorKeyframe = components["schemas"]["VideoEditorKeyframe"];
export type VideoEditorTimelineTransition =
  components["schemas"]["VideoEditorTimelineTransition"];
export type VideoEditorTransition =
  components["schemas"]["VideoEditorTransition"];
export type VideoEditorOperation =
  components["schemas"]["VideoEditorTimelineBatchIn"]["operations"][number];
export type VideoEditorTask = components["schemas"]["VideoEditorTaskOut"];
export type VideoEditorSegmentExportInput =
  components["schemas"]["VideoEditorSegmentExportCreateIn"];
export type VideoEditorSegmentExportItem =
  components["schemas"]["VideoEditorSegmentExportItem"];
export type VideoEditorPreset =
  components["schemas"]["VideoEditorRenderPreviewIn"]["preset"];
