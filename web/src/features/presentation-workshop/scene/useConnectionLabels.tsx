import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import type { Slide } from "../types";
import type { Connection } from "./model";
import { connectionPoints, type Point } from "./connectionGeometry";
import {
  labelLayout,
  pointAt,
  positionLabel,
  resizeLabel,
  labelFontSize,
  minLabelFontSize,
  maxLabelFontSize,
} from "./connectionLabelLayout";

type Edit = { base: Slide; edge: Connection; text: string };
type Drag = {
  mode: "move" | "resize";
  base: Slide;
  edge: Connection;
  pointer: number;
  start: Point;
  centre: Point;
  next: Connection | null;
  moved: boolean;
};

export function useConnectionLabels({
  slide,
  selected,
  readOnly,
  canvas,
  scale,
  commit,
  select,
  onComposition,
}: {
  slide: Slide;
  selected?: string | null;
  readOnly: boolean;
  canvas: RefObject<HTMLDivElement | null>;
  scale: number;
  commit: (slide: Slide) => void;
  select?: (id: string) => void;
  onComposition: (active: boolean) => void;
}) {
  const drag = useRef<Drag | null>(null),
    editRef = useRef<Edit | null>(null),
    composing = useRef(false);
  const [preview, setPreview] = useState<Connection | null>(null),
    [edit, setEdit] = useState<Edit | null>(null);
  const clearDrag = useCallback(() => {
    const current = drag.current;
    drag.current = null;
    setPreview(null);
    if (current && canvas.current?.hasPointerCapture(current.pointer))
      canvas.current.releasePointerCapture(current.pointer);
    return !!current;
  }, [canvas]);
  const cancelEdit = () => {
    const active = !!editRef.current;
    editRef.current = null;
    setEdit(null);
    if (composing.current) {
      composing.current = false;
      onComposition(false);
    }
    return active;
  };
  const cancel = () => clearDrag() || cancelEdit();
  const context = useRef({ slide, selected, readOnly });
  context.current = { slide, selected, readOnly };
  useEffect(() => {
    const active = drag.current ?? editRef.current;
    if (
      active &&
      (readOnly ||
        active.base !== slide ||
        (selected != null && selected !== active.edge.id))
    ) {
      clearDrag();
      cancelEdit();
    }
  });
  useEffect(() => {
    const blur = () => clearDrag();
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("blur", blur);
      if (composing.current) onComposition(false);
    };
  }, [onComposition, clearDrag]);
  const replaceEdge = (base: Slide, edge: Connection) =>
    commit({
      ...base,
      connections: (base.connections ?? []).map((c) =>
        c.id === edge.id ? edge : c,
      ),
    });
  const valid = (base: Slide, edge: Connection) =>
    !context.current.readOnly &&
    context.current.slide === base &&
    (context.current.selected == null || context.current.selected === edge.id);
  const localPoint = (event: PointerEvent): Point => {
    const rect = canvas.current!.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / scale,
      y: (event.clientY - rect.top) / scale,
    };
  };
  const beginEdit = (edge: Connection) => {
    if (readOnly) return;
    clearDrag();
    select?.(edge.id);
    const next = { base: slide, edge, text: edge.label ?? "" };
    editRef.current = next;
    setEdit(next);
  };
  const finishEdit = () => {
    const current = editRef.current;
    if (!current || composing.current) return;
    cancelEdit();
    if (
      valid(current.base, current.edge) &&
      current.text !== current.edge.label
    )
      replaceEdge(current.base, { ...current.edge, label: current.text });
  };
  const start = (
    event: PointerEvent<SVGGElement>,
    edge: Connection,
    mode: Drag["mode"] = "move",
  ) => {
    if (readOnly || event.button !== 0 || editRef.current) return;
    event.preventDefault();
    event.currentTarget.focus();
    const box = labelLayout(connectionPoints(slide, edge), edge);
    if (!box) return;
    drag.current = {
      mode,
      base: slide,
      edge,
      pointer: event.pointerId,
      start: localPoint(event),
      centre: { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      next: null,
      moved: false,
    };
  };
  const move = (event: PointerEvent) => {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return false;
    event.preventDefault();
    const cursor = localPoint(event),
      dx = cursor.x - current.start.x,
      dy = cursor.y - current.start.y;
    if (!current.moved && Math.hypot(dx, dy) * scale <= 4) return true;
    if (!current.moved) canvas.current?.setPointerCapture(event.pointerId);
    current.moved = true;
    const centre = { x: current.centre.x + dx, y: current.centre.y + dy };
    const points = connectionPoints(current.base, current.edge);
    const patch =
      current.mode === "resize"
        ? resizeLabel(points, current.edge, { x: dx, y: dy })
        : positionLabel(points, centre, current.edge.label_position ?? 0.5);
    if (!patch) return true;
    if (
      Math.abs(patch.label_offset.x) > 10000 ||
      Math.abs(patch.label_offset.y) > 10000
    )
      return true;
    current.next = { ...current.edge, ...patch };
    setPreview(current.next);
    return true;
  };
  const finish = (event: PointerEvent) => {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return false;
    move(event);
    clearDrag();
    if (current.moved && current.next && valid(current.base, current.edge))
      replaceEdge(current.base, current.next);
    return true;
  };
  const key = (event: KeyboardEvent<SVGGElement>, edge: Connection) => {
    if (
      readOnly ||
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    )
      return;
    event.preventDefault();
    const box = labelLayout(connectionPoints(slide, edge), edge);
    if (!box) return;
    const amount = event.shiftKey ? 10 : 1;
    const centre = {
      x:
        box.x +
        box.width / 2 +
        (event.key === "ArrowLeft"
          ? -amount
          : event.key === "ArrowRight"
            ? amount
            : 0),
      y:
        box.y +
        box.height / 2 +
        (event.key === "ArrowUp"
          ? -amount
          : event.key === "ArrowDown"
            ? amount
            : 0),
    };
    replaceEdge(slide, {
      ...edge,
      ...positionLabel(
        connectionPoints(slide, edge),
        centre,
        edge.label_position ?? 0.5,
      ),
    });
  };
  const resizeKey = (event: KeyboardEvent<SVGGElement>, edge: Connection) => {
    if (
      readOnly ||
      ![
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
      ].includes(event.key)
    )
      return;
    event.preventDefault();
    const step = event.shiftKey ? 2 : 0.5;
    const next =
      event.key === "Home"
        ? minLabelFontSize
        : event.key === "End"
          ? maxLabelFontSize
          : (edge.label_font_size ?? labelFontSize) +
            (["ArrowRight", "ArrowUp"].includes(event.key) ? step : -step);
    replaceEdge(slide, {
      ...edge,
      label_font_size: Math.max(
        minLabelFontSize,
        Math.min(maxLabelFontSize, next),
      ),
    });
  };
  const box = edit
    ? labelLayout(connectionPoints(slide, edit.edge), {
        ...edit.edge,
        label: edit.text || " ",
      })
    : null;
  const anchor = edit
    ? pointAt(
        connectionPoints(slide, edit.edge),
        edit.edge.label_position ?? 0.5,
      )
    : null;
  return {
    preview,
    active: () => !!drag.current || !!editRef.current,
    cancel,
    move,
    finish,
    actions: {
      labelControlScale: scale,
      onEditLabel: beginEdit,
      onLabelPointerDown: start,
      onLabelKeyDown: key,
      onLabelResizePointerDown: (
        event: PointerEvent<SVGGElement>,
        edge: Connection,
      ) => start(event, edge, "resize"),
      onLabelResizeKeyDown: resizeKey,
      editingLabel: edit?.edge.id,
    },
    editor:
      edit && !readOnly && edit.base === slide ? (
        <textarea
          key={`${slide.id}:${edit.edge.id}`}
          className="presentation-connection-label-editor"
          aria-label="编辑连线文字"
          data-presentation-history="local"
          autoFocus
          maxLength={500}
          value={edit.text}
          style={{
            left: box?.x ?? (anchor?.x ?? 0) - 60,
            top: box?.y ?? (anchor?.y ?? 0) - 29,
            width: Math.max(120, box?.width ?? 120),
            height: Math.max(28, box?.height ?? 28),
            color: edit.edge.color,
            background: slide.background,
            fontSize: edit.edge.label_font_size ?? 16,
            lineHeight: `${(edit.edge.label_font_size ?? 16) * 1.25}px`,
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            const next = { ...edit, text: e.target.value };
            editRef.current = next;
            setEdit(next);
          }}
          onBlur={() => finishEdit()}
          onCompositionStart={() => {
            composing.current = true;
            onComposition(true);
          }}
          onCompositionEnd={() => {
            composing.current = false;
            onComposition(false);
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (
              composing.current ||
              event.nativeEvent.isComposing ||
              event.keyCode === 229
            )
              return;
            if (event.key === "Escape") {
              event.preventDefault();
              cancelEdit();
              canvas.current?.focus();
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              finishEdit();
              canvas.current?.focus();
            }
          }}
        />
      ) : null,
  };
}
