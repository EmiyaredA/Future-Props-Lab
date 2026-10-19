import {
  useEffect,
  useCallback,
  useRef,
  useState,
  type PointerEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import type { Slide } from "../types";
import type { Connection } from "./model";
import {
  connectionPorts,
  dragRoute,
  reconnect,
  nearestConnectionPort,
  anchor,
  type ConnectionPort,
  type Point,
  type RouteHandle,
} from "./connectionGeometry";

type Drag = {
  pointer: number;
  base: Slide;
  edge: Connection;
  handle: RouteHandle;
  start: Point;
  origin: Point;
  screen: Point;
  moved: boolean;
  next: Connection | null;
};

export function useConnectionDrag({
  slide,
  selected,
  readOnly,
  canvas,
  scale,
  commit,
}: {
  slide: Slide;
  selected?: string | null;
  readOnly: boolean;
  canvas: RefObject<HTMLDivElement | null>;
  scale: number;
  commit: (slide: Slide) => void;
}) {
  const drag = useRef<Drag | null>(null);
  const [preview, setPreview] = useState<Connection | null>(null);
  const [endpoint, setEndpoint] = useState<{
    end: "source" | "target";
    point: Point;
    port: ConnectionPort | null;
  } | null>(null);
  const [error, setError] = useState("");
  const clear = useCallback(() => {
    const current = drag.current;
    drag.current = null;
    setPreview(null);
    setEndpoint(null);
    if (current && canvas.current?.hasPointerCapture(current.pointer))
      canvas.current.releasePointerCapture(current.pointer);
    return !!current;
  }, [canvas]);
  useEffect(() => {
    if (
      drag.current &&
      (readOnly ||
        drag.current.base !== slide ||
        drag.current.edge.id !== selected)
    )
      clear();
  }, [slide, selected, readOnly, clear]);
  useEffect(() => {
    const blur = () => clear();
    window.addEventListener("blur", blur);
    return () => window.removeEventListener("blur", blur);
  }, [clear]);
  const point = (event: PointerEvent): Point => {
    const rect = canvas.current!.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / scale,
      y: (event.clientY - rect.top) / scale,
    };
  };
  const replaceEdge = (base: Slide, edge: Connection) => ({
    ...base,
    connections: (base.connections ?? []).map((c) =>
      c.id === edge.id ? edge : c,
    ),
  });
  const start = (
    event: PointerEvent,
    edge: Connection,
    handle: RouteHandle,
    origin: Point,
  ) => {
    if (event.button !== 0 || readOnly || drag.current) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).focus();
    setError("");
    drag.current = {
      pointer: event.pointerId,
      base: slide,
      edge,
      handle,
      start: point(event),
      origin,
      screen: { x: event.clientX, y: event.clientY },
      moved: false,
      next: null,
    };
    if (handle.kind === "source" || handle.kind === "target")
      setEndpoint({ end: handle.kind, point: origin, port: null });
    canvas.current?.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent) => {
    const g = drag.current;
    if (!g || event.pointerId !== g.pointer) return false;
    event.preventDefault();
    if (
      !g.moved &&
      Math.hypot(event.clientX - g.screen.x, event.clientY - g.screen.y) <= 4
    )
      return true;
    g.moved = true;
    const cursor = point(event);
    const p = {
      x: g.origin.x + cursor.x - g.start.x,
      y: g.origin.y + cursor.y - g.start.y,
    };
    try {
      if (g.handle.kind === "source" || g.handle.kind === "target") {
        const end = g.handle.kind;
        const port = nearestConnectionPort(g.base, g.edge, end, p, scale);
        setEndpoint({ end, point: port?.point ?? p, port });
        g.next = port ? reconnect(g.edge, end, port) : null;
      } else g.next = dragRoute(g.base, g.edge, g.handle, p);
      setPreview(g.next);
      setError("");
    } catch (e) {
      g.next = null;
      setPreview(null);
      setError(e instanceof Error ? e.message : "无法调整走线");
    }
    return true;
  };
  const finish = (event: PointerEvent) => {
    const g = drag.current;
    if (!g || g.pointer !== event.pointerId) return false;
    move(event);
    if (g.moved && g.next && JSON.stringify(g.next) !== JSON.stringify(g.edge))
      commit(replaceEdge(g.base, g.next));
    clear();
    return true;
  };
  const key = (
    event: KeyboardEvent,
    edge: Connection,
    handle: RouteHandle,
    origin: Point,
  ) => {
    if (
      readOnly ||
      drag.current ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      !event.key.startsWith("Arrow")
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    try {
      let next: Connection;
      if (handle.kind === "source" || handle.kind === "target") {
        const ports = connectionPorts(slide, edge, handle.kind);
        const id = handle.kind === "source" ? edge.source_id : edge.target_id;
        const side =
          handle.kind === "source"
            ? (edge.source_anchor ?? "right")
            : (edge.target_anchor ?? "left");
        const offset =
          (handle.kind === "source"
            ? edge.source_offset
            : edge.target_offset) ?? 0.5;
        const along =
          side === "left" || side === "right"
            ? ["ArrowUp", "ArrowDown"]
            : ["ArrowLeft", "ArrowRight"];
        if (along.includes(event.key)) {
          const delta =
            (event.key === along[0] ? -1 : 1) * (event.shiftKey ? 0.1 : 0.01);
          const position = Math.max(
            0,
            Math.min(1, Math.round((offset + delta) * 100) / 100),
          );
          if (position === offset) return;
          const element = slide.elements.find((e) => e.id === id)!;
          next = reconnect(edge, handle.kind, {
            id,
            side,
            offset: position,
            point: anchor(element, side, position),
          });
        } else {
          const index = ports.findIndex((p) => p.id === id && p.side === side);
          const delta =
            event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
          const port = ports[(index + delta + ports.length) % ports.length];
          if (!port) return;
          next = reconnect(edge, handle.kind, port);
        }
      } else {
        const delta = event.shiftKey ? 10 : 1;
        next = dragRoute(slide, edge, handle, {
          x:
            origin.x +
            (event.key === "ArrowLeft"
              ? -delta
              : event.key === "ArrowRight"
                ? delta
                : 0),
          y:
            origin.y +
            (event.key === "ArrowUp"
              ? -delta
              : event.key === "ArrowDown"
                ? delta
                : 0),
        });
      }
      if (JSON.stringify(next) !== JSON.stringify(edge))
        commit(replaceEdge(slide, next));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "无法调整走线");
    }
  };
  return {
    preview,
    endpoint,
    error,
    start,
    move,
    finish,
    cancel: clear,
    active: () => !!drag.current,
    key,
  };
}
