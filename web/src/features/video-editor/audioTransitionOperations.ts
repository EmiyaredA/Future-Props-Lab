import type {
  VideoEditorClip,
  VideoEditorOperation,
  VideoEditorTimeline,
} from "./types";

type ClipState = Pick<
  VideoEditorClip,
  "id" | "kind" | "trackId" | "timelineStartUs" | "durationUs"
>;

function audioCrossfadeIsValid(
  transition: NonNullable<
    VideoEditorTimeline["document"]["transitions"]
  >[number],
  clips: Map<string, ClipState>,
  trackKinds: Map<string, string>,
) {
  const from = clips.get(transition.fromClipId);
  const to = clips.get(transition.toClipId);
  if (
    !from ||
    !to ||
    from.trackId !== to.trackId ||
    trackKinds.get(from.trackId) !== "audio" ||
    from.kind !== "audio" ||
    to.kind !== "audio"
  )
    return false;
  const ordered = [...clips.values()]
    .filter((clip) => clip.trackId === from.trackId)
    .sort(
      (left, right) =>
        left.timelineStartUs - right.timelineStartUs ||
        left.id.localeCompare(right.id),
    );
  const fromIndex = ordered.findIndex((clip) => clip.id === from.id);
  if (fromIndex < 0 || ordered[fromIndex + 1]?.id !== to.id) return false;
  const fromEnd = from.timelineStartUs + from.durationUs;
  const toEnd = to.timelineStartUs + to.durationUs;
  return (
    from.timelineStartUs < to.timelineStartUs &&
    Math.min(fromEnd, toEnd) - to.timelineStartUs > 0
  );
}

/**
 * Keep overlap-transition removal in the same undoable batch as a move/trim.
 * Positive overlap duration changes are normalized by the API boundary.
 */
export function reconcileAudioTransitionOperations(
  timeline: VideoEditorTimeline | undefined,
  redo: VideoEditorOperation[],
  undo: VideoEditorOperation[],
) {
  if (!timeline) return { redo, undo };
  const transitions = timeline.document.transitions ?? [];
  if (!transitions.some((item) => item.kind === "audio-crossfade")) {
    return { redo, undo };
  }
  const trackKinds = new Map(
    (timeline.document.tracks ?? []).map((track) => [track.id, track.kind]),
  );
  const clips = new Map<string, ClipState>(
    (timeline.document.tracks ?? []).flatMap((track) =>
      (track.clips ?? []).map((clip) => [clip.id, { ...clip }] as const),
    ),
  );
  for (const operation of redo) {
    if (operation.type === "moveClip") {
      const clip = clips.get(operation.clipId);
      if (clip) {
        clip.trackId = operation.trackId;
        clip.timelineStartUs = operation.timelineStartUs;
      }
    } else if (operation.type === "trimClip") {
      const clip = clips.get(operation.clipId);
      if (clip) {
        clip.timelineStartUs = operation.timelineStartUs;
        clip.durationUs = operation.durationUs;
      }
    } else if (operation.type === "restoreClipStates") {
      for (const restored of operation.clips) {
        clips.set(restored.id, { ...restored });
      }
    } else if (operation.type === "removeTrack") {
      for (const clip of clips.values()) {
        if (clip.trackId === operation.trackId) clips.delete(clip.id);
      }
    }
  }
  const removedIds = new Set(
    redo
      .filter((operation) => operation.type === "removeTransition")
      .map((operation) => operation.transitionId),
  );
  const removed = transitions.filter(
    (transition) =>
      transition.kind === "audio-crossfade" &&
      !removedIds.has(transition.id) &&
      !audioCrossfadeIsValid(transition, clips, trackKinds),
  );
  if (!removed.length) return { redo, undo };
  return {
    redo: [
      ...redo,
      ...removed.map((transition): VideoEditorOperation => ({
        type: "removeTransition",
        transitionId: transition.id,
      })),
    ],
    undo: undo.length
      ? [
          ...undo,
          ...removed.map((transition): VideoEditorOperation => ({
            type: "addTransition",
            transition,
          })),
        ]
      : undo,
  };
}
