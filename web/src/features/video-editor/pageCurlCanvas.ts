/** Cylindrical paper roll, matching media_rendering/local/page_curl.py. */
export type PageCurlEffect = { progress: number; direction: "left" | "right" };

export function pageCurlPixels(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  effect: PageCurlEffect,
) {
  const p = Math.max(0, Math.min(1, effect.progress));
  if (p === 0) return source.slice();
  const pixels = new Uint8ClampedArray(source.length);
  if (p === 1) return pixels;
  const envelope = Math.sin(Math.PI * p);
  const radius = 0.16 * envelope;
  const fold = 1.1 - 1.2 * p;
  const shadowWidth = 0.045 * envelope;
  const paper = [248, 245, 235];
  const mirror = effect.direction === "right";
  const column = (u: number) =>
    Math.max(0, Math.min(width - 1, Math.floor((mirror ? 1 - u : u) * width)));
  for (let y = 0; y < height; y++) {
    const tilt = 0.2 * ((y + 0.5) / height - 0.5);
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      const i = row + x * 4;
      const u = mirror ? 1 - (x + 0.5) / width : (x + 0.5) / width;
      const distance = u + tilt - fold;
      if (distance < 0) {
        pixels[i] = source[i];
        pixels[i + 1] = source[i + 1];
        pixels[i + 2] = source[i + 2];
        pixels[i + 3] = source[i + 3];
      } else if (distance <= radius) {
        const z = Math.max(0, Math.min(1, distance / radius));
        const angle = Math.asin(z);
        const backU = fold + radius * (Math.PI - angle) - tilt;
        const back = backU >= 0 && backU < 1;
        const sampleU = back ? backU : fold + radius * angle - tilt;
        if (sampleU < 0 || sampleU >= 1) continue;
        const sample = row + column(sampleU) * 4;
        const shade =
          0.7 +
          0.3 * Math.sqrt(1 - z * z) +
          0.08 * Math.exp(-(((z - 0.82) / 0.12) ** 2));
        for (let c = 0; c < 3; c++) {
          const color = back
            ? source[sample + c] * 0.18 + paper[c] * 0.82
            : source[sample + c];
          pixels[i + c] = Math.floor(Math.min(255, color * shade) + 0.5);
        }
        pixels[i + 3] = source[sample + 3];
      } else if (distance < radius + shadowWidth) {
        const crestU = fold + (radius * Math.PI) / 2 - tilt;
        if (crestU < 0 || crestU >= 1) continue;
        const strength =
          0.22 * envelope * (1 - (distance - radius) / shadowWidth) ** 2;
        pixels[i + 3] = Math.floor(
          source[row + column(crestU) * 4 + 3] * strength + 0.5,
        );
      }
    }
  }
  return pixels;
}

/** Operates on the already cropped/effected frame, with no extra media loads. */
export function paintPageCurlCanvas(
  canvas: HTMLCanvasElement,
  effect: PageCurlEffect,
) {
  const context = canvas.getContext("2d");
  if (!context || !canvas.width || !canvas.height) return;
  const frame = context.getImageData(0, 0, canvas.width, canvas.height);
  frame.data.set(
    pageCurlPixels(frame.data, canvas.width, canvas.height, effect),
  );
  context.putImageData(frame, 0, 0);
}

/** Keep the requested direction in canvas space when a clip is horizontally flipped. */
export function pageCurlForClip(
  effect: PageCurlEffect | undefined,
  flipX: boolean,
) {
  return effect && flipX
    ? {
        ...effect,
        direction:
          effect.direction === "left" ? ("right" as const) : ("left" as const),
      }
    : effect;
}
