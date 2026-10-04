import { expect, test } from "vitest";
import fixture from "./fixtures/desktop-pet-motion-v2.json";
import calibrated from "./fixtures/desktop-pet-calibrated-walk.json";
import { naturalWalkRegistration } from "./fixtures/natural-walk-registration";
import {
  AuthoredPoseAnimation,
  type AuthoredPose,
  type AuthoredPoses,
} from "../src/features/desktop-pet/locomotion/authoredPose";
import {
  jointDeformers,
  type LimbName,
  type MotionRig,
  type Point,
} from "../src/features/desktop-pet/locomotion/articulation";
import { demoMotion } from "../src/features/desktop-pet/locomotion/demo";
import { createRig } from "../src/features/desktop-pet/whale-vendor/rig/rig.js";
import type { RigState } from "../src/features/desktop-pet/whale-vendor/rig/rig.js";

const names = ["armNear", "armFar", "legBack", "legFront"] as const;
const legs = ["legBack", "legFront"] as const;
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const scale = 220 / 256;
function renderer(pose: AuthoredPose) {
  const gl = new Proxy(
    {},
    {
      get: (_, key) =>
        ["getShaderParameter", "getProgramParameter"].includes(String(key))
          ? () => true
          : () => ({}),
    },
  );
  return createRig({ getContext: () => gl } as unknown as HTMLCanvasElement, {
    view: [-100, -8, 300, 400],
    parts: [],
    deformers: {
      body: { kind: "rot", pivot: [128, 256] },
      ...jointDeformers({
        limbs: pose.limbs,
        waist: pose.waist,
      } as unknown as MotionRig),
    },
  });
}
function poses(walk: AuthoredPose): AuthoredPoses {
  return { ...fixture.poses, walk } as AuthoredPoses;
}
function slantedPose() {
  const pose = naturalWalkRegistration(calibrated as AuthoredPose);
  // Independent source axes, normalized to authored 19+19 / 30+26 bones.
  // The palm/sole is intentionally distinct from the wrist/ankle.
  const axes: Record<LimbName, [Point, Point]> = {
    armNear: [
      [-16, 180],
      [4, 159],
    ],
    armFar: [
      [16.5, 175],
      [-6, 159],
    ],
    legBack: [
      [3, 30],
      [-1, 26],
    ],
    legFront: [
      [2, 30],
      [-2, 26],
    ],
  };
  for (const name of names) {
    const limb = pose.limbs[name],
      leg = name.startsWith("leg");
    const vector = (axis: Point, length: number): Point => {
      const factor = length / Math.hypot(...axis);
      return [axis[0] * factor, axis[1] * factor];
    };
    const upper = vector(axes[name][0], leg ? 30 : 19);
    const lower = vector(axes[name][1], leg ? 26 : 19);
    limb.joint = [limb.root[0] + upper[0], limb.root[1] + upper[1]];
    limb.end = [limb.joint[0] + lower[0], limb.joint[1] + lower[1]];
    limb.contact = [
      limb.end[0] + (leg ? 3.5 : 1.25),
      leg ? pose.edges.bottom[1] : limb.end[1] + 10,
    ];
  }
  return pose;
}
function sample(
  engine: AuthoredPoseAnimation,
  facing: -1 | 1,
  t: number,
  travel: number,
  pose: AuthoredPose,
) {
  const motion = demoMotion(
    facing === -1 ? "walk-left" : "walk-right",
    0,
    pose.stride! * scale,
  );
  motion.phase = (travel / (pose.stride! * scale)) * 2 * Math.PI;
  motion.travel = { x: facing * travel, y: 0 };
  return engine.sample({
    t,
    mode: "idle",
    swing: 0,
    sit: 0,
    locomotion: motion,
    worldScale: scale,
    facing,
  })!;
}
function points(
  rig: ReturnType<typeof renderer>,
  pose: AuthoredPose,
  state: RigState,
  name: LimbName,
) {
  const limb = pose.limbs[name];
  return {
    root: rig.point(name, state, ...limb.root) as Point,
    joint: rig.point(name, state, ...limb.joint) as Point,
    end: rig.point(`${name}Lower`, state, ...limb.end) as Point,
    contact: rig.point(
      `${name}End`,
      state,
      ...(limb.contact ?? limb.end),
    ) as Point,
  };
}

