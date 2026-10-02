import type {
  VideoEditorClip,
  VideoEditorOperation,
  VideoEditorTimeline,
  VideoEditorTrack,
} from "./types";

export function audioSeamPairForSelection(
  tracks: VideoEditorTrack[],
  selectedIds: string[],
): { from: VideoEditorClip; to: VideoEditorClip } | undefined {
  for (const track of tracks) {
    if (track.kind !== "audio") continue;
    const ordered = [...(track.clips ?? [])].sort(
      (a, b) =>
        a.timelineStartUs - b.timelineStartUs || a.id.localeCompare(b.id),
    );
    if (selectedIds.length === 2) {
      const index = ordered.findIndex((clip) => clip.id === selectedIds[0]);
      const pair = ordered.filter((clip) => selectedIds.includes(clip.id));
      if (index >= 0 && pair.length === 2) {
        const first = ordered.indexOf(pair[0]!);
        if (ordered[first + 1]?.id === pair[1]!.id)
          return { from: pair[0]!, to: pair[1]! };
      }
    }
    if (selectedIds.length === 1) {
      const index = ordered.findIndex((clip) => clip.id === selectedIds[0]);
      if (index < 0) continue;
      const current = ordered[index]!;
      const previous = ordered[index - 1];
      const next = ordered[index + 1];
      if (previous?.assetId === current.assetId)
        return { from: previous, to: current };
      if (next?.assetId === current.assetId) return { from: current, to: next };
      if (index > 0) return { from: ordered[index - 1]!, to: ordered[index]! };
      if (ordered[index + 1])
        return { from: ordered[index]!, to: ordered[index + 1]! };
    }
  }
  return undefined;
}

export function audioSeamOperations(
  timeline: VideoEditorTimeline,
  from: VideoEditorClip,
  to: VideoEditorClip,
  sourceInUs: number,
  fadeDurationUs: number,
): { redo: VideoEditorOperation[]; undo: VideoEditorOperation[] } {
  const tracks = timeline.document.tracks ?? [];
  const track = tracks.find((item) => item.id === to.trackId);
  const following = (track?.clips ?? []).filter(
    (clip) => clip.id !== to.id && clip.timelineStartUs > to.timelineStartUs,
  );
  const followingIds = new Set(following.map((clip) => clip.id));
  const linkedGroups = new Set(
    following.map((clip) => clip.linkGroupId).filter(Boolean),
  );
  const originals = tracks
    .flatMap((item) => item.clips ?? [])
    .filter(
      (clip) =>
        clip.id === to.id ||
        followingIds.has(clip.id) ||
        (clip.linkGroupId && linkedGroups.has(clip.linkGroupId)),
    );
  const existing = (timeline.document.transitions ?? []).find(
    (transition) =>
      transition.fromClipId === from.id && transition.toClipId === to.id,
  );
  const transitionId = existing?.id ?? crypto.randomUUID();
  return {
    redo: [
      {
        type: "alignAudioSeam",
        fromClipId: from.id,
        toClipId: to.id,
        sourceInUs,
        fadeDurationUs,
        transitionId,
      },
    ],
    undo: [
      ...(existing
        ? [
            {
              type: "updateTransition" as const,
              transitionId,
              patch: { durationUs: existing.durationUs },
            },
          ]
        : [{ type: "removeTransition" as const, transitionId }]),
      { type: "restoreClipStates", clips: originals },
    ],
  };
}
