import { snapUs } from "./editorModel";
import { canPlaceClip } from "./timelineSnap";
import type {
  VideoEditorClip,
  VideoEditorOperation,
  VideoEditorTrack,
} from "./types";

export type ClipClipboardSnapshot = VideoEditorClip;

export function snapshotClipForClipboard(
  clip: VideoEditorClip,
): ClipClipboardSnapshot {
  return structuredClone(clip);
}

function trackAcceptsClip(
  track: VideoEditorTrack,
  clipKind: VideoEditorClip["kind"],
): boolean {
  if (track.kind === "mixed")
    return clipKind === "video" || clipKind === "image";
  if (track.kind === "audio") return clipKind === "audio";
  if (track.kind === "visual") return clipKind !== "audio";
  return false;
}

function resolvePasteTrack(
  snapshot: ClipClipboardSnapshot,
  tracks: VideoEditorTrack[],
): VideoEditorTrack | undefined {
  const preferred = tracks.find(
    (track) =>
      track.id === snapshot.trackId &&
      !track.locked &&
      trackAcceptsClip(track, snapshot.kind),
  );
  if (preferred) return preferred;
  return [...tracks]
    .sort((left, right) => left.order - right.order)
    .find((track) => !track.locked && trackAcceptsClip(track, snapshot.kind));
}

export function pasteClipOperations({
  snapshot,
  tracks,
  playheadUs,
  fps,
  newClipId = crypto.randomUUID(),
}: {
  snapshot: ClipClipboardSnapshot;
  tracks: VideoEditorTrack[];
  playheadUs: number;
  fps: number;
  newClipId?: string;
}):
  | {
      redo: VideoEditorOperation[];
      undo: VideoEditorOperation[];
      newClipId: string;
    }
  | { error: string } {
  const target = resolvePasteTrack(snapshot, tracks);
  if (!target) {
    return { error: "没有可用的目标轨道，请先解锁兼容轨道后再粘贴" };
  }
  const timelineStartUs = snapUs(playheadUs, fps);
  const clip: VideoEditorClip = {
    ...structuredClone(snapshot),
    id: newClipId,
    trackId: target.id,
    timelineStartUs,
    linkGroupId: null,
    keyframes: (snapshot.keyframes ?? []).map((keyframe) => ({
      ...keyframe,
      id: crypto.randomUUID(),
    })),
  };
  if (!canPlaceClip(clip, timelineStartUs, target.id, tracks, new Set())) {
    return { error: "该位置与其他片段重叠，无法粘贴" };
  }
  return {
    redo: [{ type: "addClip", clip }],
    undo: [{ type: "removeClip", clipId: newClipId }],
    newClipId,
  };
}
