import type { PosedPart } from "./pose";
import type { Camera } from "./types";

function affine(source: number[][], target: number[][]) {
  const [[x1, y1], [x2, y2], [x3, y3]] = source;
  const determinant = x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2);
  if (Math.abs(determinant) < 1e-8) return null;
  const solve = (axis: number) => {
    const [z1, z2, z3] = target.map((point) => point[axis]);
    return [
      (z1 * (y2 - y3) + z2 * (y3 - y1) + z3 * (y1 - y2)) / determinant,
      (z1 * (x3 - x2) + z2 * (x1 - x3) + z3 * (x2 - x1)) / determinant,
      (z1 * (x2 * y3 - x3 * y2) + z2 * (x3 * y1 - x1 * y3)) / determinant,
    ];
  };
  const [a, c, e] = solve(0);
  const [b, d, f] = solve(1);
  return [a, b, c, d, e, f] as const;
}

export async function renderStaticPose(
  parts: PosedPart[],
  urls: Map<string, string>,
  camera: Camera,
  width: number,
  height: number,
): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建备用画布");
  const images = new Map<string, HTMLImageElement>();
  await Promise.all(
    [...urls].map(async ([id, url]) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      images.set(id, image);
    }),
  );
  const rendered = new Map<string, HTMLCanvasElement>();
  for (const part of parts) {
    const image = images.get(part.assetId);
    if (!image) continue;
    const layer = document.createElement("canvas");
    layer.width = width;
    layer.height = height;
    const layerCtx = layer.getContext("2d");
    if (!layerCtx) continue;
    for (let offset = 0; offset < part.triangles.length; offset += 3) {
      const ids = part.triangles.slice(offset, offset + 3);
      const source = ids.map((id) => [
        part.uvs[id].x * image.width,
        part.uvs[id].y * image.height,
      ]);
      const target = ids.map((id) => [
        ((part.worldVertices[id].x - camera.x) * width) / camera.width,
        ((part.worldVertices[id].y - camera.y) * height) / camera.height,
      ]);
      const transform = affine(source, target);
      if (!transform) continue;
      layerCtx.save();
      layerCtx.beginPath();
      layerCtx.moveTo(target[0][0], target[0][1]);
      layerCtx.lineTo(target[1][0], target[1][1]);
      layerCtx.lineTo(target[2][0], target[2][1]);
      layerCtx.closePath();
      layerCtx.clip();
      layerCtx.setTransform(...transform);
      layerCtx.drawImage(image, 0, 0);
      layerCtx.restore();
    }
    if (part.maskId && rendered.has(part.maskId)) {
      layerCtx.globalCompositeOperation = "destination-in";
      layerCtx.drawImage(rendered.get(part.maskId)!, 0, 0);
    }
    rendered.set(part.id, layer);
    if (part.visible && part.opacity > 0) {
      ctx.globalAlpha = part.opacity;
      ctx.drawImage(layer, 0, 0);
      ctx.globalAlpha = 1;
    }
  }
  return canvas.toDataURL("image/png");
}
