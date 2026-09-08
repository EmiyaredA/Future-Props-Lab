import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { frameUs } from "./editorModel";
import {
  clipPlacementError,
  linkedClipIds,
  snapClipStartUs,
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
    event: ReactPointerEvent<HTMLButtonElement>,
    clip: VideoEditorClip,
  ) => {
    if (event.button != null && event.button !== 0) return;
    const sourceTrack = tracks.find((track) => track.id === clip.trackId);
    if (!sourceTrack || sourceTrack.locked || savingRef.current) return;
    cleanupRef.current?.();
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    const allClips = tracks.flatMap((track) => track.clips ?? []);
    const movingIds = linkedClipIds(
      allClips,
      selectedClipIds.includes(clip.id) ? selectedClipIds : [clip.id],
    );
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
      const startUs = snapClipStartUs({
        candidateUs: rawPositionUs(pointer.clientX) - grabOffsetUs,
        durationUs: clip.durationUs,
        targetTrackId,
        tracks,
        movingClipIds: movingIds,
        fps,
        zoom,
        timelineEndUs: seconds * 1_000_000,
        enabled: snapEnabled,
      });
      const deltaUs = startUs - clip.timelineStartUs;
      moved ||=
        Math.abs(deltaUs) >= frameUs(fps) || targetTrackId !== clip.trackId;
      const positions = new Map(
        moving.map((item) => [
          item.id,
          {
            startUs: Math.max(0, item.timelineStartUs + deltaUs),
            trackId: item.id === clip.id ? targetTrackId : item.trackId,
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
      setSnapGuideUs(snapEnabled ? startUs : undefined);
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
  };
  return { dragPreview, snapGuideUs, suppressClickRef, startClipDrag };
}
