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
  const dominant = target.indexOf(Math.max(...target));
  const others = [0, 1, 2].filter((channel) => channel !== dominant);
  const threshold = (key.similarity ?? 42) * 1.275;
  const softness = Math.max(1, (key.softness ?? 18) * 0.51);
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
    const excess = Math.max(
      0,
      pixels[index + dominant]! -
        Math.max(pixels[index + others[0]!]!, pixels[index + others[1]!]!),
    );
    pixels[index + dominant] = Math.max(
      0,
      pixels[index + dominant]! -
        (excess * (1 - matte) * (key.despill ?? 30)) / 100,
    );
    pixels[index + 3] = Math.round(pixels[index + 3]! * matte);
  }
  context.putImageData(frame, 0, 0);
}