test.each([
  [30, -1],
  [30, 1],
  [60, -1],
  [60, 1],
] as const)(
  "a complete contact mesh keeps its planted sole and stop pose at %i fps facing %i",
  (fps, facing) => {
    const pose = slantedPose();
    for (const limb of Object.values(pose.limbs)) delete limb.segments;
    const engine = new AuthoredPoseAnimation(poses(pose));
    const rig = renderer(pose);
    const anchors = new Map<LimbName, Point>();
    let result = sample(engine, facing, 0, 0, pose);
    for (const name of names) {
      expect(
        distance(
          points(rig, pose, result.state, name).contact,
          result.endpoints[name],
        ),
      ).toBeLessThan(1e-8);
      expect(result.state[name].a).toBeCloseTo(0, 10);
    }
    for (let index = 1; index <= fps * 4; index++) {
      const time = index / fps,
        travel = time * 60;
      result = sample(engine, facing, time, travel, pose);
      expect(
        result.motionFailure,
        JSON.stringify({ time, travel, failure: result.motionFailure }),
      ).toBeUndefined();
      for (const name of legs) {
        if (!result.contacts[name]) {
          anchors.delete(name);
          continue;
        }
        const local = points(rig, pose, result.state, name).contact;
        const world: Point = [
          facing * local[0] * scale + facing * travel,
          local[1] * scale,
        ];
        const anchor = anchors.get(name);
        if (anchor) expect(distance(world, anchor)).toBeLessThan(1);
        else anchors.set(name, world);
      }
    }
    const stopped = engine.sample({
      t: 4.01,
      mode: "idle",
      swing: 0,
      sit: 0,
      worldScale: scale,
      facing,
    });
    expect(stopped?.name).toBe("walk");
    const settled = engine.sample({
      t: 4.8,
      mode: "idle",
      swing: 0,
      sit: 0,
      worldScale: scale,
      facing,
    });
    expect(settled?.name).toBe("walk");
    expect(settled?.contacts.legBack).toBe(true);
    expect(settled?.contacts.legFront).toBe(true);
  },
);

test.each([false, true])(
  "first walk displays actual %s slanted rest joints and establishes its painted support",
  (slanted) => {
    const pose = slanted
      ? slantedPose()
      : naturalWalkRegistration(calibrated as AuthoredPose);
    const engine = new AuthoredPoseAnimation(poses(pose)),
      rig = renderer(pose);
    const result = sample(engine, 1, 10, 270, pose);
    expect(result.contacts.legBack || result.contacts.legFront).toBe(true);
    for (const name of names) {
      expect(result.state[name].a).toBeCloseTo(0, 10);
      expect(result.state[`${name}Lower`].a).toBeCloseTo(0, 10);
      expect(result.state[`${name}End`].a).toBeCloseTo(0, 10);
      const actual = points(rig, pose, result.state, name).contact;
      expect(actual[0]).toBeCloseTo(pose.limbs[name].contact![0], 10);
      expect(actual[1]).toBeCloseTo(
        pose.limbs[name].contact![1] + result.state.body.ty!,
        10,
      );
      expect(distance(actual, result.endpoints[name])).toBeLessThan(1e-8);
      if (result.contacts[name])
        expect(actual[1]).toBeCloseTo(pose.edges.bottom[1], 10);
    }
  },
);

test.each(
  [false, true].flatMap((slanted) =>
    [-1, 1].flatMap((facing) =>
      [30, 60].map((fps) => [slanted, facing, fps] as const),
    ),
  ),
)(
  "startup and six seconds of confirmed walk: slanted=%s facing=%s fps=%s preserve every planted sole and rigid bone",
  (slanted, direction, fps) => {
    const facing = direction as -1 | 1;
    const pose = slanted
      ? slantedPose()
      : naturalWalkRegistration(calibrated as AuthoredPose);
    const engine = new AuthoredPoseAnimation(poses(pose)),
      rig = renderer(pose);
    const anchors = new Map<LimbName, Point>();
    let previous: ReturnType<typeof sample> | null = null;
    let distanceMoved = 0,
      maxDrift = 0,
      maxBoneError = 0,
      maxArmEndpointError = 0,
      maxArmFlexStep = 0;
    const armFlex = new Map<LimbName, number>();
    for (let index = 0; index <= fps * 6; index++) {
      const t = index / fps;
      // Startup ramp and stalled/fractional host receipts; phase follows actual
      // accepted distance, not wall-clock time or the requested velocity.
      if (index && index % 11 !== 0)
        distanceMoved +=
          (60 / fps) * Math.min(1, t / 0.12) * (index % 7 === 0 ? 0.35 : 1);
      const result = sample(engine, facing, t, distanceMoved, pose);
      for (const name of names) {
        const p = points(rig, pose, result.state, name),
          limb = pose.limbs[name];
        maxBoneError = Math.max(
          maxBoneError,
          Math.abs(distance(p.root, p.joint) - distance(limb.root, limb.joint)),
          Math.abs(distance(p.joint, p.end) - distance(limb.joint, limb.end)),
        );
        if (name.startsWith("arm")) {
          maxArmEndpointError = Math.max(
            maxArmEndpointError,
            distance(p.contact, result.endpoints[name]),
          );
          const flex =
            (Math.acos(
              Math.max(
                -1,
                Math.min(
                  1,
                  ((p.joint[0] - p.root[0]) * (p.end[0] - p.joint[0]) +
                    (p.joint[1] - p.root[1]) * (p.end[1] - p.joint[1])) /
                    (distance(p.root, p.joint) * distance(p.joint, p.end)),
                ),
              ),
            ) *
              180) /
            Math.PI;
          if (armFlex.has(name))
            maxArmFlexStep = Math.max(
              maxArmFlexStep,
              Math.abs(flex - armFlex.get(name)!),
            );
          armFlex.set(name, flex);
          const restFlex = Math.abs(
            ((Math.atan2(
              limb.end[1] - limb.joint[1],
              limb.end[0] - limb.joint[0],
            ) -
              Math.atan2(
                limb.joint[1] - limb.root[1],
                limb.joint[0] - limb.root[0],
              )) *
              180) /
              Math.PI,
          );
          // The authored elbow keeps its own silhouette instead of being
          // replaced by a universal twenty-degree, vertical-arm pose.
          expect(Math.abs(flex - restFlex)).toBeLessThanOrEqual(8 + 1e-7);
        }
        const world: Point = [
          p.contact[0] * scale * facing + distanceMoved * facing,
          p.contact[1] * scale,
        ];
        if (result.contacts[name]) {
          if (anchors.has(name))
            maxDrift = Math.max(maxDrift, distance(world, anchors.get(name)!));
          else anchors.set(name, world);
          expect(p.contact[1]).toBeCloseTo(pose.edges.bottom[1], 7);
        } else anchors.delete(name);
        expect(result.state[name].a).toBeGreaterThanOrEqual(limb.limits[0]);
        expect(result.state[name].a).toBeLessThanOrEqual(limb.limits[1]);
        expect(result.state[`${name}Lower`].a).toBeGreaterThanOrEqual(
          limb.limits[2],
        );
        expect(result.state[`${name}Lower`].a).toBeLessThanOrEqual(
          limb.limits[3],
        );
      }
      if (previous)
        for (const name of legs) {
          if (previous.contacts[name] && !result.contacts[name]) {
            const other = name === "legBack" ? "legFront" : "legBack";
            expect(previous.contacts[other] && result.contacts[other]).toBe(
              true,
            );
          }
        }
      previous = result;
    }
    expect(maxDrift).toBeLessThan(1);
    expect(maxBoneError).toBeLessThan(1e-8);
    expect(maxArmEndpointError).toBeLessThan(1e-8);
    expect(maxArmFlexStep).toBeLessThan(240 / fps);
    expect(anchors.size).toBeGreaterThanOrEqual(1);
  },
);

