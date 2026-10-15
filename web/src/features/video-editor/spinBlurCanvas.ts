/** Nine angular samples, matching media_rendering/spin_blur.py. */
const scratchByCanvas = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();

export function paintSpinBlurCanvas(
  canvas: HTMLCanvasElement,
  media: CanvasImageSource,
  width: number,
  height: number,
  amount: number,
  crop?: { x: number; y: number; width: number; height: number },
) {
  const ratio = Math.min(1, 960 / width);
  const nextWidth = Math.max(1, Math.round(width * ratio));
  const nextHeight = Math.max(1, Math.round(height * ratio));
  let source = media;
  if (media === canvas) {
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
  if (canvas.width !== nextWidth) canvas.width = nextWidth;
  if (canvas.height !== nextHeight) canvas.height = nextHeight;
  const context = canvas.getContext("2d");
  if (!context) return;
  amount = Math.max(-1, Math.min(1, amount));
  context.clearRect(0, 0, nextWidth, nextHeight);
  context.save();
  context.translate(nextWidth / 2, nextHeight / 2);
  context.globalCompositeOperation = "lighter";
  const samples = Math.abs(amount) < 0.000001 ? 1 : 9;
  context.globalAlpha = 1 / samples;
  for (let index = 0; index < samples; index++) {
    const angle =
      samples === 1
        ? 0
        : (amount * (45 + (index / 8 - 0.5) * 24) * Math.PI) / 180;
    const scale = Math.max(
      Math.abs(Math.cos(angle)) + (height / width) * Math.abs(Math.sin(angle)),
      Math.abs(Math.cos(angle)) + (width / height) * Math.abs(Math.sin(angle)),
    );
    context.save();
    context.rotate(angle);
    context.scale(scale, scale);
    if (crop) {
      context.drawImage(
        source,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        -nextWidth / 2,
        -nextHeight / 2,
        nextWidth,
        nextHeight,
      );
    } else {
      context.drawImage(
        source,
        -nextWidth / 2,
        -nextHeight / 2,
        nextWidth,
        nextHeight,
      );
    }
    context.restore();
  }
  context.restore();
}
