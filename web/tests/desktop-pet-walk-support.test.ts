import { expect, test } from "vitest";
import {
  WalkSupportController,
  captureWalkSupportSnapshot,
  type WalkSupportSample,
  type WalkSupportStep,
} from "../src/features/desktop-pet/locomotion/walkSupport";
import {
  solveLimb,
  type Point,
} from "../src/features/desktop-pet/locomotion/articulation";
import type {
  GroundLeg,
  GroundSupportPose,
} from "../src/features/desktop-pet/locomotion/supportHeight";
import {
  createRig,
  type RigState,
} from "../src/features/desktop-pet/whale-vendor/rig/rig.js";

const legs: GroundLeg[] = ["legBack", "legFront"],
  scale = 220 / 256;
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** Mathematical complete-view registration, no imported/old artwork. */
function coherentPose(): GroundSupportPose {
  const limb = (x: number) => {
    const upper = (100 * Math.PI) / 180,
      lower = (80 * Math.PI) / 180,
      root: Point = [x, 0],
      joint: Point = [x + 30 * Math.cos(upper), 30 * Math.sin(upper)],
      end: Point = [
        joint[0] + 26 * Math.cos(lower),
        joint[1] + 26 * Math.sin(lower),
      ];
    return {
      root,
      joint,
      end,
      contact: [end[0] + 2, end[1] + 12.5] as Point,
      region: [],
      limits: [-60, 60, -90, 90] as [number, number, number, number],
      bend: 1 as const,
    };
  };
  return { limbs: { legBack: limb(20), legFront: limb(-20) } };
}
function renderer(pose: GroundSupportPose) {
  const deformers = Object.fromEntries(
    legs.flatMap((name) => {
      const l = pose.limbs[name];
      return [
        [name, { kind: "rot" as const, parent: "body", pivot: l.root }],
        [
          `${name}Lower`,
          { kind: "rot" as const, parent: name, pivot: l.joint },
        ],
        [
          `${name}End`,
          { kind: "rot" as const, parent: `${name}Lower`, pivot: l.end },
        ],
      ];
    }),
  );
  const gl = new Proxy({}, { get: () => () => ({}) });
  return createRig({ getContext: () => gl } as unknown as HTMLCanvasElement, {
    view: [-64, 0, 128, 100],
    parts: [],
    deformers: { body: { kind: "rot", pivot: [0, 0] }, ...deformers },
  });
}
const rest: RigState = { alpha: {}, body: {} };
function request(pose: GroundSupportPose): WalkSupportStep {
  const soleY = pose.limbs.legFront.contact![1];
  return {
    distance: 10,
    landing: {
      leg: "legBack",
      point: [pose.limbs.legBack.root[0] + 10, soleY],
    },
    futureDistance: 20,
    overlapDistance: 3,
    nextLanding: [pose.limbs.legFront.root[0] + 10, soleY],
    preferredBodyY: 0,
    rise: -0.3,
    footLift: 4,
  };
}
function begin(pose: GroundSupportPose, travel: Point = [0, 0], state = rest) {
  const controller = new WalkSupportController(pose),
    snapshot = captureWalkSupportSnapshot(
      pose,
      state,
      { legBack: false, legFront: true },
      travel,
    );
  const result = controller.beginStep(snapshot, request(pose));
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return { controller, snapshot };
}
function solve(pose: GroundSupportPose, sample: WalkSupportSample): RigState {
  const state: RigState = { alpha: {}, body: { ty: sample.bodyY } };
  for (const name of legs) {
    const l = pose.limbs[name],
      a = (sample.footAngles[name] * Math.PI) / 180,
      offset: Point = [l.contact![0] - l.end[0], l.contact![1] - l.end[1]],
      target: Point = [
        sample.targets[name][0] -
          offset[0] * Math.cos(a) +
          offset[1] * Math.sin(a),
        sample.targets[name][1] -
          offset[0] * Math.sin(a) -
          offset[1] * Math.cos(a) -
          sample.bodyY,
      ];
    const ik = solveLimb({ ...l, parts: ["", "", ""] }, target, l.bend);
    expect(ik.upper).toBeGreaterThanOrEqual(l.limits[0] - 1e-6);
    expect(ik.upper).toBeLessThanOrEqual(l.limits[1] + 1e-6);
    expect(ik.lower).toBeGreaterThanOrEqual(l.limits[2] - 1e-6);
    expect(ik.lower).toBeLessThanOrEqual(l.limits[3] + 1e-6);
    expect(distance(ik.end, target)).toBeLessThan(1e-8);
    state[name] = { a: ik.upper };
    state[`${name}Lower`] = { a: ik.lower };
    state[`${name}End`] = { a: sample.footAngles[name] - ik.upper - ik.lower };
  }
  return state;
}

