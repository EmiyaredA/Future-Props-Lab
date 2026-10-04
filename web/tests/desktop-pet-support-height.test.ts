import { expect, test } from "vitest";
import {
  solveSupportHeight,
  type GroundLeg,
  type GroundSupportPose,
} from "../src/features/desktop-pet/locomotion/supportHeight";
import {
  solveLimb,
  jointDeformers,
  type MotionRig,
  type Point,
} from "../src/features/desktop-pet/locomotion/articulation";
import type { PoseLimb } from "../src/features/desktop-pet/locomotion/authoredPose";
import {
  createRig,
  type RigState,
} from "../src/features/desktop-pet/whale-vendor/rig/rig.js";

const names: GroundLeg[] = ["legBack", "legFront"];
const scale = 220 / 256;
const length = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
// Independent regression coordinates from candidate32's newly painted complete
// side pose, normalized uniformly. This fixture is geometry, not an old texture.
const actual: GroundSupportPose = {
  limbs: {
    legBack: {
      root: [135.0593622650944, 187.31683590982956],
      joint: [133.69303408475352, 215.09884224342682],
      end: [132.55442726780282, 235.82148631192968],
      contact: [141.43556044001832, 260.18767219467475],
      region: [],
      limits: [-45, 45, -100, 100],
      bend: -1,
    },
    legFront: {
      root: [119.34658819117463, 188],
      joint: [109.09912683861828, 215.09884224342682],
      end: [107.50507729488729, 236.50465040210008],
      contact: [113.19811137964082, 262.4648858285762],
      region: [],
      limits: [-45, 45, -100, 100],
      bend: -1,
    },
  },
};
function renderer(pose: GroundSupportPose) {
  const gl = new Proxy({}, { get: () => () => ({}) });
  // Add no rendered texture or fake face. The actual production FK for each
  // rigid support chain is all this ground-plane test needs.
  const limbs = {
    ...pose.limbs,
    armNear: pose.limbs.legBack,
    armFar: pose.limbs.legFront,
  };
  return createRig({ getContext: () => gl } as unknown as HTMLCanvasElement, {
    view: [0, 0, 256, 300],
    parts: [],
    deformers: {
      body: { kind: "rot", pivot: [128, 188] },
      ...jointDeformers({ limbs, waist: [128, 188] } as unknown as MotionRig),
    },
  });
}
function state(
  pose: GroundSupportPose,
  targets: Record<GroundLeg, Point>,
  bodyY: number,
  footAngles: Partial<Record<GroundLeg, number>> = {},
) {
  const state: RigState = { alpha: {}, body: { ty: bodyY } };
  for (const name of names) {
    const limb = pose.limbs[name],
      theta = ((footAngles[name] ?? 0) * Math.PI) / 180,
      offset: Point = [
        limb.contact![0] - limb.end[0],
        limb.contact![1] - limb.end[1],
      ];
    const target: Point = [
      targets[name][0] -
        offset[0] * Math.cos(theta) +
        offset[1] * Math.sin(theta),
      targets[name][1] -
        offset[0] * Math.sin(theta) -
        offset[1] * Math.cos(theta) -
        bodyY,
    ];
    const bone = solveLimb({ ...limb, parts: ["", "", ""] }, target, limb.bend);
    // No angle clamp in this test: the height contract must make the target
    // reachable under the registered limits before a renderer gets it.
    expect(bone.upper).toBeGreaterThanOrEqual(limb.limits[0] - 1e-7);
    expect(bone.upper).toBeLessThanOrEqual(limb.limits[1] + 1e-7);
    expect(bone.lower).toBeGreaterThanOrEqual(limb.limits[2] - 1e-7);
    expect(bone.lower).toBeLessThanOrEqual(limb.limits[3] + 1e-7);
    state[name] = { a: bone.upper };
    state[`${name}Lower`] = { a: bone.lower };
    state[`${name}End`] = {
      a: (footAngles[name] ?? 0) - bone.upper - bone.lower,
    };
  }
  return state;
}
function targets(pose: GroundSupportPose, dx = 0): Record<GroundLeg, Point> {
  return Object.fromEntries(
    names.map((name) => {
      const limb = pose.limbs[name];
      return [
        name,
        [limb.root[0] + limb.contact![0] - limb.end[0] + dx, 262.4648858285762],
      ];
    }),
  ) as Record<GroundLeg, Point>;
}

