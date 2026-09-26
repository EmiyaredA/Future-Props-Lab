import { setVertexBoneWeight } from "./model";
import type { CharacterDocument, Deformer, Part, Point } from "./types";

export function brushVertices(
  vertices: Point[] | undefined,
  point: Point,
  radius: number,
): number[] {
  return (
    vertices?.flatMap((vertex, index) =>
      Math.hypot(vertex.x - point.x, vertex.y - point.y) <= radius
        ? [index]
        : [],
    ) ?? []
  );
}

export function paintBoneWeights(
  doc: CharacterDocument,
  partId: string,
  vertices: number[],
  boneId: string,
  strength: number,
): void {
  const part = doc.parts.find((item) => item.id === partId);
  if (!part?.skinWeights) return;
  for (const index of vertices)
    setVertexBoneWeight(part, index, boneId, strength);
}

export function moveBone(
  doc: CharacterDocument,
  id: string,
  point: Point,
): void {
  const bone = doc.bones.find((item) => item.id === id);
  if (bone) {
    bone.x = point.x;
    bone.y = point.y;
  }
}

export function moveShapePoint(
  node: Part | Deformer,
  index: number,
  point: Point,
): void {
  if ("vertices" in node) node.vertices[index] = point;
  else node.points[index] = point;
}
