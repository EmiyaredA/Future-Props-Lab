import {
  useLayoutEffect,
  useRef,
  type RefObject,
  type PointerEvent,
  type KeyboardEvent,
} from "react";

export type PanelPosition = { x: number; y: number };

/** Coordinates belong to the canvas host, never the scaled/scrolling slide. */
export function useConnectionPanelPosition(
  root: RefObject<HTMLDivElement | null>,
  position: PanelPosition | null,
  onMove: (value: PanelPosition) => void,
) {
  const latest = useRef({ position, onMove });
  const place = useRef<(next?: PanelPosition) => void>(() => {});
  const drag = useRef<{
    pointer: number;
    x: number;
    y: number;
    origin: PanelPosition;
  } | null>(null);
  useLayoutEffect(() => {
    latest.current = { position, onMove };
    place.current();
  });
  useLayoutEffect(() => {
    const panel = root.current,
      host = panel?.parentElement;
    if (!panel || !host) return;
    const update = (next?: PanelPosition) => {
      const rect = host.getBoundingClientRect(),
        view = window.visualViewport;
      const left = Math.max(0, (view?.offsetLeft ?? 0) - rect.left) + 12;
      const top = Math.max(0, (view?.offsetTop ?? 0) - rect.top) + 12;
      const right =
        Math.min(
          rect.width,
          (view?.offsetLeft ?? 0) + (view?.width ?? innerWidth) - rect.left,
        ) - 12;
      const bottom =
        Math.min(
          rect.height,
          (view?.offsetTop ?? 0) + (view?.height ?? innerHeight) - rect.top,
        ) - 12;
      panel.style.maxWidth = `${Math.max(0, right - left)}px`;
      panel.style.maxHeight = `${Math.max(0, bottom - top)}px`;
      const requested = next ??
        latest.current.position ?? { x: right - panel.offsetWidth, y: top };
      const clamped = {
        x: Math.max(left, Math.min(requested.x, right - panel.offsetWidth)),
        y: Math.max(top, Math.min(requested.y, bottom - panel.offsetHeight)),
      };
      panel.style.left = `${clamped.x}px`;
      panel.style.top = `${clamped.y}px`;
      panel.style.visibility = "visible";
      if (next) latest.current.onMove(clamped);
    };
    place.current = update;
    update();
    const observer = new ResizeObserver(() => update());
    observer.observe(host);
    observer.observe(panel);
    const reposition = () => update();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    window.visualViewport?.addEventListener("resize", reposition);
    window.visualViewport?.addEventListener("scroll", reposition);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      window.visualViewport?.removeEventListener("resize", reposition);
      window.visualViewport?.removeEventListener("scroll", reposition);
      place.current = () => {};
    };
  }, [root]);
  const location = () => ({
    x: parseFloat(root.current?.style.left ?? "0"),
    y: parseFloat(root.current?.style.top ?? "0"),
  });
  return {
    onPointerDown(event: PointerEvent<HTMLButtonElement>) {
      if (event.button !== 0) return;
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = {
        pointer: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        origin: location(),
      };
    },
    onPointerMove(event: PointerEvent<HTMLButtonElement>) {
      const start = drag.current;
      if (!start || start.pointer !== event.pointerId) return;
      place.current({
        x: start.origin.x + event.clientX - start.x,
        y: start.origin.y + event.clientY - start.y,
      });
    },
    onPointerUp() {
      drag.current = null;
    },
    onPointerCancel() {
      drag.current = null;
    },
    onLostPointerCapture() {
      drag.current = null;
    },
    onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
      const delta = event.shiftKey ? 10 : 1;
      const move = {
        ArrowLeft: [-delta, 0],
        ArrowRight: [delta, 0],
        ArrowUp: [0, -delta],
        ArrowDown: [0, delta],
      }[event.key];
      if (!move) return;
      event.preventDefault();
      event.stopPropagation();
      const current = location();
      place.current({ x: current.x + move[0], y: current.y + move[1] });
    },
  };
}
