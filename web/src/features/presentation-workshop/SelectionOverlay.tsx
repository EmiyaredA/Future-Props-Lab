import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { rotatedBounds, toolbarPosition } from "./selectionGeometry";
import type { SlideElement } from "./types";
import "./presentation-selection.css";

export function SelectionOverlay({
  area,
  canvas,
  elements,
  scale,
  children,
}: {
  area: RefObject<HTMLDivElement | null>;
  canvas: RefObject<HTMLDivElement | null>;
  elements: SlideElement[];
  scale: number;
  children: ReactNode;
}) {
  const overlay = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = overlay.current,
      host = area.current,
      surface = canvas.current;
    if (!node || !host || !surface || !elements.length) return;
    const position = () => {
      const viewport = window.visualViewport;
      const rect = host.getBoundingClientRect(),
        slide = surface.getBoundingClientRect();
      const left = Math.max(rect.left, viewport?.offsetLeft ?? 0),
        top = Math.max(rect.top, viewport?.offsetTop ?? 0);
      const right = Math.min(
        rect.right,
        (viewport?.offsetLeft ?? 0) + (viewport?.width ?? innerWidth),
      );
      const bottom = Math.min(
        rect.bottom,
        (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight),
      );
      node.style.maxWidth = `${Math.max(0, right - left - 16)}px`;
      node.dataset.compact = String(right - left < 660);
      const box = rotatedBounds(elements);
      const location = toolbarPosition(
        {
          x: slide.x + box.x * scale,
          y: slide.y + box.y * scale,
          width: box.width * scale,
          height: box.height * scale,
        },
        { x: left, y: top, width: right - left, height: bottom - top },
        { width: node.offsetWidth, height: node.offsetHeight },
        44,
      );
      node.style.visibility = location ? "visible" : "hidden";
      if (location) {
        node.style.left = `${location.x}px`;
        node.style.top = `${location.y}px`;
        node.dataset.placement = location.placement;
      }
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(host);
    observer.observe(node);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
    };
  }, [area, canvas, elements, scale]);
  return (
    <div
      ref={overlay}
      className="presentation-selection-overlay"
      style={{ visibility: "hidden" }}
    >
      {children}
    </div>
  );
}
