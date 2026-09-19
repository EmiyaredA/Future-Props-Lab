import type { VideoEditorClip } from "./types";

type ChromaKey = NonNullable<VideoEditorClip["chromaKey"]>;

export function paintChromaCanvas(
  canvas: HTMLCanvasElement,
  media: CanvasImageSource,
  width: number,
  height: number,
  key: ChromaKey,
) {
  const scale = Math.min(1, 960 / width);
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return;
  context.drawImage(media, 0, 0, canvas.width, canvas.height);
  const frame = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = frame.data;
  const target = [1, 3, 5].map((start) =>
    parseInt(key.color!.slice(start, start + 2), 16),
  );
  const threshold = (key.similarity ?? 42) * 1.275;
  const softness = Math.max(1, (key.softness ?? 18) * 0.51);
  const matteValues = new Uint8Array(canvas.width * canvas.height);
  for (let index = 0; index < pixels.length; index += 4) {
    const distance =
      Math.floor(Math.abs(pixels[index]! - target[0]!) / 3) +
      Math.floor(Math.abs(pixels[index + 1]! - target[1]!) / 3) +
      Math.floor(Math.abs(pixels[index + 2]! - target[2]!) / 3);
    const progress = Math.max(
      0,
      Math.min(1, (distance - threshold) / softness),
    );
    const matte = progress * progress * (3 - 2 * progress);
    matteValues[index / 4] = Math.round(matte * 255);
  }
  const high = Math.max(...target);
  const despill = (key.despill ?? 30) / 100;
  for (let pixel = 0; pixel < matteValues.length; pixel++) {
    const index = pixel * 4;
    const matte = matteValues[pixel]!;
    let screen = 0;
    if (despill && matte) {
      screen = 255;
      for (let channel = 0; channel < 3; channel++) {
        const value = target[channel]!;
        const sample = pixels[index + channel]!;
        const bound =
          value >= high - 16 && value
            ? Math.min(255, Math.round((sample * 255) / value))
            : value < 255
              ? Math.min(255, Math.round(((255 - sample) * 255) / (255 - value)))
              : 255;
        screen = Math.min(screen, bound);
      }
      if (screen) {
        const x = pixel % canvas.width;
        const y = Math.floor(pixel / canvas.width);
        let nearBackground = false;
        for (let dy = -2; dy <= 2 && !nearBackground; dy++) {
          const neighborY = y + dy;
          if (neighborY < 0 || neighborY >= canvas.height) continue;
          for (let dx = -2; dx <= 2; dx++) {
            const neighborX = x + dx;
            if (
              neighborX >= 0 &&
              neighborX < canvas.width &&
              matteValues[neighborY * canvas.width + neighborX] === 0
            ) {
              nearBackground = true;
              break;
            }
          }
        }
        if (nearBackground) {
          screen = Math.min(254, Math.round(screen * despill));
          for (let channel = 0; channel < 3; channel++) {
            pixels[index + channel] =
              ((pixels[index + channel]! - (screen * target[channel]!) / 255) *
                255) /
              (255 - screen);
          }
        } else screen = 0;
      }
    }
    pixels[index + 3] = Math.round(
      (pixels[index + 3]! * Math.min(matte, 255 - screen)) / 255,
    );
  }
  context.putImageData(frame, 0, 0);
}
