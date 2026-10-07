import type { VideoEditorClip, VideoEditorTrack } from "./types";
import { frameUs, snapUs, trackKindLabels } from "./editorModel";

export const TIMELINE_SNAP_DISTANCE_PX = 8;

export function linkedClipIds(
  clips: VideoEditorClip[],
  selectedClipIds: string[],
): Set<string> {
  const selected = new Set(selectedClipIds);
  const groups = new Set(
    clips
      .filter((clip) => selected.has(clip.id) && clip.linkGroupId)
      .map((clip) => clip.linkGroupId!),
  );
  return new Set(
    clips
      .filter(
        (clip) =>
          selected.has(clip.id) ||
          (clip.linkGroupId && groups.has(clip.linkGroupId)),
      )
      .map((clip) => clip.id),
  );
}

export function clipDeletionLock(
  tracks: VideoEditorTrack[],
  clipIds: string[],
) {
  const targets = linkedClipIds(
    tracks.flatMap((track) => track.clips ?? []),
    clipIds,
  );
  return tracks.find(
    (track) =>
      track.locked && track.clips?.some((clip) => targets.has(clip.id)),
  );
}

export function snapClipPosition({
  candidateUs,
  durationUs,
  tracks,
  movingClipIds,
  fps,
  zoom,
  timelineEndUs,
  enabled,
  minimumStartUs = 0,
}: {
  candidateUs: number;
  durationUs: number;
  targetTrackId: string;
  tracks: VideoEditorTrack[];
  movingClipIds: Set<string>;
  fps: number;
  zoom: number;
  timelineEndUs: number;
  enabled: boolean;
  minimumStartUs?: number;
}) {
  const frameAligned = Math.max(
    minimumStartUs,
    snapUs(Math.max(0, candidateUs), fps),
  );
  if (!enabled) return { startUs: frameAligned, guideUs: undefined };

  // Snap targets span every track so clips can align across the timeline.
  // targetTrackId stays in the API for call-site placement checks.
  const targets: { startUs: number; guideUs: number }[] = [
    { startUs: 0, guideUs: 0 },
    { startUs: timelineEndUs - durationUs, guideUs: timelineEndUs },
  ];
  for (const track of tracks) {
    for (const clip of track.clips ?? []) {
      if (movingClipIds.has(clip.id)) continue;
      for (const edge of [
        clip.timelineStartUs,
        clip.timelineStartUs + clip.durationUs,
      ]) {
        targets.push(
          { startUs: edge, guideUs: edge },
          { startUs: edge - durationUs, guideUs: edge },
        );
      }
    }
  }

  const thresholdUs = Math.max(
    frameUs(fps),
    (TIMELINE_SNAP_DISTANCE_PX / Math.max(1, zoom)) * 1_000_000,
  );
  let best = {
    startUs: frameAligned,
    guideUs: undefined as number | undefined,
  };
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const target of targets) {
    if (target.startUs < minimumStartUs) continue;
    // Media boundaries need not lie on the frame grid. Preserve the exact
    // seam so rounding cannot introduce a gap or an overlap.
    const distance = Math.abs(target.startUs - frameAligned);
    if (distance <= thresholdUs && distance < bestDistance) {
      best = target;
      bestDistance = distance;
    }
  }
  return best;
}

export function snapClipStartUs(
  options: Parameters<typeof snapClipPosition>[0],
) {
  return snapClipPosition(options).startUs;
}

export function canPlaceClip(
  clip: VideoEditorClip,
  startUs: number,
  targetTrackId: string,
  tracks: VideoEditorTrack[],
  movingClipIds: Set<string>,
) {
  return !clipPlacementError(
    clip,
    startUs,
    targetTrackId,
    tracks,
    movingClipIds,
  );
}

export function clipPlacementError(
  clip: VideoEditorClip,
  startUs: number,
  targetTrackId: string,
  tracks: VideoEditorTrack[],
  movingClipIds: Set<string>,
): string | undefined {
  if (startUs < 0) return "片段不能移到时间轴起点之前";
  const target = tracks.find((track) => track.id === targetTrackId);
  if (!target) return "目标轨道已不存在，请重新选择轨道";
  const targetName = `${trackKindLabels[target.kind]}「${target.name}」`;
  if (target.locked) return `${targetName}已锁定，请先解锁再移动片段`;
  const source = tracks.find((track) => track.id === clip.trackId);
  if (source?.locked) return "片段所在轨道已锁定，请先解锁再移动片段";
  if (
    source?.kind === "mixed" &&
    target.kind !== "mixed" &&
    clip.kind === "video"
  )
    return `混合轨的视频不能直接移入${targetName}，请先右键片段选择「分离轨道」`;
  if (target.kind === "mixed" && !["video", "image"].includes(clip.kind))
    return `${targetName}只接收视频或图片片段，请将文字和色彩放入视觉轨、音频放入音频轨`;
  if (target.kind === "audio" && clip.kind !== "audio")
    return `${targetName}只接收音频片段，画面素材请放入视觉轨`;
  if (target.kind === "visual" && clip.kind === "audio")
    return `${targetName}不接收音频片段，请移入音频轨`;
  if (target.kind === "audio") return undefined;
  const endUs = startUs + clip.durationUs;
  const overlap = (target.clips ?? []).some((other) => {
    if (movingClipIds.has(other.id)) return false;
    return (
      startUs < other.timelineStartUs + other.durationUs &&
      endUs > other.timelineStartUs
    );
  });
  return overlap
    ? `${targetName}的该位置已有片段，请移到空白位置或其他轨道`
    : undefined;
}
