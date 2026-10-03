export type Rect = { x: number; y: number; width: number; height: number };

export type ChatLayout = "compact" | "expanded";

export function companionBounds(pet: Rect, area: Rect, layout: ChatLayout) {
  const width = Math.min(layout === "compact" ? 320 : 360, area.width);
  const height = Math.min(layout === "compact" ? 240 : 460, area.height);
  const gap = 8;
  const leftSpace = pet.x - area.x;
  const rightSpace = area.x + area.width - pet.x - pet.width;
  const side =
    leftSpace >= width + gap || leftSpace >= rightSpace ? "left" : "right";
  const bounds = clampPetBounds(
    {
      x: side === "left" ? pet.x - width - gap : pet.x + pet.width + gap,
      y: layout === "compact" ? pet.y + 32 : pet.y + pet.height - height,
      width,
      height,
    },
    [area],
  );
  return { ...bounds, side: side as "left" | "right" };
}

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
