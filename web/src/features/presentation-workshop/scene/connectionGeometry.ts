import type { Slide, SlideElement } from "../types";

type Connection = NonNullable<Slide["connections"]>[number];
export type Point = { x: number; y: number };
export type Side = "left" | "right" | "top" | "bottom";
export const connectionSides: Side[] = ["left", "right", "top", "bottom"];
export const near = (a: number, b: number) => Math.abs(a - b) < 0.000001;
const same = (a: Point, b: Point) => near(a.x, b.x) && near(a.y, b.y);

export function anchor(element: SlideElement, side: Side, offset = 0.5) {
  const x =
    element.x +
    (side === "left"
      ? 0
      : side === "right"
        ? element.width
        : element.width * offset);
  const y =
    element.y +
    (side === "top"
      ? 0
      : side === "bottom"
        ? element.height
        : element.height * offset);
  const a = (element.rotation * Math.PI) / 180;
  const cx = element.x + element.width / 2,
    cy = element.y + element.height / 2;
  return {
    x: cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a),
    y: cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a),
  };
}

export function connectionPoints(slide: Slide, edge: Connection): Point[] {
  const source = slide.elements.find((e) => e.id === edge.source_id);
  const target = slide.elements.find((e) => e.id === edge.target_id);
  if (!source || !target) return [];
  const a = anchor(
      source,
      edge.source_anchor ?? "right",
      edge.source_offset ?? 0.5,
    ),
    b = anchor(target, edge.target_anchor ?? "left", edge.target_offset ?? 0.5);
  if (edge.style === "straight") return [a, b];
  if (edge.waypoints?.length) return [a, ...edge.waypoints, b];
  return edge.source_anchor === "top" || edge.source_anchor === "bottom"
    ? [a, { x: a.x, y: (a.y + b.y) / 2 }, { x: b.x, y: (a.y + b.y) / 2 }, b]
    : [a, { x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: b.y }, b];
}

/** Only remove points on a forward segment; keep intentional U turns. */
export function simplifyRoute(points: Point[]): Point[] {
  const result: Point[] = [];
  for (const p of points) {
    if (result.length && same(result[result.length - 1], p)) continue;
    while (result.length > 1) {
      const a = result[result.length - 2],
        b = result[result.length - 1];
      const cross = (b.x - a.x) * (p.y - b.y) - (b.y - a.y) * (p.x - b.x);
      const dot = (b.x - a.x) * (p.x - b.x) + (b.y - a.y) * (p.y - b.y);
      if (!near(cross, 0) || dot < 0) break;
      result.pop();
    }
    result.push({ ...p });
  }
  return result;
}

export function checkedWaypoints(points: Point[]) {
  const waypoints = simplifyRoute(points).slice(1, -1);
  if (
    waypoints.length > 32 ||
    points.some(
      (p) =>
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        Math.abs(p.x) > 10000 ||
        Math.abs(p.y) > 10000,
    )
  )
    throw new Error("走线超出坐标或 32 个路径点限制，请简化路径后再调整");
  return waypoints;
}

function bridge(next: Point, previous: Point, adjacent: Point): Point[] {
  if (same(next, previous)) return [];
  // Old diagonal routes remain valid. Preserve the old interior point and add
  // an axis-aligned transition only when the original end segment was axial.
  if (near(previous.x, adjacent.x)) return [{ x: next.x, y: adjacent.y }];
  if (near(previous.y, adjacent.y)) return [{ x: adjacent.x, y: next.y }];
  return [];
}

function attachEnd(
  next: Point,
  previous: Point,
  points: Point[],
  neighbor: Point,
) {
  const adjacent = points[0];
  if (same(next, previous)) return [];
  const following = points[1] ?? neighbor;
  if (near(previous.y, adjacent.y) && near(adjacent.x, following.x)) {
    adjacent.y = next.y;
    return [];
  }
  if (near(previous.x, adjacent.x) && near(adjacent.y, following.y)) {
    adjacent.x = next.x;
    return [];
  }
  return bridge(next, previous, adjacent);
}

