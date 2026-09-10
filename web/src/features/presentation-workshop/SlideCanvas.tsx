import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import type { Editor } from "@tiptap/react";
import { bounds, snapMove } from "./geometry";
import { SlideSurface } from "./SlideSurface";
import { SlideTextEditor } from "./SlideTextEditor";
import type { Slide, SlideElement } from "./types";

import { SelectionOverlay } from "./SelectionOverlay";
import { SelectionHandles } from "./SelectionHandles";
import {
  resizeFromHandle,
  rotatedBounds,
  type ResizeHandle,
} from "./selectionGeometry";

type Gesture = {
  handle: ResizeHandle;
  pointer: number;
  startX: number;
  startY: number;
  base: Slide;
  ids: string[];
  mode: "move" | "resize" | "rotate" | "marquee";
  box: ReturnType<typeof bounds>;
};
export function SlideCanvas({
  slide,
  selected,
  select,
  editing,
  setEditing,
  replace,
  onText,
  readOnly,
  zoom,
  onScaleChange,
  selectionToolbar,
  cropOverlay,
  onReady,
  onComposition,
  undo,
  redo,
}: {
  slide: Slide;
  selected: string[];
  select: (ids: string[]) => void;
  editing: string | null;
  setEditing: (id: string | null) => void;
  replace: (slide: Slide) => void;
  onText: (
    id: string,
    paragraphs: SlideElement["paragraphs"],
    format?: boolean,
  ) => void;
  readOnly: boolean;
  zoom: number | null;
  onScaleChange?: (scale: number) => void;
  selectionToolbar?: ReactNode;
  cropOverlay?: ReactNode;
  onReady: (editor: Editor | null) => void;
  onComposition: (active: boolean) => void;
  undo: () => void;
  redo: () => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLDivElement>(null),
    gesture = useRef<Gesture | null>(null);
  const preview = useRef<Slide | null>(null);
  const lastHit = useRef<string | null>(null);
  const [transient, setTransient] = useState<Slide | null>(null),
    [fit, setFit] = useState(0.5);
  const [gesturing, setGesturing] = useState(false);
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({
    x: null,
    y: null,
  });
  const [marquee, setMarquee] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  useEffect(() => {
    if (!host.current) return;
    const resize = () => {
      const rect = host.current!.getBoundingClientRect();
      setFit(
        Math.max(
          0.08,
          Math.min((rect.width - 48) / 1280, (rect.height - 48) / 720),
        ),
      );
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const scale = zoom ?? fit,
    display = transient?.id === slide.id ? transient : slide;
  useLayoutEffect(() => {
    onScaleChange?.(scale);
  }, [scale, onScaleChange]);
  const chosen = display.elements.filter((e) => selected.includes(e.id));
  const movable = chosen.filter((e) => !e.locked);
  const box =
    movable.length > 1
      ? rotatedBounds(movable)
      : movable.length
        ? bounds(movable)
        : null;
  const point = (event: PointerEvent) => {
    const rect = canvas.current!.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / scale,
      y: (event.clientY - rect.top) / scale,
    };
  };
  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (
      event.button !== 0 ||
      (event.target as HTMLElement).closest(".presentation-text-editor")
    )
      return;
    const element = slide.elements.find(
      (e) =>
        e.id ===
        (event.target as HTMLElement).closest<HTMLElement>("[data-element-id]")
          ?.dataset.elementId,
    );
    lastHit.current = element?.id ?? null;
    const mode = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-handle]",
    )?.dataset.handle as Gesture["mode"] | undefined;
    setEditing(null);
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    const ids = mode
      ? selected
      : element
        ? additive
          ? selected.includes(element.id)
            ? selected.filter((id) => id !== element.id)
            : [...selected, element.id]
          : selected.includes(element.id)
            ? selected
            : [element.id]
        : [];
    select(ids);
    if (readOnly || window.matchMedia("(max-width: 767px)").matches) return;
    const elements = slide.elements.filter(
      (e) => ids.includes(e.id) && !e.locked,
    );
    if (element?.locked || (element && !elements.length)) return;
    event.preventDefault();
    event.currentTarget.focus();
    const p = point(event);
    setGesturing(true);
    gesture.current = {
      handle: ((event.target as HTMLElement).closest<HTMLElement>(
        "[data-resize]",
      )?.dataset.resize ?? "se") as ResizeHandle,
      pointer: event.pointerId,
      startX: p.x,
      startY: p.y,
      base: slide,
      ids: elements.map((e) => e.id),
      mode: mode ?? (element ? "move" : "marquee"),
      box: elements.length
        ? elements.length > 1
          ? rotatedBounds(elements)
          : bounds(elements)
        : { x: p.x, y: p.y, width: 0, height: 0 },
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || event.pointerId !== g.pointer) return;
    const p = point(event);
    let dx = p.x - g.startX,
      dy = p.y - g.startY;
    if (g.mode === "marquee") {
      const area = {
        x: Math.min(p.x, g.startX),
        y: Math.min(p.y, g.startY),
        width: Math.abs(dx),
        height: Math.abs(dy),
      };
      setMarquee(area);
      select(
        g.base.elements
          .filter(
            (e) =>
              e.x >= area.x &&
              e.y >= area.y &&
              e.x + e.width <= area.x + area.width &&
              e.y + e.height <= area.y + area.height,
          )
          .map((e) => e.id),
      );
      return;
    }
    if (g.mode === "move" && !event.altKey) {
      const snap = snapMove(
        g.box,
        dx,
        dy,
        g.base.elements.filter((e) => !g.ids.includes(e.id)),
        6 / scale,
      );
      dx = snap.dx;
      dy = snap.dy;
      setGuides({ x: snap.x, y: snap.y });
    }
    const keepRatio =
      event.shiftKey ||
      g.base.elements.some(
        (e) =>
          g.ids.includes(e.id) && (e.kind === "image" || e.kind === "vector"),
      );
    const resized = resizeFromHandle(
      {
        ...g.base.elements.find((e) => g.ids.includes(e.id))!,
        ...g.box,
        rotation: 0,
        kind: "rect",
      },
      dx,
      dy,
      g.handle,
      keepRatio,
    );
    const sx = resized.width / g.box.width,
      sy = resized.height / g.box.height;
    const cx = g.box.x + g.box.width / 2,
      cy = g.box.y + g.box.height / 2;
    let angle =
      ((Math.atan2(p.y - cy, p.x - cx) -
        Math.atan2(g.startY - cy, g.startX - cx)) *
        180) /
      Math.PI;
    if (event.shiftKey) angle = Math.round(angle / 15) * 15;
    const radians = (angle * Math.PI) / 180;
    const next = {
      ...g.base,
      elements: g.base.elements.map((e) => {
        if (!g.ids.includes(e.id)) return e;
        if (g.mode === "move")
          return {
            ...e,
            x: Math.max(-10000, Math.min(10000, e.x + dx)),
            y: Math.max(-10000, Math.min(10000, e.y + dy)),
          };
        if (g.mode === "resize" && g.ids.length === 1)
          return resizeFromHandle(e, dx, dy, g.handle, event.shiftKey);
        if (g.mode === "resize")
          return {
            ...e,
            x: resized.x + (e.x - g.box.x) * sx,
            y: resized.y + (e.y - g.box.y) * sy,
            width: Math.max(1, Math.min(10000, e.width * sx)),
            height: Math.max(1, Math.min(10000, e.height * sy)),
          };
        const ex = e.x + e.width / 2 - cx,
          ey = e.y + e.height / 2 - cy;
        return {
          ...e,
          x: cx + ex * Math.cos(radians) - ey * Math.sin(radians) - e.width / 2,
          y:
            cy + ex * Math.sin(radians) + ey * Math.cos(radians) - e.height / 2,
          rotation: (e.rotation + angle + 360) % 360,
        };
      }),
    };
    preview.current = next;
    setTransient(next);
  };
  const finish = (cancel = false) => {
    if (!cancel && preview.current) replace(preview.current);
    gesture.current = null;
    setGesturing(false);
    preview.current = null;
    setTransient(null);
    setMarquee(null);
    setGuides({ x: null, y: null });
  };
  const active = display.elements.find(
    (e) => e.id === editing && e.kind === "text" && !e.locked,
  );
  return (
    <div className="presentation-canvas-area" data-popover-boundary ref={host}>
      <div
        className="presentation-canvas-viewport"
        style={{ width: 1280 * scale, height: 720 * scale }}
      >
        <div
          ref={canvas}
          className="presentation-canvas"
          role="group"
          aria-label="幻灯片画布"
          tabIndex={0}
          style={{ transform: `scale(${scale})`, width: 1280, height: 720 }}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={() => finish()}
          onPointerCancel={() => finish(true)}
          onKeyDown={(e) => {
            if (e.altKey && e.key === "F10") {
              e.preventDefault();
              host.current
                ?.querySelector<HTMLButtonElement>('[role="toolbar"] button')
                ?.focus();
            }
            if (e.key === "Escape" && gesture.current) {
              e.stopPropagation();
              finish(true);
            }
          }}
          onDoubleClick={(event) => {
            const id =
              (event.target as HTMLElement).closest<HTMLElement>(
                "[data-element-id]",
              )?.dataset.elementId ?? lastHit.current;
            if (
              !readOnly &&
              id &&
              slide.elements.some(
                (e) => e.id === id && e.kind === "text" && !e.locked,
              )
            )
              setEditing(id);
          }}
        >
          <SlideSurface slide={display} editingId={editing}>
            {active && !readOnly ? (
              <SlideTextEditor
                key={active.id}
                element={active}
                onChange={(p, format) => onText(active.id, p, format)}
                onComposition={onComposition}
                onReady={onReady}
                onExit={() => setEditing(null)}
                undo={undo}
                redo={redo}
              />
            ) : null}
            {!editing && box && !readOnly ? (
              <SelectionHandles
                box={box}
                scale={scale}
                rotation={movable.length === 1 ? movable[0].rotation : 0}
              />
            ) : null}
            {guides.x !== null ? (
              <div
                className="presentation-guide vertical"
                style={{ left: guides.x }}
              />
            ) : null}
            {guides.y !== null ? (
              <div
                className="presentation-guide horizontal"
                style={{ top: guides.y }}
              />
            ) : null}
            {marquee ? (
              <div
                className="presentation-marquee"
                style={{
                  left: marquee.x,
                  top: marquee.y,
                  width: marquee.width,
                  height: marquee.height,
                }}
              />
            ) : null}
            {cropOverlay}
          </SlideSurface>
        </div>
      </div>
      {!readOnly && !gesturing && chosen.length > 0 && selectionToolbar ? (
        <SelectionOverlay
          area={host}
          canvas={canvas}
          elements={chosen}
          scale={scale}
        >
          {selectionToolbar}
        </SelectionOverlay>
      ) : null}
    </div>
  );
}