test("waiting for host movement cannot advance the initial free-foot placement", () => {
  const pose = slantedPose(),
    engine = new AuthoredPoseAnimation(poses(pose)),
    rig = renderer(pose);
  const first = sample(engine, 1, 0, 0, pose);
  const displayed = Object.fromEntries(
    legs.map((name) => [name, points(rig, pose, first.state, name).contact]),
  );
  for (const t of [0.05, 0.1, 0.2, 0.3, 0.6]) {
    const result = sample(engine, 1, t, 0, pose);
    for (const name of legs)
      expect(
        distance(
          points(rig, pose, result.state, name).contact,
          displayed[name],
        ),
      ).toBeLessThan(0.03);
  }
});

test("a confirmed receipt at the same render timestamp does not restore the initial limb angles", () => {
  const pose = slantedPose(),
    engine = new AuthoredPoseAnimation(poses(pose)),
    rig = renderer(pose);
  const first = sample(engine, 1, 0, 0, pose);
  const support = legs.find((name) => first.contacts[name])!;
  const anchor = points(rig, pose, first.state, support).contact;
  const updated = sample(engine, 1, 0, 1, pose);
  const actual = points(rig, pose, updated.state, support).contact;
  expect(
    distance(
      [actual[0] * scale + 1, actual[1] * scale],
      [anchor[0] * scale, anchor[1] * scale],
    ),
  ).toBeLessThan(1e-8);
  expect(updated.state[support].a).not.toBeCloseTo(0, 5);
});

test("rapid hold/cancel and configured events discard the starting step without retaining its support", () => {
  const pose = slantedPose(),
    engine = new AuthoredPoseAnimation(poses(pose));
  sample(engine, 1, 0, 0, pose);
  sample(engine, 1, 0.05, 1, pose);
  const held = engine.sample({
    t: 0.06,
    mode: "held",
    swing: 0,
    sit: 0,
    locomotion: demoMotion("held", 0.06),
  })!;
  expect(held.name).toBe("held");
  expect(Object.values(held.contacts).every((contact) => !contact)).toBe(true);
  expect(engine.sample({ t: 0.08, mode: "sit", swing: 0, sit: 1 })).toBeNull();
  const fresh = sample(engine, 1, 0.1, 80, pose);
  for (const name of names) expect(fresh.state[name].a).toBeCloseTo(0, 10);
});

test("whole-pose packages retain their existing time-based entry path", () => {
  const engine = new AuthoredPoseAnimation(fixture.poses as AuthoredPoses);
  const first = engine.sample({ t: 0, mode: "walk", swing: 0, sit: 0 })!;
  expect(first.state.body.ty).toBe(0);
  for (const name of names) expect(first.state[name].a).toBeCloseTo(0, 10);
});
