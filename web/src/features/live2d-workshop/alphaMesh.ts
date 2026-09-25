import type { Point } from "./types";

/** Keep only cells that intersect painted pixels; UVs still address the full PNG. */
export function meshFromAlpha(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  stride = 4,
) {
  const columns = Math.max(2, Math.min(24, Math.ceil(width / 48)));
  const rows = Math.max(2, Math.min(32, Math.ceil(height / 48)));
  const vertices: Point[] = [];
  const uvs: Point[] = [];
  const triangles: number[] = [];
  const ids = new Map<string, number>();
  const vertex = (x: number, y: number) => {
    const key = `${x}:${y}`;
    const previous = ids.get(key);
    if (previous !== undefined) return previous;
    const index = vertices.length;
    vertices.push({ x: (width * x) / columns, y: (height * y) / rows });
    uvs.push({ x: x / columns, y: y / rows });
    ids.set(key, index);
    return index;
  };
  for (let row = 0; row < rows; row++)
    for (let column = 0; column < columns; column++) {
      const left = Math.floor((width * column) / columns);
      const top = Math.floor((height * row) / rows);
      const right = Math.min(
        width,
        Math.ceil((width * (column + 1)) / columns),
      );
      const bottom = Math.min(height, Math.ceil((height * (row + 1)) / rows));
      let painted = false;
      for (let y = top; y < bottom && !painted; y++)
        for (let x = left; x < right; x++)
          if (alpha[(y * width + x) * stride + stride - 1] > 16) {
            painted = true;
            break;
          }
      if (!painted) continue;
      const a = vertex(column, row);
      const b = vertex(column + 1, row);
      const c = vertex(column, row + 1);
      const d = vertex(column + 1, row + 1);
      triangles.push(a, b, c, b, d, c);
    }
  if (!triangles.length) throw new Error("素材没有可绑定的不透明像素");
  return { vertices, uvs, triangles };
}

export async function meshFromPng(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("无法读取素材透明度");
    context.drawImage(bitmap, 0, 0);
    return meshFromAlpha(
      context.getImageData(0, 0, bitmap.width, bitmap.height).data,
      bitmap.width,
      bitmap.height,
    );
  } finally {
    bitmap.close();
  }
}