/** Rebase an existing route without discarding its manually placed interior. */
export function followConnection(
  before: Slide,
  after: Slide,
  edge: Connection,
): Connection {
  if (!edge.waypoints?.length || edge.style === "straight") return edge;
  const old = before.connections?.find((c) => c.id === edge.id);
  if (
    !old ||
    old.source_id !== edge.source_id ||
    old.target_id !== edge.target_id ||
    old.source_anchor !== edge.source_anchor ||
    old.target_anchor !== edge.target_anchor ||
    (old.source_offset ?? 0.5) !== (edge.source_offset ?? 0.5) ||
    (old.target_offset ?? 0.5) !== (edge.target_offset ?? 0.5)
  )
    return edge;
  const oldPoints = connectionPoints(before, old),
    nextPoints = connectionPoints(after, edge);
  if (!oldPoints.length || !nextPoints.length) return edge;
  const a = oldPoints[0],
    b = oldPoints[oldPoints.length - 1];
  const c = nextPoints[0],
    d = nextPoints[nextPoints.length - 1];
  if (same(a, c) && same(b, d)) return edge;
  const dx = c.x - a.x,
    dy = c.y - a.y;
  const inner = edge.waypoints.map((p) => ({ ...p }));
  const translation = [edge.source_id, edge.target_id].every((id) => {
    const previous = before.elements.find((e) => e.id === id)!;
    const current = after.elements.find((e) => e.id === id)!;
    return (
      previous.width === current.width &&
      previous.height === current.height &&
      previous.rotation === current.rotation
    );
  });
  let route: Point[];
  if (translation && near(dx, d.x - b.x) && near(dy, d.y - b.y))
    route = [c, ...inner.map((p) => ({ x: p.x + dx, y: p.y + dy })), d];
  else {
    const start = attachEnd(c, a, inner, b);
    inner.reverse();
    const end = attachEnd(d, b, inner, c);
    inner.reverse();
    route = [c, ...start, ...inner, ...end.reverse(), d];
  }
  return { ...edge, waypoints: checkedWaypoints(route) };
}

export type RouteHandle = {
  kind: "source" | "target" | "corner" | "segment";
  index: number;
};

export function dragRoute(
  slide: Slide,
  edge: Connection,
  handle: RouteHandle,
  point: Point,
): Connection {
  const points = connectionPoints(slide, edge).map((p) => ({ ...p }));
  if (points.length < 2) return edge;
  const i = handle.index;
  if (edge.style === "straight") {
    const a = points[0],
      b = points[points.length - 1];
    const dx = point.x - (a.x + b.x) / 2,
      dy = point.y - (a.y + b.y) / 2;
    const offset = (id: string, side: Side, endpoint: Point) => {
      const element = slide.elements.find((e) => e.id === id)!;
      return projectedOffset(element, side, {
        x: endpoint.x + dx,
        y: endpoint.y + dy,
      });
    };
    return {
      ...edge,
      source_offset: offset(edge.source_id, edge.source_anchor ?? "right", a),
      target_offset: offset(edge.target_id, edge.target_anchor ?? "left", b),
      waypoints: [],
    };
  }
  if (handle.kind === "segment") {
    const a = points[i],
      b = points[i + 1];
    const vertical = near(a.x, b.x),
      horizontal = near(a.y, b.y);
    const dx = horizontal ? 0 : point.x - (a.x + b.x) / 2;
    const dy = vertical ? 0 : point.y - (a.y + b.y) / 2;
    if (near(dx, 0) && near(dy, 0)) return edge;
    const moved = [
      { x: a.x + dx, y: a.y + dy },
      { x: b.x + dx, y: b.y + dy },
    ];
    points.splice(
      i,
      2,
      ...(i === 0 ? [a] : []),
      ...moved,
      ...(i + 1 === points.length - 1 ? [b] : []),
    );
  } else if (handle.kind === "corner" && i > 0 && i < points.length - 1) {
    const old = points[i],
      prev = points[i - 1],
      next = points[i + 1];
    if (same(old, point)) return edge;
    const left = near(prev.x, old.x)
      ? { x: point.x, y: prev.y }
      : near(prev.y, old.y)
        ? { x: prev.x, y: point.y }
        : prev;
    const right = near(next.x, old.x)
      ? { x: point.x, y: next.y }
      : near(next.y, old.y)
        ? { x: next.x, y: point.y }
        : next;
    points.splice(
      i - 1,
      3,
      ...(i === 1 ? [prev] : []),
      left,
      point,
      right,
      ...(i === points.length - 2 ? [next] : []),
    );
  }
  return { ...edge, waypoints: checkedWaypoints(points) };
}

