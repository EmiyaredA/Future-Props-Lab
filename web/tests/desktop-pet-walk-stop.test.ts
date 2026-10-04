import { expect, test } from "vitest";
import fixture from "./fixtures/desktop-pet-motion-v2.json";
import calibratedWalkFixture from "./fixtures/desktop-pet-calibrated-walk.json";
import { naturalWalkRegistration } from "./fixtures/natural-walk-registration";
import {
  AuthoredPoseAnimation,
  type AuthoredPose,
  type AuthoredPoses,
} from "../src/features/desktop-pet/locomotion/authoredPose";
import {
  jointDeformers,
  type MotionRig,
} from "../src/features/desktop-pet/locomotion/articulation";
import { createRig } from "../src/features/desktop-pet/whale-vendor/rig/rig.js";
import { demoMotion } from "../src/features/desktop-pet/locomotion/demo";
import { PetLocomotion } from "../src/features/desktop-pet/locomotion/controller";
const poses = fixture.poses as AuthoredPoses;
const calibratedWalk = naturalWalkRegistration(
  calibratedWalkFixture as AuthoredPose,
);
const calibratedPoses = { ...poses, walk: calibratedWalk };
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

test.each(
  (["walk-left", "walk-right"] as const).flatMap((demo) =>
    [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75].flatMap((stopAt) =>
      [30, 60].map((fps) => [demo, stopAt, fps] as const),
    ),
  ),
)(
  "%s stops at %s seconds at %s fps with a reachable support handoff and near-straight side idle",
  (demo, stopAt, fps) => {
    const engine = new AuthoredPoseAnimation(calibratedPoses);
    const renderer = rig(calibratedWalk);
    const scale = 220 / 256;
    let moving!: NonNullable<ReturnType<typeof engine.sample>>;
    for (let frame = 0; frame <= Math.round(stopAt * 60); frame++) {
      const t = frame / 60;
      moving = engine.sample({
        t,
        mode: "idle",
        sit: 0,
        swing: 0,
        locomotion: demoMotion(demo, t, calibratedWalk.stride! * scale),
        worldScale: scale,
      })!;
    }
    const supports = Object.entries(moving.contacts)
      .filter(([name, supported]) => name.startsWith("leg") && supported)
      .map(([name]) => name as "legBack" | "legFront");
    expect(supports.length).toBeGreaterThan(0);
    const original = Object.fromEntries(
      Object.entries(calibratedWalk.limbs).map(([name, limb]) => [
        name,
        renderer.point(
          `${name}End`,
          moving.state,
          ...(limb.contact ?? limb.end),
        ),
      ]),
    );
    const idle = (t: number) =>
      engine.sample({
        t,
        mode: "idle",
        sit: 0,
        swing: 0,
        locomotion: null,
        worldScale: scale,
        facing: demo === "walk-left" ? -1 : 1,
      })!;
    const first = idle(stopAt);
    expect(first.state).toEqual(moving.state);
    const anchors = new Map<string, number[]>(
      supports.map((name) => [name, original[name]]),
    );
    const previous = new Map<string, number[]>(Object.entries(original));
    let maximumTravel = 0;
    let maximumKneeStep = 0;
    let last = first;
    let previousContacts = first.contacts;
    let previousState = first.state;
    for (let frame = 1; frame <= fps; frame++) {
      last = idle(stopAt + frame / fps);
      expect(last.pose).toBe(calibratedWalk);
      expect(
        Number(last.contacts.legBack) + Number(last.contacts.legFront),
      ).toBeGreaterThan(0);
      for (const name of ["legBack", "legFront"] as const) {
        maximumKneeStep = Math.max(
          maximumKneeStep,
          Math.abs(
            (last.state[`${name}Lower`].a ?? 0) -
              (previousState[`${name}Lower`].a ?? 0),
          ),
        );
        if (previousContacts[name] && !last.contacts[name]) {
          const other = name === "legBack" ? "legFront" : "legBack";
          // A planted partner already existed in the preceding displayed frame.
          expect(previousContacts[other]).toBe(true);
          expect(last.contacts[other]).toBe(true);
        }
        const limb = calibratedWalk.limbs[name];
        const p = renderer.point(
          `${name}End`,
          last.state,
          ...(limb.contact ?? limb.end),
        );
        const before = previous.get(name)!;
        maximumTravel = Math.max(
          maximumTravel,
          Math.hypot(p[0] - before[0], p[1] - before[1]) * scale,
        );
        previous.set(name, p);
        if (!last.contacts[name]) {
          anchors.delete(name);
          continue;
        }
        expect(p[1]).toBeCloseTo(calibratedWalk.edges.bottom[1], 6);
        const anchor = anchors.get(name);
        if (anchor)
          expect(
            Math.hypot(p[0] - anchor[0], p[1] - anchor[1]) * scale,
          ).toBeLessThan(1);
        else anchors.set(name, p);
      }
      previousContacts = last.contacts;
      previousState = last.state;
      for (const [name, limb] of Object.entries(calibratedWalk.limbs)) {
        const root = renderer.point(name, last.state, ...limb.root);
        const joint = renderer.point(name, last.state, ...limb.joint);
        expect(Math.hypot(joint[0] - root[0], joint[1] - root[1])).toBeCloseTo(
          Math.hypot(
            limb.joint[0] - limb.root[0],
            limb.joint[1] - limb.root[1],
          ),
          7,
        );
      }
    }
    for (const name of ["legBack", "legFront"] as const) {
      const limb = calibratedWalk.limbs[name];
      const p = renderer.point(
        `${name}End`,
        last.state,
        ...(limb.contact ?? limb.end),
      );
      expect(p[1]).toBeCloseTo(calibratedWalk.edges.bottom[1], 7);
      expect(p[0]).toBeCloseTo(
        limb.root[0] + (limb.contact?.[0] ?? limb.end[0]) - limb.end[0],
        6,
      );
      expect(Math.abs(last.state[`${name}Lower`].a ?? 0)).toBeLessThan(23);
    }
    // The source bone axes/sole offset determine the neutral pelvis height;
    // a fixed -3 lift was valid only for the rejected older straight-leg rig.
    expect(last.motionFailure).toBeUndefined();
    for (const name of ["legBack", "legFront"] as const) {
      const limb = calibratedWalk.limbs[name];
      const root = renderer.point(name, last.state, ...limb.root),
        joint = renderer.point(name, last.state, ...limb.joint),
        ankle = renderer.point(`${name}Lower`, last.state, ...limb.end);
      const cosine =
        ((joint[0] - root[0]) * (ankle[0] - joint[0]) +
          (joint[1] - root[1]) * (ankle[1] - joint[1])) /
        780;
      expect(
        (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI,
      ).toBeLessThan(8);
    }
    expect(maximumTravel).toBeLessThan(240 / fps);
    expect(maximumKneeStep).toBeLessThan(600 / fps);
    expect(idle(10).state).toEqual(last.state);
  },
);

test.each([0.08, 0.28, 0.4, 0.52, 0.65])(
  "walk restarts after %s seconds of stopping from the currently displayed rigid pose",
  (rest) => {
    const engine = new AuthoredPoseAnimation(calibratedPoses);
    const renderer = rig(calibratedWalk);
    const scale = 220 / 256;
    for (let frame = 0; frame <= 45; frame++) {
      const t = frame / 60;
      engine.sample({
        t,
        mode: "idle",
        sit: 0,
        swing: 0,
        locomotion: demoMotion("walk-right", t, calibratedWalk.stride! * scale),
        worldScale: scale,
      });
    }
    engine.sample({
      t: 0.75,
      mode: "idle",
      sit: 0,
      swing: 0,
      locomotion: null,
      worldScale: scale,
    });
    const stopped = engine.sample({
      t: 0.75 + rest,
      mode: "idle",
      sit: 0,
      swing: 0,
      locomotion: null,
      worldScale: scale,
    })!;
    const points = Object.fromEntries(
      Object.entries(calibratedWalk.limbs).map(([name, limb]) => [
        name,
        renderer.point(
          `${name}End`,
          stopped.state,
          ...(limb.contact ?? limb.end),
        ),
      ]),
    );
    const restarted = engine.sample({
      t: 0.75 + rest,
      mode: "idle",
      sit: 0,
      swing: 0,
      locomotion: {
        ...demoMotion("walk-right", 0, calibratedWalk.stride! * scale),
        travel: demoMotion("walk-right", 0.75, calibratedWalk.stride! * scale)
          .travel,
      },
      worldScale: scale,
    })!;
    for (const [name, limb] of Object.entries(calibratedWalk.limbs)) {
      const p = renderer.point(
        `${name}End`,
        restarted.state,
        ...(limb.contact ?? limb.end),
      );
      expect(
        Math.hypot(p[0] - points[name][0], p[1] - points[name][1]) * scale,
      ).toBeLessThan(0.01);
    }
  },
);

test.each(
  (["walk-left", "walk-right"] as const).flatMap((demo) =>
    [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75].flatMap((stopAt) =>
      [0.35, 0.65].map((rest) => [demo, stopAt, rest] as const),
    ),
  ),
)(
  "%s resumes after stopping at %s for %s seconds with stable actual support points",
  (demo, stopAt, rest) => {
    const engine = new AuthoredPoseAnimation(calibratedPoses);
    const renderer = rig(calibratedWalk);
    const scale = 220 / 256;
    const facing = demo === "walk-left" ? -1 : 1;
    for (let frame = 0; frame <= Math.round(stopAt * 60); frame++) {
      const t = frame / 60;
      engine.sample({
        t,
        mode: "idle",
        sit: 0,
        swing: 0,
        locomotion: demoMotion(demo, t, calibratedWalk.stride! * scale),
        worldScale: scale,
      });
    }
    engine.sample({
      t: stopAt,
      mode: "idle",
      sit: 0,
      swing: 0,
      worldScale: scale,
      facing,
    });
    engine.sample({
      t: stopAt + rest,
      mode: "idle",
      sit: 0,
      swing: 0,
      worldScale: scale,
      facing,
    });
    const anchors = new Map<string, number[]>();
    const previous = new Map<string, number[]>();
    const controller = new PetLocomotion(
      {
        revision: 1,
        generation: 0,
        displayId: 1,
        visible: true,
        bounds: { x: 500, y: 420, width: 300, height: 400 },
        workArea: { x: -1280, y: 25, width: 3840, height: 775 },
      },
      { roam: "free", size: 220, edgeClimbing: false, highGliding: false },
      () => {},
      () => (facing < 0 ? 0.1 : 0.9),
    );
    const geometry = {
      visible: { x: 80, y: 130, width: 140, height: 220 },
      feet: { x: 150, y: 350 },
      strideLength: calibratedWalk.stride! * scale,
    };
    for (let frame = 0; frame < 140; frame++) controller.step(0.05, geometry);
    let maximumTravel = 0;
    for (let frame = 0; frame <= 120; frame++) {
      const elapsed = frame / 60;
      if (frame > 0) {
        if (frame > 1) controller.step(1 / 60, geometry);
        controller.receipt(
          {
            ...controller.environment,
            bounds: {
              ...controller.environment.bounds,
              x: controller.x,
              y: controller.y,
            },
          },
          1 / 60,
        );
      }
      // Actual runtime starts with the controller's acceleration and confirmed
      // travel; a constant-speed demo would bypass that motion contract.
      const motion = {
        ...controller.frame,
        travel: {
          x: (controller.frame.travel?.x ?? 0) + facing * stopAt * 60,
          y: controller.frame.travel?.y ?? 0,
        },
      };
      const result = engine.sample({
        t: stopAt + rest + elapsed,
        mode: "idle",
        sit: 0,
        swing: 0,
        locomotion: motion,
        worldScale: scale,
      })!;
      for (const name of ["legBack", "legFront"] as const) {
        const limb = calibratedWalk.limbs[name];
        const p = renderer.point(
          `${name}End`,
          result.state,
          ...(limb.contact ?? limb.end),
        );
        const world = [p[0] * scale * facing + motion.travel!.x, p[1] * scale];
        expect(
          result.motionFailure,
          JSON.stringify({
            elapsed,
            travel: motion.travel,
            failure: result.motionFailure,
          }),
        ).toBeUndefined();
        const prior = previous.get(name);
        if (prior)
          maximumTravel = Math.max(
            maximumTravel,
            Math.hypot(world[0] - prior[0], world[1] - prior[1]),
          );
        previous.set(name, world);
        if (!result.contacts[name]) {
          anchors.delete(name);
          continue;
        }
        const anchor = anchors.get(name);
        if (anchor)
          expect(
            Math.hypot(world[0] - anchor[0], world[1] - anchor[1]),
          ).toBeLessThan(1);
        else anchors.set(name, world);
      }
    }
    expect(maximumTravel).toBeLessThan(4);
  },
);

test.each(["sit", "sleep", "jump", "bow", "drag"])(
  "side idle yields immediately to configured %s behavior and never captures a fresh ordinary idle",
  (mode) => {
    const engine = new AuthoredPoseAnimation(calibratedPoses);
    engine.sample({
      t: 0,
      mode: "idle",
      sit: 0,
      swing: 0,
      locomotion: demoMotion("walk-right", 0),
    });
    engine.sample({
      t: 0.5,
      mode: "idle",
      sit: 0,
      swing: 0,
      locomotion: demoMotion("walk-right", 0.5),
    });
    expect(
      engine.sample({ t: 0.6, mode: "idle", sit: 0, swing: 0 }),
    ).not.toBeNull();
    const event = engine.sample({
      t: 0.7,
      mode,
      sit: mode === "sit" ? 1 : 0,
      swing: 0,
    });
    if (mode === "drag") expect(event?.name).toBe("held");
    else if (mode === "jump") expect(event).toBeNull();
    else expect(event).toBeNull();
    expect(engine.sample({ t: 1, mode: "idle", sit: 0, swing: 0 })).toBeNull();
    expect(
      new AuthoredPoseAnimation(calibratedPoses).sample({
        t: 1,
        mode: "idle",
        sit: 0,
        swing: 0,
      }),
    ).toBeNull();
  },
);

test.each([0.32, 0.47, 0.65])(
  "physical regrab after %s seconds cancels the remaining stop trajectory",
  (rest) => {
    const engine = new AuthoredPoseAnimation(calibratedPoses);
    engine.sample({
      t: 0.75,
      mode: "idle",
      sit: 0,
      swing: 0,
      locomotion: demoMotion("walk-right", 0.75),
    });
    engine.sample({ t: 0.75, mode: "idle", sit: 0, swing: 0 });
    engine.sample({ t: 0.75 + rest, mode: "idle", sit: 0, swing: 0 });
    const grabbed = engine.sample({
      t: 0.75 + rest,
      mode: "idle",
      sit: 0,
      swing: 0,
      locomotion: demoMotion("held", rest),
    });
    expect(grabbed?.name).toBe("held");
    expect(engine.sample({ t: 2, mode: "idle", sit: 0, swing: 0 })).toBeNull();
  },
);

// Frozen candidate 27 roots; canonical limb textures keep the 19/19 and 30/26 bones.