test("snapshot capture agrees with actual production FK at rest and a nonzero displayed pose", () => {
  const pose = coherentPose(),
    rig = renderer(pose),
    state: RigState = {
      alpha: {},
      body: { ty: 2.5 },
      legFront: { a: -4 },
      legFrontLower: { a: -3 },
      legFrontEnd: { a: 7 },
    },
    snapshot = captureWalkSupportSnapshot(
      pose,
      state,
      { legFront: true, legBack: false },
      [17, -40],
    );
  for (const name of legs) {
    const l = pose.limbs[name],
      p = snapshot.joints[name];
    expect(
      distance(p.root, rig.point(name, state, ...l.root) as Point),
    ).toBeLessThan(1e-10);
    expect(
      distance(p.joint, rig.point(name, state, ...l.joint) as Point),
    ).toBeLessThan(1e-10);
    expect(
      distance(p.ankle, rig.point(`${name}Lower`, state, ...l.end) as Point),
    ).toBeLessThan(1e-10);
    expect(
      distance(p.sole, rig.point(`${name}End`, state, ...l.contact!) as Point),
    ).toBeLessThan(1e-10);
  }
});

test("entry keeps the actual snapshot and unchanged receipts cannot advance the pose", () => {
  const pose = coherentPose(),
    { controller, snapshot } = begin(pose, [-20, 50]),
    before = structuredClone(snapshot),
    first = controller.sample([-20, 50]);
  expect(first.ok).toBe(true);
  if (!first.ok) return;
  expect(first.bodyY).toBe(snapshot.bodyY);
  for (const name of legs)
    expect(
      distance(first.targets[name], snapshot.joints[name].sole),
    ).toBeLessThan(1e-10);
  expect(controller.sample([-20, 50])).toEqual(first);
  expect(snapshot).toEqual(before);
});

test.each([
  [-1, 30],
  [1, 30],
  [-1, 60],
  [1, 60],
  [1, 240],
])(
  "host receipts facing%s at %sfps retain world shoes and continuous planned height",
  (facing, fps) => {
    const pose = coherentPose(),
      rig = renderer(pose),
      { controller } = begin(pose),
      requestStep = request(pose);
    const anchors = new Map<GroundLeg, Point>();
    let previousHeight: number | undefined,
      maximumDrift = 0,
      maximumBodyStep = 0;
    // Traverse both the active step and its already checked support lookahead.
    // No new angular blend or per-frame body projection is introduced here.
    for (let i = 0; i <= 6 * fps; i++) {
      const travel: Point = [(30 * i) / (6 * fps), 0],
        sample = controller.sample(travel);
      expect(sample.ok, JSON.stringify({ travel, sample })).toBe(true);
      if (!sample.ok) continue;
      const state = solve(pose, sample);
      if (previousHeight !== undefined)
        maximumBodyStep = Math.max(
          maximumBodyStep,
          Math.abs(sample.bodyY - previousHeight),
        );
      previousHeight = sample.bodyY;
      for (const name of legs) {
        const l = pose.limbs[name],
          shoe = rig.point(`${name}End`, state, ...l.contact!) as Point,
          world: Point = [
            facing * (shoe[0] + travel[0]) * scale,
            shoe[1] * scale,
          ];
        expect(distance(shoe, sample.targets[name])).toBeLessThan(1e-8);
        if (sample.contacts[name]) {
          if (anchors.has(name))
            maximumDrift = Math.max(
              maximumDrift,
              distance(world, anchors.get(name)!),
            );
          else anchors.set(name, world);
        } else anchors.delete(name);
        const root = rig.point(name, state, ...l.root) as Point,
          knee = rig.point(name, state, ...l.joint) as Point,
          ankle = rig.point(`${name}Lower`, state, ...l.end) as Point;
        expect(distance(root, knee)).toBeCloseTo(30, 9);
        expect(distance(knee, ankle)).toBeCloseTo(26, 9);
      }
      if (travel[0] === requestStep.distance)
        expect(sample.contacts).toEqual({ legBack: true, legFront: true });
    }
    expect(maximumDrift).toBeLessThan(1e-8);
    expect(maximumBodyStep).toBeLessThan(0.25);
  },
);

