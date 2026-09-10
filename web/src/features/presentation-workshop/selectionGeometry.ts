import type { SlideElement } from "./types";
import { boundedElement } from "./geometry";

export type Rect = { x: number; y: number; width: number; height: number };
export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const resizeHandles: ResizeHandle[] = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
];

export function rotatedBounds(elements: SlideElement[]): Rect {
  const corners = elements.flatMap((e) => {
    const angle = (e.rotation * Math.PI) / 180;
    return [-1, 1].flatMap((x) =>
      [-1, 1].map((y) => ({
        x:
          e.x +
          e.width / 2 +
          ((x * e.width) / 2) * Math.cos(angle) -
          ((y * e.height) / 2) * Math.sin(angle),
        y:
          e.y +
          e.height / 2 +
          ((x * e.width) / 2) * Math.sin(angle) +
          ((y * e.height) / 2) * Math.cos(angle),
      })),
    );
  });
  const x = Math.min(...corners.map((p) => p.x));
  const y = Math.min(...corners.map((p) => p.y));
  return {
    x,
    y,
    width: Math.max(...corners.map((p) => p.x)) - x,
    height: Math.max(...corners.map((p) => p.y)) - y,
  };
}

export function toolbarPosition(
  anchor: Rect,
  area: Rect,
  size: { width: number; height: number },
  bottomGap = 12,
) {
  if (
    anchor.x + anchor.width <= area.x ||
    anchor.x >= area.x + area.width ||
    anchor.y + anchor.height <= area.y ||
    anchor.y >= area.y + area.height ||
    area.height < size.height + 16
  )
    return null;
  const gap = 12,
    margin = 8;
  const above = anchor.y - area.y - margin;
  const below = area.y + area.height - anchor.y - anchor.height - margin;
  const placement =
    above >= size.height + gap || above >= below ? "top" : "bottom";
  return {
    x: Math.max(
      area.x + margin,
      Math.min(
        anchor.x + (anchor.width - size.width) / 2,
        area.x + area.width - size.width - margin,
      ),
    ),
    y: Math.max(
      area.y + margin,
      Math.min(
        placement === "top"
          ? anchor.y - size.height - gap
          : anchor.y + anchor.height + bottomGap,
        area.y + area.height - size.height - margin,
      ),
    ),
    placement,
  };
}

/** Resize in the rotated element's local axes, keeping the opposite anchor fixed. */
export function resizeFromHandle(
  e: SlideElement,
  dx: number,
  dy: number,
  handle: ResizeHandle,
  proportional: boolean,
): SlideElement {
  const angle = (e.rotation * Math.PI) / 180,
    cos = Math.cos(angle),
    sin = Math.sin(angle);
  const hx = handle.includes("w") ? -1 : handle.includes("e") ? 1 : 0;
  const hy = handle.includes("n") ? -1 : handle.includes("s") ? 1 : 0;
  let width = Math.max(
    8,
    Math.min(10000, e.width + hx * (dx * cos + dy * sin)),
  );
  let height = Math.max(
    8,
    Math.min(10000, e.height + hy * (-dx * sin + dy * cos)),
  );
  if (proportional || e.kind === "image" || e.kind === "vector") {
    const ratio =
      hx && hy
        ? Math.abs(width / e.width - 1) >= Math.abs(height / e.height - 1)
          ? width / e.width
          : height / e.height
        : hx
          ? width / e.width
          : height / e.height;
    const bounded = Math.min(
      10000 / Math.max(e.width, e.height),
      Math.max(8 / Math.min(e.width, e.height), ratio),
    );
    width = e.width * bounded;
    height = e.height * bounded;
  }
  const localX = (hx * (width - e.width)) / 2,
    localY = (hy * (height - e.height)) / 2;
  return boundedElement({
    ...e,
    width,
    height,
    x: e.x + (e.width - width) / 2 + localX * cos - localY * sin,
    y: e.y + (e.height - height) / 2 + localX * sin + localY * cos,
  });
}
