import { expect, test } from "vitest";
import fixture from "./fixtures/desktop-pet-motion-v2.json";
import calibrated from "./fixtures/desktop-pet-calibrated-walk.json";
import {
  AuthoredPoseAnimation,
  bindPoseParts,
  type AuthoredPose,
  type AuthoredPoses,
} from "../src/features/desktop-pet/locomotion/authoredPose";
import {
  jointDeformers,
  type MotionRig,
  type Point,
} from "../src/features/desktop-pet/locomotion/articulation";
import { demoMotion } from "../src/features/desktop-pet/locomotion/demo";
import { createRig } from "../src/features/desktop-pet/whale-vendor/rig/rig.js";
import type { RigState } from "../src/features/desktop-pet/whale-vendor/rig/rig.js";

const names = ["armNear", "armFar", "legBack", "legFront"] as const;
const dist = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);
function resources() {
  const held = structuredClone(calibrated) as AuthoredPose;
  held.part = "held_complete_core";
  delete held.head;
  held.waist = [128, 188];
  for (const [index, name] of names.entries()) {
    const limb = held.limbs[name],
      leg = index >= 2;
    const root: Point = leg ? [110 + index * 9, 211] : [148 + index * 19, 226];
    const upperAngle = ((leg ? 85 : 94 + index * 3) * Math.PI) / 180;
    const lowerAngle = ((leg ? 93 : 87 - index) * Math.PI) / 180;
    limb.root = root;
    limb.joint = [
      root[0] + Math.cos(upperAngle) * (leg ? 30 : 19),
      root[1] + Math.sin(upperAngle) * (leg ? 30 : 19),
    ];
    limb.end = [
      limb.joint[0] + Math.cos(lowerAngle) * (leg ? 26 : 19),
      limb.joint[1] + Math.sin(lowerAngle) * (leg ? 26 : 19),
    ];
    limb.contact = [limb.end[0] + 2, limb.end[1] + (leg ? 12.5 : 10)];
    limb.segments = [`held_${name}_0`, `held_${name}_1`, `held_${name}_2`];
    limb.limits = [-35, 35, -70, 70];
  }
  const poses = { ...fixture.poses, held, walk: calibrated } as AuthoredPoses;
  const gl = new Proxy(
    {},
    {
      get: (_, key) =>
        ["getShaderParameter", "getProgramParameter"].includes(String(key))
          ? () => true
          : () => ({}),
    },
  );
  const rig = createRig(
    { getContext: () => gl } as unknown as HTMLCanvasElement,
    {
      parts: [],
      view: [-100, -8, 400, 400],
      deformers: {
        body: { kind: "rot", pivot: held.waist },
        ...jointDeformers({
          limbs: held.limbs,
          waist: held.waist,
        } as unknown as MotionRig),
      },
    },
  );
  return { held, poses, rig, engine: new AuthoredPoseAnimation(poses) };
}
function hold(setup: ReturnType<typeof resources>, t: number, swing = 18) {
  return setup.engine.sample({
    t,
    mode: "idle",
    sit: 0,
    swing: 0,
    locomotion: { ...demoMotion("held", t), swing },
    gripPoint: setup.held.waist,
  })!;
}
const idle = (setup: ReturnType<typeof resources>, t: number) =>
  setup.engine.sample({ t, mode: "idle", sit: 0, swing: 0 });
function displayed(setup: ReturnType<typeof resources>, state: RigState) {
  return names.flatMap((name) => {
    const limb = setup.held.limbs[name];
    return [
      setup.rig.point(name, state, ...limb.root),
      setup.rig.point(name, state, ...limb.joint),
      setup.rig.point(`${name}Lower`, state, ...limb.end),
      setup.rig.point(`${name}End`, state, ...limb.contact!),
    ];
  });
}

