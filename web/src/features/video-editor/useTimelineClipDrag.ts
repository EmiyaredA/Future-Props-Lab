import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  clipPlacementError,
  linkedClipIds,
  snapClipPosition,
} from "./timelineSnap";
import type {
  VideoEditorClip,
  VideoEditorOperation,
  VideoEditorTrack,
} from "./types";

type DragPreview = {
  positions: Map<string, { startUs: number; trackId: string }>;
  valid: boolean;
  error?: string;
};

export function useTimelineClipDrag({
  scroller,
  tracks,
  selectedClipIds,
  selectClip,
  rawPositionUs,
  fps,
  zoom,
  seconds,
  snapEnabled,
  commit,
  onNotice,
}: {
  scroller: RefObject<HTMLDivElement | null>;
  tracks: VideoEditorTrack[];
  selectedClipIds: string[];
  selectClip: (id?: string, additive?: boolean) => void;
  rawPositionUs: (clientX: number) => number;
  fps: number;
  zoom: number;
  seconds: number;
  snapEnabled: boolean;
  commit: (
    redo: VideoEditorOperation[],
    undo?: VideoEditorOperation[],
  ) => Promise<void>;
  onNotice?: (message: string) => void;
}) {
  const [dragPreview, setDragPreview] = useState<DragPreview>();
  const [snapGuideUs, setSnapGuideUs] = useState<number>();
  const suppressClickRef = useRef(false);
  const cleanupRef = useRef<() => void>(undefined);
  const savingRef = useRef(false);
  useEffect(() => () => cleanupRef.current?.(), []);

  const startClipDrag = (
    event: ReactPointerEvent<HTMLElement>,
    clip: VideoEditorClip,
  ) => {
    if (event.button != null && event.button !== 0) return;
    const sourceTrack = tracks.find((track) => track.id === clip.trackId);
    if (!sourceTrack || sourceTrack.locked || savingRef.current) return;
    const additive = event.metaKey || event.ctrlKey;
    if (additive) {
      event.preventDefault();
      event.stopPropagation();
      selectClip(clip.id, true);
      // pointerdown already toggled; ignore the synthetic click that follows.
      suppressClickRef.current = true;
      window.setTimeout(() => (suppressClickRef.current = false), 100);
      return;
    }
    cleanupRef.current?.();
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    const origin = { x: event.clientX, y: event.clientY };
    const allClips = tracks.flatMap((track) => track.clips ?? []);
    const selection = selectedClipIds.includes(clip.id)
      ? selectedClipIds
      : [clip.id];
    const movingIds = linkedClipIds(allClips, selection);
    const moving = allClips.filter((item) => movingIds.has(item.id));
    if (!selectedClipIds.includes(clip.id)) selectClip(clip.id);
    const grabOffsetUs = rawPositionUs(event.clientX) - clip.timelineStartUs;
    const rows = [
      ...(scroller.current?.querySelectorAll<HTMLElement>(
        ".ve-track-row[data-track-id]",
      ) ?? []),
    ];
    let moved = false;
    let preview: DragPreview | undefined;
    let frame: number | undefined;
    let latestPointer: PointerEvent | undefined;

    const update = (pointer: PointerEvent) => {
      if (
        !moved &&
        Math.hypot(pointer.clientX - origin.x, pointer.clientY - origin.y) < 3
      )
        return;
      // A translated clip still belongs to its source row in the DOM. Hit
      // test the stable row bounds, not the element under the moving clip.
      const row = rows.find((node) => {
        const rect = node.getBoundingClientRect();
        return (
          pointer.clientX >= rect.left &&
          pointer.clientX < rect.right &&
          pointer.clientY >= rect.top &&
          pointer.clientY < rect.bottom
        );
      });
      const targetTrackId = row?.dataset.trackId ?? clip.trackId;
      const { startUs, guideUs } = snapClipPosition({
        candidateUs: rawPositionUs(pointer.clientX) - grabOffsetUs,
        durationUs: clip.durationUs,
        targetTrackId,
        tracks,
        movingClipIds: movingIds,
        fps,
        zoom,
        timelineEndUs: seconds * 1_000_000,
        enabled: snapEnabled,
        minimumStartUs:
          clip.timelineStartUs -
          Math.min(...moving.map((item) => item.timelineStartUs)),
      });
      const deltaUs = startUs - clip.timelineStartUs;
      moved ||= deltaUs !== 0 || targetTrackId !== clip.trackId;
      // Same-track members of the selection follow the grabbed clip onto the
      // destination track; linked counterparts on other tracks keep theirs.
      const positions = new Map(
        moving.map((item) => [
          item.id,
          {
            startUs: item.timelineStartUs + deltaUs,
            trackId:
              item.trackId === clip.trackId ? targetTrackId : item.trackId,
          },
        ]),
      );
      const error = moving
        .map((item) => {
          const position = positions.get(item.id)!;
          return clipPlacementError(
            item,
            position.startUs,
            position.trackId,
            tracks,
            movingIds,
          );
        })
        .find(Boolean);
      const valid = !error;
      setSnapGuideUs(valid ? guideUs : undefined);
      if (
        preview?.valid === valid &&
        moving.every((item) => {
          const previous = preview!.positions.get(item.id)!;
          const next = positions.get(item.id)!;
          return (
            previous.startUs === next.startUs &&
            previous.trackId === next.trackId
          );
        })
      )
        return;
      preview = { positions, valid, error };
      setDragPreview(preview);
    };
    const move = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      pointer.preventDefault();
      latestPointer = pointer;
      if (frame !== undefined) return;
      frame = window.requestAnimationFrame(() => {
        frame = undefined;
        if (latestPointer) update(latestPointer);
      });
    };
    const cleanup = () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", keydown);
      cleanupRef.current = undefined;
    };
    const clearPreview = () => {
      setDragPreview(undefined);
      setSnapGuideUs(undefined);
    };
    const suppressClick = () => {
      suppressClickRef.current = moved;
      if (moved)
        window.setTimeout(() => (suppressClickRef.current = false), 100);
    };
    const cancel = () => {
      cleanup();
      suppressClick();
      clearPreview();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    const finish = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      update(pointer);
      cleanup();
      suppressClick();
      setSnapGuideUs(undefined);
      const redo: VideoEditorOperation[] = [];
      const undo: VideoEditorOperation[] = [];
      if (moved && preview?.valid) {
        for (const item of moving) {
          const next = preview.positions.get(item.id)!;
          if (
            next.startUs === item.timelineStartUs &&
            next.trackId === item.trackId
          )
            continue;
          redo.push({
            type: "moveClip",
            clipId: item.id,
            trackId: next.trackId,
            timelineStartUs: next.startUs,
          });
          undo.push({
            type: "moveClip",
            clipId: item.id,
            trackId: item.trackId,
            timelineStartUs: item.timelineStartUs,
          });
        }
      } else if (moved && preview && !preview.valid) {
        onNotice?.(preview.error!);
      }
      if (!redo.length) {
        clearPreview();
        return;
      }
      // Keep the drop position visible until the saved timeline arrives.
      savingRef.current = true;
      void commit(redo, undo)
        .catch(() => undefined)
        .finally(() => {
          savingRef.current = false;
          clearPreview();
        });
    };
    cleanupRef.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", keydown);
  };
  return { dragPreview, snapGuideUs, suppressClickRef, startClipDrag };
}
