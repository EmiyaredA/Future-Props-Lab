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
  if (proportional || e.kind === "image" || e.kind === "vector") {
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