export function connectionPorts(
  slide: Slide,
  edge: Connection,
  end: "source" | "target",
) {
  const opposite = end === "source" ? edge.target_id : edge.source_id;
  return slide.elements
    .filter((e) => e.kind !== "line" && e.id !== opposite)
    .flatMap((e) =>
      connectionSides.map((side) => ({
        id: e.id,
        side,
        offset: 0.5,
        point: anchor(e, side),
      })),
    );
}

export type ConnectionPort = ReturnType<typeof connectionPorts>[number];
function projectedOffset(element: SlideElement, side: Side, point: Point) {
  const cx = element.x + element.width / 2,
    cy = element.y + element.height / 2;
  const angle = (-element.rotation * Math.PI) / 180;
  const x =
    cx + (point.x - cx) * Math.cos(angle) - (point.y - cy) * Math.sin(angle);
  const y =
    cy + (point.x - cx) * Math.sin(angle) + (point.y - cy) * Math.cos(angle);
  const vertical = side === "left" || side === "right";
  return Math.max(
    0,
    Math.min(
      1,
      (vertical ? y - element.y : x - element.x) /
        (vertical ? element.height : element.width),
    ),
  );
}
/** Project onto every element's perimeter, including backplates inside groups. */
export function nearestConnectionPort(
  slide: Slide,
  edge: Connection,
  end: "source" | "target",
  point: Point,
  scale: number,
): ConnectionPort | null {
  let best: ConnectionPort | null = null;
  let distance = 16 / scale;
  const opposite = end === "source" ? edge.target_id : edge.source_id;
  for (const element of [...slide.elements].reverse()) {
    if (element.kind === "line" || element.id === opposite) continue;
    const cx = element.x + element.width / 2,
      cy = element.y + element.height / 2;
    const angle = (-element.rotation * Math.PI) / 180;
    const x =
      cx + (point.x - cx) * Math.cos(angle) - (point.y - cy) * Math.sin(angle);
    const y =
      cy + (point.x - cx) * Math.sin(angle) + (point.y - cy) * Math.cos(angle);
    for (const side of connectionSides) {
      const vertical = side === "left" || side === "right";
      const length = vertical ? element.height : element.width;
      let offset = Math.max(
        0,
        Math.min(1, (vertical ? y - element.y : x - element.x) / length),
      );
      if (Math.abs(offset - 0.5) * length * scale <= 5) offset = 0.5;
      const projected = anchor(element, side, offset);
      const d = Math.hypot(point.x - projected.x, point.y - projected.y);
      if (d < distance) {
        distance = d;
        best = { id: element.id, side, offset, point: projected };
      }
    }
  }
  return best;
}
export function reconnect(
  edge: Connection,
  end: "source" | "target",
  port: ConnectionPort,
): Connection {
  const id = end === "source" ? edge.source_id : edge.target_id;
  const side =
    end === "source"
      ? (edge.source_anchor ?? "right")
      : (edge.target_anchor ?? "left");
  const offset =
    (end === "source" ? edge.source_offset : edge.target_offset) ?? 0.5;
  if (id === port.id && side === port.side && near(offset, port.offset))
    return edge;
  return {
    ...edge,
    ...(end === "source"
      ? {
          source_id: port.id,
          source_anchor: port.side,
          source_offset: port.offset,
        }
      : {
          target_id: port.id,
          target_anchor: port.side,
          target_offset: port.offset,
        }),
    waypoints: [],
  };
}
