import { expect, test } from "vitest";
import fixture from "./fixtures/desktop-pet-motion-v2.json";
import calibratedWalkFixture from "./fixtures/desktop-pet-calibrated-walk.json";
import { naturalWalkRegistration } from "./fixtures/natural-walk-registration";
import {
  AuthoredPoseAnimation,
  type AuthoredPoses,
  type AuthoredPose,
  skinAuthoredPart,
  bindPoseParts,
  posePartIds,
} from "../src/features/desktop-pet/locomotion/authoredPose";
import {
  jointDeformers,
  type MotionRig,
} from "../src/features/desktop-pet/locomotion/articulation";
import { createRig } from "../src/features/desktop-pet/whale-vendor/rig/rig.js";
import { demoMotion } from "../src/features/desktop-pet/locomotion/demo";
import { PetLocomotion } from "../src/features/desktop-pet/locomotion/controller";
import type { PetEnvironment } from "../src/platform/petMotion";
import type {
  RigPart,
  RigState,
} from "../src/features/desktop-pet/whale-vendor/rig/rig.js";

const poses = fixture.poses as AuthoredPoses;

test("separate anatomical segments follow rigid joints without bending or scaling painted pieces", () => {
  const pose = structuredClone(poses.walk);
  pose.head = { part: "walk_head", neck: [133, 128] };
  for (const [name, limb] of Object.entries(pose.limbs)) {
    delete limb.part;
    limb.segments = [`${name}_upper`, `${name}_lower`, `${name}_distal`];
  }
  const ids = posePartIds(pose);
  const source = ids.map((id) => ({
    id,
    tex: id,
    parent: "body",
    box: [10, 20, 30, 40],
    grid: [16, 16],
    z: 1,
  })) as RigPart[];
  const parts = bindPoseParts(source, { walk: pose });
  expect(parts[0]).toBe(source[0]);
  expect(parts.find((p) => p.id === "walk_head")?.parent).toBe("head");
  const renderer = rig();
  for (const [name, limb] of Object.entries(pose.limbs)) {
    for (const [index, id] of limb.segments!.entries()) {
      const part = parts.find((p) => p.id === id)!;
      const parent = [name, `${name}Lower`, `${name}End`][index];
      expect(part.parent).toBe(parent);
      expect(part.skin).toBeUndefined();
      expect(part.grid).toEqual([1, 1]);
      const state: RigState = {
        alpha: {},
        [name]: { a: 40, pivot: limb.root },
        [`${name}Lower`]: { a: -70, pivot: limb.joint },
        [`${name}End`]: { a: 30, pivot: limb.end },
      };
      const a = renderer.point(parent, state, 10, 20),
        b = renderer.point(parent, state, 40, 60);
      expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(50, 8);
    }
  }
  expect(source.every((p) => p.parent === "body")).toBe(true);
  expect(ids).toHaveLength(14);
  const engine = new AuthoredPoseAnimation({ ...poses, walk: pose });
  const result = engine.sample({ t: 1, mode: "walk", swing: 0, sit: 0 });
  expect(result?.state.neck?.pivot).toEqual([133, 128]);
});
function rig(pose: AuthoredPose = poses.walk) {
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

test.each(["walk-left", "walk-right"] as const)(
  "authored %s plants soles without accumulated world drift and bends knees forward",
  (demo) => {
    const engine = new AuthoredPoseAnimation(poses),
      renderer = rig();
    const scale = 0.793269,
      planted = new Map<string, { x: number; y: number }>();
    for (let i = 0; i < 360; i++) {
      const t = i / 60,
        motion = demoMotion(demo, t, poses.walk.stride! * scale);
      const result = engine.sample({
        t,
        mode: "idle",
        sit: 0,
        swing: 0,
        locomotion: motion,
        facing: motion.facing,
        worldScale: scale,
      })!;
      for (const name of ["legBack", "legFront"] as const) {
        const limb = result.pose.limbs[name];
        const [x, y] = renderer.point(`${name}End`, result.state, ...limb.end);
        const [kx, ky] = renderer.point(name, result.state, ...limb.joint);
        // A trailing leg may sit behind the hip; its knee must bend on the
        // anatomical forward side of the hip-to-ankle axis throughout the cycle.
        expect(
          (kx - limb.root[0]) * (y - limb.root[1]) -
            (ky - limb.root[1]) * (x - limb.root[0]),
        ).toBeGreaterThanOrEqual(-0.01);
        if (i < 30 || !result.contacts[name]) {
          planted.delete(name);
          continue;
        }
        const world = {
          x: x * scale * motion.facing + motion.travel!.x,
          y: y * scale + motion.travel!.y,
        };
        const origin = planted.get(name);
        if (origin)
          expect(
            Math.hypot(world.x - origin.x, world.y - origin.y),
          ).toBeLessThan(1);
        else planted.set(name, world);
      }
    }
  },
);

test("attached rest preserves the last posed limbs and face binding", () => {
  const engine = new AuthoredPoseAnimation(poses);
  const motion = demoMotion("climb-top", 0.4);
  engine.sample({
    t: 0.1,
    mode: "idle",
    sit: 0,
    swing: 0,
    locomotion: demoMotion("climb-top", 0.1),
  });
  const moving = engine.sample({
    t: 0.4,
    mode: "idle",
    sit: 0,
    swing: 0,
    locomotion: motion,
  });
  const resting = engine.sample({
    t: 0.5,
    mode: "idle",
    sit: 0,
    swing: 0,
    locomotion: { ...motion, attachment: "resting", velocity: { x: 0, y: 0 } },
  });
  expect(resting?.state).toEqual(moving?.state);
  expect(resting?.pose.face).toEqual(moving?.pose.face);
});

test("authored held pose does not fold a standing torso or counterrotate the neck", () => {
  const engine = new AuthoredPoseAnimation(poses);
  const motion = demoMotion("held", 1);
  const result = engine.sample({
    t: 1,
    mode: "idle",
    sit: 0,
    swing: 0,
    locomotion: motion,
    gripPoint: [128, 188],
  })!;
  expect(result.state.torso).toEqual({});
  expect(result.state.neck).toEqual({});
  expect(result.state.body.pivot).toEqual([128, 188]);
  expect(result.pose.part).toBe("pose_held");
});

test.each(["climb-left", "climb-right", "climb-top", "climb-bottom"] as const)(
  "%s keeps painted palms and boot contacts planted for the entire support phase",
  (demo) => {
    const engine = new AuthoredPoseAnimation(poses),
      renderer = rig();
    const planted = new Map<string, number[]>();
    for (let i = 0; i < 360; i++) {
      const t = i / 60,
        motion = demoMotion(
          demo,
          t,
          poses[
            demo === "climb-top"
              ? "top"
              : demo === "climb-bottom"
                ? "bottom"
                : "side"
          ].stride!,
        );
      const result = engine.sample({
        t,
        mode: "idle",
        sit: 0,
        swing: 0,
        locomotion: motion,
        facing: motion.facing,
      })!;
      for (const [name, limb] of Object.entries(result.pose.limbs)) {
        if (i < 30 || !result.contacts[name as keyof typeof result.contacts]) {
          planted.delete(name);
          continue;
        }
        const p = renderer.point(
          `${name}End`,
          result.state,
          ...(limb.contact ?? limb.end),
        );
        const world = [
          p[0] * motion.facing + motion.travel!.x,
          p[1] + motion.travel!.y,
        ];
        const start = planted.get(name);
        if (start)
          expect(
            Math.hypot(world[0] - start[0], world[1] - start[1]),
          ).toBeLessThan(1);
        else planted.set(name, world);
      }
    }
  },
);

test("distal boot pixels follow the planted sole instead of bending with a circular ankle patch", () => {
  const limb = poses.side.limbs.legBack;
  const contact = limb.contact!;
  const part = skinAuthoredPart(
    {
      id: limb.part!,
      tex: "boot",
      parent: "body",
      z: 1,
      box: [contact[0] - 1, contact[1] - 1, 2, 2],
      grid: [1, 1],
    },
    poses.side,
  );
  const middle = 32 * 65 + 32;
  expect(
    part.skin!.find((s) => s.deformer === "legBackEnd")!.weights[middle],
  ).toBeCloseTo(1);
  expect(
    part.skin!.find((s) => s.deformer === "legBackLower")!.weights[middle],
  ).toBeCloseTo(0);
});

const calibratedWalk = naturalWalkRegistration(
  calibratedWalkFixture as AuthoredPose,
);
const calibratedPoses = { ...poses, walk: calibratedWalk };

test.each([
  ["walk-left", 0.5, 0.7],
  ["walk-right", 0.5, 0.7],
  ["walk-left", 220 / 256, 1],
  ["walk-right", 220 / 256, 1],
  ["walk-left", 1.4, 1],
  ["walk-right", 1.4, 1],
] as const)(
  "calibrated %s at scale %s and speed %s preserves rigid bones, forward knees and planted painted soles over six seconds",
  (demo, scale, speed) => {
    const engine = new AuthoredPoseAnimation(calibratedPoses);
    const renderer = rig(calibratedWalk);
    const planted = new Map<string, number[]>();
    const extension = { support: [] as number[], swing: [] as number[] };
    let maximumDrift = 0;
    let supportFrames = 0;
    for (let frame = 0; frame <= 360; frame++) {
      const t = frame / 60;
      const motion = demoMotion(
        demo,
        t * speed,
        calibratedWalk.stride! * scale,
      );
      motion.velocity.x *= speed;
      const result = engine.sample({
        t,
        mode: "idle",
        sit: 0,
        swing: 0,
        locomotion: motion,
        facing: motion.facing,
        worldScale: scale,
      })!;
      for (const [name, limb] of Object.entries(calibratedWalk.limbs)) {
        const hip = renderer.point(name, result.state, ...limb.root);
        const knee = renderer.point(name, result.state, ...limb.joint);
        const ankle = renderer.point(`${name}Lower`, result.state, ...limb.end);
        const upperLength = Math.hypot(
          limb.joint[0] - limb.root[0],
          limb.joint[1] - limb.root[1],
        );
        const lowerLength = Math.hypot(
          limb.end[0] - limb.joint[0],
          limb.end[1] - limb.joint[1],
        );
        expect(Math.hypot(knee[0] - hip[0], knee[1] - hip[1])).toBeCloseTo(
          upperLength,
          7,
        );
        expect(Math.hypot(ankle[0] - knee[0], ankle[1] - knee[1])).toBeCloseTo(
          lowerLength,
          7,
        );
        if (!name.startsWith("leg") || frame < 30) continue;
        // Measure the knee against the transformed hip-to-ankle axis, including
        // pelvis lift. Mirroring the whole pose reverses this sign in world space.
        expect(
          (knee[0] - hip[0]) * (ankle[1] - hip[1]) -
            (knee[1] - hip[1]) * (ankle[0] - hip[0]),
        ).toBeGreaterThanOrEqual(-0.01);
        const supporting = result.contacts[name as "legBack" | "legFront"];
        extension[supporting ? "support" : "swing"].push(
          Math.hypot(ankle[0] - hip[0], ankle[1] - hip[1]) /
            (upperLength + lowerLength),
        );
        if (!supporting) {
          planted.delete(name);
          continue;
        }
        supportFrames++;
        const sole = renderer.point(
          `${name}End`,
          result.state,
          ...(limb.contact ?? limb.end),
        );
        const world = [
          sole[0] * scale * motion.facing + motion.travel!.x,
          sole[1] * scale + motion.travel!.y,
        ];
        expect(world[1]).toBeCloseTo(calibratedWalk.edges.bottom[1] * scale, 6);
        const anchor = planted.get(name);
        if (anchor)
          maximumDrift = Math.max(
            maximumDrift,
            Math.hypot(world[0] - anchor[0], world[1] - anchor[1]),
          );
        else planted.set(name, world);
      }
    }
    expect(supportFrames).toBeGreaterThan(350);
    expect(maximumDrift).toBeLessThanOrEqual(1);
    const average = (values: number[]) =>
      values.reduce((total, value) => total + value, 0) / values.length;
    expect(average(extension.support)).toBeGreaterThan(0.9);
    expect(
      average(extension.support) - average(extension.swing),
    ).toBeGreaterThan(0.03);
  },
);

test("calibrated walk uses confirmed distance phase instead of advancing limbs with elapsed time", () => {
  const renderer = rig(calibratedWalk);
  const scale = 220 / 256;
  const motion = demoMotion("walk-right", 1, calibratedWalk.stride! * scale);
  const engine = new AuthoredPoseAnimation(calibratedPoses);
  const sample = (t: number) =>
    engine.sample({
      t,
      mode: "idle",
      sit: 0,
      swing: 0,
      locomotion: motion,
      worldScale: scale,
    })!;
  sample(0);
  const before = sample(1);
  const after = sample(7);
  for (const [name, limb] of Object.entries(calibratedWalk.limbs)) {
    expect(renderer.point(`${name}End`, after.state, ...limb.end)).toEqual(
      renderer.point(`${name}End`, before.state, ...limb.end),
    );
  }
  const nextMotion = demoMotion(
    "walk-right",
    1.1,
    calibratedWalk.stride! * scale,
  );
  expect(nextMotion.phase! - motion.phase!).toBeCloseTo(
    ((nextMotion.travel!.x - motion.travel!.x) /
      (calibratedWalk.stride! * scale)) *
      2 *
      Math.PI,
    10,
  );
});

test("calibrated stride advances only by confirmed host travel, including fractional and constrained receipts", () => {
  const scale = 220 / 256;
  const environment: PetEnvironment = {
    generation: 0,
    revision: 1,
    bounds: { x: 500, y: 420, width: 300, height: 400 },
    workArea: { x: -1280, y: 25, width: 3840, height: 775 },
    displayId: 1,
    visible: true,
  };
  const controller = new PetLocomotion(
    environment,
    { roam: "free", size: 220, edgeClimbing: false, highGliding: false },
    () => {},
    () => 0.9,
  );
  const geometry = {
    visible: { x: 80, y: 130, width: 140, height: 220 },
    feet: { x: 150, y: 350 },
    strideLength: calibratedWalk.stride! * scale,
  };
  for (let i = 0; i < 140; i++) controller.step(0.05, geometry);
  expect(controller.frame.state).toBe("walk");
  const initialPhase = controller.frame.phase;
  for (let i = 0; i < 10; i++) controller.step(0.05, geometry);
  expect(controller.frame.phase).toBe(initialPhase);
  controller.receipt(
    { ...environment, bounds: { ...environment.bounds, x: 503.25 } },
    0.1,
  );
  expect(controller.frame.travel).toEqual({ x: 3.25, y: 0 });
  expect(controller.frame.phase - initialPhase).toBeCloseTo(
    (3.25 / geometry.strideLength) * 2 * Math.PI,
    10,
  );
  const phase = controller.frame.phase;
  controller.receipt(controller.environment, 0.1);
  expect(controller.frame.phase).toBe(phase);
  const confirmed = controller.environment;
  controller.receipt(
    {
      ...confirmed,
      bounds: { ...confirmed.bounds, x: confirmed.bounds.x + 1.5 },
      sceneOffset: { x: 0.5, y: 0 },
    },
    0.1,
  );
  expect(controller.frame.phase - phase).toBeCloseTo(
    (2 / geometry.strideLength) * 2 * Math.PI,
    10,
  );
});

test.each(["walk-left", "walk-right"] as const)(
  "calibrated %s releases support without snapping a rigid boot into its swing orientation",
  (demo) => {
    const engine = new AuthoredPoseAnimation(calibratedPoses);
    const renderer = rig(calibratedWalk);
    const scale = 220 / 256;
    const previous = new Map<
      string,
      { world: number[]; angle: number; supporting: boolean }
    >();
    let maximumReleaseJump = 0;
    let maximumReleaseRotation = 0;
    let releases = 0;
    for (let frame = 0; frame <= 360; frame++) {
      const t = frame / 60;
      const motion = demoMotion(demo, t, calibratedWalk.stride! * scale);
      const result = engine.sample({
        t,
        mode: "idle",
        sit: 0,
        swing: 0,
        locomotion: motion,
        facing: motion.facing,
        worldScale: scale,
      })!;
      for (const name of ["legBack", "legFront"] as const) {
        const limb = calibratedWalk.limbs[name];
        const contact = limb.contact ?? limb.end;
        const sole = renderer.point(`${name}End`, result.state, ...contact);
        const toeAxis = renderer.point(
          `${name}End`,
          result.state,
          contact[0] + 10,
          contact[1],
        );
        const world = [
          sole[0] * scale * motion.facing + motion.travel!.x,
          sole[1] * scale + motion.travel!.y,
        ];
        const angle = Math.atan2(toeAxis[1] - sole[1], toeAxis[0] - sole[0]);
        const supporting = result.contacts[name];
        const before = previous.get(name);
        if (frame >= 30 && before?.supporting && !supporting) {
          releases++;
          maximumReleaseJump = Math.max(
            maximumReleaseJump,
            Math.hypot(world[0] - before.world[0], world[1] - before.world[1]),
          );
          maximumReleaseRotation = Math.max(
            maximumReleaseRotation,
            (Math.abs(
              Math.atan2(
                Math.sin(angle - before.angle),
                Math.cos(angle - before.angle),
              ),
            ) *
              180) /
              Math.PI,
          );
        }
        previous.set(name, { world, angle, supporting });
      }
    }
    expect(releases).toBeGreaterThan(10);
    // At 60 fps this catches an instantaneous floor-to-air binding switch;
    // it still permits ordinary forward swing travel and gradual toe roll.
    expect(maximumReleaseJump).toBeLessThan(4);
    expect(maximumReleaseRotation).toBeLessThan(8);
  },
);

test.each([
  ["walk-left", 30],
  ["walk-right", 30],
  ["walk-left", 60],
  ["walk-right", 60],
] as const)(
  "calibrated %s at %s fps keeps free-leg targets reachable and avoids a straight-leg IK knee snap",
  (demo, fps) => {
    const engine = new AuthoredPoseAnimation(calibratedPoses);
    const renderer = rig(calibratedWalk);
    const scale = 220 / 256;
    const previous = new Map<string, number>();
    let maximumKneeStep = 0;
    for (let frame = 0; frame <= 6 * fps; frame++) {
      const t = frame / fps;
      const result = engine.sample({
        t,
        mode: "idle",
        sit: 0,
        swing: 0,
        locomotion: demoMotion(demo, t, calibratedWalk.stride! * scale),
        worldScale: scale,
      })!;
      for (const name of ["legBack", "legFront"] as const) {
        const limb = calibratedWalk.limbs[name];
        const reach =
          Math.hypot(
            limb.joint[0] - limb.root[0],
            limb.joint[1] - limb.root[1],
          ) +
          Math.hypot(limb.end[0] - limb.joint[0], limb.end[1] - limb.joint[1]);
        // The first short step starts at the actual straight painted rest leg.
        // Its contact continuity is covered by desktop-pet-walk-start.test.ts;
        // the established gait must retain the full free-leg flexion margin.
        if (frame >= fps / 2 && !result.contacts[name]) {
          const ankle = renderer.point(
            `${name}Lower`,
            result.state,
            ...limb.end,
          );
          const hip = renderer.point(name, result.state, ...limb.root);
          const ankleDistance = Math.hypot(
            ankle[0] - hip[0],
            ankle[1] - hip[1],
          );
          expect(ankleDistance).toBeLessThanOrEqual(reach - 0.49);
        }
        const knee = result.state[`${name}Lower`].a ?? 0;
        const before = previous.get(name);
        if (frame >= fps / 2 && before !== undefined)
          maximumKneeStep = Math.max(maximumKneeStep, Math.abs(knee - before));
        previous.set(name, knee);
      }
    }
    // The previous reach-clamped trajectory jumped 20.6 degrees at 60 fps and
    // 30.4 degrees at 30 fps; this bounds angular change without changing bones.
    expect(maximumKneeStep).toBeLessThan(600 / fps);
  },
);

test("calibrated free-foot reach guard respects a wider authored stride without stretching rigid legs", () => {
  const wide = { ...calibratedWalk, stride: 96 };
  const engine = new AuthoredPoseAnimation({ ...calibratedPoses, walk: wide });
  const renderer = rig(wide);
  for (let frame = 0; frame <= 360; frame++) {
    const t = frame / 60;
    const result = engine.sample({
      t,
      mode: "idle",
      sit: 0,
      swing: 0,
      locomotion: demoMotion("walk-right", t, wide.stride),
    })!;
    for (const name of ["legBack", "legFront"] as const) {
      if (frame < 30 || result.contacts[name]) continue;
      const limb = wide.limbs[name];
      const ankle = renderer.point(`${name}Lower`, result.state, ...limb.end);
      const hip = renderer.point(name, result.state, ...limb.root);
      expect(
        Math.hypot(ankle[0] - hip[0], ankle[1] - hip[1]),
      ).toBeLessThanOrEqual(55.51);
    }
  }
});

function calibratedHeldPose(): AuthoredPose {
  const pose = structuredClone(calibratedWalk);
  pose.part = "pose_held";
  delete pose.head;
  pose.waist = [128, 188];
  const roots = {
    armNear: [148, 231.0769230769231],
    armFar: [167.23076923076923, 226.76923076923077],
    legBack: [114.15384615384616, 211.84615384615384],
    legFront: [98, 212.15384615384616],
  };
  for (const [name, limb] of Object.entries(pose.limbs)) {
    const leg = name.startsWith("leg");
    const [x, y] = roots[name as keyof typeof roots];
    const offset = leg
      ? [limb.contact![0] - limb.end[0], limb.contact![1] - limb.end[1]]
      : [0, 10];
    limb.root = [x, y];
    limb.joint = [x, y + (leg ? 30 : 19)];
    limb.end = [x, y + (leg ? 56 : 38)];
    limb.contact = [x + offset[0], limb.end[1] + offset[1]];
    limb.limits = [-35, 35, -70, 70];
    limb.bend = leg ? -1 : 1;
    limb.segments = [0, 1, 2].map((i) => `pose_held_${name}_${i}`) as [
      string,
      string,
      string,
    ];
  }
  return pose;
}

test("segmented held relaxes actual elbows/knees and feet with fixed bones and one continuous waist transform", () => {
  const held = calibratedHeldPose();
  const engine = new AuthoredPoseAnimation({ ...calibratedPoses, held });
  const renderer = rig(held);
  const points = new Map<string, number[]>();
  let maximumKneeStep = 0;
  const knees = new Map<string, number>();
  let settled!: NonNullable<ReturnType<typeof engine.sample>>;
  for (let frame = 0; frame <= 360; frame++) {
    const t = frame / 60;
    const motion = {
      ...demoMotion("held", t),
      swing: t < 1 ? Math.sin(t * 10) * 80 : 0,
    };
    const result = engine.sample({
      t,
      mode: "idle",
      sit: 0,
      swing: 0,
      locomotion: motion,
      gripPoint: held.waist,
    })!;
    settled = result;
    expect(result.state.body.sx).toBeUndefined();
    expect(result.state.body.sy).toBeUndefined();
    expect(result.state.neck).toEqual({});
    expect(renderer.point("body", result.state, ...held.waist)).toEqual(
      held.waist,
    );
    const bodyAngle = Number(result.state.body.a ?? 0);
    expect(Math.abs(bodyAngle)).toBeLessThanOrEqual(2.16);
    const radians = (bodyAngle * Math.PI) / 180;
    const transformed = (p: number[]) => [
      held.waist[0] +
        (p[0] - held.waist[0]) * Math.cos(radians) -
        (p[1] - held.waist[1]) * Math.sin(radians),
      held.waist[1] +
        (p[0] - held.waist[0]) * Math.sin(radians) +
        (p[1] - held.waist[1]) * Math.cos(radians),
    ];
    const mouth: [number, number] = [213.0769230769231, 248.46153846153845];
    expect(renderer.point("body", result.state, ...mouth)).toEqual(
      transformed(mouth),
    );
    for (const [name, limb] of Object.entries(held.limbs)) {
      const root = renderer.point(name, result.state, ...limb.root);
      const joint = renderer.point(name, result.state, ...limb.joint);
      const end = renderer.point(`${name}Lower`, result.state, ...limb.end);
      const contact = renderer.point(
        `${name}End`,
        result.state,
        ...limb.contact!,
      );
      const axis = renderer.point(
        `${name}End`,
        result.state,
        limb.contact![0] + 10,
        limb.contact![1],
      );
      expect(root[0]).toBeCloseTo(transformed(limb.root)[0], 8);
      expect(root[1]).toBeCloseTo(transformed(limb.root)[1], 8);
      expect(Math.hypot(joint[0] - root[0], joint[1] - root[1])).toBeCloseTo(
        name.startsWith("leg") ? 30 : 19,
        8,
      );
      expect(Math.hypot(end[0] - joint[0], end[1] - joint[1])).toBeCloseTo(
        name.startsWith("leg") ? 26 : 19,
        8,
      );
      expect(result.endpoints[name as keyof typeof held.limbs][0]).toBeCloseTo(
        contact[0],
        8,
      );
      expect(result.endpoints[name as keyof typeof held.limbs][1]).toBeCloseTo(
        contact[1],
        8,
      );
      expect(result.contacts[name as keyof typeof held.limbs]).toBe(false);
      const knee = Number(result.state[`${name}Lower`].a ?? 0);
      if (knees.has(name))
        maximumKneeStep = Math.max(
          maximumKneeStep,
          Math.abs(knee - knees.get(name)!),
        );
      knees.set(name, knee);
      if (frame > 18) {
        // Dragging only adds inertia to the complete pose's source elbow/knee;
        // it does not impose a new flex angle on an already drawn joint.
        expect(Math.abs(knee)).toBeLessThanOrEqual(3);
        expect(joint[1]).toBeGreaterThan(root[1]);
        expect(end[1]).toBeGreaterThan(joint[1]);
        const footAngle =
          (Math.atan2(axis[1] - contact[1], axis[0] - contact[0]) * 180) /
          Math.PI;
        expect(Math.abs(footAngle - bodyAngle)).toBeLessThan(0.001);
      }
      if (frame === 300) points.set(name, contact);
      if (frame === 360)
        expect(
          Math.hypot(
            contact[0] - points.get(name)![0],
            contact[1] - points.get(name)![1],
          ),
        ).toBeLessThan(0.001);
    }
  }
  expect(maximumKneeStep).toBeLessThan(3);
  expect(Math.abs(Number(settled.state.body.a ?? 0))).toBeLessThan(0.001);
});

test("rapid release/regrab preserves displayed held joints and the calibrated grip", () => {
  const held = calibratedHeldPose();
  const engine = new AuthoredPoseAnimation({ ...calibratedPoses, held });
  const sample = (t: number, swing: number) =>
    engine.sample({
      t,
      mode: "idle",
      sit: 0,
      swing: 0,
      locomotion: { ...demoMotion("held", t), swing },
      gripPoint: held.waist,
    })!;
  sample(0, 18);
  sample(0.3, 18);
  expect(sample(0.4, 18).state.body.a).toBeGreaterThan(0);
  const release = engine.sample({ t: 0.41, mode: "idle", sit: 0, swing: 0 })!;
  const fresh = sample(0.42, 0);
  expect(fresh.state.body.a).toBe(release.state.body.a);
  expect(fresh.state.body.pivot).toEqual(held.waist);
  expect(fresh.state.legBackLower.a).toBe(release.state.legBackLower.a);
  const recovering = sample(0.8, 0);
  expect(Math.abs(Number(recovering.state.legBackLower.a))).toBeLessThan(
    Math.abs(Number(release.state.legBackLower.a)),
  );
  for (let i = 1; i <= 120; i++) sample(0.8 + i / 60, 0);
  expect(sample(3, 0).state.legBackLower.a).toBeCloseTo(0, 7);
});

test("the shared geometry solver preserves character-specific fields without requiring a human face", () => {
  const { face, ...geometry } = calibratedWalk;
  expect(face.twoEyes).toBeDefined();
  const generic = Object.fromEntries(
    Object.keys(calibratedPoses).map((name) => [
      name,
      { ...geometry, characterLayer: "whale" },
    ]),
  ) as Record<
    keyof AuthoredPoses,
    typeof geometry & { characterLayer: string }
  >;
  const engine = new AuthoredPoseAnimation(generic);
  const result = engine.sample({ t: 0, mode: "walk", sit: 0, swing: 0 })!;
  expect(result.pose.characterLayer).toBe("whale");
  expect("face" in result.pose).toBe(false);
});
