import {
  lightLeakStrip,
  paintWhipPanCanvas,
} from "./directionalTransitionCanvas";
import { paintSpinBlurCanvas } from "./spinBlurCanvas";
import type { ActiveTimedEffect } from "./timedEffects";

const scratchByCanvas = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
const paddingByCanvas = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();

/** Gaussian blur extends the boundary pixel, matching Pillow's opaque edges. */
function paddedBlurSource(source: HTMLCanvasElement, radius: number) {
  let padded = paddingByCanvas.get(source);
  if (!padded) {
    padded = document.createElement("canvas");
    paddingByCanvas.set(source, padded);
  }
  const pad = Math.ceil(radius * 4) + 2;
  const w = source.width;
  const h = source.height;
  padded.width = w + pad * 2;
  padded.height = h + pad * 2;
  const context = padded.getContext("2d")!;
  context.drawImage(source, pad, pad);
  context.drawImage(source, 0, 0, 1, h, 0, pad, pad, h);
  context.drawImage(source, w - 1, 0, 1, h, pad + w, pad, pad, h);
  context.drawImage(source, 0, 0, w, 1, pad, 0, w, pad);
  context.drawImage(source, 0, h - 1, w, 1, pad, pad + h, w, pad);
  for (const [x, y, dx, dy] of [
    [0, 0, 0, 0],
    [w - 1, 0, pad + w, 0],
    [0, h - 1, 0, pad + h],
    [w - 1, h - 1, pad + w, pad + h],
  ])
    context.drawImage(source, x, y, 1, 1, dx, dy, pad, pad);
  return { padded, pad };
}

/** Clip-only processing before geometry transforms; order and alpha are retained. */
export function paintTimedEffectsCanvas(
  canvas: HTMLCanvasElement,
  effects: ActiveTimedEffect[],
  fittedWidth = canvas.width,
) {
  for (const effect of effects) {
    if (effect.kind === "spin-blur") {
      paintSpinBlurCanvas(
        canvas,
        canvas,
        canvas.width,
        canvas.height,
        effect.amount,
      );
      continue;
    }
    if (effect.kind === "whip-pan") {
      paintWhipPanCanvas(canvas, canvas, canvas.width, canvas.height, {
        amount: effect.amount,
        direction: effect.direction ?? "left",
      });
      continue;
    }
    const context = canvas.getContext("2d");
    if (!context) return;
    if (effect.kind === "flash" || effect.kind === "light-leak") {
      const data = context.getImageData(0, 0, canvas.width, canvas.height);
      const direction = effect.direction ?? "left";
      const horizontal = direction === "left" || direction === "right";
      const strip =
        effect.kind === "light-leak"
          ? lightLeakStrip(horizontal ? canvas.width : canvas.height, {
              progress: effect.progress,
              direction,
            })
          : undefined;
      const alpha = Math.round(230 * effect.amount) / 255;
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          const index = (y * canvas.width + x) * 4;
          for (let c = 0; c < 3; c++) {
            const light = strip
              ? strip[(horizontal ? x : y) * 4 + c] / 255
              : alpha;
            data.data[index + c] = Math.round(
              data.data[index + c] + (255 - data.data[index + c]) * light,
            );
          }
        }
      }
      context.putImageData(data, 0, 0);
      continue;
    }
    let scratch = scratchByCanvas.get(canvas);
    if (!scratch) {
      scratch = document.createElement("canvas");
      scratchByCanvas.set(canvas, scratch);
    }
    scratch.width = canvas.width;
    scratch.height = canvas.height;
    scratch.getContext("2d")?.drawImage(canvas, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.save();
    if (effect.kind === "blur") {
      const radius =
        (Math.round(10 * effect.amount) * canvas.width) / fittedWidth;
      const { padded, pad } = paddedBlurSource(scratch, radius);
      context.filter = `blur(${radius}px)`;
      context.drawImage(padded, -pad, -pad);
    } else if (effect.kind === "zoom") {
      const scale = 1 + 0.22 * effect.amount;
      context.drawImage(
        scratch,
        ((1 - scale) * canvas.width) / 2,
        ((1 - scale) * canvas.height) / 2,
        canvas.width * scale,
        canvas.height * scale,
      );
    }
    context.restore();
  }
}
