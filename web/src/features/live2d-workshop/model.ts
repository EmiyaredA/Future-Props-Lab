import Delaunator from "delaunator";
import { evaluate, parameterValues } from "@shared/live2d/pose";
export {
  interval,
  parameterValues,
  deformerTransform,
  evaluate,
} from "@shared/live2d/pose";
export type { PosedPart } from "@shared/live2d/pose";
import type {
  Asset,
  Bone,
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
export function makeBone(
  doc: CharacterDocument,
  name = "新骨骼",
  parentId: string | null = null,
  x = doc.width / 2,
  y = doc.height / 2,
): Bone {
  return {
    id: id(),
    name,
    parentId,
    x,
    y,
    rotation: 0,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    spring: 0,
    damping: 0.5,
  };
}
export function applyHumanTemplate(doc: CharacterDocument) {
  if (doc.bones.length) return;
  const w = doc.width;
  const h = doc.height;
  const root = makeBone(doc, "躯干根骨", null, w * 0.5, h * 0.88);
  const chest = makeBone(doc, "胸肩", root.id, w * 0.5, h * 0.57);
  const neck = makeBone(doc, "颈部", chest.id, w * 0.5, h * 0.42);
  const head = makeBone(doc, "头部", neck.id, w * 0.5, h * 0.3);
  const leftArm = makeBone(doc, "左上臂", chest.id, w * 0.29, h * 0.58);
  const leftForearm = makeBone(doc, "左前臂", leftArm.id, w * 0.23, h * 0.74);
  const rightArm = makeBone(doc, "右上臂", chest.id, w * 0.71, h * 0.58);
  const rightForearm = makeBone(doc, "右前臂", rightArm.id, w * 0.77, h * 0.74);
  const leftHair = makeBone(doc, "左发束", head.id, w * 0.32, h * 0.3);
  const rightHair = makeBone(doc, "右发束", head.id, w * 0.68, h * 0.3);
  const tie = makeBone(doc, "领带", chest.id, w * 0.5, h * 0.54);
  leftHair.spring = rightHair.spring = tie.spring = 0.5;
  doc.bones.push(root, chest, neck, head, leftArm, leftForearm, rightArm, rightForearm, leftHair, rightHair, tie);
  for (const part of doc.parts) {
    if (part.parentId || part.skinWeights?.length) continue;
    const name = `${part.group}/${part.name}`.toLowerCase();
    const centerX = part.x + part.width / 2;
    const chosen = /左.*(袖|臂|手)/.test(name) ? leftArm
      : /右.*(袖|臂|手)/.test(name) ? rightArm
      : /(刘海|眼|眉|口|脸|面|头)/.test(name) ? head
      : /发/.test(name) ? centerX < w / 2 ? leftHair : rightHair
      : /领带/.test(name) ? tie : chest;
    part.skinWeights = part.vertices.map(() => [{ boneId: chosen.id, weight: 1 }]);
  }
  doc.idleBehavior.springBones = [leftHair.id, rightHair.id, tie.id];
}

export function setVertexBoneWeight(part: Part, index: number, boneId: string, amount: number) {
  if (!part.skinWeights) return;
  const current = part.skinWeights[index] ?? [];
  const other = current.filter((item) => item.boneId !== boneId);
  const bounded = Math.max(0, Math.min(1, amount));
  if (bounded >= 1 || (!other.length && bounded > 0)) {
    part.skinWeights[index] = [{ boneId, weight: 1 }];
    return;
  }
  if (!other.length) return;
  const kept = other.slice(0, bounded > 0 ? 3 : 4);
  const total = kept.reduce((sum, item) => sum + item.weight, 0);
  part.skinWeights[index] = [
    ...(bounded > 0 ? [{ boneId, weight: bounded }] : []),
    ...kept.map((item) => ({
      boneId: item.boneId,
      weight: (item.weight / total) * (1 - bounded),
    })),
  ];
}
export function triangulate(part: Part) {
  part.triangles = Array.from(
    Delaunator.from(part.uvs.map((p) => [p.x, p.y])).triangles,
  );
}
export function captureKey(
  doc: CharacterDocument,
  parameterId: string,
  targetId: string,
  value: number,
  shape?: Part | Deformer | Bone,
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
    pose!.deformers.find((d) => d.id === targetId) ??
    pose!.bones.find((b) => b.id === targetId)!;
  const keyFor = (node: Part | Deformer | Bone, at: number): Keyform =>
    "vertices" in node
      ? { value: at, points: copy(node.vertices), opacity: node.opacity }
      : "kind" in node && node.kind === "rotation"
        ? { value: at, rotation: node.rotation, scale: node.scale }
        : "kind" in node
          ? { value: at, points: copy(node.points) }
          : {
              value: at,
              rotation: node.rotation,
              scale: node.scale,
              offsetX: node.offsetX,
              offsetY: node.offsetY,
            };
  let binding = parameter.bindings.find((b) => b.targetId === targetId);
  if (!binding) {
    const base =
      doc.parts.find((p) => p.id === targetId) ??
      doc.deformers.find((d) => d.id === targetId) ??
      doc.bones.find((b) => b.id === targetId)!;
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
