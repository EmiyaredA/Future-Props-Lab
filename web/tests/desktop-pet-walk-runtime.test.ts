import { expect, test } from "vitest";
import {
  AuthoredPoseAnimation,
  type AuthoredPoseGeometry,
  type PoseName,
} from "../src/features/desktop-pet/locomotion/authoredPose";
import {
  jointDeformers,
  type MotionRig,
  type Point,
} from "../src/features/desktop-pet/locomotion/articulation";
import { createRig } from "../src/features/desktop-pet/whale-vendor/rig/rig.js";
import type { PetMotionFrame } from "../src/platform/petMotion";
import calibrated from "./fixtures/desktop-pet-calibrated-walk.json";
const legs = ["legBack", "legFront"] as const;
const scale = 220 / 256;
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** New, geometry-only complete side pose; no old artwork is used. */
function source(): AuthoredPoseGeometry {
  const limb = (
    x: number,
    y: number,
    upper: number,
    lower: number,
    a: number,
    b: number,
  ) => {
    const root: Point = [x, y],
      joint: Point = [
        x + a * Math.cos((upper * Math.PI) / 180),
        y + a * Math.sin((upper * Math.PI) / 180),
      ],
      end: Point = [
        joint[0] + b * Math.cos((lower * Math.PI) / 180),
        joint[1] + b * Math.sin((lower * Math.PI) / 180),
      ];
    return {
      root,
      joint,
      end,
      contact: [end[0] + 2, end[1] + 12.5] as Point,
      region: [],
      limits: [-60, 60, -90, 90] as [number, number, number, number],
      bend: (lower < upper ? 1 : -1) as -1 | 1,
    };
  };
  const limbs = {
    legBack: limb(121, 191, 100, 80, 30, 26),
    legFront: limb(136, 191, 100, 80, 30, 26),
    armNear: limb(111, 150, 80, 100, 19, 19),
    armFar: limb(146, 150, 80, 100, 19, 19),
  };
  return {
    part: "new_complete_side",
    waist: [128, 188],
    limbs,
    stride: 48,
    edges: {
      left: [90, 210],
      right: [155, 210],
      top: [128, 80],
      bottom: [128, limbs.legFront.contact[1]],
    },
  };
}
function engine(pose = source()) {
  const poses = Object.fromEntries(
    ["walk", "held", "side", "top", "bottom", "glide"].map((name) => [
      name,
      pose,
    ]),
  ) as Record<PoseName, AuthoredPoseGeometry>;
  const animation = new AuthoredPoseAnimation(poses);
  const gl = new Proxy({}, { get: () => () => ({}) });
  const renderer = createRig(
    { getContext: () => gl } as unknown as HTMLCanvasElement,
    {
      view: [0, 0, 256, 300],
      parts: [],
      deformers: {
        body: { kind: "rot", pivot: pose.waist },
        ...jointDeformers({
          limbs: pose.limbs,
          waist: pose.waist,
        } as unknown as MotionRig),
      },
    },
  );
  return { animation, renderer, pose };
}
function motion(
  t: number,
  travel: number,
  facing = 1,
  state: PetMotionFrame["state"] = "walk",
): PetMotionFrame {
  return {
    state,
    phase: t * 9,
    facing: facing as -1 | 1,
    edge: null,
    swing: 0,
    velocity: { x: state === "walk" ? 45 * facing : 0, y: 0 },
    travel: { x: travel * scale * facing, y: 0 },
  };
}
function frame(
  t: number,
  travel: number,
  facing = 1,
  state: PetMotionFrame["state"] = "walk",
) {
  return {
    t,
    mode: "idle",
    swing: 0,
    sit: 0,
    worldScale: scale,
    facing,
    locomotion: motion(t, travel, facing, state),
  };
}
test.each([
  [-1, 30],
  [1, 30],
  [-1, 60],
  [1, 60],
])(
  "actual authored walk facing%s %sfps plans support without sliding or scaling",
  (facing, fps) => {
    const { animation, renderer, pose } = engine();
    const anchors = new Map<string, Point>();
    let lastHeight: number | undefined;
    for (let i = 0; i <= 6 * fps; i++) {
      const d = (30 * i) / fps,
        result = animation.sample(frame(i / fps, d, facing))!;
      expect(
        result.motionFailure,
        JSON.stringify({ i, result: result.motionFailure }),
      ).toBeUndefined();
      expect(animation.getMotionFailure()).toBeNull();
      for (const leg of legs) {
        const limb = pose.limbs[leg],
          sole = renderer.point(
            `${leg}End`,
            result.state,
            ...limb.contact!,
          ) as Point;
        expect(distance(sole, result.endpoints[leg])).toBeLessThan(1e-7);
        const world: Point = [(sole[0] + d) * scale * facing, sole[1] * scale];
        if (result.contacts[leg]) {
          if (anchors.has(leg))
            expect(distance(world, anchors.get(leg)!)).toBeLessThan(1e-7);
          else anchors.set(leg, world);
        } else anchors.delete(leg);
        const root = renderer.point(leg, result.state, ...limb.root) as Point,
          joint = renderer.point(leg, result.state, ...limb.joint) as Point,
          ankle = renderer.point(
            `${leg}Lower`,
            result.state,
            ...limb.end,
          ) as Point;
        expect(distance(root, joint)).toBeCloseTo(30, 8);
        expect(distance(joint, ankle)).toBeCloseTo(26, 8);
        expect(result.state[leg].a).toBeGreaterThanOrEqual(limb.limits[0]);
        expect(result.state[leg].a).toBeLessThanOrEqual(limb.limits[1]);
      }
      const height = Number(result.state.body.ty);
      if (lastHeight !== undefined)
        expect(Math.abs(height - lastHeight)).toBeLessThan(1);
      lastHeight = height;
    }
  },
);
test("render time alone never advances confirmed-foot targets or arms", () => {
  const { animation } = engine();
  const first = animation.sample(frame(0, 0))!;
  const after = animation.sample(frame(20, 0))!;
  for (const leg of legs) {
    expect(after.endpoints[leg]).toEqual(first.endpoints[leg]);
    expect(after.state[leg]).toEqual(first.state[leg]);
  }
  for (const arm of ["armNear", "armFar"] as const) {
    expect(after.endpoints[arm]).toEqual(first.endpoints[arm]);
    expect(after.state[arm]).toEqual(first.state[arm]);
  }
});
test.each([30, 60])(
  "%sfps stop and fast restart preserves actual FK support",
  (fps) => {
    const { animation, renderer, pose } = engine();
    const anchors = new Map<string, Point>();
    let d = 0;
    for (let i = 0; i <= 2 * fps; i++) {
      const t = i / fps,
        walking = t < 0.75 || t >= 1.4;
      if (walking) d += 30 / fps;
      const result = animation.sample(
        frame(t, d, 1, walking ? "walk" : "idle"),
      )!;
      expect(
        result.motionFailure,
        JSON.stringify({ i, result: result.motionFailure }),
      ).toBeUndefined();
      for (const leg of legs) {
        const p = renderer.point(
          `${leg}End`,
          result.state,
          ...pose.limbs[leg].contact!,
        ) as Point;
        const world: Point = [(p[0] + d) * scale, p[1] * scale];
        if (result.contacts[leg]) {
          if (anchors.has(leg))
            expect(distance(world, anchors.get(leg)!)).toBeLessThan(1e-7);
          else anchors.set(leg, world);
        } else anchors.delete(leg);
      }
    }
  },
);
test("source registration contradictions are visible failures and never fall back to old gait", () => {
  const { animation } = engine(calibrated as unknown as AuthoredPoseGeometry);
  const result = animation.sample(frame(0, 0))!;
  expect(result.motionFailure?.reason).toBe("invalid-source-floor");
  expect(animation.getMotionFailure()).toBe("invalid-source-floor");
  expect(animation.sample(frame(1, 20))!.motionFailure).toEqual(
    result.motionFailure,
  );
});
test("reversal keeps the registered displayed view and requires a real turn view", () => {
  const { animation } = engine();
  animation.sample(frame(0, 0));
  const before = animation.sample(frame(0.1, 3))!;
  const opposite = frame(0.2, 3, -1);
  expect(animation.displayFacing(-1)).toBe(1);
  // The outer renderer freezes display facing before sampling. The requested
  // locomotion direction must still reach the failure contract independently.
  opposite.facing = animation.displayFacing(-1);
  opposite.locomotion.travel = { x: 3 * scale, y: 0 };
  const after = animation.sample(opposite)!;
  expect(after.motionFailure?.reason).toBe("needs-walk-turn-view");
  expect(after.displayFacing).toBe(1);
  expect(after.state).toEqual(before.state);
});

