import { clampPetBounds, type Rect } from "./pet-window-geometry";

export type MotionGeometry = {
  visible: Rect;
  feet: { x: number; y: number };
  edges?: Record<"left" | "right" | "top" | "bottom", { x: number; y: number }>;
  supportedEdges?: ("left" | "right" | "top" | "bottom")[];
  strideLength?: number;
};
export type MotionRequest = {
  generation: number;
  sequence: number;
  environmentRevision: number;
  x: number;
  y: number;
  geometry: MotionGeometry;
  manual: boolean;
  grab?: { x: number; y: number };
};

export function motionRequest(value: unknown, window: Rect): MotionRequest {
  const v = value as MotionRequest | null;
  if (
    !v ||
    [v.generation, v.sequence, v.environmentRevision].some(
      (n) => !Number.isSafeInteger(n) || n < 0,
    ) ||
    !Number.isFinite(v.x) ||
    !Number.isFinite(v.y) ||
    Math.abs(v.x) > 100000 ||
    Math.abs(v.y) > 100000 ||
    typeof v.manual !== "boolean"
  )
    throw new Error("桌宠运动请求无效");
  const g = v.geometry;
  if (
    v.grab &&
    (!v.manual ||
      [v.grab.x, v.grab.y].some(
        (n) => !Number.isFinite(n) || Math.abs(n) > 2000,
      ))
  )
    throw new Error("桌宠抓取位置无效");
  if (
    !g ||
    !g.visible ||
    !g.feet ||
    [
      g.visible.x,
      g.visible.y,
      g.visible.width,
      g.visible.height,
      g.feet.x,
      g.feet.y,
    ].some((n) => !Number.isFinite(n)) ||
    g.visible.width < 1 ||
    g.visible.height < 1 ||
    g.visible.x < -window.width ||
    g.visible.y < -window.height ||
    g.visible.x + g.visible.width > window.width * 2 ||
    g.visible.y + g.visible.height > window.height * 2 ||
    g.feet.x < -window.width ||
    g.feet.x > window.width * 2 ||
    g.feet.y < -window.height ||
    g.feet.y > window.height * 2
  )
    throw new Error("桌宠可见范围无效");
  const edgeNames = ["left", "right", "top", "bottom"] as const;
  if (
    g.strideLength !== undefined &&
    (!Number.isFinite(g.strideLength) ||
      g.strideLength < 1 ||
      g.strideLength > window.height * 2)
  )
    throw new Error("桌宠步长无效");
  if (
    g.edges &&
    (Object.keys(g.edges).length !== 4 ||
      edgeNames.some(
        (edge) =>
          !g.edges?.[edge] ||
          !Number.isFinite(g.edges[edge].x) ||
          !Number.isFinite(g.edges[edge].y) ||
          Math.abs(g.edges[edge].x) > window.width * 2 ||
          Math.abs(g.edges[edge].y) > window.height * 2,
      ))
  )
    throw new Error("桌宠接触边缘无效");
  if (
    g.supportedEdges &&
    (!Array.isArray(g.supportedEdges) ||
      g.supportedEdges.length > 4 ||
      new Set(g.supportedEdges).size !== g.supportedEdges.length ||
      g.supportedEdges.some((edge) => !edgeNames.includes(edge)))
  )
    throw new Error("桌宠边缘能力无效");
  return v;
}

/** Only transparent margins may leave the work area. Never clamp against the full 300×400 shell. */
export function clampVisiblePet(
  bounds: Rect,
  geometry: MotionGeometry,
  area: Rect,
): Rect {
  const visible = geometry.visible;
  const placed = clampPetBounds(
    {
      x: bounds.x + visible.x,
      y: bounds.y + visible.y,
      width: visible.width,
      height: visible.height,
    },
    [
      {
        x: area.x + 4,
        y: area.y + 4,
        width: Math.max(1, area.width - 8),
        height: Math.max(1, area.height - 8),
      },
    ],
  );
  return {
    ...bounds,
    x: Math.round(placed.x - visible.x),
    y: Math.round(placed.y - visible.y),
  };
}

/** Compensate only native placement constraints while all painted pixels remain in the actual window. */
export function scenePlacement(
  desired: Rect,
  actual: Rect,
  geometry: MotionGeometry,
) {
  const offset = { x: desired.x - actual.x, y: desired.y - actual.y };
  const visible = geometry.visible;
  if (
    visible.x + offset.x < -1 ||
    visible.y + offset.y < -1 ||
    visible.x + offset.x + visible.width > actual.width + 1 ||
    visible.y + offset.y + visible.height > actual.height + 1
  )
    throw new Error("当前系统无法将完整角色放置到该显示器位置");
  return offset;
}

/** Keep a fixed renderer origin when a hanging silhouette needs more transparent shell space. */
export function motionWindowBounds(
  origin: Rect,
  geometry: MotionGeometry,
): Rect {
  const visible = geometry.visible;
  const dx = Math.min(0, Math.floor(visible.x - 8));
  const dy = Math.min(0, Math.floor(visible.y - 8));
  return {
    x: origin.x + dx,
    y: origin.y + dy,
    width: Math.max(300, Math.ceil(visible.x + visible.width + 8 - dx)),
    height: Math.max(400, Math.ceil(visible.y + visible.height + 8 - dy)),
  };
}

/** One window owns the generation. Cancellation invalidates every outstanding old request. */
export class PetMotionGate {
  generation = 0;
  private sequence = -1;
  accept(value: MotionRequest, revision: number) {
    if (value.environmentRevision !== revision)
      throw new Error("桌面边界已变化");
    if (
      value.generation < this.generation ||
      (value.generation === this.generation && value.sequence <= this.sequence)
    )
      throw new Error("桌宠运动更新已过期");
    this.generation = value.generation;
    this.sequence = value.sequence;
  }
  cancel(generation: unknown) {
    if (
      !Number.isSafeInteger(generation) ||
      (generation as number) <= this.generation
    )
      throw new Error("桌宠运动版本无效");
    this.generation = generation as number;
    this.sequence = -1;
  }
}
