import type { CSSProperties } from "react";
import type { SlideElement } from "./types";
export function bounds(elements: SlideElement[]) {
  const x = Math.min(...elements.map((e) => e.x)),
    y = Math.min(...elements.map((e) => e.y));
  return {
    x,
    y,
    width: Math.max(...elements.map((e) => e.x + e.width)) - x,
    height: Math.max(...elements.map((e) => e.y + e.height)) - y,
  };
}
export function alignElements(
  elements: SlideElement[],
  ids: string[],
  mode: string,
): SlideElement[] {
  const selected = elements.filter((e) => ids.includes(e.id) && !e.locked);
  if (!selected.length) return elements;
  const box =
    selected.length === 1
      ? { x: 0, y: 0, width: 1280, height: 720 }
      : bounds(selected);
  const distributed = new Map<string, number>();
  if (mode === "horizontal" || mode === "vertical") {
    if (selected.length < 3) return elements;
    const axis = mode === "horizontal" ? "x" : "y",
      size = axis === "x" ? "width" : "height";
    const ordered = [...selected].sort((a, b) => a[axis] - b[axis]);
    const gap =
      (box[size] - ordered.reduce((sum, e) => sum + e[size], 0)) /
      (ordered.length - 1);
    let position = box[axis];
    ordered.forEach((e) => {
      distributed.set(e.id, position);
      position += e[size] + gap;
    });
  }
  return elements.map((e) => {
    if (!ids.includes(e.id) || e.locked) return e;
    if (mode === "horizontal") return { ...e, x: distributed.get(e.id) ?? e.x };
    if (mode === "vertical") return { ...e, y: distributed.get(e.id) ?? e.y };
    return {
      ...e,
      x:
        mode === "left"
          ? box.x
          : mode === "center"
            ? box.x + (box.width - e.width) / 2
            : mode === "right"
              ? box.x + box.width - e.width
              : e.x,
      y:
        mode === "top"
          ? box.y
          : mode === "middle"
            ? box.y + (box.height - e.height) / 2
            : mode === "bottom"
              ? box.y + box.height - e.height
              : e.y,
    };
  });
}
export function snapMove(
  box: ReturnType<typeof bounds>,
  dx: number,
  dy: number,
  others: SlideElement[],
  threshold: number,
) {
  const xs = [
    0,
    640,
    1280,
    ...others.flatMap((e) => [e.x, e.x + e.width / 2, e.x + e.width]),
  ];
  const ys = [
    0,
    360,
    720,
    ...others.flatMap((e) => [e.y, e.y + e.height / 2, e.y + e.height]),
  ];
  const snap = (moving: number[], targets: number[]) => {
    let delta = threshold,
      guide: number | null = null;
    moving.forEach((value) =>
      targets.forEach((target) => {
        if (Math.abs(target - value) < Math.abs(delta)) {
          delta = target - value;
          guide = target;
        }
      }),
    );
    return { delta: guide === null ? 0 : delta, guide };
  };
  const x = snap(
    [box.x + dx, box.x + dx + box.width / 2, box.x + dx + box.width],
    xs,
  );
  const y = snap(
    [box.y + dy, box.y + dy + box.height / 2, box.y + dy + box.height],
    ys,
  );
  return { dx: dx + x.delta, dy: dy + y.delta, x: x.guide, y: y.guide };
}

export function elementStyle(element: SlideElement): CSSProperties {
  return {
    left: element.x,
    top: element.y,
    width: element.width,
    height: element.height,
    transform: `rotate(${element.rotation}deg)`,
  };
}

export function boundedElement(element: SlideElement): SlideElement {
  const x = Math.max(-10000, Math.min(10000, element.x));
  const y = Math.max(-10000, Math.min(10000, element.y));
  const width = Math.max(1, Math.min(10000, element.width));
  const height = Math.max(1, Math.min(10000, element.height));
  return x === element.x &&
    y === element.y &&
    width === element.width &&
    height === element.height
    ? element
    : { ...element, x, y, width, height };
}

export function resizeRotatedElement(
  e: SlideElement,
  dx: number,
  dy: number,
  proportional: boolean,
): SlideElement {
  const radians = (e.rotation * Math.PI) / 180;
  const cos = Math.cos(radians),
    sin = Math.sin(radians);
  let width = Math.max(8, e.width + dx * cos + dy * sin);
  let height = Math.max(8, e.height - dx * sin + dy * cos);
  if (proportional || e.kind === "image") {
    const ratio = Math.max(width / e.width, height / e.height);
    width = e.width * ratio;
    height = e.height * ratio;
  }
  width = Math.min(10000, width);
  height = Math.min(10000, height);
  const halfWidth = (width - e.width) / 2,
    halfHeight = (height - e.height) / 2;
  return boundedElement({
    ...e,
    width,
    height,
    x: e.x + halfWidth * cos - halfHeight * sin - halfWidth,
    y: e.y + halfWidth * sin + halfHeight * cos - halfHeight,
  });
}
