import { describe, expect, test } from "vitest";
import {
  drawCrop,
  fitCrop,
  pixelCrop,
  resizeCrop,
  type CropSide,
} from "@features/visual-workshop/canvas/imageCropGeometry";
import { derivedImageNode } from "@features/visual-workshop/canvas/derivedImageNode";
import type { ManagedFile } from "@features/files";
import type { VisualCanvasNode } from "@features/visual-workshop/api";

describe("crop coordinates in original pixels", () => {
  test("drawing past the top-left corner never creates an empty selection", () => {
    for (const ratio of [null, 1, 16 / 9, 9 / 16]) {
      const rect = drawCrop(
        { x: 0, y: 0 },
        { x: -100, y: -100 },
        { width: 800, height: 600 },
        ratio,
      );
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.height).toBeGreaterThan(0);
      expect(rect.x).toBe(0);
      expect(rect.y).toBe(0);
    }
  });
  for (const size of [
    { width: 843, height: 1200 },
    { width: 1600, height: 900 },
    { width: 1, height: 1 },
  ]) {
    for (const ratio of [null, 1, 16 / 9, 9 / 16, 4 / 3, 3 / 4]) {
      test(`${size.width} × ${size.height}, ratio ${ratio}`, () => {
        const base = fitCrop(size, ratio);
        const sides: CropSide[] = [
          "move",
          "nw",
          "n",
          "ne",
          "e",
          "se",
          "s",
          "sw",
          "w",
        ];
        for (const side of sides)
          for (const delta of [-10000, -40, 0, 40, 10000]) {
            const next = resizeCrop(base, size, side, delta, -delta, ratio);
            expect(next.x).toBeGreaterThanOrEqual(-1e-9);
            expect(next.y).toBeGreaterThanOrEqual(-1e-9);
            expect(next.x + next.width).toBeLessThanOrEqual(size.width + 1e-9);
            expect(next.y + next.height).toBeLessThanOrEqual(
              size.height + 1e-9,
            );
            if (ratio) expect(next.width / next.height).toBeCloseTo(ratio);
            const pixels = pixelCrop(next, size);
            expect(pixels.width).toBeGreaterThanOrEqual(1);
            expect(pixels.height).toBeGreaterThanOrEqual(1);
            expect(pixels.x + pixels.width).toBeLessThanOrEqual(size.width);
            expect(pixels.y + pixels.height).toBeLessThanOrEqual(size.height);
          }
      });
    }
  }
  test("draws backwards, constrains a ratio and rounds both pixel edges", () => {
    const size = { width: 1000, height: 600 };
    expect(
      drawCrop({ x: 800, y: 500 }, { x: 400, y: 200 }, size, null),
    ).toEqual({ x: 400, y: 200, width: 400, height: 300 });
    const square = drawCrop({ x: 800, y: 500 }, { x: 1400, y: 1000 }, size, 1);
    expect(square).toEqual({ x: 800, y: 500, width: 100, height: 100 });
    expect(
      pixelCrop({ x: 100.6, y: 200.2, width: 300.8, height: 120.6 }, size),
    ).toEqual({ x: 101, y: 200, width: 300, height: 121 });
  });
});

test("derived images retain their source, avoid occupied positions and reuse their retry identity", () => {
  const source: VisualCanvasNode = {
    id: "source",
    kind: "image",
    title: "原图",
    position: { x: 100, y: 100 },
    asset_id: "original",
    generation_task_id: "task",
  };
  const asset = { id: "cropped", display_name: "原图-裁剪" } as ManagedFile;
  const first = derivedImageNode([source], source.id, asset);
  expect(first).toEqual({
    id: "derived-image-cropped",
    kind: "image",
    title: "原图-裁剪",
    position: { x: 468, y: 100 },
    asset_id: "cropped",
  });
  expect(derivedImageNode([source, first], source.id, asset)).toBe(first);
  const second = derivedImageNode([source, first], source.id, {
    ...asset,
    id: "second",
  });
  expect(second.position).toEqual({ x: 468, y: 346 });
  expect(source.asset_id).toBe("original");
  expect(() => derivedImageNode([], source.id, asset)).toThrow(
    "源节点已不存在",
  );
});
