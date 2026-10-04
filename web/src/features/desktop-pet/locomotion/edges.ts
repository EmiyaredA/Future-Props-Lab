import type { PetEdge, PetGeometry, PetRect } from "@platform/petMotion";

export const edgeThreshold = (size: number) =>
  Math.max(12, Math.min(32, (20 * size) / 220));
export const horizontalEdge = (edge: PetEdge) =>
  edge === "top" || edge === "bottom";
export function edgeAnchor(shape: PetGeometry, edge: PetEdge) {
  return (
    shape.edges?.[edge] ?? {
      x:
        edge === "left"
          ? shape.visible.x
          : edge === "right"
            ? shape.visible.x + shape.visible.width
            : shape.feet.x,
      y:
        edge === "top"
          ? shape.visible.y
          : edge === "bottom"
            ? shape.feet.y
            : shape.visible.y + shape.visible.height / 2,
    }
  );
}
export function edgeCoordinate(area: PetRect, edge: PetEdge) {
  return edge === "left"
    ? area.x + 4
    : edge === "right"
      ? area.x + area.width - 4
      : edge === "top"
        ? area.y + 4
        : area.y + area.height - 4;
}
/** Stable tie order makes a deliberate placement into a corner choose the wall first. */
export function nearestEdge(
  x: number,
  y: number,
  shape: PetGeometry,
  area: PetRect,
  size: number,
  retained: PetEdge | null = null,
): PetEdge | null {
  const allowed = shape.supportedEdges ?? ["left", "right"];
  const gap = (edge: PetEdge) => {
    const anchor = edgeAnchor(shape, edge);
    return Math.abs(
      (horizontalEdge(edge) ? y + anchor.y : x + anchor.x) -
        edgeCoordinate(area, edge),
    );
  };
  if (
    retained &&
    allowed.includes(retained) &&
    gap(retained) <= edgeThreshold(size) * 1.5
  )
    return retained;
  const candidates = (["left", "right", "top", "bottom"] as PetEdge[]).filter(
    (edge) => allowed.includes(edge),
  );
  candidates.sort((a, b) => gap(a) - gap(b));
  return candidates[0] && gap(candidates[0]) <= edgeThreshold(size)
    ? candidates[0]
    : null;
}
export function alignEdge(
  x: number,
  y: number,
  shape: PetGeometry,
  area: PetRect,
  edge: PetEdge,
) {
  const anchor = edgeAnchor(shape, edge);
  return horizontalEdge(edge)
    ? { x, y: edgeCoordinate(area, edge) - anchor.y }
    : { x: edgeCoordinate(area, edge) - anchor.x, y };
}
export function nextEdge(edge: PetEdge, direction: number): PetEdge {
  if (horizontalEdge(edge)) return direction < 0 ? "left" : "right";
  return direction < 0 ? "top" : "bottom";
}
