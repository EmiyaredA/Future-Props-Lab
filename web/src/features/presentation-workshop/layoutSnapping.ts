import type { SlideElement } from "./types";
import { boundedElement } from "./geometry";
import {
  resizeFromHandle,
  rotatedBounds,
  type Rect,
  type ResizeHandle,
} from "./selectionGeometry";
import type { LayoutObject } from "./layoutObjects";

export type LayoutGuide = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label?: string;
  kind: "align" | "size" | "gap";
};
export type SnapMemory = string[];
type Candidate = {
  id: string;
  correction: number;
  rank: number;
  guides: LayoutGuide[];
};
const near = (a: number, b: number) => Math.abs(a - b) < 0.001;
const points = (box: Rect, axis: "x" | "y") => {
  const size = axis === "x" ? box.width : box.height;
  return [box[axis], box[axis] + size / 2, box[axis] + size];
};
const measure = (value: number) => `${+value.toFixed(1)}`;
function line(axis: "x" | "y", value: number, a: Rect, b: Rect): LayoutGuide {
  return axis === "x"
    ? {
        x1: value,
        x2: value,
        y1: Math.min(a.y, b.y),
        y2: Math.max(a.y + a.height, b.y + b.height),
        kind: "align",
      }
    : {
        y1: value,
        y2: value,
        x1: Math.min(a.x, b.x),
        x2: Math.max(a.x + a.width, b.x + b.width),
        kind: "align",
      };
}
function choose<T extends { id: string; distance: number; rank: number }>(
  candidates: T[],
  memory: SnapMemory,
  scale: number,
) {
  const held = candidates.filter(
    (c) => memory.includes(c.id) && c.distance * scale <= 10,
  );
  const pool = held.length
    ? held
    : candidates.filter((c) => c.distance * scale <= 6);
  return pool.sort(
    (a, b) =>
      (Math.abs(a.distance - b.distance) > 1e-6
        ? a.distance - b.distance
        : a.rank - b.rank) || a.id.localeCompare(b.id),
  )[0];
}

/** A group or multi-selection uses its visual bounds; a single element uses local axes. */
export function resizeSelection(
  elements: SlideElement[],
  dx: number,
  dy: number,
  handle: ResizeHandle,
  proportional: boolean,
) {
  if (elements.length === 1)
    return [resizeFromHandle(elements[0], dx, dy, handle, proportional)];
  const box = rotatedBounds(elements);
  const resized = resizeFromHandle(
    { ...elements[0], ...box, kind: "rect", rotation: 0 },
    dx,
    dy,
    handle,
    proportional ||
      elements.some(
        (e) =>
          e.kind === "image" || e.kind === "vector" || e.rotation % 180 !== 0,
      ),
  );
  const sx = resized.width / box.width,
    sy = resized.height / box.height;
  return elements.map((e) =>
    boundedElement({
      ...e,
      x: resized.x + (e.x - box.x) * sx,
      y: resized.y + (e.y - box.y) * sy,
      width: e.width * sx,
      height: e.height * sy,
    }),
  );
}

