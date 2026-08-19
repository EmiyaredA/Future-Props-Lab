export type PortraitNaturalSize = { width: number; height: number };

export function portraitFootprintWidth(
  heightPercent: number,
  canvasWidth: number,
  canvasHeight: number,
  naturalSize?: PortraitNaturalSize,
  fallbackSize?: PortraitNaturalSize,
) {
  const size = naturalSize ?? fallbackSize;
  const aspectRatio =
    size && size.width > 0 && size.height > 0
      ? size.width / size.height
      : 3 / 4;
  return Number(
    (heightPercent * aspectRatio * (canvasHeight / canvasWidth)).toFixed(4),
  );
}
