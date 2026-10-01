export type Rect = { x: number; y: number; width: number; height: number };

export function clampPetBounds(bounds: Rect, areas: Rect[]): Rect {
  if (!areas.length) return bounds;
  const center = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  const nearest = [...areas].sort(
    (a, b) => distance(a, center) - distance(b, center),
  )[0];
  const width = Math.min(bounds.width, nearest.width);
  const height = Math.min(bounds.height, nearest.height);
  return {
    x: Math.round(
      Math.max(
        nearest.x,
        Math.min(bounds.x, nearest.x + nearest.width - width),
      ),
    ),
    y: Math.round(
      Math.max(
        nearest.y,
        Math.min(bounds.y, nearest.y + nearest.height - height),
      ),
    ),
    width,
    height,
  };
}

function distance(area: Rect, point: { x: number; y: number }): number {
  const x = Math.max(area.x, Math.min(point.x, area.x + area.width));
  const y = Math.max(area.y, Math.min(point.y, area.y + area.height));
  return (point.x - x) ** 2 + (point.y - y) ** 2;
}
