import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFigureGeometrySampler } from "@features/desktop-pet/locomotion/measure";

let sampler: ReturnType<typeof createFigureGeometrySampler>;
beforeEach(() => {
  sampler = createFigureGeometrySampler();
});

const NS = "http://www.w3.org/2000/svg";
class Point {
  constructor(
    public x = 0,
    public y = 0,
  ) {}
  matrixTransform(matrix: { a: number; d: number; e: number; f: number }) {
    return new Point(
      this.x * matrix.a + matrix.e,
      this.y * matrix.d + matrix.f,
    );
  }
}
afterEach(() => {
  sampler.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stage(active = true) {
  vi.stubGlobal("DOMPoint", Point);
  const matrix = { a: 2, d: 2, e: 100, f: 200 };
  const group = document.createElementNS(NS, "g");
  Object.assign(group, { getScreenCTM: () => matrix });
  const objects = [0, 1].map(() => {
    const object = document.createElementNS(NS, "foreignObject");
    Object.assign(object, {
      x: { baseVal: { value: 20 } },
      y: { baseVal: { value: 30 } },
      width: { baseVal: { value: 50 } },
      height: { baseVal: { value: 100 } },
      getScreenCTM: () => matrix,
    });
    const canvas = document.createElement("canvas");
    object.append(canvas);
    group.append(object);
    return { object, canvas };
  });
  if (active) {
    objects[0].object.style.display = "none";
    objects[0].canvas.dataset.petRasterActive = "false";
    objects[1].canvas.dataset.petRasterActive = "true";
  }
  const pixels = new Uint8ClampedArray(80 * 100 * 4);
  for (let y = 20; y < 60; y++)
    for (let x = 10; x < 30; x++) pixels[(80 * y + x) * 4 + 3] = 255;
  const drawImage = vi.fn();
  const clearRect = vi.fn();
  const getContext = vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockImplementation((() => ({
      clearRect,
      drawImage,
      getImageData: () => ({ data: pixels }),
    })) as unknown as HTMLCanvasElement["getContext"]);
  return { group, objects, drawImage, clearRect, getContext, pixels, matrix };
}

describe("whole sequence painted geometry", () => {
  it("allocates lazily and reuses one readback surface while clearing before every draw", () => {
    const { group, clearRect, drawImage, getContext } = stage();
    const empty = document.createElementNS(NS, "g");
    expect(sampler.measure(empty)).toBeNull();
    expect(getContext).not.toHaveBeenCalled();
    for (let i = 0; i < 100; i++) expect(sampler.measure(group)).not.toBeNull();
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(getContext).toHaveBeenCalledWith("2d", { willReadFrequently: true });
    expect(clearRect).toHaveBeenCalledTimes(100);
    expect(clearRect).toHaveBeenCalledWith(0, 0, 80, 100);
    for (let i = 0; i < 100; i++)
      expect(clearRect.mock.invocationCallOrder[i]).toBeLessThan(
        drawImage.mock.invocationCallOrder[i],
      );
  });

  it("resamples changing alpha and transforms rather than retaining stale bounds", () => {
    const { group, pixels, matrix, getContext } = stage();
    expect(sampler.measure(group)?.visible.x).toBe(152.5);
    matrix.e = -300;
    expect(sampler.measure(group)?.visible.x).toBe(-247.5);
    pixels.fill(0);
    expect(sampler.measure(group)).toBeNull();
    pixels[(80 * 35 + 22) * 4 + 3] = 255;
    expect(sampler.measure(group)?.visible).toEqual({
      x: -232.5,
      y: 330,
      width: 1.25,
      height: 2,
    });
    expect(getContext).toHaveBeenCalledTimes(1);
  });

  it("owns separate surfaces for simultaneous renderers and releases backing memory", () => {
    const { group, getContext } = stage();
    const other = createFigureGeometrySampler();
    try {
      sampler.measure(group);
      other.measure(group);
      const first = getContext.mock.contexts[0] as HTMLCanvasElement;
      const second = getContext.mock.contexts[1] as HTMLCanvasElement;
      expect(first).not.toBe(second);
      expect([first.width, first.height]).toEqual([80, 100]);
      expect([second.width, second.height]).toEqual([80, 100]);
      sampler.dispose();
      expect([first.width, first.height]).toEqual([0, 0]);
      expect([second.width, second.height]).toEqual([80, 100]);
      // React development effect teardown/remount can reuse the owner safely.
      expect(sampler.measure(group)).not.toBeNull();
      expect(getContext.mock.contexts[2]).not.toBe(first);
      expect(getContext).toHaveBeenCalledTimes(3);
    } finally {
      other.dispose();
    }
  });

  it("reuses the sampler after replacing the currently painted raster", () => {
    const { group, objects, drawImage, getContext } = stage();
    sampler.measure(group);
    objects[1].canvas.dataset.petRasterActive = "false";
    objects[0].canvas.dataset.petRasterActive = "true";
    expect(sampler.measure(group)).not.toBeNull();
    expect(drawImage.mock.calls[1][0]).toBe(objects[0].canvas);
    expect(getContext).toHaveBeenCalledTimes(1);
  });

  it("measures the active complete cel instead of the hidden original rig", () => {
    const { group, objects, drawImage } = stage();
    const geometry = sampler.measure(group);
    expect(drawImage).toHaveBeenCalledWith(objects[1].canvas, 0, 0, 80, 100);
    expect(geometry?.visible).toEqual({
      x: 152.5,
      y: 300,
      width: 25,
      height: 80,
    });
  });

  it("keeps legacy rigs measurable without the complete cel marker", () => {
    const { group, objects, drawImage } = stage(false);
    expect(sampler.measure(group)).not.toBeNull();
    expect(drawImage.mock.calls[0][0]).toBe(objects[0].canvas);
  });

  it("provides all host-required planes without advertising missing painted supports", () => {
    const { group } = stage();
    group.setAttribute("data-pet-edges", JSON.stringify({ bottom: [45, 125] }));
    group.setAttribute("data-pet-supported-edges", "bottom");
    const geometry = sampler.measure(group)!;
    expect(geometry.edges).toEqual({
      left: { x: 152.5, y: 340 },
      right: { x: 177.5, y: 340 },
      top: { x: 190, y: 300 },
      bottom: { x: 190, y: 450 },
    });
    expect(geometry.supportedEdges).toEqual(["bottom"]);
    expect(geometry.feet).toEqual({ x: 190, y: 450 });
  });

  it.each(["left", "right"] as const)(
    "reflects a partial %s contact and its supported side without overwriting a fallback",
    (side) => {
      const { group, matrix } = stage();
      matrix.a = -2;
      group.setAttribute(
        "data-pet-edges",
        JSON.stringify({ [side]: [10, 45], bottom: [42, 92] }),
      );
      group.setAttribute("data-pet-supported-edges", `${side},bottom`);
      const geometry = sampler.measure(group)!;
      const mirrored = side === "left" ? "right" : "left";
      expect(Object.keys(geometry.edges!).sort()).toEqual([
        "bottom",
        "left",
        "right",
        "top",
      ]);
      expect(geometry.edges![mirrored]).toEqual({ x: 80, y: 290 });
      expect(geometry.edges![side]).toEqual({
        x: side === "left" ? 22.5 : 47.5,
        y: 340,
      });
      expect(geometry.supportedEdges).toEqual([mirrored, "bottom"]);
      expect(geometry.edges!.bottom).toEqual({ x: 16, y: 384 });
      expect(geometry.feet).toEqual({ x: 16, y: 384 });
    },
  );
});