test("support handoff establishes the new shoe before releasing the previous shoe", () => {
  const pose = coherentPose(),
    { controller } = begin(pose);
  for (const [d, expected] of [
    [9.99, { legFront: true, legBack: false }],
    [10, { legFront: true, legBack: true }],
    [13, { legFront: true, legBack: true }],
    [13.01, { legFront: false, legBack: true }],
    [30, { legFront: true, legBack: true }],
  ] as const) {
    const sample = controller.sample([d, 0]);
    expect(sample.ok).toBe(true);
    if (sample.ok) expect(sample.contacts).toEqual(expected);
  }
});

test("future unreachable placement is rejected before either new world contact exists", () => {
  const pose = coherentPose(),
    controller = new WalkSupportController(pose),
    snapshot = captureWalkSupportSnapshot(
      pose,
      rest,
      { legFront: true, legBack: false },
      [0, 0],
    ),
    step = request(pose);
  const input = structuredClone({ snapshot, step });
  step.nextLanding[0] = 2000;
  expect(controller.beginStep(snapshot, step)).toEqual({
    ok: false,
    reason: "support-window-infeasible",
  });
  expect(controller.sample([0, 0])).toEqual({
    ok: false,
    reason: "no-active-window",
  });
  expect(snapshot).toEqual(input.snapshot);
});

test("cancel, reversed or changed-plane receipts never revive an old trajectory", () => {
  const pose = coherentPose(),
    { controller } = begin(pose);
  expect(controller.sample([2, 0]).ok).toBe(true);
  expect(controller.sample([1, 0])).toEqual({
    ok: false,
    reason: "travel-reversed",
  });
  expect(controller.sample([2, 1])).toEqual({
    ok: false,
    reason: "travel-reversed",
  });
  expect(controller.sample([3, 0])).toEqual({
    ok: false,
    reason: "travel-reversed",
  });
  controller.cancel();
  expect(controller.sample([8, 0])).toEqual({
    ok: false,
    reason: "no-active-window",
  });
});

test("a replacement plan begins from the displayed pose with no scale or joint jump", () => {
  const pose = coherentPose(),
    rig = renderer(pose),
    { controller } = begin(pose),
    sample = controller.sample([5, 0]);
  expect(sample.ok).toBe(true);
  if (!sample.ok) return;
  const state = solve(pose, sample),
    snapshot = captureWalkSupportSnapshot(pose, state, sample.contacts, [5, 0]);
  const result = controller.beginStep(snapshot, {
    ...request(pose),
    distance: 5,
  });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  const after = controller.sample([5, 0]);
  expect(after.ok).toBe(true);
  if (!after.ok) return;
  const displayed = solve(pose, after);
  expect(after.bodyY).toBe(sample.bodyY);
  for (const name of legs) {
    const l = pose.limbs[name];
    expect(
      distance(
        rig.point(`${name}End`, displayed, ...l.contact!) as Point,
        rig.point(`${name}End`, state, ...l.contact!) as Point,
      ),
    ).toBeLessThan(1e-8);
    expect(
      distance(
        rig.point(name, displayed, ...l.joint) as Point,
        rig.point(name, state, ...l.joint) as Point,
      ),
    ).toBeLessThan(1e-8);
  }
});