test("stationary waist hold preserves the authored downward arms and every rest joint", () => {
  const setup = resources();
  for (let index = 0; index <= 120; index++) hold(setup, index / 60, 0);
  const result = hold(setup, 2, 0);
  for (const name of names) {
    const limb = setup.held.limbs[name];
    expect(result.state[name].a).toBe(0);
    expect(result.state[`${name}Lower`].a).toBe(0);
    expect(result.state[`${name}End`].a).toBe(0);
    expect(setup.rig.point(name, result.state, ...limb.joint)).toEqual(
      limb.joint,
    );
    expect(setup.rig.point(`${name}Lower`, result.state, ...limb.end)).toEqual(
      limb.end,
    );
    if (name.startsWith("arm")) {
      const wrist = setup.rig.point(`${name}Lower`, result.state, ...limb.end);
      const hand = setup.rig.point(
        `${name}End`,
        result.state,
        ...limb.contact!,
      );
      expect(wrist[1]).toBeGreaterThan(limb.root[1]);
      expect(hand[1]).toBeGreaterThan(wrist[1]);
    }
  }
});

test.each([-18, 18])(
  "drag swing %s keeps both hands below their shoulders with limited joint motion",
  (swing) => {
    const setup = resources();
    for (let index = 0; index <= 120; index++) hold(setup, index / 60, swing);
    const result = hold(setup, 2, swing);
    for (const name of ["armNear", "armFar"] as const) {
      const limb = setup.held.limbs[name];
      const root = setup.rig.point(name, result.state, ...limb.root);
      const wrist = setup.rig.point(`${name}Lower`, result.state, ...limb.end);
      const hand = setup.rig.point(
        `${name}End`,
        result.state,
        ...limb.contact!,
      );
      expect(wrist[1]).toBeGreaterThan(root[1]);
      expect(hand[1]).toBeGreaterThan(wrist[1]);
      expect(Math.abs(Number(result.state[name].a))).toBeLessThanOrEqual(6);
      expect(
        Math.abs(Number(result.state[`${name}Lower`].a)),
      ).toBeLessThanOrEqual(3);
    }
  },
);

test.each([30, 60])(
  "%s fps complete held surface remains connected and never folds during dragging",
  (fps) => {
    const setup = resources();
    for (const limb of Object.values(setup.held.limbs)) {
      delete limb.segments;
      const points = [limb.root, limb.joint, limb.end, limb.contact!];
      const xs = points.map((p) => p[0]),
        ys = points.map((p) => p[1]);
      const left = Math.min(...xs) - 8,
        right = Math.max(...xs) + 8;
      limb.region = [
        [left, Math.min(...ys) - 4],
        [right, Math.min(...ys) - 4],
        [right, Math.max(...ys) + 4],
        [left, Math.max(...ys) + 4],
      ];
    }
    const part = bindPoseParts(
      [
        {
          id: setup.held.part,
          tex: "whole_held",
          box: [80, 170, 140, 140],
          grid: [16, 16],
          parent: "body",
          z: 3,
        },
      ],
      { held: setup.held },
    )[0];
    const mesh = part.mesh!;
    let displayedVertices = new Float32Array();
    const gl = new Proxy(
      {},
      {
        get: (_, key) => {
          if (key === "bufferSubData")
            return (
              _target: unknown,
              _offset: unknown,
              vertices: Float32Array,
            ) => {
              displayedVertices = new Float32Array(vertices);
            };
          if (
            ["getShaderParameter", "getProgramParameter"].includes(String(key))
          )
            return () => true;
          return () => ({});
        },
      },
    );
    const renderer = createRig(
      { getContext: () => gl } as unknown as HTMLCanvasElement,
      {
        parts: [part],
        view: [80, 170, 220, 310],
        deformers: {
          body: { kind: "rot", pivot: setup.held.waist },
          ...jointDeformers({
            limbs: setup.held.limbs,
            waist: setup.held.waist,
          } as unknown as MotionRig),
        },
      },
    );
    renderer.upload(part.tex, document.createElement("canvas"));
    const area = (vertices: Float32Array, a: number, b: number, c: number) =>
      (vertices[b * 2] - vertices[a * 2]) *
        (vertices[c * 2 + 1] - vertices[a * 2 + 1]) -
      (vertices[b * 2 + 1] - vertices[a * 2 + 1]) *
        (vertices[c * 2] - vertices[a * 2]);
    for (let i = 0; i <= 3 * fps; i++) {
      const result = hold(
        setup,
        i / fps,
        i < fps ? Math.sin((i / fps) * 12) * 18 : 0,
      );
      renderer.render(result.state);
      const shared = new Map<string, Point>();
      for (let v = 0; v < mesh.positions.length / 2; v++) {
        const key = `${mesh.positions[v * 2]}:${mesh.positions[v * 2 + 1]}`;
        const at: Point = [
          displayedVertices[v * 2],
          displayedVertices[v * 2 + 1],
        ];
        if (shared.has(key))
          expect(dist(at, shared.get(key)!)).toBeLessThan(1e-6);
        else shared.set(key, at);
      }
      for (let j = 0; j < mesh.indices.length; j += 3) {
        const [a, b, c] = mesh.indices.slice(j, j + 3);
        expect(
          area(displayedVertices, a, b, c) / area(mesh.positions, a, b, c),
        ).toBeGreaterThan(0.25);
      }
    }
  },
);

