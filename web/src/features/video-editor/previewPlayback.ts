import type {
  VideoEditorClip,
  VideoEditorTimelineTransition,
  VideoEditorTrack,
} from "./types";

/** Adjacent cuts share a display buffer; simultaneous partners stay separate. */
export function previewVideoPlaybackKeys(
  tracks: VideoEditorTrack[],
  transitions: VideoEditorTimelineTransition[],
): Map<string, string> {
  const keys = new Map<string, string>();
  for (const track of tracks) {
    if (track.hidden || !["visual", "mixed"].includes(track.kind)) continue;
    const clips = [...(track.clips ?? [])].sort(
      (left, right) => left.timelineStartUs - right.timelineStartUs,
    );
    let previous: VideoEditorClip | undefined;
    for (const clip of clips) {
      const seam = transitions.some(
        (item) =>
          item.placement === "between" &&
          !item.kind.startsWith("audio-") &&
          (item.fromClipId === previous?.id ||
            item.toClipId === previous?.id ||
            item.fromClipId === clip.id ||
            item.toClipId === clip.id),
      );
      const continuous =
        previous?.kind === "video" &&
        clip.kind === "video" &&
        Boolean(clip.assetId) &&
        previous.timelineStartUs + previous.durationUs ===
          clip.timelineStartUs &&
        !seam;
      keys.set(clip.id, continuous ? keys.get(previous!.id)! : clip.id);
      previous = clip;
    }
  }
  return keys;
}
