import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { zoomViewportAt, type Viewport } from "./geometry";

export function useCanvasViewportGestures(
  element: HTMLDivElement | null,
  enabled: boolean,
  setViewport: Dispatch<SetStateAction<Viewport>>,
  closeMenu: (value: undefined) => void,
) {
  const gestureViewport = useRef<Viewport | undefined>(undefined);
  useEffect(() => {
    if (!enabled || !element) return;
    const handleWheel = (event: globalThis.WheelEvent) => {
      const gestureWheel = event.ctrlKey || event.metaKey;
      if (
        !gestureWheel &&
        event.target instanceof Element &&
        event.target.closest('[data-canvas-wheel="content"]')
      ) {
        return;
      }
      event.preventDefault();
      closeMenu(undefined);
      const bounds = element.getBoundingClientRect();
      const pointerX = event.clientX - bounds.left;
      const pointerY = event.clientY - bounds.top;
      setViewport((current) => {
        const factor = gestureWheel
          ? Math.exp(-event.deltaY * 0.01)
          : event.deltaY > 0
            ? 0.9
            : 1.1;
        return zoomViewportAt(
          current,
          current.zoom * factor,
          pointerX,
          pointerY,
        );
      });
    };
    const handleGestureStart = (event: Event) => {
      event.preventDefault();
      gestureViewport.current = undefined;
      setViewport((current) => {
        gestureViewport.current = current;
        return current;
      });
    };
    const handleGestureChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as Event & {
        scale?: number;
        clientX?: number;
        clientY?: number;
      };
      const bounds = element.getBoundingClientRect();
      const anchorX =
        typeof gesture.clientX === "number"
          ? gesture.clientX - bounds.left
          : bounds.width / 2;
      const anchorY =
        typeof gesture.clientY === "number"
          ? gesture.clientY - bounds.top
          : bounds.height / 2;
      setViewport((current) => {
        const initial = gestureViewport.current ?? current;
        gestureViewport.current = initial;
        return zoomViewportAt(
          initial,
          initial.zoom * (gesture.scale ?? 1),
          anchorX,
          anchorY,
        );
      });
    };
    const handleGestureEnd = (event: Event) => {
      event.preventDefault();
      gestureViewport.current = undefined;
    };
    element.addEventListener("wheel", handleWheel, { passive: false });
    element.addEventListener("gesturestart", handleGestureStart, {
      passive: false,
    });
    element.addEventListener("gesturechange", handleGestureChange, {
      passive: false,
    });
    element.addEventListener("gestureend", handleGestureEnd, {
      passive: false,
    });
    return () => {
      gestureViewport.current = undefined;
      element.removeEventListener("wheel", handleWheel);
      element.removeEventListener("gesturestart", handleGestureStart);
      element.removeEventListener("gesturechange", handleGestureChange);
      element.removeEventListener("gestureend", handleGestureEnd);
    };
  }, [enabled, element, closeMenu, setViewport]);
}