test("a failed large receipt preserves the displayed pose and world contacts through late receipts", () => {
  const { animation, renderer, pose } = engine();
  animation.sample(frame(0, 0));
  const before = animation.sample(frame(0.1, 3))!;
  const world = Object.fromEntries(
    legs.map((leg) => {
      const p = renderer.point(
        `${leg}End`,
        before.state,
        ...pose.limbs[leg].contact!,
      ) as Point;
      return [leg, [p[0] + 3, p[1]] as Point];
    }),
  );
  for (const d of [1000, 1001, 999]) {
    const after = animation.sample(frame(0.2, d))!;
    expect(after.motionFailure?.reason).toBe("window-exhausted");
    expect(after.name).toBe("walk");
    expect(after.pose).toBe(pose);
    for (const leg of legs) {
      const p = renderer.point(
        `${leg}End`,
        after.state,
        ...pose.limbs[leg].contact!,
      ) as Point;
      expect(distance([p[0] + d, p[1]], world[leg])).toBeLessThan(1e-7);
      expect(after.state[leg]).toEqual(before.state[leg]);
    }
  }
});

test("invalid confirmed travel fails without injecting nonfinite renderer transforms", () => {
  const { animation } = engine();
  animation.sample(frame(0, 0));
  const after = animation.sample(frame(0.1, Number.NaN))!;
  expect(after.motionFailure?.reason).toBe("invalid-step-input");
  expect(Number.isFinite(Number(after.state.body.ty))).toBe(true);
});

