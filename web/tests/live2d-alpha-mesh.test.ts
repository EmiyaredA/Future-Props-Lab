import { describe, expect, it } from "vitest";
import { meshFromAlpha } from "../src/features/live2d-workshop/alphaMesh";

describe("transparent layer mesh", () => {
  it("keeps painted cells and omits clear cells while preserving full-image UVs", () => {
    const rgba = new Uint8ClampedArray(8 * 8 * 4);
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) rgba[(y * 8 + x) * 4 + 3] = 255;
    const mesh = meshFromAlpha(rgba, 8, 8);
    expect(mesh.triangles).toHaveLength(6);
    expect(mesh.vertices).toHaveLength(4);
    expect(mesh.uvs).toContainEqual({ x: 0.5, y: 0.5 });
    expect(Math.max(...mesh.triangles)).toBeLessThan(mesh.vertices.length);
  });

  it("rejects a layer with no painted pixels", () => {
    expect(() => meshFromAlpha(new Uint8ClampedArray(8 * 8 * 4), 8, 8)).toThrow(
      "素材没有可绑定的不透明像素",
    );
  });
});
