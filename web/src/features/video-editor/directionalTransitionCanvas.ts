import type { VideoEditorTransition } from "./types";

export type TransitionDirection = Extract<
  VideoEditorTransition["direction"],
  "left" | "right" | "up" | "down"
>;
export type WhipPanEffect = { amount: number; direction: TransitionDirection };
export type LightLeakEffect = {
  progress: number;
  direction: TransitionDirection;
};

const scratchByCanvas = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();

/** Same nine translated samples and boundary extension as directional_transitions.py. */
export function paintWhipPanCanvas(
  canvas: HTMLCanvasElement,
  media: CanvasImageSource,
  width: number,
  height: number,
  effect: WhipPanEffect,
  crop?: { x: number; y: number; width: number; height: number },
) {
  let source = media;
  if (source === canvas) {
    let scratch = scratchByCanvas.get(canvas);
    if (!scratch) {
      scratch = document.createElement("canvas");
      scratchByCanvas.set(canvas, scratch);
    }
    if (scratch.width !== canvas.width) scratch.width = canvas.width;
    if (scratch.height !== canvas.height) scratch.height = canvas.height;
    const context = scratch.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, scratch.width, scratch.height);
    context.drawImage(canvas, 0, 0);
    source = scratch;
  }
  const ratio = Math.min(1, 960 / width);
  const w = Math.max(1, Math.round(width * ratio));
  const h = Math.max(1, Math.round(height * ratio));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const context = canvas.getContext("2d");
  if (!context) return;
  const area = crop ?? { x: 0, y: 0, width, height };
  const amount = Math.max(-1, Math.min(1, effect.amount));
  const horizontal =
    effect.direction === "left" || effect.direction === "right";
  const sign =
    effect.direction === "left" || effect.direction === "up" ? -1 : 1;
  const length = horizontal ? w : h;
  const count = Math.abs(amount) < 0.000001 ? 1 : 9;
  context.clearRect(0, 0, w, h);
  context.save();
  context.globalCompositeOperation = "lighter";
  context.globalAlpha = 1 / count;
  for (let i = 0; i < count; i++) {
    const shift =
      count === 1
        ? 0
        : Math.floor(
            sign *
              length *
              (amount * 0.3 + Math.abs(amount) * 0.16 * (i / 8 - 0.5)) +
              0.5,
          );
    context.drawImage(
      source,
      area.x,
      area.y,
      area.width,
      area.height,
      horizontal ? shift : 0,
      horizontal ? 0 : shift,
      w,
      h,
    );
    if (horizontal && shift) {
      const pixel = area.width / w;
      context.drawImage(
        source,
        shift > 0 ? area.x : area.x + area.width - pixel,
        area.y,
        pixel,
        area.height,
        shift > 0 ? 0 : w + shift,
        0,
        Math.abs(shift),
        h,
      );
    } else if (shift) {
      const pixel = area.height / h;
      context.drawImage(
        source,
        area.x,
        shift > 0 ? area.y : area.y + area.height - pixel,
        area.width,
        pixel,
        0,
        shift > 0 ? 0 : h + shift,
        w,
        Math.abs(shift),
      );
    }
  }
  context.restore();
}

/** One RGB illumination strip, identical to the Pillow screen-blend recipe. */
export function lightLeakStrip(length: number, effect: LightLeakEffect) {
  const progress = Math.max(0, Math.min(1, effect.progress));
  const envelope = Math.sin(Math.PI * progress);
  const center = -0.55 + 2.1 * progress;
  const reversed = effect.direction === "left" || effect.direction === "up";
  const pixels = new Uint8ClampedArray(length * 4);
  for (let i = 0; i < length; i++) {
    const u = (i + 0.5) / length;
    const distance = (reversed ? 1 - u : u) - center;
    const bloom = Math.exp(-0.5 * (distance / 0.28) ** 2) * envelope;
    const core = Math.exp(-0.5 * (distance / 0.1) ** 2) * envelope;
    const colors = [
      0.86 * bloom + 0.3 * core,
      0.95 * bloom + 0.25 * core,
      0.38 * bloom + 0.7 * core,
    ];
    colors.forEach((value, channel) => {
      pixels[i * 4 + channel] = Math.floor(
        Math.max(0, Math.min(1, value)) * 255 + 0.5,
      );
    });
    pixels[i * 4 + 3] = 255;
  }
  return pixels;
}
