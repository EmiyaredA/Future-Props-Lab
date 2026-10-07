import type { VisualCanvasNode } from "../api";
import { NODE_SIZE, type NodeKind } from "./geometry";

export type CanvasPoint = { x: number; y: number };
export type CanvasRect = CanvasPoint & { width: number; height: number };
export type PlacedNode = Pick<VisualCanvasNode, "kind" | "position">;
export const PLACEMENT_GAP = 32;
export const COORDINATE_LIMIT = 1_000_000;

export function nodeRect(node: PlacedNode): CanvasRect {
  return { ...node.position, ...NODE_SIZE[node.kind] };
}

export function canvasBounds(nodes: PlacedNode[]): CanvasRect {
  if (!nodes.length) return { x: 80, y: 80, width: 0, height: 0 };
  const x = Math.min(...nodes.map((node) => node.position.x));
  const y = Math.min(...nodes.map((node) => node.position.y));
  return {
    x,
    y,
    width:
      Math.max(
        ...nodes.map((node) => node.position.x + NODE_SIZE[node.kind].width),
      ) - x,
    height:
      Math.max(
        ...nodes.map((node) => node.position.y + NODE_SIZE[node.kind].height),
      ) - y,
  };
}

export function rectanglesOverlap(
  a: CanvasRect,
  b: CanvasRect,
  gap = PLACEMENT_GAP,
) {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  );
}

/** Bounded obstacle-edge search, shared with the backend's automatic placement. */
export function findFreePosition(
  obstacles: CanvasRect[],
  size: { width: number; height: number },
  anchor: CanvasPoint,
  preferredArea?: CanvasRect,
): CanvasPoint {
  if (
    ![anchor.x, anchor.y, size.width, size.height].every(Number.isFinite) ||
    size.width < 0 ||
    size.height < 0 ||
    size.width > COORDINATE_LIMIT * 2 ||
    size.height > COORDINATE_LIMIT * 2
  )
    throw new Error("节点位置超出画布坐标范围");
  const clamp = (point: CanvasPoint) => ({
    x: Math.max(
      -COORDINATE_LIMIT,
      Math.min(COORDINATE_LIMIT - size.width, point.x),
    ),
    y: Math.max(
      -COORDINATE_LIMIT,
      Math.min(COORDINATE_LIMIT - size.height, point.y),
    ),
  });
  const start = clamp(anchor);
  const free = (point: CanvasPoint) =>
    !obstacles.some((other) =>
      rectanglesOverlap(
        { ...point, width: size.width, height: size.height },
        other,
      ),
    );
  if (free(start)) return start;
  const candidates: CanvasPoint[] = [];
  for (const other of obstacles) {
    const left = other.x - size.width - PLACEMENT_GAP;
    const right = other.x + other.width + PLACEMENT_GAP;
    const top = other.y - size.height - PLACEMENT_GAP;
    const bottom = other.y + other.height + PLACEMENT_GAP;
    candidates.push(
      { x: right, y: start.y },
      { x: start.x, y: bottom },
      { x: left, y: start.y },
      { x: start.x, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom },
      { x: right, y: top },
      { x: left, y: top },
    );
  }
  const distance = (point: CanvasPoint) =>
    (point.x - start.x) ** 2 + (point.y - start.y) ** 2;
  candidates.sort((a, b) => distance(a) - distance(b));
  const radius = Math.max(size.width, size.height, 320) * 2;
  if (preferredArea) {
    for (const point of candidates) {
      if (
        point.x >= preferredArea.x &&
        point.y >= preferredArea.y &&
        point.x + size.width <= preferredArea.x + preferredArea.width &&
        point.y + size.height <= preferredArea.y + preferredArea.height &&
        point.x === clamp(point).x &&
        point.y === clamp(point).y &&
        free(point)
      )
        return point;
    }
  }
  for (const point of candidates) {
    if (
      distance(point) <= radius ** 2 &&
      point.x === clamp(point).x &&
      point.y === clamp(point).y &&
      free(point)
    )
      return point;
  }
  // Prefer the right edge of the occupied region when the nearby area is full.
  const fallbacks = [
    {
      x: Math.max(...obstacles.map((r) => r.x + r.width)) + PLACEMENT_GAP,
      y: start.y,
    },
    {
      x: start.x,
      y: Math.max(...obstacles.map((r) => r.y + r.height)) + PLACEMENT_GAP,
    },
    {
      x: Math.min(...obstacles.map((r) => r.x)) - size.width - PLACEMENT_GAP,
      y: start.y,
    },
    {
      x: start.x,
      y: Math.min(...obstacles.map((r) => r.y)) - size.height - PLACEMENT_GAP,
    },
    ...candidates,
  ];
  for (const point of fallbacks) {
    const bounded = clamp(point);
    if (free(bounded)) return bounded;
  }
  throw new Error("附近没有可用位置，请移动节点后重试");
}

export function placeNode(
  nodes: PlacedNode[],
  kind: NodeKind,
  anchor: CanvasPoint,
  preferredArea?: CanvasRect,
) {
  return findFreePosition(
    nodes.map(nodeRect),
    NODE_SIZE[kind],
    anchor,
    preferredArea,
  );
}

export function projectInsertionAnchor(nodes: PlacedNode[]): CanvasPoint {
  const bounds = canvasBounds(nodes);
  return { x: bounds.x, y: bounds.y };
}

/** Shift the entire group; never change its internal arrangement. */
export function placeNodeGroup<T extends PlacedNode>(
  nodes: T[],
  obstacles: PlacedNode[],
  anchor: CanvasPoint,
): T[] {
  if (!nodes.length) return nodes;
  const bounds = canvasBounds(nodes);
  const point = findFreePosition(obstacles.map(nodeRect), bounds, anchor);
  return nodes.map((node) => ({
    ...node,
    position: {
      x: node.position.x + point.x - bounds.x,
      y: node.position.y + point.y - bounds.y,
    },
  }));
}

export function batchInsertionAnchor(
  anchor: CanvasPoint,
  index: number,
  count: number,
): CanvasPoint {
  const columns = Math.ceil(Math.sqrt(count));
  return {
    x: anchor.x + (index % columns) * (320 + 64),
    y: anchor.y + Math.floor(index / columns) * (214 + 48),
  };
}
