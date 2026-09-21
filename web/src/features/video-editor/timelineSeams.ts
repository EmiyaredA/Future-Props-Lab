import type {
  VideoEditorClip,
  VideoEditorTimelineTransition,
} from "./types";

export function seamTransitions(
  transitions: VideoEditorTimelineTransition[] | undefined,
) {
  return (transitions ?? []).filter((item) => item.placement === "between");
}

export function transitionBelongsToTrack(
  transition: VideoEditorTimelineTransition,
  trackId: string,
  clipById: Map<string, VideoEditorClip>,
) {
  const from = clipById.get(transition.fromClipId);
  const to = clipById.get(transition.toClipId);
  return from?.trackId === trackId && to?.trackId === trackId;
}

/**
 * Place the seam capsule centered on the cut so it reads as “between” the two
 * clips. Width still equals the real duration at the current zoom.
 */
export function seamTransitionStyle(
  transition: VideoEditorTimelineTransition,
  clipById: Map<string, VideoEditorClip>,
  zoom: number,
) {
  const to = clipById.get(transition.toClipId);
  const seamUs = to?.timelineStartUs ?? 0;
  const durationUs = Math.max(1, transition.durationUs);
  const startUs = Math.max(0, seamUs - Math.floor(durationUs / 2));
  const widthPx = Math.max(6, (durationUs / 1_000_000) * zoom);
  return {
    left: `${(startUs / 1_000_000) * zoom}px`,
    width: `${widthPx}px`,
  };
}

/**
 * Width of a clip-local edge transition band as a percent of the clip body.
 * Caps so a single edge never covers more than the visible clip.
 */
export function clipEdgeTransitionWidthPercent(
  durationUs: number,
  clipDurationUs: number,
) {
  if (durationUs <= 0 || clipDurationUs <= 0) return 0;
  return Math.min(100, (durationUs / clipDurationUs) * 100);
}

export function emptySeamsForTrack(
  trackId: string,
  clipById: Map<string, VideoEditorClip>,
  transitions: VideoEditorTimelineTransition[],
) {
  const trackClips = [...clipById.values()]
    .filter((clip) => clip.trackId === trackId)
    .sort((left, right) => left.timelineStartUs - right.timelineStartUs);
  const seams: { from: VideoEditorClip; to: VideoEditorClip }[] = [];
  for (let index = 0; index < trackClips.length - 1; index += 1) {
    const from = trackClips[index]!;
    const to = trackClips[index + 1]!;
    if (from.timelineStartUs + from.durationUs !== to.timelineStartUs) continue;
    if (from.kind !== "video" && from.kind !== "image") continue;
    if (to.kind !== "video" && to.kind !== "image") continue;
    const hasBetween = transitions.some(
      (item) => item.fromClipId === from.id && item.toClipId === to.id,
    );
    if (!hasBetween) seams.push({ from, to });
  }
  return seams;
}