test.each([30, 60])(
  "%sfps stop consumes its final host receipt before planning both support exchanges",
  (fps) => {
    const { animation, renderer, pose } = engine();
    const anchors = new Map<string, Point>();
    for (let i = 0; i <= 2 * fps; i++) {
      const t = i / fps,
        d = (Math.min(t, 0.75) * 60) / scale;
      const result = animation.sample(
        frame(t, d, -1, t <= 0.75 ? "walk" : "idle"),
      )!;
      expect(
        result.motionFailure,
        JSON.stringify({ fps, t, failure: result.motionFailure }),
      ).toBeUndefined();
      for (const leg of legs) {
        const p = renderer.point(
          `${leg}End`,
          result.state,
          ...pose.limbs[leg].contact!,
        ) as Point;
        const world: Point = [(p[0] + d) * scale * -1, p[1] * scale];
        if (result.contacts[leg]) {
          if (anchors.has(leg))
            expect(distance(world, anchors.get(leg)!)).toBeLessThan(1e-7);
          else anchors.set(leg, world);
        } else anchors.delete(leg);
      }
    }
  },
);
test("held cancels support ownership before a new walk session", () => {
  const { animation } = engine();
  animation.sample(frame(0, 0));
  animation.sample(frame(0.2, 6));
  expect(animation.sample(frame(0.21, 6, 1, "held"))?.name).toBe("held");
  const after = animation.sample(frame(0.3, 70))!;
  expect(after.motionFailure).toBeUndefined();
  expect(after.state.body.ty).toBe(0);
});
