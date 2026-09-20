import { snapUs } from "./editorModel";
import { canPlaceClip } from "./timelineSnap";
import type {
  VideoEditorClip,
  VideoEditorOperation,
  VideoEditorTrack,
} from "./types";

export type ClipClipboardSnapshot = VideoEditorClip[];

export function snapshotClipsForClipboard(
  clips: VideoEditorClip[],
): ClipClipboardSnapshot {
  return structuredClone(clips);
}

export function snapshotClipForClipboard(
  clip: VideoEditorClip,
): ClipClipboardSnapshot {
  return snapshotClipsForClipboard([clip]);
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
  snapshot: VideoEditorClip,
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

function buildPastedClip(
  snapshot: VideoEditorClip,
  newClipId: string,
  trackId: string,
  timelineStartUs: number,
): VideoEditorClip {
  return {
    ...structuredClone(snapshot),
    id: newClipId,
    trackId,
    timelineStartUs,
    linkGroupId: null,
    keyframes: (snapshot.keyframes ?? []).map((keyframe) => ({
      ...keyframe,
      id: crypto.randomUUID(),
    })),
  };
}

export function pasteClipsOperations({
  snapshot,
  tracks,
  playheadUs,
  fps,
  newClipIds,
}: {
  snapshot: ClipClipboardSnapshot;
  tracks: VideoEditorTrack[];
  playheadUs: number;
  fps: number;
  newClipIds?: string[];
}):
  | {
      redo: VideoEditorOperation[];
      undo: VideoEditorOperation[];
      newClipIds: string[];
    }
  | { error: string } {
  if (!snapshot.length) {
    return { error: "剪贴板为空" };
  }
  const ordered = [...snapshot].sort(
    (left, right) => left.timelineStartUs - right.timelineStartUs,
  );
  const baseStartUs = ordered[0]!.timelineStartUs;
  const playheadSnapped = snapUs(playheadUs, fps);
  const workingTracks: VideoEditorTrack[] = tracks.map((track) => ({
    ...track,
    clips: [...(track.clips ?? [])],
  }));
  const redo: VideoEditorOperation[] = [];
  const undo: VideoEditorOperation[] = [];
  const createdIds: string[] = [];

  for (const [index, item] of ordered.entries()) {
    const target = resolvePasteTrack(item, workingTracks);
    if (!target) {
      return { error: "没有可用的目标轨道，请先解锁兼容轨道后再粘贴" };
    }
    const timelineStartUs = snapUs(
      playheadSnapped + (item.timelineStartUs - baseStartUs),
      fps,
    );
    const newClipId = newClipIds?.[index] ?? crypto.randomUUID();
    const clip = buildPastedClip(item, newClipId, target.id, timelineStartUs);
    if (
      !canPlaceClip(clip, timelineStartUs, target.id, workingTracks, new Set())
    ) {
      return { error: "该位置与其他片段重叠，无法粘贴" };
    }
    const track = workingTracks.find((entry) => entry.id === target.id)!;
    track.clips = [...(track.clips ?? []), clip];
    redo.push({ type: "addClip", clip });
    undo.unshift({ type: "removeClip", clipId: newClipId });
    createdIds.push(newClipId);
  }

  return { redo, undo, newClipIds: createdIds };
}

/** Single-clip helper that preserves the previous return shape. */
export function pasteClipOperations({
  snapshot,
  tracks,
  playheadUs,
  fps,
  newClipId = crypto.randomUUID(),
}: {
  snapshot: ClipClipboardSnapshot | VideoEditorClip;
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
  const clips = Array.isArray(snapshot) ? snapshot : [snapshot];
  const result = pasteClipsOperations({
    snapshot: clips,
    tracks,
    playheadUs,
    fps,
    newClipIds: [newClipId],
  });
  if ("error" in result) return result;
  return {
    redo: result.redo,
    undo: result.undo,
    newClipId: result.newClipIds[0]!,
  };
}
