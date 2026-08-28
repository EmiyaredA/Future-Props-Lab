const portraitGroundOffsets = new Map<string, number>();

const ALPHA_THRESHOLD = 8;
const MINIMUM_VISIBLE_ROW_RATIO = 0.002;

export function portraitTransparentBottomPercent(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
) {
  if (width <= 0 || height <= 0 || rgba.length < width * height * 4) return 0;
  const minimumVisiblePixels = Math.max(
    1,
    Math.ceil(width * MINIMUM_VISIBLE_ROW_RATIO),
  );
  for (let y = height - 1; y >= 0; y -= 1) {
    let visiblePixels = 0;
    for (let x = 0; x < width; x += 1) {
      if (rgba[(y * width + x) * 4 + 3] < ALPHA_THRESHOLD) continue;
      visiblePixels += 1;
      if (visiblePixels >= minimumVisiblePixels)
        return ((height - y - 1) / height) * 100;
    }
  }
  return 0;
}

function applyGroundOffset(image: HTMLImageElement, percent: number) {
  image
    .closest<HTMLElement>(".galgame-sprite-motion")
    ?.style.setProperty(
      "--galgame-portrait-ground-offset",
      `${Math.max(0, percent)}%`,
    );
}

export function groundPortraitElement(image: HTMLImageElement) {
  const key = image.dataset.fileId || image.currentSrc || image.src;
  const cached = portraitGroundOffsets.get(key);
  if (cached !== undefined) {
    applyGroundOffset(image, cached);
    return;
  }
  if (image.naturalWidth <= 0 || image.naturalHeight <= 0) return;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(
      0,
      0,
      image.naturalWidth,
      image.naturalHeight,
    ).data;
    const percent = portraitTransparentBottomPercent(
      pixels,
      image.naturalWidth,
      image.naturalHeight,
    );
    portraitGroundOffsets.set(key, percent);
    applyGroundOffset(image, percent);
  } catch {
    // A failed pixel read must not hide the portrait. The authored bottom
    // anchor remains the safe fallback for unsupported image sources.
    applyGroundOffset(image, 0);
  }
}