test.each([30, 60])(
  "%s fps release damps the actual same-core body/limbs with fixed bones and an unchanged grip",
  (fps) => {
    const setup = resources();
    for (let index = 0; index <= fps; index++) hold(setup, index / fps);
    const from = hold(setup, 1),
      first = idle(setup, 1.001)!;
    expect(first.name).toBe("held");
    expect(first.pose).toBe(from.pose);
    expect(first.transition).toEqual({
      kind: "held-release",
      progress: 0,
      needsView: "held-recovery",
    });
    for (const [index, point] of displayed(setup, first.state).entries())
      expect(dist(point, displayed(setup, from.state)[index])).toBeLessThan(
        1e-9,
      );
    let previous = first;
    for (let index = 1; index < 0.24 * fps; index++) {
      const result = idle(setup, 1.001 + index / fps)!;
      expect(Math.abs(Number(result.state.body.a))).toBeLessThanOrEqual(
        Math.abs(Number(previous.state.body.a)),
      );
      expect(
        setup.rig.point("body", result.state, ...setup.held.waist),
      ).toEqual(setup.held.waist);
      expect(result.state.neck.a ?? 0).toBe(0);
      expect(
        dist(
          setup.rig.point("body", result.state, 128, 100),
          setup.rig.point("body", result.state, 128, 170),
        ),
      ).toBeCloseTo(70, 8);
      for (const name of names) {
        const limb = setup.held.limbs[name],
          leg = name.startsWith("leg");
        const root = setup.rig.point(name, result.state, ...limb.root),
          joint = setup.rig.point(name, result.state, ...limb.joint);
        const end = setup.rig.point(`${name}Lower`, result.state, ...limb.end),
          contact = setup.rig.point(
            `${name}End`,
            result.state,
            ...limb.contact!,
          );
        expect(dist(root, joint)).toBeCloseTo(leg ? 30 : 19, 8);
        expect(dist(joint, end)).toBeCloseTo(leg ? 26 : 19, 8);
        expect(
          dist(root, setup.rig.point("body", result.state, ...limb.root)),
        ).toBeLessThan(1e-8);
        expect(dist(contact, result.endpoints[name])).toBeLessThan(1e-8);
        expect(result.contacts[name]).toBe(false);
        expect(result.state[name].sx ?? 1).toBe(1);
        expect(result.state[name].sy ?? 1).toBe(1);
        expect(result.state.head.sx ?? 1).toBe(1);
        expect(result.state.head.sy ?? 1).toBe(1);
        expect(
          dist(
            contact,
            setup.rig.point(`${name}End`, previous.state, ...limb.contact!),
          ),
        ).toBeLessThan(3);
      }
      previous = result;
    }
    // The available held core cannot unfold itself. Expiry explicitly yields to
    // the legacy idle path; this test is not evidence of a natural view change.
    expect(idle(setup, 1.242)).toBeNull();
  },
);

