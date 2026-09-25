import type {
  Bone,
  CharacterDocument,
  Deformer,
  Keyform,
  Part,
  Point,
} from "./types";

const copy = <T>(value: T): T => structuredClone(value);

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
  for (const field of [
    "rotation",
    "scale",
    "opacity",
    "offsetX",
    "offsetY",
  ] as const)
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
export function boneTransform(bones: Bone[]) {
  const byId = new Map(bones.map((bone) => [bone.id, bone]));
  return (point: Point, boneId: string): Point => {
    let { x, y } = point;
    const visited = new Set<string>();
    let parent: string | null | undefined = boneId;
    while (parent && !visited.has(parent)) {
      visited.add(parent);
      const bone = byId.get(parent);
      if (!bone) break;
      const angle = (bone.rotation * Math.PI) / 180;
      const dx = (x - bone.x) * bone.scale;
      const dy = (y - bone.y) * bone.scale;
      x = bone.x + dx * Math.cos(angle) - dy * Math.sin(angle) + bone.offsetX;
      y = bone.y + dx * Math.sin(angle) + dy * Math.cos(angle) + bone.offsetY;
      parent = bone.parentId;
    }
    return { x, y };
  };
}
export function evaluate(
  doc: CharacterDocument,
  values: Record<string, number>,
  boneRotations: Record<string, number> = {},
): { parts: PosedPart[]; deformers: Deformer[]; bones: Bone[] } {
  const parts = copy(doc.parts),
    deformers = copy(doc.deformers),
    bones = copy(doc.bones ?? []);
  for (const parameter of doc.parameters)
    for (const binding of parameter.bindings) {
      const part = parts.find((p) => p.id === binding.targetId),
        deformer = deformers.find((d) => d.id === binding.targetId),
        bone = bones.find((b) => b.id === binding.targetId);
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
      if (bone) {
        if (posed.rotation != null)
          bone.rotation += posed.rotation - base.rotation!;
        if (posed.scale != null) bone.scale += posed.scale - base.scale!;
        if (posed.offsetX != null)
          bone.offsetX += posed.offsetX - base.offsetX!;
        if (posed.offsetY != null)
          bone.offsetY += posed.offsetY - base.offsetY!;
      }
    }
  for (const bone of bones) bone.rotation += boneRotations[bone.id] ?? 0;
  for (const d of deformers) d.scale = Math.max(0.001, d.scale);
  for (const b of bones) b.scale = Math.max(0.001, b.scale);
  const transform = deformerTransform(deformers);
  const transformBone = boneTransform(bones);
  return {
    parts: parts
      .map((p) => ({
        ...p,
        opacity: Math.max(0, Math.min(1, p.opacity)),
        worldVertices: p.vertices.map((v, index) => {
          const point = { x: v.x + p.x, y: v.y + p.y };
          const weights = p.skinWeights?.[index];
          if (!weights?.length) return transform(point, p.parentId);
          return weights.reduce(
            (result, item) => {
              const posed = transformBone(point, item.boneId);
              result.x += posed.x * item.weight;
              result.y += posed.y * item.weight;
              return result;
            },
            { x: 0, y: 0 },
          );
        }),
      }))
      .sort((a, b) => a.order - b.order),
    deformers,
    bones,
  };
}