test("candidate32's original rest branch contradiction remains an explicit failure", () => {
  const pose = coherentPose();
  pose.limbs.legFront = {
    root: [119.34658819117463, 188],
    joint: [109.09912683861828, 215.09884224342682],
    end: [107.50507729488729, 236.50465040210008],
    contact: [113.19811137964082, 262.4648858285762],
    region: [],
    limits: [-45, 45, -100, 100],
    bend: -1,
  };
  const controller = new WalkSupportController(pose),
    snapshot = captureWalkSupportSnapshot(
      pose,
      rest,
      { legFront: true, legBack: false },
      [0, 0],
    );
  expect(controller.beginStep(snapshot, request(pose))).toEqual({
    ok: false,
    reason: "source-branch-inconsistent",
    leg: "legFront",
  });
  expect(pose.limbs.legFront.limits).toEqual([-45, 45, -100, 100]);
  expect(pose.limbs.legFront.bend).toBe(-1);
});

test("body endpoints and handoff have zero boundary velocity without a framewise projection", () => {
  const pose = coherentPose(),
    { controller } = begin(pose),
    epsilon = 1e-4;
  const samples = [
    0,
    epsilon,
    10 - epsilon,
    10,
    10 + epsilon,
    13 - epsilon,
    13,
    13 + epsilon,
    30 - epsilon,
    30,
  ].map((x) => {
    const sample = controller.sample([x, 0]);
    expect(sample.ok).toBe(true);
    return { x, sample: sample as WalkSupportSample };
  });
  for (const [a, b] of [
    [0, 1],
    [2, 3],
    [3, 4],
    [8, 9],
  ])
    expect(
      Math.abs(samples[a].sample.bodyY - samples[b].sample.bodyY) / epsilon,
    ).toBeLessThan(1e-3);
  const world = (i: number): Point => [
    samples[i].sample.targets.legFront[0] + samples[i].x,
    samples[i].sample.targets.legFront[1],
  ];
  expect(distance(world(5), world(6))).toBeLessThan(1e-9);
  expect(distance(world(6), world(7)) / epsilon).toBeLessThan(1e-3);
});

test("rotated/scaled snapshots are captured honestly and rejected for the ground plane", () => {
  const pose = coherentPose(),
    rig = renderer(pose),
    state: RigState = {
      alpha: {},
      body: { a: 2, sx: 1.1, sy: 1.1, pivot: [0, 0] },
    },
    snapshot = captureWalkSupportSnapshot(
      pose,
      state,
      { legFront: true, legBack: false },
      [0, 0],
    );
  for (const name of legs)
    expect(
      distance(
        snapshot.joints[name].sole,
        rig.point(`${name}End`, state, ...pose.limbs[name].contact!) as Point,
      ),
    ).toBeLessThan(1e-9);
  expect(
    new WalkSupportController(pose).beginStep(snapshot, request(pose)),
  ).toEqual({ ok: false, reason: "snapshot-not-ground-view" });
});

test("changed-plane failure stays stopped, and failed replacement cannot resurrect its previous plan", () => {
  const pose = coherentPose(),
    { controller } = begin(pose);
  expect(controller.sample([1, 1])).toEqual({
    ok: false,
    reason: "invalid-step-input",
  });
  expect(controller.sample([1, 0])).toEqual({
    ok: false,
    reason: "invalid-step-input",
  });
  const snapshot = captureWalkSupportSnapshot(
    pose,
    rest,
    { legFront: true, legBack: false },
    [0, 0],
  );
  const step = request(pose);
  step.nextLanding[0] = 2000;
  expect(controller.beginStep(snapshot, step).ok).toBe(false);
  expect(controller.sample([2, 0])).toEqual({
    ok: false,
    reason: "no-active-window",
  });
});