test("real sole offsets require a common pelvis height instead of clamping either ankle", () => {
  const desired = targets(actual);
  const input = structuredClone({ pose: actual, targets: desired });
  const result = solveSupportHeight(
    actual,
    desired,
    { legBack: true, legFront: true },
    -3,
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.bodyY).toBeCloseTo(2.232378857, 8);
  const rig = renderer(actual),
    s = state(actual, desired, result.bodyY);
  for (const name of names) {
    const limb = actual.limbs[name];
    const point = rig.point(`${name}End`, s, ...limb.contact!) as Point;
    expect(length(point, desired[name])).toBeLessThan(1e-8);
    const root = rig.point(name, s, ...limb.root) as Point,
      joint = rig.point(name, s, ...limb.joint) as Point,
      ankle = rig.point(`${name}Lower`, s, ...limb.end) as Point;
    expect(length(root, joint)).toBeCloseTo(length(limb.root, limb.joint), 10);
    expect(length(joint, ankle)).toBeCloseTo(length(limb.joint, limb.end), 10);
  }
  expect({ pose: actual, targets: desired }).toEqual(input);
});

test.each([
  [-1, 30],
  [1, 30],
  [-1, 60],
  [1, 60],
])(
  "six-second facing%s world supports at %sfps preserve both shoes and bone lengths",
  (facing, fps) => {
    const pose = actual,
      rig = renderer(pose),
      anchors = targets(pose, 3);
    let maximumDrift = 0;
    // Host-confirmed travel across the supported interval; changing the body's
    // requested gait lift must not change a single world contact.
    for (let i = 0; i <= fps * 6; i++) {
      const travel = (18 * i) / (fps * 6),
        desired = Object.fromEntries(
          names.map((name) => [
            name,
            [anchors[name][0] - travel, anchors[name][1]],
          ]),
        ) as Record<GroundLeg, Point>;
      const result = solveSupportHeight(
        pose,
        desired,
        { legBack: true, legFront: true },
        -3 * Math.max(0, Math.cos((i / fps) * 4)),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const s = state(pose, desired, result.bodyY);
      for (const name of names) {
        const l = pose.limbs[name],
          point = rig.point(`${name}End`, s, ...l.contact!) as Point;
        maximumDrift = Math.max(
          maximumDrift,
          length(
            [facing * (point[0] + travel), point[1]],
            [facing * anchors[name][0], anchors[name][1]],
          ) * scale,
        );
        const a = rig.point(name, s, ...l.root) as Point,
          b = rig.point(name, s, ...l.joint) as Point,
          c = rig.point(`${name}Lower`, s, ...l.end) as Point;
        expect(length(a, b)).toBeCloseTo(length(l.root, l.joint), 9);
        expect(length(b, c)).toBeCloseTo(length(l.joint, l.end), 9);
        expect(Number(s[name].sx ?? 1)).toBe(1);
      }
    }
    expect(maximumDrift).toBeLessThan(1e-8);
  },
);

test("registered angular limits constrain common height before any angle clamp", () => {
  const pose = structuredClone(actual);
  pose.limbs.legBack.limits[2] = 25;
  pose.limbs.legBack.limits[3] = 50;
  const desired = targets(pose);
  const result = solveSupportHeight(
    pose,
    desired,
    { legBack: true, legFront: true },
    0,
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const s = state(pose, desired, result.bodyY);
  expect(Number(s.legBackLower.a)).toBeCloseTo(25, 6);
});

test("a slanted painted boot uses its actual rotated contact-to-ankle offset", () => {
  const desired = targets(actual, 4),
    footAngles = { legBack: 8, legFront: -6 };
  const result = solveSupportHeight(
    actual,
    desired,
    { legBack: true, legFront: true },
    -4,
    footAngles,
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const rig = renderer(actual),
    s = state(actual, desired, result.bodyY, footAngles);
  for (const name of names)
    expect(
      length(
        rig.point(`${name}End`, s, ...actual.limbs[name].contact!) as Point,
        desired[name],
      ),
    ).toBeLessThan(1e-8);
});

test("infeasible or absent contacts yield explicit outcomes and never alter targets", () => {
  const desired = targets(actual);
  expect(solveSupportHeight(actual, desired, {}, -3)).toEqual({
    ok: true,
    bodyY: -3,
    intervals: [],
    constraints: [],
  });
  expect(
    solveSupportHeight(
      actual,
      { ...desired, legBack: [1000, 262] },
      { legBack: true },
      0,
    ),
  ).toMatchObject({ ok: false, reason: "horizontal-reach", name: "legBack" });
  const missing = structuredClone(actual);
  delete missing.limbs.legBack.contact;
  expect(
    solveSupportHeight(missing, desired, { legBack: true }, 0),
  ).toMatchObject({ ok: false, reason: "missing-sole-contact" });
  expect(
    solveSupportHeight(actual, desired, { legBack: true }, NaN),
  ).toMatchObject({ ok: false, reason: "invalid-support-input" });
  expect(
    solveSupportHeight(
      actual,
      targets(actual, 4),
      { legBack: true, legFront: true },
      0,
    ),
  ).toMatchObject({ ok: false, reason: "no-common-height" });
  expect(
    solveSupportHeight(
      actual,
      { ...desired, legFront: [desired.legFront[0], 400] },
      { legBack: true, legFront: true },
      0,
    ),
  ).toMatchObject({ ok: false, reason: "no-common-height" });
});

test("fixed registered joint limits retain their exact feasible support instead of sampling it away", () => {
  const limb: PoseLimb = {
    root: [0, 0],
    joint: [0, 30],
    end: [13, 52.5166604984],
    contact: [13, 64.5166604984],
    region: [],
    limits: [0, 0, 0, 0],
    bend: 1,
  };
  const pose: GroundSupportPose = { limbs: { legBack: limb, legFront: limb } };
  const result = solveSupportHeight(
    pose,
    { legBack: [...limb.contact!] },
    { legBack: true },
    -3,
  );
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.bodyY).toBeCloseTo(0, 8);
});

test("analytic intervals agree with independently evaluated IK over varied source axes", () => {
  const radians = Math.PI / 180;
  for (const upper of [45, 90, 135])
    for (const lower of [60, 95, 150])
      for (const bend of [-1, 1] as const) {
        const joint: Point = [
          30 * Math.cos(upper * radians),
          30 * Math.sin(upper * radians),
        ];
        const limb: PoseLimb = {
          root: [0, 0],
          joint,
          end: [
            joint[0] + 26 * Math.cos(lower * radians),
            joint[1] + 26 * Math.sin(lower * radians),
          ],
          contact: [0, 0],
          limits: [-30, 35, -85, 95],
          region: [],
          bend,
        };
        limb.contact = [...limb.end];
        const pose: GroundSupportPose = {
          limbs: { legBack: limb, legFront: limb },
        };
        for (let dx = -40; dx <= 40; dx += 10)
          for (let dy = 0.271; dy < 56; dy += 0.731) {
            const d = Math.hypot(dx, dy),
              bone = solveLimb(
                { ...limb, parts: ["", "", ""] },
                [dx, dy],
                bend,
              );
            const legal =
              d >= 4.02 &&
              d <= 55.98 &&
              bone.upper >= -30 &&
              bone.upper <= 35 &&
              bone.lower >= -85 &&
              bone.lower <= 95;
            const result = solveSupportHeight(
              pose,
              { legBack: [dx, dy] },
              { legBack: true },
              0,
            );
            if (legal) {
              expect(
                result.ok,
                `axes ${upper}/${lower} bend${bend}, ${dx}/${dy}`,
              ).toBe(true);
              if (result.ok) expect(result.bodyY).toBeCloseTo(0, 7);
            } else if (result.ok) {
              expect(Math.abs(result.bodyY)).toBeGreaterThan(1e-6);
              const checked = solveLimb(
                { ...limb, parts: ["", "", ""] },
                [dx, dy - result.bodyY],
                bend,
              );
              expect(checked.upper).toBeGreaterThanOrEqual(-30 - 1e-7);
              expect(checked.upper).toBeLessThanOrEqual(35 + 1e-7);
              expect(checked.lower).toBeGreaterThanOrEqual(-85 - 1e-7);
              expect(checked.lower).toBeLessThanOrEqual(95 + 1e-7);
            }
          }
      }
});
