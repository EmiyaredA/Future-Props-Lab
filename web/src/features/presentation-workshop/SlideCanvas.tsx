import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import type { Editor } from "@tiptap/react";
import { bounds } from "./geometry";
import { layoutContext } from "./layoutObjects";
import {
  snapTranslation,
  snapResize,
  resizeSelection,
  type LayoutGuide,
  type SnapMemory,
} from "./layoutSnapping";
import { LayoutGuides } from "./LayoutGuides";
import { SlideSurface } from "./SlideSurface";
import { SlideTextEditor } from "./SlideTextEditor";
import type { Slide, SlideElement } from "./types";
import type { Connection } from "./scene/model";
import { selectionIds } from "./scene/model";
import { groupAtHit, selectionAtHit } from "./scene/selection";
import { useSlideViewport } from "./useSlideViewport";

import { SelectionOverlay } from "./SelectionOverlay";
import { SelectionHandles } from "./SelectionHandles";
import { rotatedBounds, type ResizeHandle } from "./selectionGeometry";

type Gesture = {
  handle: ResizeHandle;
  pointer: number;
  startX: number;
  startY: number;
  base: Slide;
  ids: string[];
  mode: "move" | "resize" | "rotate" | "marquee";
  box: ReturnType<typeof bounds>;
  context: ReturnType<typeof layoutContext>;
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
  onZoomChange,
  onScaleChange,
  selectionToolbar,
  cropOverlay,
  onReady,
  onComposition,
  historyGesture,
  groupScope = null,
  onGroupScopeChange,
  selectedConnection,
  onSelectConnection,
  referenceOverlay,
  onCanvasInteract,
  previewConnection,
}: {
  slide: Slide;
  onCanvasInteract?: () => void;
  previewConnection?: Connection;
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
  onZoomChange?: (zoom: number) => void;
  onScaleChange?: (scale: number) => void;
  selectionToolbar?: ReactNode;
  cropOverlay?: ReactNode;
  onReady: (editor: Editor | null) => void;
  onComposition: (active: boolean) => void;
  historyGesture?: RefObject<(() => boolean) | null>;
  groupScope?: string | null;
  onGroupScopeChange?: (scope: string | null, ids: string[]) => void;
  selectedConnection?: string | null;
  onSelectConnection?: (id: string) => void;
  referenceOverlay?: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLDivElement>(null),
    gesture = useRef<Gesture | null>(null);
  const preview = useRef<Slide | null>(null);
  const rawPreview = useRef<Slide | null>(null);
  const snapMemory = useRef<SnapMemory>([]);
  const lastHit = useRef<string | null>(null);
  const press = useRef<{
    pointer: number;
    x: number;
    y: number;
    moved: boolean;
    canEdit: boolean;
    drill: ReturnType<typeof selectionAtHit>["drill"];
  } | null>(null);
  const textClick = useRef({ id: null as string | null, ready: false });
  const lastPressCanEdit = useRef(false);
  const [transient, setTransient] = useState<Slide | null>(null);
  const [gesturing, setGesturing] = useState(false);
  const [guides, setGuides] = useState<LayoutGuide[]>([]);
  const [marquee, setMarquee] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  useEffect(() => {
    press.current = null;
    gesture.current = null;
    preview.current = null;
    lastHit.current = null;
    textClick.current = { id: null, ready: false };
    lastPressCanEdit.current = false;
    setTransient(null);
    setGesturing(false);
    setMarquee(null);
    setGuides([]);
    snapMemory.current = [];
    rawPreview.current = null;
  }, [slide.id, readOnly]);
  useEffect(() => {
    const releaseSnap = (event: KeyboardEvent) => {
      if (
        event.key !== "Alt" ||
        !gesture.current ||
        gesture.current.mode === "rotate"
      )
        return;
      setGuides([]);
      snapMemory.current = [];
      if (rawPreview.current) {
        preview.current = rawPreview.current;
        setTransient(rawPreview.current);
      }
    };
    window.addEventListener("keydown", releaseSnap);
    return () => window.removeEventListener("keydown", releaseSnap);
  }, []);
  const scale = useSlideViewport({
    host,
    canvas,
    zoom,
    onZoomChange,
    isZoomBlocked: () => !!press.current || !!gesture.current || !!cropOverlay,
  });
  const display = transient?.id === slide.id ? transient : slide;
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
    const hit = selectionAtHit(
      slide,
      selected,
      element?.id ?? null,
      groupScope,
      additive,
    );
    const ids = mode ? selected : hit.ids;
    const grouped =
      element &&
      slide.groups?.some((g) => (g.element_ids ?? []).includes(element.id));
    press.current = {
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      canEdit:
        !mode &&
        !additive &&
        !readOnly &&
        element?.kind === "text" &&
        !element.locked &&
        (!grouped ||
          (selected.length === 1 &&
            selected[0] === element.id &&
            !groupAtHit(slide, element.id, groupScope))),
      drill: !mode && !readOnly && onGroupScopeChange ? hit.drill : null,
    };
    if (!mode && hit.scope !== groupScope && !readOnly && onGroupScopeChange)
      onGroupScopeChange(hit.scope, ids);
    else select(ids);
    if (readOnly || window.matchMedia("(max-width: 767px)").matches) return;
    const elements = slide.elements.filter(
      (e) => ids.includes(e.id) && !e.locked,
    );
    if (
      element?.locked ||
      slide.elements.some((e) => ids.includes(e.id) && e.locked) ||
      (element && !elements.length)
    )
      return;
    event.preventDefault();
    event.currentTarget.focus();
    const p = point(event);
    gesture.current = {
      handle: ((event.target as HTMLElement).closest<HTMLElement>(
        "[data-resize]",
      )?.dataset.resize ?? "se") as ResizeHandle,
      pointer: event.pointerId,
      startX: p.x,
      startY: p.y,
      base: slide,
      context: layoutContext(slide, ids, mode ? groupScope : hit.scope),
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
    const pending = press.current;
    if (!pending || event.pointerId !== pending.pointer) return;
    if (!pending.moved) {
      if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) <= 4)
        return;
      pending.moved = true;
    }
    const g = gesture.current;
    if (!g || event.pointerId !== g.pointer) return;
    setGesturing(true);
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
      select([
        ...new Set(
          g.base.elements
            .filter(
              (e) =>
                e.x >= area.x &&
                e.y >= area.y &&
                e.x + e.width <= area.x + area.width &&
                e.y + e.height <= area.y + area.height,
            )
            .flatMap((e) => selectionIds(g.base, e.id, groupScope)),
        ),
      ]);
      return;
    }
    const selectedElements = g.base.elements.filter((e) =>
      g.ids.includes(e.id),
    );
    const resize = (x: number, y: number) =>
      resizeSelection(selectedElements, x, y, g.handle, event.shiftKey);
    const rawElements =
      g.mode === "resize"
        ? resize(dx, dy)
        : selectedElements.map((e) => ({
            ...e,
            x: Math.max(-10000, Math.min(10000, e.x + dx)),
            y: Math.max(-10000, Math.min(10000, e.y + dy)),
          }));
    rawPreview.current = {
      ...g.base,
      elements: g.base.elements.map(
        (e) => rawElements.find((r) => r.id === e.id) ?? e,
      ),
    };
    if ((g.mode === "move" || g.mode === "resize") && !event.altKey) {
      const snap =
        g.mode === "move"
          ? snapTranslation(
              rotatedBounds(selectedElements),
              dx,
              dy,
              g.context.others,
              g.context.container,
              scale,
              snapMemory.current,
            )
          : snapResize(
              selectedElements,
              dx,
              dy,
              g.handle,
              event.shiftKey,
              g.context.others,
              g.context.container,
              scale,
              snapMemory.current,
            );
      dx = snap.dx;
      dy = snap.dy;
      snapMemory.current = snap.memory;
      setGuides(snap.guides);
    } else {
      setGuides([]);
      snapMemory.current = [];
    }
    const resized = g.mode === "resize" ? resize(dx, dy) : [];
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
        if (g.mode === "resize") return resized.find((r) => r.id === e.id)!;
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
    if (
      !cancel &&
      preview.current &&
      gesture.current &&
      preview.current.elements.some((e, i) => {
        const before = gesture.current!.base.elements[i];
        return (
          e.x !== before.x ||
          e.y !== before.y ||
          e.width !== before.width ||
          e.height !== before.height ||
          e.rotation !== before.rotation
        );
      })
    )
      replace(preview.current);
    const pending = press.current;
    lastPressCanEdit.current = !cancel && !!pending?.canEdit && !pending.moved;
    if (!cancel && pending && !pending.moved && pending.drill)
      onGroupScopeChange?.(pending.drill.scope, pending.drill.ids);
    press.current = null;
    gesture.current = null;
    setGesturing(false);
    preview.current = null;
    setTransient(null);
    setMarquee(null);
    setGuides([]);
    snapMemory.current = [];
    rawPreview.current = null;
  };
  useLayoutEffect(() => {
    if (!historyGesture) return;
    historyGesture.current = () => {
      if (!press.current && !gesture.current) return false;
      finish(true);
      return true;
    };
    return () => {
      historyGesture.current = null;
    };
  });
  const active = display.elements.find(
    (e) => e.id === editing && e.kind === "text" && !e.locked,
  );
  return (
    <div
      className="presentation-canvas-area"
      data-popover-boundary
      ref={host}
      onPointerDown={(event) => {
        if (
          event.button === 0 &&
          !(event.target as Element).closest("[data-connection-id]")
        )
          onCanvasInteract?.();
      }}
    >
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
          onPointerUp={(event) => {
            if (press.current?.pointer !== event.pointerId) return;
            move(event);
            finish();
          }}
          onPointerCancel={() => finish(true)}
          onLostPointerCapture={() => {
            if (press.current) finish(true);
          }}
          onClick={(event) => {
            if (event.detail % 2 === 1)
              textClick.current = {
                id: lastHit.current,
                ready: lastPressCanEdit.current,
              };
          }}
          onKeyDown={(e) => {
            if (e.altKey && e.key === "F10") {
              e.preventDefault();
              host.current
                ?.querySelector<HTMLButtonElement>('[role="toolbar"] button')
                ?.focus();
            }
            if (e.key === "Escape" && gesture.current) {
              e.preventDefault();
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
              textClick.current.id === id &&
              textClick.current.ready &&
              lastPressCanEdit.current &&
              selected.length === 1 &&
              selected[0] === id &&
              !groupAtHit(slide, id, groupScope) &&
              slide.elements.some(
                (e) => e.id === id && e.kind === "text" && !e.locked,
              )
            )
              setEditing(id);
          }}
        >
          <SlideSurface
            slide={
              previewConnection
                ? {
                    ...display,
                    connections: [
                      ...(display.connections ?? []),
                      previewConnection,
                    ],
                  }
                : display
            }
            editingId={editing}
            selectedConnection={selectedConnection}
            onSelectConnection={
              readOnly
                ? undefined
                : (id) => {
                    if (id !== previewConnection?.id) onSelectConnection?.(id);
                  }
            }
          >
            {referenceOverlay}
            {active && !readOnly ? (
              <SlideTextEditor
                key={active.id}
                element={active}
                onChange={(p, format) => onText(active.id, p, format)}
                onComposition={onComposition}
                onReady={onReady}
                onExit={() => {
                  setEditing(null);
                  canvas.current?.focus();
                }}
              />
            ) : null}
            {!editing && box && !readOnly ? (
              <SelectionHandles
                box={box}
                scale={scale}
                rotation={movable.length === 1 ? movable[0].rotation : 0}
              />
            ) : null}
            <LayoutGuides guides={guides} scale={scale} />
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
