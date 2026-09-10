import type { SlideElement } from "./types";
import { coverCrop } from "./imageCrop";
export function cropGesture(
  base: SlideElement,
  natural: { width: number; height: number },
  side: string,
  dx: number,
  dy: number,
  ratio: number | null,
): Partial<SlideElement> {
  const r = (-base.rotation * Math.PI) / 180,
    localX = dx * Math.cos(r) - dy * Math.sin(r),
    localY = dx * Math.sin(r) + dy * Math.cos(r);
  const logical = side
    .replace(/[ew]/g, (s) => (base.flip_x ? (s === "e" ? "w" : "e") : s))
    .replace(/[ns]/g, (s) => (base.flip_y ? (s === "n" ? "s" : "n") : s));
  const old = base.crop,
    c = { ...old };
  const x =
      (localX / base.width) *
      (1 - old.left - old.right) *
      (base.flip_x ? -1 : 1),
    y =
      (localY / base.height) *
      (1 - old.top - old.bottom) *
      (base.flip_y ? -1 : 1);
  if (side === "move") {
    const mx = Math.max(-c.right, Math.min(c.left, x)),
      my = Math.max(-c.bottom, Math.min(c.top, y));
    return {
      crop: {
        left: c.left - mx,
        right: c.right + mx,
        top: c.top - my,
        bottom: c.bottom + my,
      },
    };
  }
  if (logical.includes("w"))
    c.left = Math.max(0, Math.min(0.98 - c.right, c.left + x));
  if (logical.includes("e"))
    c.right = Math.max(0, Math.min(0.98 - c.left, c.right - x));
  if (logical.includes("n"))
    c.top = Math.max(0, Math.min(0.98 - c.bottom, c.top + y));
  if (logical.includes("s"))
    c.bottom = Math.max(0, Math.min(0.98 - c.top, c.bottom - y));
  const crop = ratio
    ? coverCrop(natural.width, natural.height, ratio, 1, c)
    : c;
  const width = Math.max(
    1,
    (base.width * (1 - crop.left - crop.right)) / (1 - old.left - old.right),
  );
  const height = Math.max(
    1,
    (base.height * (1 - crop.top - crop.bottom)) / (1 - old.top - old.bottom),
  );
  const shiftX = side.includes("w")
    ? (base.width - width) / 2
    : side.includes("e")
      ? (width - base.width) / 2
      : 0;
  const shiftY = side.includes("n")
    ? (base.height - height) / 2
    : side.includes("s")
      ? (height - base.height) / 2
      : 0;
  return {
    crop,
    width,
    height,
    x:
      base.x +
      (base.width - width) / 2 +
      shiftX * Math.cos(-r) -
      shiftY * Math.sin(-r),
    y:
      base.y +
      (base.height - height) / 2 +
      shiftX * Math.sin(-r) +
      shiftY * Math.cos(-r),
  };
}
