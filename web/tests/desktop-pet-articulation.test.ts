import { describe, expect, test } from "vitest";
import {
  Articulation,
  jointDeformers,
  solveLimb,
  type MotionRig,
} from "../src/features/desktop-pet/locomotion/articulation";
import { createRig } from "../src/features/desktop-pet/whale-vendor/rig/rig.js";
import {
  demoMotion,
  type MotionDemo,
} from "../src/features/desktop-pet/locomotion/demo";
import { whaleMotionRig } from "../src/features/desktop-pet/locomotion/whaleRig";
import { motionPhases } from "../src/features/desktop-pet/locomotion/phases";

const model: MotionRig = {
  version: 1,
  waist: [128, 188],
  hiddenParts: ["old"],
  limbs: {
    armNear: {
      root: [96.365, 152.585],
      joint: [88, 170],
      end: [79, 186],
      parts: ["an", "al", "ah"],
    },
    armFar: {
      root: [146.5, 154.25],
      joint: [157, 171],
      end: [169, 188],
      parts: ["bn", "bl", "bh"],
    },
    legBack: {
      root: [112.275, 188.105],
      joint: [110.5, 218],
      end: [109.5, 243],
      parts: ["ln", "ll", "lf"],
    },
    legFront: {
      root: [133.735, 188.105],
      joint: [135, 218],
      end: [135.5, 242],
      parts: ["rn", "rl", "rf"],
    },
  },
};
function renderer(definition = model) {
  // GPU rasterization is checked separately in Electron; use the production deformer chain here.
  const gl = new Proxy(
    {},
    {
      get: (_, key) =>
        key === "getShaderParameter" || key === "getProgramParameter"
          ? () => true
          : () => ({}),
    },
  );
  return createRig({ getContext: () => gl } as unknown as HTMLCanvasElement, {
    view: [0, 0, 256, 400],
    parts: [],
    deformers: {
      body: { kind: "rot", pivot: [128, 256] },
      ...jointDeformers(definition),
    },
  });
}
function sequence(
  demo: MotionDemo,
  fps = 60,
  worldScale = 1,
  definition = model,
) {
  const engine = new Articulation(definition, [128, 256]),
    rig = renderer(definition);
  let previous: ReturnType<typeof demoMotion> | null = null;
  return Array.from({ length: fps * 2 }, (_, index) => {
    const t = index / fps;
    const motion = motionPhases(
      { ...demoMotion(demo, t), contactAnchors: previous?.contactAnchors },
      t,
    );
    previous = motion;
    const pose = engine.sample({
      t,
      mode: "idle",
      sit: 0,
      swing: 0,
      locomotion: motion,
      worldScale,
      facing: motion.state === "climb" ? 1 : motion.facing,
    });
    const points = Object.fromEntries(
      Object.entries(definition.limbs).map(([name, limb]) => [
        name,
        rig.point(`${name}End`, pose.state, ...limb.end),
      ]),
    );
    return { t, motion, pose, points };
  });
}
describe("actual articulated deformer coordinates", () => {
  test.each(["walk-left", "walk-right"] as const)(
    "%s keeps supporting soles fixed in the world",
    (demo) => {
      const frames = sequence(demo, 60, 0.793269);
      for (const name of ["legBack", "legFront"] as const) {
        for (let i = 30; i < frames.length; i++) {
          const before = frames[i - 1],
            after = frames[i];
          if (!before.pose.contacts[name] || !after.pose.contacts[name])
            continue;
          const b = before.points[name],
            a = after.points[name];
          const facing = after.motion.facing;
          expect(
            Math.abs(
              (a[0] - b[0]) * facing * 0.793269 +
                after.motion.travel!.x -
                before.motion.travel!.x,
            ),
          ).toBeLessThan(0.1);
          expect(Math.abs(a[1] - b[1])).toBeLessThan(0.1);
        }
      }
    },
  );
  test("legacy waist grab preserves its anchor; fold angles are not a visual acceptance criterion", () => {
    const frames = sequence("held"),
      last = frames.at(-1)!,
      rig = renderer();
    expect(rig.point("torso", last.pose.state, 128, 188)).toEqual([128, 188]);
  });
  test.each(["climb-left", "climb-right"] as const)(
    "%s alternates contacts while hands reach toward the boundary",
    (demo) => {
      const frames = sequence(demo);
      expect(
        frames.some((f) => f.pose.contacts.armNear && !f.pose.contacts.armFar),
      ).toBe(true);
      expect(
        frames.some((f) => f.pose.contacts.armFar && !f.pose.contacts.armNear),
      ).toBe(true);
      for (const f of frames.slice(30))
        for (const p of Object.values(f.points))
          expect(p.every(Number.isFinite)).toBe(true);
      for (const name of Object.keys(model.limbs))
        for (let i = 30; i < frames.length; i++) {
          const before = frames[i - 1],
            after = frames[i];
          if (
            !before.pose.contacts[name as keyof typeof model.limbs] ||
            !after.pose.contacts[name as keyof typeof model.limbs]
          )
            continue;
          expect(
            Math.hypot(
              after.points[name][0] - before.points[name][0],
              after.points[name][1] -
                before.points[name][1] +
                after.motion.travel!.y -
                before.motion.travel!.y,
            ),
            `${name} at ${i}`,
          ).toBeLessThan(0.15);
        }
    },
  );
  test("each limb keeps coherent depth and old pieces are hidden", () => {
    const pose = sequence("walk-right").at(-1)!.pose;
    expect(pose.state.alpha.old).toBe(0);
    expect(
      Math.max(...model.limbs.legBack.parts.map((id) => pose.state.z![id])),
    ).toBeLessThan(
      Math.min(...model.limbs.legFront.parts.map((id) => pose.state.z![id])),
    );
  });
  test("unreachable endpoints never stretch or invert either bone", () => {
    const limb = model.limbs.legFront,
      result = solveLimb(limb, [500, -300], -1);
    expect(
      Math.hypot(
        result.joint[0] - limb.root[0],
        result.joint[1] - limb.root[1],
      ),
    ).toBeCloseTo(
      Math.hypot(limb.joint[0] - limb.root[0], limb.joint[1] - limb.root[1]),
      8,
    );
    expect(
      Math.hypot(
        result.end[0] - result.joint[0],
        result.end[1] - result.joint[1],
      ),
    ).toBeCloseTo(
      Math.hypot(limb.end[0] - limb.joint[0], limb.end[1] - limb.joint[1]),
      8,
    );
  });
  test("negative gesture age cannot produce negative transition progress", () => {
    expect(motionPhases(demoMotion("held", 0), -0.1).progress).toBe(0);
  });
});

