import type {
  VideoEditorAsset,
  VideoEditorClip,
  VideoEditorTimeline,
} from "./types";

export function clipMergeSelection(
  timeline: VideoEditorTimeline,
  assets: VideoEditorAsset[],
  ids: string[],
): { clips: VideoEditorClip[]; error?: string } {
  const tracks = timeline.document.tracks ?? [];
  const clips = tracks
    .flatMap((track) => track.clips ?? [])
    .filter((clip) => ids.includes(clip.id))
    .sort((a, b) => a.timelineStartUs - b.timelineStartUs);
  const fail = (error: string) => ({ clips, error });
  if (
    clips.length < 2 ||
    clips.length > 100 ||
    clips.length !== new Set(ids).size
  )
    return fail("请选择 2～100 个视频片段");
  if (clips.some((clip) => clip.kind !== "video"))
    return fail("只能合并视频片段");
  const track = tracks.find((item) => item.id === clips[0]!.trackId);
  if (!track || clips.some((clip) => clip.trackId !== track.id))
    return fail("只能合并同一轨道的片段");
  if (track.locked) return fail("轨道已锁定");
  if (clips.some((clip) => clip.linkGroupId))
    return fail("请先解除片段的音画关联");
  if (
    clips.some(
      (clip, index) =>
        index > 0 &&
        clips[index - 1]!.timelineStartUs + clips[index - 1]!.durationUs !==
          clip.timelineStartUs,
    )
  )
    return fail("请选择首尾连续、无间隙或重叠的视频片段");
  if (
    clips.some(
      (clip) =>
        !assets.some(
          (asset) =>
            asset.id === clip.assetId && asset.processingStatus === "ready",
        ),
    )
  )
    return fail("视频素材尚未准备好");
  return { clips };
}
