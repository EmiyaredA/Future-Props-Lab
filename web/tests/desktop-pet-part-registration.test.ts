import { expect, test, vi } from "vitest";
import geometry from "./fixtures/desktop-pet-motion-v2.json";
import {
  validatePartRegistrations,
  type RestTransform,
} from "../src/features/desktop-pet/partRegistration";
import {
  bindPoseParts,
  type AuthoredPose,
} from "../src/features/desktop-pet/locomotion/authoredPose";
import { authoredRestSample } from "../src/features/desktop-pet/locomotion/transitions/transitionPlayer";
import {
  jointDeformers,
  type MotionRig,
} from "../src/features/desktop-pet/locomotion/articulation";
import {
  createRig,
  type RigPart,
} from "../src/features/desktop-pet/whale-vendor/rig/rig.js";

const registration: RestTransform = { angle: 90, pivot: [11, 22] };
function resource() {
  const pose = structuredClone(geometry.poses.walk) as AuthoredPose;
  for (const [name, limb] of Object.entries(pose.limbs)) {
    delete limb.part;
    limb.segments = [`${name}_upper`, `${name}_lower`, `${name}_end`];
  }
  const part: RigPart = {
    id: "armNear_upper",
    tex: "atlas",
    box: [10, 20, 4, 6],
    uvBox: [0.1, 0.2, 0.3, 0.5],
    grid: [1, 1],
    parent: "body",
    z: 1,
    restTransform: structuredClone(registration),
  };
  return { part, pose, rig: { version: 2, poses: { walk: pose } } };
}

test("only explicitly declared static registration changes the old package boundary", () => {
  const part = { id: "legacy", futureMetadata: "preserved" };
  for (const rig of [undefined, { version: 1 }, { version: 2 }])
    expect(() => validatePartRegistrations([part], rig)).not.toThrow();
  for (const field of ["mesh", "restAngle"])
    for (const value of [null, {}, 0])
      expect(() =>
        validatePartRegistrations([{ ...part, [field]: value }], undefined),
      ).toThrow("资源包不支持运行时网格");
});

test.each([
  null,
  [],
  { angle: 181, pivot: [0, 0] },
  { angle: -181, pivot: [0, 0] },
  { angle: true, pivot: [0, 0] },
  { angle: NaN, pivot: [0, 0] },
  { angle: Infinity, pivot: [0, 0] },
  { angle: 0, pivot: [0, 513] },
  { angle: 0, pivot: [false, 0] },
  { angle: 0, pivot: [0, Infinity] },
  { angle: 0, pivot: [0] },
  { angle: 0, pivot: [0, 0, 0] },
  { angle: 0 },
  { angle: 0, pivot: [0, 0], scale: 2 },
])("static registration rejects invalid or extra fields %j", (transform) => {
  const { part, rig } = resource();
  expect(() =>
    validatePartRegistrations([{ ...part, restTransform: transform }], rig),
  ).toThrow();
});

test("registration requires a v2 rigid segment, including native inline transition views", () => {
  const { part, pose, rig } = resource();
  expect(() => validatePartRegistrations([part], rig)).not.toThrow();
  for (const value of [undefined, { ...rig, version: 1 }, { version: 2 }])
    expect(() => validatePartRegistrations([part], value)).toThrow();
  for (const id of [pose.part, "head", "whole_limb"])
    expect(() =>
      validatePartRegistrations([{ ...part, id }], rig),
    ).toThrow();
  for (const skin of [[], null, [{ deformer: "armNear", weights: [1] }]])
    expect(() =>
      validatePartRegistrations([{ ...part, skin }], rig),
    ).toThrow();
  // A renderer-owned binder may explicitly clear the skin field after validation.
  expect(() =>
    validatePartRegistrations([{ ...part, skin: undefined }], rig),
  ).not.toThrow();
  expect(() =>
    validatePartRegistrations([part], {
      version: 2,
      poses: {},
      transitions: [{ keyframes: [{ pose }, { pose: structuredClone(pose) }] }],
    }),
  ).not.toThrow();
});

test.each([-180, 0, 180])("registration accepts inclusive finite angle %d", (angle) => {
  const { part, rig } = resource();
  expect(() =>
    validatePartRegistrations(
      [{ ...part, restTransform: { angle, pivot: [-512, 512] } }],
      rig,
    ),
  ).not.toThrow();
});

test("real binder and GPU rest vertices preserve uniform registration and UV before zero-angle FK", () => {
  const { part, pose, rig: declaration } = resource();
  validatePartRegistrations([part], declaration);
  const bound = bindPoseParts([part], { walk: pose });
  expect(bound[0].parent).toBe("armNear");
  expect(bound[0].restTransform).toEqual(registration);
  const methods = new Map<string, ReturnType<typeof vi.fn>>();
  const gl = new Proxy(
    {},
    {
      get: (_, key) => {
        const name = String(key);
        if (!methods.has(name))
          methods.set(
            name,
            vi.fn(() =>
              name === "getShaderParameter" || name === "getProgramParameter"
                ? true
                : {},
            ),
          );
        return methods.get(name);
      },
    },
  );
  const motionRig: MotionRig = {
    version: 2,
    hiddenParts: [],
    limbs: Object.fromEntries(
      Object.entries(pose.limbs).map(([name, limb]) => [
        name,
        { ...limb, parts: limb.segments },
      ]),
    ) as MotionRig["limbs"],
  };
  const renderer = createRig(
    { width: 256, height: 256, getContext: () => gl } as unknown as HTMLCanvasElement,
    {
      parts: bound,
      view: [0, 0, 256, 256],
      deformers: {
        body: { kind: "rot", pivot: pose.waist },
        ...jointDeformers(motionRig),
      },
    },
  );
  renderer.upload(part.tex, {} as TexImageSource);
  renderer.render(authoredRestSample(pose, "walk", "walk", 1).state);
  const vertices = methods.get("bufferSubData")!.mock.calls[0][2] as Float32Array;
  // Source rectangle rotated 90 degrees around [11,22], with no animated compensation.
  const expected = [13, 21, 13, 25, 7, 21, 7, 25];
  expect([...vertices]).toEqual(expected);
  const uv = methods.get("bufferData")!.mock.calls.find(
    (call) => call[1] instanceof Float32Array,
  )![1] as Float32Array;
  expect([...uv]).toEqual([0.1, 0.2, 0.3, 0.2, 0.1, 0.5, 0.3, 0.5].map(Math.fround));
  expect(part.box).toEqual([10, 20, 4, 6]);
  expect(pose.limbs.armNear.root).toEqual(geometry.poses.walk.limbs.armNear.root);
});
