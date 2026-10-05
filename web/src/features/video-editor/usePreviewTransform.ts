import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import type { VideoEditorClip, VideoEditorOperation } from "./types";
import type { TimelineEditBuilder } from "./timelineSaveQueue";
import {
  changedTransform,
  gestureTransform,
  transformAt,
  transformEdit,
  type ClipTransform,
  type Point,
  type TransformDraft,
  type TransformGeometry,
  type TransformHandle,
} from "./transformModel";

type Gesture = {
  pointerId: number;
  target: HTMLElement;
  initial: ClipTransform;
  next: ClipTransform;
  handle: TransformHandle;
  start: Point;
  bounds: DOMRect;
  clipId: string;
  revision: number;
  playheadUs: number;
  geometry: TransformGeometry;
};
export function usePreviewTransform({
  clip,
  localUs,
  geometry,
  revision,
  playheadUs,
  stageRef,
  canvasWidth,
  canvasHeight,
  disabled,
  commit,
  onDraft,
  onStart,
}: {
  clip?: VideoEditorClip;
  localUs: number;
  geometry?: TransformGeometry;
  revision: number;
  playheadUs: number;
  stageRef: RefObject<HTMLDivElement | null>;
  canvasWidth: number;
  canvasHeight: number;
  disabled: boolean;
  commit?: (
    redo: VideoEditorOperation[] | TimelineEditBuilder,
    undo?: VideoEditorOperation[],
  ) => Promise<void>;
  onDraft?: (draft: TransformDraft | undefined) => void;
  onStart: () => void;
}) {
  const [draft, setDraft] = useState<TransformDraft>();
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const gesture = useRef<Gesture | undefined>(undefined);
  const mounted = useRef(true);
  const callbacks = useRef({ onDraft, onStart });
  callbacks.current = { onDraft, onStart };
  const publish = useCallback((next?: TransformDraft) => {
    setDraft(next);
    callbacks.current.onDraft?.(next);
  }, []);
  const cancel = useCallback(() => {
    const current = gesture.current;
    gesture.current = undefined;
    if (current?.target.hasPointerCapture?.(current.pointerId))
      current.target.releasePointerCapture(current.pointerId);
    publish();
  }, [publish]);
  useLayoutEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const update = () => {
      const rect = node.getBoundingClientRect();
      setBounds((before) =>
        before.width === rect.width && before.height === rect.height
          ? before
          : { width: rect.width, height: rect.height },
      );
    };
    update();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(update);
    observer?.observe(node);
    window.addEventListener("resize", update);
    document.addEventListener("fullscreenchange", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
      document.removeEventListener("fullscreenchange", update);
    };
  }, [stageRef, clip?.id, disabled]);
  useLayoutEffect(() => {
    if (gesture.current) cancel();
  }, [
    clip?.id,
    revision,
    playheadUs,
    disabled,
    canvasWidth,
    canvasHeight,
    bounds.width,
    bounds.height,
    cancel,
  ]);
  useEffect(() => {
    mounted.current = true;
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && gesture.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancel();
      }
    };
    window.addEventListener("keydown", escape, true);
    return () => {
      mounted.current = false;
      window.removeEventListener("keydown", escape, true);
      const current = gesture.current;
      gesture.current = undefined;
      if (current?.target.hasPointerCapture?.(current.pointerId))
        current.target.releasePointerCapture(current.pointerId);
      callbacks.current.onDraft?.(undefined);
    };
  }, [cancel]);
  const eligible = Boolean(
    clip &&
    geometry &&
    commit &&
    !disabled &&
    !pending &&
    (geometry.multiplier ?? 1) > 0,
  );
  const toCanvas = (
    event: { clientX: number; clientY: number },
    rect: DOMRect,
  ): Point => ({
    x: ((event.clientX - rect.left) * canvasWidth) / rect.width,
    y: ((event.clientY - rect.top) * canvasHeight) / rect.height,
  });
  const save = async (
    current: Pick<
      Gesture,
      "clipId" | "revision" | "playheadUs" | "initial" | "next"
    >,
  ) => {
    const values = changedTransform(current.initial, current.next);
    if (!commit || !Object.keys(values).length) {
      cancel();
      return;
    }
    setPending(true);
    setError("");
    publish({
      clipId: current.clipId,
      revision: current.revision,
      playheadUs: current.playheadUs,
      values,
    });
    try {
      await commit(
        transformEdit(current.clipId, current.playheadUs, values, {
          revision: current.revision,
        }),
      );
    } catch (caught) {
      if (mounted.current)
        setError(caught instanceof Error ? caught.message : "变换保存失败");
    } finally {
      if (mounted.current) {
        setPending(false);
        publish();
      }
    }
  };
  const onPointerDown =
    (handle: TransformHandle) => (event: PointerEvent<HTMLElement>) => {
      if (
        !eligible ||
        !clip ||
        !geometry ||
        event.button !== 0 ||
        gesture.current
      )
        return;
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect?.width || !rect.height) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      const initial = transformAt(clip, localUs);
      gesture.current = {
        pointerId: event.pointerId,
        target: event.currentTarget,
        handle,
        initial,
        next: initial,
        start: toCanvas(event, rect),
        bounds: rect,
        clipId: clip.id,
        revision,
        playheadUs,
        geometry,
      };
      setError("");
      callbacks.current.onStart();
      publish({ clipId: clip.id, revision, playheadUs, values: {} });
    };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const current = gesture.current;
    if (!current || event.pointerId !== current.pointerId) return;
    current.next = gestureTransform(
      current.initial,
      current.geometry,
      current.handle,
      current.start,
      toCanvas(event, current.bounds),
      event.shiftKey,
      current.next.rotation,
    );
    publish({
      clipId: current.clipId,
      revision: current.revision,
      playheadUs: current.playheadUs,
      values: changedTransform(current.initial, current.next),
    });
  };
  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    const current = gesture.current;
    if (!current || event.pointerId !== current.pointerId) return;
    onPointerMove(event);
    gesture.current = undefined;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    void save(current);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (
      !eligible ||
      !clip ||
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const initial = transformAt(clip, localUs),
      step = event.shiftKey ? 10 : 1;
    callbacks.current.onStart();
    void save({
      clipId: clip.id,
      revision,
      playheadUs,
      initial,
      next: {
        ...initial,
        x:
          initial.x +
          (event.key === "ArrowLeft"
            ? -step
            : event.key === "ArrowRight"
              ? step
              : 0),
        y:
          initial.y +
          (event.key === "ArrowUp"
            ? -step
            : event.key === "ArrowDown"
              ? step
              : 0),
      },
    });
  };
  const visibleDraft =
    draft &&
    draft.clipId === clip?.id &&
    draft.playheadUs === playheadUs &&
    (draft.revision === revision || pending)
      ? draft
      : undefined;
  return {
    draft: visibleDraft,
    bounds,
    eligible,
    pending,
    error,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onKeyDown,
    onPointerCancel: () => {
      if (gesture.current) cancel();
    },
    onLostPointerCapture: () => {
      if (gesture.current) cancel();
    },
  };
}