test("contact origins survive host receipts but reset on direction and mode changes", () => {
  const first = demoMotion("walk-right", 0.1);
  const next = motionPhases(
    { ...demoMotion("walk-right", 0.12), contactAnchors: first.contactAnchors },
    0.12,
  );
  expect(next.contactAnchors!.feet[0]).toEqual(first.contactAnchors!.feet[0]);
  const turn = motionPhases({ ...next, facing: -1 }, 0.13);
  expect(turn.contactAnchors!.feet[0]!.facing).toBe(-1);
  expect(motionPhases({ ...turn, state: "idle" }, 0).contactAnchors).toEqual({
    feet: [null, null],
    hands: [null, null],
  });
});

test.each(["walk-left", "walk-right", "climb-left", "climb-right"] as const)(
  "Coo %s keeps its shorter supporting limbs fixed",
  (demo) => {
    const pivots = {
      body: [128, 256],
      waist: [128, 188.93],
      neck: [129.9, 154.73],
      armNear: [113.18, 166.13],
      armFar: [153.65, 168.98],
      legBack: [112.42, 203.18],
      legFront: [144.15, 203.18],
    } as Record<string, [number, number]>;
    const parts = ["arm_near", "arm_far", "leg_back", "leg_front"].map(
      (id, index) => ({
        id,
        tex: id,
        parent: ["armNear", "armFar", "legBack", "legFront"][index],
        box: [80, index < 2 ? 160 : 200, 100, 60],
        grid: [2, 2],
        z: index,
      }),
    );
    const adapted = whaleMotionRig(
      { parts, pivots, view: [-12, -8, 268, 272] },
      {
        body: { kind: "rot", pivot: pivots.body },
        neck: { kind: "rot", pivot: pivots.neck },
        skirt: { kind: "warp", rect: [0, 0, 256, 256] },
      },
    );
    const frames = sequence(demo, 60, 0.793269, adapted.rig!);
    for (const name of Object.keys(adapted.rig!.limbs))
      for (let i = 30; i < frames.length; i++) {
        const before = frames[i - 1],
          after = frames[i];
        if (
          !before.pose.contacts[name as keyof typeof model.limbs] ||
          !after.pose.contacts[name as keyof typeof model.limbs]
        )
          continue;
        const facing = demo.startsWith("climb") ? 1 : after.motion.facing;
        const dx =
          (after.points[name][0] - before.points[name][0]) * 0.793269 * facing +
          after.motion.travel!.x -
          before.motion.travel!.x;
        const dy =
          (after.points[name][1] - before.points[name][1]) * 0.793269 +
          after.motion.travel!.y -
          before.motion.travel!.y;
        expect(Math.hypot(dx, dy), `${name} at ${i}`).toBeLessThan(0.15);
      }
  },
);
