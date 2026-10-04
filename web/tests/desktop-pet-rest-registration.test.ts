import { describe, expect, it } from "vitest";
import {
  createRig,
  type RigPart,
  type RigState,
} from "../src/features/desktop-pet/whale-vendor/rig/rig.js";

function renderer(part: RigPart) {
  const uploaded: number[][] = [];
  const vertices: number[][] = [];
  const gl = new Proxy(
    {},
    {
      get: (_, key) => {
        if (key === "getShaderParameter" || key === "getProgramParameter")
          return () => true;
        if (key === "bufferSubData")
          return (_target: unknown, _offset: unknown, data: Float32Array) =>
            vertices.push(Array.from(data));
        if (key === "bufferData")
          return (_target: unknown, data: unknown) => {
            if (data instanceof Float32Array) uploaded.push(Array.from(data));
          };
        return () => ({});
      },
    },
  );
  const rig = createRig(
    {
      width: 256,
      height: 256,
      getContext: () => gl,
    } as unknown as HTMLCanvasElement,
    {
      view: [0, 0, 256, 256],
      parts: [part],
      deformers: {
        body: { kind: "rot", pivot: [0, 0] },
        upper: { kind: "rot", pivot: [5, 6], parent: "body" },
      },
    },
  );
  rig.upload("fabric", document.createElement("canvas"));
  return { rig, uploaded, vertices };
}

const part: RigPart = {
  id: "upper",
  tex: "fabric",
  parent: "upper",
  box: [5, 6, 4, 10],
  grid: [1, 1],
  z: 1,
  uvBox: [0.2, 0.3, 0.5, 0.9],
};
const state = (angle = 0): RigState => ({
  body: { tx: -2, ty: 3 },
  upper: { a: angle },
  alpha: {},
});

describe("painted rigid part registration in the actual renderer", () => {
  it("registers source artwork before FK, keeping UVs and bone lengths intact", () => {
    const { rig, uploaded, vertices } = renderer({
      ...part,
      restTransform: {
        angle: (-Math.atan2(6, 8) * 180) / Math.PI,
        pivot: [5, 6],
      },
    });
    rig.render(state());
    // The source ten-unit axis lands on the declared physical axis [6,8].
    expect(vertices[0].slice(4, 6)).toEqual([9, 17]);
    expect(
      Math.hypot(
        vertices[0][4] - vertices[0][0],
        vertices[0][5] - vertices[0][1],
      ),
    ).toBeCloseTo(10, 6);
    expect(uploaded[0]).toEqual(
      expect.arrayContaining([expect.closeTo(0.2), expect.closeTo(0.9)]),
    );
    rig.render(state(90));
    const expectedContact = rig.point("upper", state(90), 11, 14);
    expect(vertices[1][4]).toBeCloseTo(expectedContact[0], 6);
    expect(vertices[1][5]).toBeCloseTo(expectedContact[1], 6);
    expect(expectedContact).toEqual([-5, 15]);
    rig.render(state());
    expect(vertices[2]).toEqual(vertices[0]);
  });

  it("retains the original unregistered vertex path", () => {
    const { rig, vertices } = renderer(part);
    rig.render({ alpha: {} });
    expect(vertices[0]).toEqual([5, 6, 9, 6, 5, 16, 9, 16]);
    expect(part.box).toEqual([5, 6, 4, 10]);
  });

  it.each([
    { angle: Number.NaN, pivot: [5, 6] },
    { angle: 181, pivot: [5, 6] },
    { angle: 10, pivot: [5, 513] },
  ])("rejects invalid registration before drawing: %j", (restTransform) => {
    expect(() =>
      renderer({
        ...part,
        restTransform: restTransform as RigPart["restTransform"],
      }),
    ).toThrow("Invalid rigid part registration");
  });

  it("does not silently rotate already skinned geometry", () => {
    expect(() =>
      renderer({
        ...part,
        skin: [{ deformer: "upper", weights: [1, 1, 1, 1] }],
        restTransform: { angle: 15, pivot: [5, 6] },
      }),
    ).toThrow("Invalid rigid part registration");
  });
});
