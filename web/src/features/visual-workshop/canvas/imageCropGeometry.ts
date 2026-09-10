export type ImageSize = { width: number; height: number };
export type CropRect = ImageSize & { x: number; y: number };
export type CropSide =
  "move" | "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function fitCrop(size: ImageSize, ratio: number | null): CropRect {
  const width = ratio ? Math.min(size.width, size.height * ratio) : size.width;
  const height = ratio ? width / ratio : size.height;
  return {
    x: (size.width - width) / 2,
    y: (size.height - height) / 2,
    width,
    height,
  };
}

export function pixelCrop(rect: CropRect, size: ImageSize): CropRect {
  const x = clamp(Math.round(rect.x), 0, size.width - 1);
  const y = clamp(Math.round(rect.y), 0, size.height - 1);
  return {
    x,
    y,
    width: clamp(Math.round(rect.x + rect.width), x + 1, size.width) - x,
    height: clamp(Math.round(rect.y + rect.height), y + 1, size.height) - y,
  };
}

export function resizeCrop(
  base: CropRect,
  size: ImageSize,
  side: CropSide,
  dx: number,
  dy: number,
  ratio: number | null,
): CropRect {
  if (side === "move")
    return {
      ...base,
      x: clamp(base.x + dx, 0, size.width - base.width),
      y: clamp(base.y + dy, 0, size.height - base.height),
    };
  const horizontal = side.includes("w") ? -1 : side.includes("e") ? 1 : 0;
  const vertical = side.includes("n") ? -1 : side.includes("s") ? 1 : 0;
  if (!ratio) {
    const left =
      horizontal === -1
        ? clamp(base.x + dx, 0, base.x + base.width - 1)
        : base.x;
    const top =
      vertical === -1
        ? clamp(base.y + dy, 0, base.y + base.height - 1)
        : base.y;
    const right =
      horizontal === 1
        ? clamp(base.x + base.width + dx, base.x + 1, size.width)
        : base.x + base.width;
    const bottom =
      vertical === 1
        ? clamp(base.y + base.height + dy, base.y + 1, size.height)
        : base.y + base.height;
    return { x: left, y: top, width: right - left, height: bottom - top };
  }
  const anchorX =
    base.x + base.width * (horizontal === -1 ? 1 : horizontal === 1 ? 0 : 0.5);
  const anchorY =
    base.y + base.height * (vertical === -1 ? 1 : vertical === 1 ? 0 : 0.5);
  const maxWidth =
    horizontal === -1
      ? anchorX
      : horizontal === 1
        ? size.width - anchorX
        : 2 * Math.min(anchorX, size.width - anchorX);
  const maxHeight =
    vertical === -1
      ? anchorY
      : vertical === 1
        ? size.height - anchorY
        : 2 * Math.min(anchorY, size.height - anchorY);
  const delta =
    horizontal && (!vertical || Math.abs(dx) >= Math.abs(dy * ratio))
      ? horizontal * dx
      : vertical * dy * ratio;
  const maximum = Math.min(maxWidth, maxHeight * ratio);
  const width = clamp(
    base.width + delta,
    Math.min(maximum, Math.max(1, ratio)),
    maximum,
  );
  const height = width / ratio;
  return {
    x: anchorX - width * (horizontal === -1 ? 1 : horizontal === 1 ? 0 : 0.5),
    y: anchorY - height * (vertical === -1 ? 1 : vertical === 1 ? 0 : 0.5),
    width,
    height,
  };
}

export function drawCrop(
  start: { x: number; y: number },
  end: { x: number; y: number },
  size: ImageSize,
  ratio: number | null,
): CropRect {
  const x = clamp(start.x, 0, size.width - 1),
    y = clamp(start.y, 0, size.height - 1);
  const west = end.x < x,
    north = end.y < y;
  let width = Math.max(1, Math.abs(end.x - x)),
    height = Math.max(1, Math.abs(end.y - y));
  if (ratio) {
    width = Math.min(
      Math.max(width, height * ratio),
      west ? x : size.width - x,
      (north ? y : size.height - y) * ratio,
    );
    height = width / ratio;
  } else {
    width = Math.min(width, west ? x : size.width - x);
    height = Math.min(height, north ? y : size.height - y);
  }
  return { x: west ? x - width : x, y: north ? y - height : y, width, height };
}
