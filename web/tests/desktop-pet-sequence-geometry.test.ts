import { afterEach, describe, expect, it, vi } from "vitest";
import { figureGeometry } from "@features/desktop-pet/locomotion/measure";

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
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    (() => ({
      drawImage,
      getImageData: () => ({ data: pixels }),
    })) as unknown as HTMLCanvasElement["getContext"],
  );
  return { group, objects, drawImage };
}

describe("whole sequence painted geometry", () => {
  it("measures the active complete cel instead of the hidden original rig", () => {
    const { group, objects, drawImage } = stage();
    const geometry = figureGeometry(group);
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
    expect(figureGeometry(group)).not.toBeNull();
    expect(drawImage.mock.calls[0][0]).toBe(objects[0].canvas);
  });

  it("provides all host-required planes without advertising missing painted supports", () => {
    const { group } = stage();
    group.setAttribute("data-pet-edges", JSON.stringify({ bottom: [45, 125] }));
    group.setAttribute("data-pet-supported-edges", "bottom");
    const geometry = figureGeometry(group)!;
    expect(geometry.edges).toEqual({
      left: { x: 152.5, y: 340 },
      right: { x: 177.5, y: 340 },
      top: { x: 190, y: 300 },
      bottom: { x: 190, y: 450 },
    });
    expect(geometry.supportedEdges).toEqual(["bottom"]);
    expect(geometry.feet).toEqual({ x: 190, y: 450 });
  });
});
