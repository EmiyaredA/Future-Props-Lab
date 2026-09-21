import Delaunator from "delaunator";
import type {
  Asset,
  CharacterDocument,
  Deformer,
  Keyform,
  Motion,
  Part,
  Point,
} from "./types";

export const id = () => crypto.randomUUID();
export const copy = <T>(value: T): T => structuredClone(value);
export function grid(width: number, height: number, columns = 4, rows = 4) {
  const vertices: Point[] = [],
    uvs: Point[] = [],
    triangles: number[] = [];
  for (let y = 0; y <= rows; y++)
    for (let x = 0; x <= columns; x++) {
      vertices.push({ x: (width * x) / columns, y: (height * y) / rows });
      uvs.push({ x: x / columns, y: y / rows });
    }
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < columns; x++) {
      const a = y * (columns + 1) + x,
        b = a + columns + 1;
      triangles.push(a, a + 1, b, a + 1, b + 1, b);
    }
  return { vertices, uvs, triangles };
}
export function makePart(
  asset: Asset,
  doc: CharacterDocument,
  x?: number,
  y?: number,
): Part {
  return {
    id: id(),
    assetId: asset.id,
    name: asset.name.replace(/\.png$/i, ""),
    group: "",
    parentId: null,
    x: x ?? (doc.width - asset.width) / 2,
    y: y ?? (doc.height - asset.height) / 2,
    width: asset.width,
    height: asset.height,
    ...grid(asset.width, asset.height),
    opacity: 1,
    order: doc.parts.length,
    visible: true,
    locked: false,
    maskId: null,
  };
}
export function makeDeformer(
  doc: CharacterDocument,
  kind: "rotation" | "warp",
): Deformer {
  const mesh = grid(doc.width, doc.height, 2, 2);
  return {
    id: id(),
    name: kind === "rotation" ? "旋转变形器" : "曲面变形器",
    kind,
    parentId: null,
    x: kind === "rotation" ? doc.width / 2 : 0,
    y: kind === "rotation" ? doc.height / 2 : 0,
    rotation: 0,
    scale: 1,
    width: doc.width,
    height: doc.height,
    columns: 2,
    rows: 2,
    points: kind === "warp" ? mesh.vertices : [],
  };
}
export function triangulate(part: Part) {
  part.triangles = Array.from(
    Delaunator.from(part.uvs.map((p) => [p.x, p.y])).triangles,
  );
}
export function interval<T>(
  keys: T[],
  value: number,
  at: (item: T) => number,
): [T, T, number] {
  const sorted = [...keys].sort((a, b) => at(a) - at(b));
  if (value <= at(sorted[0])) return [sorted[0], sorted[0], 0];
  for (let i = 1; i < sorted.length; i++)
    if (value <= at(sorted[i]))
      return [
        sorted[i - 1],
        sorted[i],
        (value - at(sorted[i - 1])) / (at(sorted[i]) - at(sorted[i - 1])),
      ];
  return [sorted.at(-1)!, sorted.at(-1)!, 0];
}
export function parameterValues(
  doc: CharacterDocument,
  frame = 0,
  motionId?: string,
  expressionId?: string,
  overrides: Record<string, number> = {},
) {
  const values = Object.fromEntries(
    doc.parameters.map((p) => [p.id, p.default]),
  );
  Object.assign(
    values,
    doc.expressions.find((e) => e.id === expressionId)?.values ?? {},
  );
  const motion = doc.motions.find((m) => m.id === motionId);
  for (const track of motion?.tracks ?? [])
    if (track.keys?.length) {
      const [a, b, ratio] = interval(track.keys, frame, (k) => k.frame);
      const t =
        a.interpolation === "hold"
          ? 0
          : a.interpolation === "smooth"
            ? ratio * ratio * (3 - 2 * ratio)
            : ratio;
      values[track.parameterId] = a.value + (b.value - a.value) * t;
    }
  Object.assign(values, overrides);
  for (const p of doc.parameters)
    values[p.id] = Math.max(p.minimum, Math.min(p.maximum, values[p.id]));
  return values;
}
function sample(keys: Keyform[], value: number) {
  const [a, b, t] = interval(keys, value, (k) => k.value);
  const result: Partial<Keyform> = {};
  for (const field of ["rotation", "scale", "opacity"] as const)
    if (a[field] != null && b[field] != null)
      result[field] = a[field]! + (b[field]! - a[field]!) * t;
  if (a.points && b.points)
    result.points = a.points.map((p, i) => ({
      x: p.x + (b.points![i].x - p.x) * t,
      y: p.y + (b.points![i].y - p.y) * t,
    }));
  return result;
}
export function deformerTransform(deformers: Deformer[]) {
  const byId = new Map(deformers.map((d) => [d.id, d]));
  return (point: Point, parent?: string | null): Point => {
    let { x, y } = point;
    const visited = new Set<string>();
    while (parent && !visited.has(parent)) {
      visited.add(parent);
      const d = byId.get(parent);
      if (!d) break;
      if (d.kind === "rotation") {
        const angle = (d.rotation * Math.PI) / 180,
          dx = (x - d.x) * d.scale,
          dy = (y - d.y) * d.scale;
        x = d.x + dx * Math.cos(angle) - dy * Math.sin(angle);
        y = d.y + dx * Math.sin(angle) + dy * Math.cos(angle);
      } else {
        const u = ((x - d.x) / d.width) * d.columns,
          v = ((y - d.y) / d.height) * d.rows;
        const col = Math.max(0, Math.min(d.columns - 1, Math.floor(u))),
          row = Math.max(0, Math.min(d.rows - 1, Math.floor(v)));
        const tx = u - col,
          ty = v - row,
          at = row * (d.columns + 1) + col;
        const [a, b, c, e] = [
          at,
          at + 1,
          at + d.columns + 1,
          at + d.columns + 2,
        ].map((i) => d.points[i]);
        const blend = (axis: "x" | "y") =>
          (a[axis] * (1 - tx) + b[axis] * tx) * (1 - ty) +
          (c[axis] * (1 - tx) + e[axis] * tx) * ty;
        x = blend("x");
        y = blend("y");
      }
      parent = d.parentId;
    }
    return { x, y };
  };
}
export type PosedPart = Part & { worldVertices: Point[] };
export function evaluate(
  doc: CharacterDocument,
  values: Record<string, number>,
): { parts: PosedPart[]; deformers: Deformer[] } {
  const parts = copy(doc.parts),
    deformers = copy(doc.deformers);
  for (const parameter of doc.parameters)
    for (const binding of parameter.bindings) {
      const part = parts.find((p) => p.id === binding.targetId),
        deformer = deformers.find((d) => d.id === binding.targetId);
      const base = sample(binding.keys, parameter.default),
        posed = sample(binding.keys, values[parameter.id] ?? parameter.default);
      if (part) {
        if (posed.opacity != null)
          part.opacity += posed.opacity - base.opacity!;
        if (posed.points)
          part.vertices = part.vertices.map((p, i) => ({
            x: p.x + posed.points![i].x - base.points![i].x,
            y: p.y + posed.points![i].y - base.points![i].y,
          }));
      }
      if (deformer) {
        if (posed.rotation != null)
          deformer.rotation += posed.rotation - base.rotation!;
        if (posed.scale != null) deformer.scale += posed.scale - base.scale!;
        if (posed.points)
          deformer.points = deformer.points.map((p, i) => ({
            x: p.x + posed.points![i].x - base.points![i].x,
            y: p.y + posed.points![i].y - base.points![i].y,
          }));
      }
    }
  for (const d of deformers) d.scale = Math.max(0.001, d.scale);
  const transform = deformerTransform(deformers);
  return {
    parts: parts
      .map((p) => ({
        ...p,
        opacity: Math.max(0, Math.min(1, p.opacity)),
        worldVertices: p.vertices.map((v) =>
          transform({ x: v.x + p.x, y: v.y + p.y }, p.parentId),
        ),
      }))
      .sort((a, b) => a.order - b.order),
    deformers,
  };
}
export function captureKey(
  doc: CharacterDocument,
  parameterId: string,
  targetId: string,
  value: number,
  shape?: Part | Deformer,
) {
  const parameter = doc.parameters.find((p) => p.id === parameterId)!;
  const pose = shape
    ? null
    : evaluate(
        doc,
        parameterValues(doc, 0, undefined, undefined, { [parameterId]: value }),
      );
  const target =
    shape ??
    pose!.parts.find((p) => p.id === targetId) ??
    pose!.deformers.find((d) => d.id === targetId)!;
  const keyFor = (node: Part | Deformer, at: number): Keyform =>
    "vertices" in node
      ? { value: at, points: copy(node.vertices), opacity: node.opacity }
      : node.kind === "rotation"
        ? { value: at, rotation: node.rotation, scale: node.scale }
        : { value: at, points: copy(node.points) };
  let binding = parameter.bindings.find((b) => b.targetId === targetId);
  if (!binding) {
    const base =
      doc.parts.find((p) => p.id === targetId) ??
      doc.deformers.find((d) => d.id === targetId)!;
    binding = { targetId, keys: [keyFor(base, parameter.default)] };
    parameter.bindings.push(binding);
  }
  binding.keys = binding.keys
    .filter((k) => k.value !== value)
    .concat([keyFor(target, value)])
    .sort((a, b) => a.value - b.value);
}
export function newMotion(name: string): Motion {
  return {
    id: id(),
    name,
    fps: 30,
    duration: 60,
    loopStart: 0,
    loopEnd: 60,
    tracks: [],
  };
}
export function clearBindings(doc: CharacterDocument, targetId: string) {
  for (const p of doc.parameters)
    p.bindings = p.bindings.filter((b) => b.targetId !== targetId);
}