export function snapTranslation(
  box: Rect,
  dx: number,
  dy: number,
  others: LayoutObject[],
  container: Rect,
  scale: number,
  memory: SnapMemory = [],
) {
  const moving = { ...box, x: box.x + dx, y: box.y + dy };
  const guides: LayoutGuide[] = [],
    nextMemory: SnapMemory = [];
  const result = { dx, dy, guides, memory: nextMemory };
  for (const axis of ["x", "y"] as const) {
    const size = axis === "x" ? "width" : "height",
      orth = axis === "x" ? "y" : "x",
      orthSize = axis === "x" ? "height" : "width";
    const candidates: Candidate[] = [];
    for (const target of [{ id: "container", box: container }, ...others]) {
      points(moving, axis).forEach((value, i) =>
        points(target.box, axis).forEach((v, j) => {
          candidates.push({
            id: `${axis}:${target.id}:${i}:${j}`,
            correction: v - value,
            rank: 0,
            guides: [line(axis, v, moving, target.box)],
          });
        }),
      );
    }
    const neighbors = others
      .filter(
        (o) =>
          o.box[orth] < moving[orth] + moving[orthSize] &&
          o.box[orth] + o.box[orthSize] > moving[orth],
      )
      .sort((a, b) => a.box[axis] - b.box[axis]);
    const gapGuide = (start: number, end: number): LayoutGuide =>
      axis === "x"
        ? {
            x1: start,
            x2: end,
            y1: moving.y + moving.height / 2,
            y2: moving.y + moving.height / 2,
            label: measure(end - start),
            kind: "gap",
          }
        : {
            y1: start,
            y2: end,
            x1: moving.x + moving.width / 2,
            x2: moving.x + moving.width / 2,
            label: measure(end - start),
            kind: "gap",
          };
    for (let i = 0; i < neighbors.length - 1; i++) {
      const a = neighbors[i],
        b = neighbors[i + 1];
      const endA = a.box[axis] + a.box[size],
        startB = b.box[axis],
        gap = startB - endA;
      if (gap < 0) continue;
      const add = (
        id: string,
        position: number,
        intervals: [number, number][],
      ) => {
        if (
          neighbors.some(
            (o) =>
              o.box[axis] < position + moving[size] &&
              o.box[axis] + o.box[size] > position,
          )
        )
          return;
        candidates.push({
          id: `${axis}:gap:${a.id}:${b.id}:${id}`,
          correction: position - moving[axis],
          rank: 2,
          guides: intervals.map(([start, end]) => gapGuide(start, end)),
        });
      };
      if (gap >= moving[size]) {
        const p = (endA + startB - moving[size]) / 2;
        add("between", p, [
          [endA, p],
          [p + moving[size], startB],
        ]);
      }
      const before = a.box[axis] - gap - moving[size],
        after = b.box[axis] + b.box[size] + gap;
      add("before", before, [
        [before + moving[size], a.box[axis]],
        [endA, startB],
      ]);
      add("after", after, [
        [endA, startB],
        [b.box[axis] + b.box[size], after],
      ]);
    }
    const best = choose(
      candidates.map((c) => ({ ...c, distance: Math.abs(c.correction) })),
      memory,
      scale,
    );
    if (best) {
      result[axis === "x" ? "dx" : "dy"] += best.correction;
      guides.push(...best.guides);
      nextMemory.push(best.id);
    }
  }
  return result;
}

type Metric = "left" | "right" | "top" | "bottom" | "width" | "height";
function metrics(elements: SlideElement[]) {
  const box = rotatedBounds(elements);
  return {
    box,
    left: box.x,
    right: box.x + box.width,
    top: box.y,
    bottom: box.y + box.height,
    width: elements.length === 1 ? elements[0].width : box.width,
    height: elements.length === 1 ? elements[0].height : box.height,
  };
}

