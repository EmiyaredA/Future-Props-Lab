import type { Viewport } from "./geometry";
import type { CanvasRect } from "./canvasPlacement";

/** Screen coordinates relative to the canvas surface, excluding fixed chrome. */
export function visibleCanvasArea(
  bounds: Pick<DOMRect, "left" | "top" | "width" | "height">,
  overlays: DOMRect[],
): CanvasRect {
  let left = 16,
    top = 16,
    right = Math.max(16, bounds.width - 16),
    bottom = Math.max(16, bounds.height - 16);
  for (const overlay of overlays) {
    if (!overlay.width || !overlay.height) continue;
    const x = overlay.left - bounds.left,
      y = overlay.top - bounds.top;
    if (
      x >= bounds.width ||
      y >= bounds.height ||
      x + overlay.width <= 0 ||
      y + overlay.height <= 0
    )
      continue;
    if (overlay.width > bounds.width * 0.65) {
      if (y < bounds.height / 2) top = Math.max(top, y + overlay.height + 16);
      else bottom = Math.min(bottom, y - 16);
    } else if (
      overlay.height > bounds.height * 0.5 ||
      (overlay.height > overlay.width &&
        (x + overlay.width < bounds.width * 0.25 || x > bounds.width * 0.75))
    ) {
      if (x < bounds.width / 2) left = Math.max(left, x + overlay.width + 16);
      else right = Math.min(right, x - 16);
    } else {
      if (y < bounds.height / 2) top = Math.max(top, y + overlay.height + 16);
      else bottom = Math.min(bottom, y - 16);
    }
  }
  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

export function worldVisibleArea(
  area: CanvasRect,
  viewport: Viewport,
): CanvasRect {
  return {
    x: (area.x - viewport.x) / viewport.zoom,
    y: (area.y - viewport.y) / viewport.zoom,
    width: area.width / viewport.zoom,
    height: area.height / viewport.zoom,
  };
}

export function revealCanvasBounds(
  bounds: CanvasRect,
  area: CanvasRect,
  viewport: Viewport,
): Viewport {
  const visible = worldVisibleArea(area, viewport);
  const shift = (
    start: number,
    size: number,
    min: number,
    available: number,
  ) =>
    size > available
      ? min + (available - size) / 2 - start
      : start < min
        ? min - start
        : start + size > min + available
          ? min + available - start - size
          : 0;
  const dx = shift(bounds.x, bounds.width, visible.x, visible.width);
  const dy = shift(bounds.y, bounds.height, visible.y, visible.height);
  return dx || dy
    ? {
        ...viewport,
        x: viewport.x + dx * viewport.zoom,
        y: viewport.y + dy * viewport.zoom,
      }
    : viewport;
}
