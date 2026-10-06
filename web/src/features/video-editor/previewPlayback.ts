import { clipSourceTimeUs } from "./editorModel";
import type {
  VideoEditorClip,
  VideoEditorTimelineTransition,
  VideoEditorTrack,
} from "./types";

/** Continuous splits share a decoder; transition partners need separate ones. */
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
          item.fromClipId === previous?.id &&
          item.toClipId === clip.id,
      );
      const continuous =
        previous?.kind === "video" &&
        clip.kind === "video" &&
        Boolean(clip.assetId) &&
        previous.assetId === clip.assetId &&
        previous.sourceLoop === clip.sourceLoop &&
        (previous.playbackRate ?? 1) === (clip.playbackRate ?? 1) &&
        previous.timelineStartUs + previous.durationUs ===
          clip.timelineStartUs &&
        clipSourceTimeUs(previous, previous.durationUs) === clip.sourceInUs &&
        !seam;
      keys.set(clip.id, continuous ? keys.get(previous!.id)! : clip.id);
      previous = clip;
    }
  }
  return keys;
}
