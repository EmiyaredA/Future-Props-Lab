import type {
  VideoEditorClip,
  VideoEditorOperation,
  VideoEditorTimeline,
  VideoEditorTimelineTransition,
} from "./types";
import type { AudioTransitionKind } from "./audioTransitionCurves";
import { audioTransitionKinds } from "./audioTransitionCurves";

export function audioTransitionOperations(
  timeline: VideoEditorTimeline,
  from: VideoEditorClip,
  to: VideoEditorClip,
  existing: VideoEditorTimelineTransition | undefined,
  kind: AudioTransitionKind,
  durationUs: number,
  easing: VideoEditorTimelineTransition["easing"],
): { redo: VideoEditorOperation[]; undo: VideoEditorOperation[]; id: string } {
  const tracks = timeline.document.tracks ?? [];
  const movesClips =
    from.timelineStartUs + from.durationUs - durationUs !== to.timelineStartUs;
  const track = tracks.find((item) => item.id === to.trackId);
  const following = (track?.clips ?? []).filter(
    (clip) => clip.id !== to.id && clip.timelineStartUs > to.timelineStartUs,
  );
  const followingIds = new Set(following.map((clip) => clip.id));
  const linkedGroups = new Set(
    following.map((clip) => clip.linkGroupId).filter(Boolean),
  );
  const originals = movesClips
    ? tracks
        .flatMap((item) => item.clips ?? [])
        .filter(
          (clip) =>
            clip.id === to.id ||
            followingIds.has(clip.id) ||
            (clip.linkGroupId && linkedGroups.has(clip.linkGroupId)),
        )
    : [];
  const id = existing?.id ?? crypto.randomUUID();
  return {
    id,
    redo: [
      {
        type: "setAudioTransition",
        fromClipId: from.id,
        toClipId: to.id,
        transitionId: id,
        kind,
        durationUs,
        easing,
      },
    ],
    undo: [
      ...(existing
        ? [
            {
              type: "updateTransition" as const,
              transitionId: id,
              patch: {
                kind: existing.kind,
                durationUs: existing.durationUs,
                easing: existing.easing,
              },
            },
          ]
        : [{ type: "removeTransition" as const, transitionId: id }]),
      ...(movesClips
        ? [{ type: "restoreClipStates" as const, clips: originals }]
        : []),
    ],
  };
}

type ClipState = Pick<
  VideoEditorClip,
  "id" | "kind" | "trackId" | "timelineStartUs" | "durationUs"
>;

function audioTransitionIsValid(
  transition: VideoEditorTimelineTransition,
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

/** Keep seam removal in the same undoable batch as a move or trim. */
export function reconcileAudioTransitionOperations(
  timeline: VideoEditorTimeline | undefined,
  redo: VideoEditorOperation[],
  undo: VideoEditorOperation[],
) {
  if (!timeline) return { redo, undo };
  const transitions = timeline.document.transitions ?? [];
  if (
    !transitions.some((item) =>
      audioTransitionKinds.includes(item.kind as AudioTransitionKind),
    )
  )
    return { redo, undo };
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
      for (const restored of operation.clips)
        clips.set(restored.id, { ...restored });
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
      audioTransitionKinds.includes(transition.kind as AudioTransitionKind) &&
      !removedIds.has(transition.id) &&
      !audioTransitionIsValid(transition, clips, trackKinds),
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
