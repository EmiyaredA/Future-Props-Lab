import { deformerTransform } from "./model";
import type { Deformer, Part, Point } from "./types";

export function inverseDeformedPoint(
  shape: Part | Deformer | undefined,
  deformers: Deformer[],
  index: number,
  world: Point,
): Point {
  if (!shape) return world;
  const isPart = "vertices" in shape;
  let guess = { ...(isPart ? shape.vertices[index] : shape.points[index]) };
  const transform = deformerTransform(deformers);
  const project = (point: Point) =>
    transform(
      isPart ? { x: point.x + shape.x, y: point.y + shape.y } : point,
      shape.parentId,
    );
  for (let iteration = 0; iteration < 8; iteration++) {
    const a = project(guess);
    const b = project({ x: guess.x + 0.01, y: guess.y });
    const c = project({ x: guess.x, y: guess.y + 0.01 });
    const dx = world.x - a.x;
    const dy = world.y - a.y;
    if (Math.abs(dx) + Math.abs(dy) < 0.001) break;
    const ax = (b.x - a.x) / 0.01;
    const ay = (b.y - a.y) / 0.01;
    const bx = (c.x - a.x) / 0.01;
    const by = (c.y - a.y) / 0.01;
    const determinant = ax * by - ay * bx;
    if (Math.abs(determinant) < 1e-8) break;
    guess = {
      x: guess.x + (dx * by - dy * bx) / determinant,
      y: guess.y + (dy * ax - dx * ay) / determinant,
    };
  }
  return guess;
}
