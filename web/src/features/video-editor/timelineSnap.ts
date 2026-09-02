import type { VideoEditorClip, VideoEditorTrack } from "./types";
import { frameUs, snapUs } from "./editorModel";

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

export function snapClipStartUs({
  candidateUs,
  durationUs,
  targetTrackId,
  tracks,
  movingClipIds,
  fps,
  zoom,
  timelineEndUs,
  enabled,
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
}) {
  const frameAligned = snapUs(Math.max(0, candidateUs), fps);
  if (!enabled) return frameAligned;

  const targets = new Set<number>([0, Math.max(0, timelineEndUs - durationUs)]);
  const targetTrack = tracks.find((track) => track.id === targetTrackId);
  for (const clip of targetTrack?.clips ?? []) {
    if (movingClipIds.has(clip.id)) continue;
    targets.add(clip.timelineStartUs);
    targets.add(clip.timelineStartUs - durationUs);
    targets.add(clip.timelineStartUs + clip.durationUs);
    targets.add(clip.timelineStartUs + clip.durationUs - durationUs);
  }

  const thresholdUs = Math.max(
    frameUs(fps),
    (TIMELINE_SNAP_DISTANCE_PX / Math.max(1, zoom)) * 1_000_000,
  );
  let best = frameAligned;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const target of targets) {
    const aligned = snapUs(Math.max(0, target), fps);
    const distance = Math.abs(aligned - frameAligned);
    if (distance <= thresholdUs && distance < bestDistance) {
      best = aligned;
      bestDistance = distance;
    }
  }
  return best;
}

export function canPlaceClip(
  clip: VideoEditorClip,
  startUs: number,
  targetTrackId: string,
  tracks: VideoEditorTrack[],
  movingClipIds: Set<string>,
) {
  const target = tracks.find((track) => track.id === targetTrackId);
  if (!target || target.locked) return false;
  if (target.kind === "audio" && clip.kind !== "audio") return false;
  if (target.kind === "visual" && clip.kind === "audio") return false;
  if (target.kind !== "visual") return true;
  const endUs = startUs + clip.durationUs;
  return !(target.clips ?? []).some((other) => {
    if (movingClipIds.has(other.id)) return false;
    return (
      startUs < other.timelineStartUs + other.durationUs &&
      endUs > other.timelineStartUs
    );
  });
}