test.each([0, 0.03, 0.12, 0.23])(
  "regrab at %ss of release continues all displayed FK points instead of resetting to rest",
  (elapsed) => {
    const setup = resources();
    for (let index = 0; index <= 60; index++) hold(setup, index / 60);
    idle(setup, 1.001);
    const source = idle(setup, 1.001 + elapsed)!;
    const actual = hold(setup, 1.002 + elapsed, 0);
    for (const [index, point] of displayed(setup, actual.state).entries())
      expect(dist(point, displayed(setup, source.state)[index])).toBeLessThan(
        1e-8,
      );
    expect(actual.transition).toBeUndefined();
    let final = actual;
    for (let index = 1; index <= 120; index++)
      final = hold(setup, 1.002 + elapsed + index / 60, 0);
    expect(Math.abs(Number(final.state.body.a))).toBeLessThan(0.001);
    expect(setup.rig.point("body", final.state, ...setup.held.waist)).toEqual(
      setup.held.waist,
    );
  },
);

test("held release does not capture configured sitting/sleep or a different complete pose", () => {
  const setup = resources();
  hold(setup, 0);
  hold(setup, 0.5);
  idle(setup, 0.51);
  expect(
    setup.engine.sample({ t: 0.52, mode: "sleep", sit: 0, swing: 0 }),
  ).toBeNull();
  const fresh = hold(setup, 0.53, 0);
  expect(fresh.state.legBackLower.a).toBeCloseTo(0, 8);
  expect(
    setup.engine.sample({ t: 0.54, mode: "sit", sit: 1, swing: 0 }),
  ).toBeNull();
});

test("a physical landing gets a bounded same-held-core recovery window, with the missing upright view explicit", () => {
  const setup = resources();
  hold(setup, 0);
  const from = hold(setup, 0.5);
  const landed = setup.engine.sample({
    t: 0.51,
    mode: "idle",
    sit: 0,
    swing: 0,
    locomotion: demoMotion("land", 0.51),
  })!;
  expect(landed.pose).toBe(from.pose);
  expect(landed.transition?.needsView).toBe("held-recovery");
  const completed = setup.engine.sample({
    t: 0.76,
    mode: "idle",
    sit: 0,
    swing: 0,
    locomotion: demoMotion("land", 0.76),
  })!;
  expect(completed.name).toBe("walk");
  expect(completed.transition).toBeUndefined();
});

test("same walk view used as an event cannot reactivate a previous physical startup phase", () => {
  const setup = resources();
  for (let index = 0; index <= 180; index++) {
    const t = index / 60;
    setup.engine.sample({
      t,
      mode: "idle",
      sit: 0,
      swing: 0,
      locomotion: demoMotion("walk-right", t, calibrated.stride),
    });
  }
  const event = setup.engine.sample({
    t: 3.01,
    mode: "walk",
    sit: 0,
    swing: 0,
    gait: { phase: 0, stride: 0, lift: 0 },
  })!;
  expect(event.state.body.ty).toBeCloseTo(0, 10);
  const landed = setup.engine.sample({
    t: 3.02,
    mode: "idle",
    sit: 0,
    swing: 0,
    locomotion: demoMotion("land", 0),
  })!;
  expect(landed.state.body.ty).toBeCloseTo(0, 10);
});

test("legacy whole-pose held still yields immediately to ordinary idle", () => {
  const engine = new AuthoredPoseAnimation(fixture.poses as AuthoredPoses);
  engine.sample({ t: 0, mode: "held", sit: 0, swing: 0 });
  expect(engine.sample({ t: 0.1, mode: "idle", sit: 0, swing: 0 })).toBeNull();
});