/** Solve constraints through the existing anchor-preserving resize, including rotation. */
export function snapResize(
  elements: SlideElement[],
  dx: number,
  dy: number,
  handle: ResizeHandle,
  proportional: boolean,
  others: LayoutObject[],
  container: Rect,
  scale: number,
  memory: SnapMemory = [],
) {
  const evaluate = (x: number, y: number) =>
    metrics(resizeSelection(elements, x, y, handle, proportional));
  const raw = evaluate(dx, dy),
    probeX = evaluate(dx + 0.01, dy),
    probeY = evaluate(dx, dy + 0.01);
  const keepRatio =
    proportional ||
    elements.some(
      (e) =>
        e.kind === "image" ||
        e.kind === "vector" ||
        (elements.length > 1 && e.rotation % 180 !== 0),
    );
  const base =
    elements.length === 1
      ? elements[0]
      : { ...rotatedBounds(elements), rotation: 0 };
  const hx = handle.includes("w") ? -1 : handle.includes("e") ? 1 : 0;
  const hy = handle.includes("n") ? -1 : handle.includes("s") ? 1 : 0;
  const angle = (base.rotation * Math.PI) / 180;
  const vx =
    hx * base.width * Math.cos(angle) - hy * base.height * Math.sin(angle);
  const vy =
    hx * base.width * Math.sin(angle) + hy * base.height * Math.cos(angle);
  const norm = vx * vx + vy * vy;
  const ratioProbe = keepRatio
    ? evaluate(dx + vx * 0.0001, dy + vy * 0.0001)
    : raw;
  type Constraint = {
    id: string;
    key: Metric;
    target: number;
    rank: number;
    object: { box: Rect };
    gx: number;
    gy: number;
  };
  const constraints: Constraint[] = [];
  for (const key of [
    "left",
    "right",
    "top",
    "bottom",
    "width",
    "height",
  ] as const) {
    const derivative = (ratioProbe[key] - raw[key]) / 0.0001;
    const gx = keepRatio
      ? (derivative * vx) / norm
      : (probeX[key] - raw[key]) / 0.01;
    const gy = keepRatio
      ? (derivative * vy) / norm
      : (probeY[key] - raw[key]) / 0.01;
    if (gx * gx + gy * gy < 1e-8) continue;
    const dimension = key === "width" || key === "height";
    const axis = ["left", "right", "width"].includes(key) ? "x" : "y";
    for (const object of dimension
      ? others
      : [{ id: "container", box: container }, ...others]) {
      const targets = dimension
        ? [(object as LayoutObject)[key]]
        : points(object.box, axis);
      targets.forEach((target, i) =>
        constraints.push({
          id: `resize:${key}:${object.id}:${i}`,
          key,
          target,
          rank: dimension ? 1 : 0,
          object,
          gx,
          gy,
        }),
      );
    }
  }
  const solve = (c: Constraint, x: number, y: number) => {
    const error = c.target - evaluate(x, y)[c.key],
      norm = c.gx * c.gx + c.gy * c.gy;
    return { x: x + (c.gx * error) / norm, y: y + (c.gy * error) / norm };
  };
  // Coincident objects produce the same equation. Solve it once, retaining the
  // active reference (or a stable ID) instead of evaluating every duplicate.
  const unique = new Map<string, Constraint>();
  for (const constraint of constraints) {
    const key = `${constraint.key}:${constraint.target}`;
    const previous = unique.get(key);
    if (
      !previous ||
      (!memory.includes(previous.id) &&
        (memory.includes(constraint.id) ||
          constraint.id.localeCompare(previous.id) < 0))
    ) {
      unique.set(key, constraint);
    }
  }
  const candidates = [...unique.values()].flatMap((c) => {
    const correction = (c.target - raw[c.key]) / Math.hypot(c.gx, c.gy);
    if (Math.abs(correction) * scale > (memory.includes(c.id) ? 10 : 6))
      return [];
    const p = solve(c, dx, dy);
    if (!near(evaluate(p.x, p.y)[c.key], c.target)) return [];
    return [{ ...c, ...p, distance: Math.hypot(p.x - dx, p.y - dy) }];
  });
  const best = choose(candidates, memory, scale);
  let x = best?.x ?? dx,
    y = best?.y ?? dy;
  const matches: Constraint[] = best ? [best] : [];
  if (best) {
    // Add a second independent constraint only if the first remains satisfied.
    const compatible = candidates
      .filter((c) => c.id !== best.id)
      .flatMap((c) => {
        const determinant = best.gx * c.gy - best.gy * c.gx;
        if (Math.abs(determinant) < 1e-6) return [];
        const a = best.target - raw[best.key],
          b = c.target - raw[c.key];
        const p = {
          x: dx + (a * c.gy - b * best.gy) / determinant,
          y: dy + (b * best.gx - a * c.gx) / determinant,
        };
        const output = evaluate(p.x, p.y);
        return near(output[best.key], best.target) &&
          near(output[c.key], c.target)
          ? [{ ...c, ...p, distance: Math.hypot(p.x - x, p.y - y) }]
          : [];
      });
    const second = choose(compatible, memory, scale);
    if (second) {
      x = second.x;
      y = second.y;
      matches.push(second);
    }
  }
  const output = evaluate(x, y);
  const guides = matches.map((c) => {
    if (c.key === "width")
      return {
        x1: output.box.x,
        x2: output.box.x + output.box.width,
        y1: output.box.y,
        y2: output.box.y,
        label: `同宽 ${measure(c.target)}`,
        kind: "size" as const,
      };
    if (c.key === "height")
      return {
        x1: output.box.x + output.box.width,
        x2: output.box.x + output.box.width,
        y1: output.box.y,
        y2: output.box.y + output.box.height,
        label: `同高 ${measure(c.target)}`,
        kind: "size" as const,
      };
    return line(
      c.key === "left" || c.key === "right" ? "x" : "y",
      c.target,
      output.box,
      c.object.box,
    );
  });
  return { dx: x, dy: y, guides, memory: matches.map((c) => c.id) };
}
