import { describe, expect, test } from "vitest";
import { portraitTransparentBottomPercent } from "@features/galgame-workshop/editor/portraitGrounding";

function rgba(width: number, height: number, alphaRows: number[][]) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  alphaRows.forEach((row, y) =>
    row.forEach((alpha, x) => {
      pixels[(y * width + x) * 4 + 3] = alpha;
    }),
  );
  return pixels;
}

describe("portrait grounding", () => {
  test("moves transparent bottom padding below the stage floor", () => {
    const pixels = rgba(2, 4, [
      [255, 255],
      [255, 255],
      [0, 0],
      [0, 0],
    ]);
    expect(portraitTransparentBottomPercent(pixels, 2, 4)).toBe(50);
  });

  test("does not move a portrait whose visible pixels already reach the bottom", () => {
    const pixels = rgba(2, 2, [
      [255, 255],
      [255, 255],
    ]);
    expect(portraitTransparentBottomPercent(pixels, 2, 2)).toBe(0);
  });

  test("ignores near-transparent noise and isolated bottom specks", () => {
    const width = 1000;
    const pixels = rgba(width, 3, [
      Array(width).fill(255),
      [255, 255, ...Array(width - 2).fill(0)],
      [255, ...Array(width - 1).fill(7)],
    ]);
    expect(portraitTransparentBottomPercent(pixels, width, 3)).toBeCloseTo(
      100 / 3,
    );
  });
});
