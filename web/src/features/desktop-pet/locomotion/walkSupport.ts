import type { Point } from "./articulation";
import type { RigState } from "../whale-vendor/rig/rig.js";
import {
  solveSupportHeight,
  type GroundLeg,
  type GroundSupportPose,
} from "./supportHeight";

const legs: GroundLeg[] = ["legBack", "legFront"];
const rad = Math.PI / 180;
const tolerance = 1e-6;
const heightSafety = 0.005;
const ease = (u: number) => u * u * u * (10 + u * (-15 + 6 * u));
const wave = (u: number) => Math.sin(Math.PI * u) ** 2;
const footEase = (u: number) => u * u * (3 - 2 * u);
const angle = (a: Point, b: Point) =>
  Math.atan2(b[1] - a[1], b[0] - a[0]) / rad;
const wrap = (degrees: number) =>
  Math.atan2(Math.sin(degrees * rad), Math.cos(degrees * rad)) / rad;
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const finite = (point: Point) => point.every(Number.isFinite);
type LegValues<T> = Record<GroundLeg, T>;
type Joints = { root: Point; joint: Point; ankle: Point; sole: Point };
export type WalkSupportSnapshot = {
  travel: Point;
  bodyY: number;
  bodyX: number;
  bodyAngle: number;
  bodyScale: Point;
  joints: LegValues<Joints>;
  footAngles: LegValues<number>;
  contacts: LegValues<boolean>;
};
export type WalkSupportStep = {
  /** A settling step moves limbs while the confirmed window stays in place. */
  stationary?: boolean;
  /** Preserve an already displayed double support before the first foot releases. */
  initialOverlapDistance?: number;
  /** Rig-space confirmed forward travel; caller owns window movement. */
  distance: number;
  landing: { leg: GroundLeg; point: Point };
  /** Look ahead through the new support's next step before claiming it. */
  futureDistance: number;
  overlapDistance: number;
  nextLanding: Point;
  preferredBodyY?: number;
  rise?: number;
  footLift?: number;
};
type FailureReason =
  | "invalid-step-input"
  | "snapshot-not-ground-view"
  | "snapshot-bone-mismatch"
  | "source-branch-inconsistent"
  | "snapshot-joint-limits"
  | "missing-existing-support"
  | "initial-pose-unreachable"
  | "support-window-infeasible"
  | "no-active-window"
  | "travel-reversed"
  | "window-exhausted"
  | "planned-pose-unreachable";
export type WalkSupportFailure = {
  ok: false;
  reason: FailureReason;
  leg?: GroundLeg;
};
export type WalkSupportSample = {
  ok: true;
  bodyY: number;
  targets: LegValues<Point>;
  contacts: LegValues<boolean>;
  footAngles: LegValues<number>;
  progress: number;
  complete: boolean;
  rise: number;
};
type Feet = Pick<WalkSupportSample, "targets" | "contacts" | "footAngles">;
type Polygon = Point[];
type Plan = {
  snapshot: WalkSupportSnapshot;
  step: WalkSupportStep;
  endBody: Point;
  rise: number;
};

/** Capture displayed rigid chains, preserving scale, root and distal orientation. */
export function captureWalkSupportSnapshot(
  pose: GroundSupportPose & { waist?: Point },
  state: RigState,
  contacts: LegValues<boolean>,
  travel: Point,
): WalkSupportSnapshot {
  const rotation = (point: Point, pivot: Point, degrees: number): Point => {
    const a = degrees * rad,
      x = point[0] - pivot[0],
      y = point[1] - pivot[1];
    return [
      pivot[0] + x * Math.cos(a) - y * Math.sin(a),
      pivot[1] + x * Math.sin(a) + y * Math.cos(a),
    ];
  };
  const a = (name: string) => Number(state[name]?.a ?? 0);
  const bodyY = Number(state.body.ty ?? 0),
    bodyAngle = a("body");
  const bodyScale: Point = [
    Number(state.body.sx ?? 1),
    Number(state.body.sy ?? 1),
  ];
  const joints = {} as LegValues<Joints>,
    footAngles = {} as LegValues<number>;
  for (const name of legs) {
    const limb = pose.limbs[name];
    const through = (point: Point, depth: number): Point => {
      let result = [...point] as Point;
      for (const [key, pivot, layer] of [
        [`${name}End`, limb.end, 3],
        [`${name}Lower`, limb.joint, 2],
        [name, limb.root, 1],
      ] as [string, Point, number][])
        if (depth >= layer) result = rotation(result, pivot, a(key));
      const pivot = (state.body.pivot ?? pose.waist ?? [0, 0]) as Point;
      result = [
        pivot[0] + (result[0] - pivot[0]) * bodyScale[0],
        pivot[1] + (result[1] - pivot[1]) * bodyScale[1],
      ];
      result = rotation(result, pivot, bodyAngle);
      // Capture the real affine body; ground validation subsequently rejects
      // its rotation/scale instead of pretending it uses the horizontal plane.
      return [result[0] + Number(state.body.tx ?? 0), result[1] + bodyY];
    };
    joints[name] = {
      root: through(limb.root, 0),
      joint: through(limb.joint, 1),
      ankle: through(limb.end, 2),
      sole: through(limb.contact ?? limb.end, 3),
    };
    footAngles[name] = a(name) + a(`${name}Lower`) + a(`${name}End`);
  }
  return {
    travel: [...travel],
    bodyY,
    bodyX: Number(state.body.tx ?? 0),
    bodyAngle,
    bodyScale,
    joints,
    footAngles,
    contacts: { ...contacts },
  };
}

function validateSnapshot(
  pose: GroundSupportPose,
  snapshot: WalkSupportSnapshot,
): WalkSupportFailure | null {
  if (
    !finite(snapshot.travel) ||
    !Number.isFinite(snapshot.bodyY) ||
    !Number.isFinite(snapshot.bodyAngle) ||
    !Number.isFinite(snapshot.bodyX) ||
    Math.abs(snapshot.bodyX) > tolerance ||
    !finite(snapshot.bodyScale) ||
    Math.abs(snapshot.bodyAngle) > tolerance ||
    snapshot.bodyScale.some((n) => Math.abs(n - 1) > tolerance)
  )
    return { ok: false, reason: "snapshot-not-ground-view" };
  for (const leg of legs) {
    const limb = pose.limbs[leg],
      points = snapshot.joints[leg];
    if (
      !limb.contact ||
      !Object.values(points).every(finite) ||
      !Number.isFinite(snapshot.footAngles[leg]) ||
      distance(points.root, [limb.root[0], limb.root[1] + snapshot.bodyY]) >
        tolerance ||
      Math.abs(
        distance(points.root, points.joint) - distance(limb.root, limb.joint),
      ) > tolerance ||
      Math.abs(
        distance(points.joint, points.ankle) - distance(limb.joint, limb.end),
      ) > tolerance ||
      Math.abs(
        distance(points.ankle, points.sole) - distance(limb.end, limb.contact),
      ) > tolerance
    )
      return { ok: false, reason: "snapshot-bone-mismatch", leg };
    const upper = angle(points.root, points.joint),
      lower = angle(points.joint, points.ankle),
      knee = wrap(lower - upper),
      upperDelta = wrap(upper - angle(limb.root, limb.joint)),
      lowerDelta = wrap(lower - angle(limb.joint, limb.end)) - upperDelta;
    if (knee * limb.bend > tolerance)
      return { ok: false, reason: "source-branch-inconsistent", leg };
    if (
      upperDelta < limb.limits[0] - tolerance ||
      upperDelta > limb.limits[1] + tolerance ||
      lowerDelta < limb.limits[2] - tolerance ||
      lowerDelta > limb.limits[3] + tolerance
    )
      return { ok: false, reason: "snapshot-joint-limits", leg };
  }
  return null;
}

function pointOnCurve(
  start: Point,
  end: Point,
  u: number,
  lift: number,
): Point {
  const e = footEase(u);
  return [
    start[0] * (1 - e) + end[0] * e,
    start[1] * (1 - e) + end[1] * e - lift * 16 * u * u * (1 - u) ** 2,
  ];
}
function feetAt(
  snapshot: WalkSupportSnapshot,
  step: WalkSupportStep,
  traveled: number,
): Feet {
  const free = step.landing.leg,
    support = free === "legBack" ? "legFront" : "legBack";
  const initial = Object.fromEntries(
    legs.map((leg) => [
      leg,
      [
        snapshot.joints[leg].sole[0] + snapshot.travel[0],
        snapshot.joints[leg].sole[1] + snapshot.travel[1],
      ],
    ]),
  ) as LegValues<Point>;
  const advance = step.stationary ? 0 : traveled;
  const travel: Point = [snapshot.travel[0] + advance, snapshot.travel[1]];
  const firstLanding: Point = [
    step.landing.point[0] +
      snapshot.travel[0] +
      (step.stationary ? 0 : step.distance),
    step.landing.point[1] + snapshot.travel[1],
  ];
  const nextLanding: Point = [
    step.nextLanding[0] +
      snapshot.travel[0] +
      (step.stationary ? 0 : step.distance + step.futureDistance),
    step.nextLanding[1] + snapshot.travel[1],
  ];
  const targets = {} as LegValues<Point>,
    contacts = {} as LegValues<boolean>,
    footAngles = {} as LegValues<number>;
  const local = (point: Point): Point => [
    point[0] - travel[0],
    point[1] - travel[1],
  ];
  if (traveled <= step.distance + tolerance) {
    const overlap = snapshot.contacts[free]
      ? (step.initialOverlapDistance ?? 0)
      : 0;
    const u =
      traveled >= step.distance - tolerance
        ? 1
        : Math.max(0, (traveled - overlap) / (step.distance - overlap));
    targets[support] = local(initial[support]);
    contacts[support] = true;
    footAngles[support] = snapshot.footAngles[support];
    targets[free] = local(
      pointOnCurve(initial[free], firstLanding, u, step.footLift ?? 4),
    );
    contacts[free] = u >= 1 || (u === 0 && snapshot.contacts[free]);
    footAngles[free] = snapshot.footAngles[free] * (1 - ease(u)) - 12 * wave(u);
  } else {
    const d = traveled - step.distance,
      u =
        d >= step.futureDistance - tolerance
          ? 1
          : Math.max(
              0,
              Math.min(
                1,
                (d - step.overlapDistance) /
                  (step.futureDistance - step.overlapDistance),
              ),
            );
    targets[free] = local(firstLanding);
    contacts[free] = true;
    footAngles[free] = 0;
    targets[support] = local(
      pointOnCurve(initial[support], nextLanding, u, step.footLift ?? 4),
    );
    contacts[support] = d <= step.overlapDistance + tolerance || u >= 1;
    footAngles[support] =
      snapshot.footAngles[support] * (1 - ease(u)) - 12 * wave(u);
  }
  return { targets, contacts, footAngles };
}

/** Clip feasible body endpoint pairs, not animated vertices or existing soles. */
function halfPlane(
  polygon: Polygon,
  a: number,
  b: number,
  bound: number,
): Polygon {
  const result: Polygon = [];
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i],
      q = polygon[(i + 1) % polygon.length],
      x = a * p[0] + b * p[1] - bound,
      y = a * q[0] + b * q[1] - bound;
    if (x <= tolerance) result.push(p);
    if ((x < 0 && y > 0) || (x > 0 && y < 0)) {
      const u = x / (x - y);
      result.push([p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u]);
    }
  }
  return result;
}
function closest(polygons: Polygon[], preferred: Point): Point {
  const candidates: Point[] = [];
  for (const polygon of polygons) {
    let inside = true,
      area = 0;
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i],
        q = polygon[(i + 1) % polygon.length];
      area += p[0] * q[1] - p[1] * q[0];
      if (
        (q[0] - p[0]) * (preferred[1] - p[1]) -
          (q[1] - p[1]) * (preferred[0] - p[0]) <
        -tolerance
      )
        inside = false;
      const dx = q[0] - p[0],
        dy = q[1] - p[1],
        u = Math.max(
          0,
          Math.min(
            1,
            ((preferred[0] - p[0]) * dx + (preferred[1] - p[1]) * dy) /
              Math.max(1e-12, dx * dx + dy * dy),
          ),
        );
      candidates.push([p[0] + u * dx, p[1] + u * dy]);
    }
    if (inside && area > tolerance * tolerance) candidates.push(preferred);
  }
  return candidates.sort(
    (a, b) => distance(a, preferred) - distance(b, preferred),
  )[0];
}
function bodyAt(plan: Plan, traveled: number): number {
  const future = traveled > plan.step.distance,
    u = future
      ? (traveled - plan.step.distance) / plan.step.futureDistance
      : traveled / plan.step.distance,
    start = future ? plan.endBody[0] : plan.snapshot.bodyY,
    end = plan.endBody[future ? 1 : 0];
  return start * (1 - ease(u)) + end * ease(u) + plan.rise * wave(u);
}

/** One immutable current step plus a preflighted next support window. No timers or host movement. */
export class WalkSupportController {
  private readonly pose: GroundSupportPose;
  private plan: Plan | null = null;
  private distance = 0;
  private failure: WalkSupportFailure | null = null;
  constructor(pose: GroundSupportPose) {
    this.pose = structuredClone(pose);
  }
  cancel() {
    this.plan = null;
    this.distance = 0;
    this.failure = null;
  }
  beginStep(
    snapshot: WalkSupportSnapshot,
    step: WalkSupportStep,
  ): { ok: true; rise: number } | WalkSupportFailure {
    this.cancel();
    const invalid = validateSnapshot(this.pose, snapshot);
    if (invalid) return invalid;
    if (
      ![
        step.distance,
        step.futureDistance,
        step.overlapDistance,
        step.preferredBodyY ?? 0,
        step.rise ?? 0,
        step.footLift ?? 4,
        step.initialOverlapDistance ?? 0,
      ].every(Number.isFinite) ||
      step.distance <= 0 ||
      step.futureDistance <= 0 ||
      step.overlapDistance < 0 ||
      step.overlapDistance >= step.futureDistance ||
      (step.initialOverlapDistance ?? 0) < 0 ||
      (step.initialOverlapDistance ?? 0) >= step.distance ||
      !finite(step.landing.point) ||
      !finite(step.nextLanding) ||
      !legs.includes(step.landing.leg)
    )
      return { ok: false, reason: "invalid-step-input" };
    const support = step.landing.leg === "legBack" ? "legFront" : "legBack";
    if (!snapshot.contacts[support])
      return { ok: false, reason: "missing-existing-support", leg: support };
    const startFeet = feetAt(snapshot, step, 0),
      all = { legBack: true, legFront: true };
    const initial = solveSupportHeight(
      this.pose,
      startFeet.targets,
      all,
      snapshot.bodyY,
      startFeet.footAngles,
    );
    if (!initial.ok || Math.abs(initial.bodyY - snapshot.bodyY) > tolerance)
      return { ok: false, reason: "initial-pose-unreachable" };
    const endpoints = [step.distance, step.distance + step.futureDistance].map(
      (d) => {
        const feet = feetAt(snapshot, step, d);
        return solveSupportHeight(
          this.pose,
          feet.targets,
          all,
          0,
          feet.footAngles,
        );
      },
    );
    if (endpoints.some((result) => !result.ok))
      return { ok: false, reason: "support-window-infeasible" };
    const bounds = endpoints.map((result) =>
      result.ok
        ? [
            Math.min(...result.intervals.map(([lo]) => lo)),
            Math.max(...result.intervals.map(([, hi]) => hi)),
          ]
        : [0, 0],
    );
    for (const rise of [
      ...new Set([step.rise ?? 0, (step.rise ?? 0) / 2, 0]),
    ]) {
      let polygons: Polygon[] = [
        [
          [bounds[0][0], bounds[1][0]],
          [bounds[0][1], bounds[1][0]],
          [bounds[0][1], bounds[1][1]],
          [bounds[0][0], bounds[1][1]],
        ],
      ];
      for (let segment = 0; segment < 2 && polygons.length; segment++)
        for (let i = 0; i <= 128 && polygons.length; i++) {
          const u = i / 128,
            e = ease(u),
            traveled =
              segment === 0
                ? u * step.distance
                : step.distance + u * step.futureDistance,
            feet = feetAt(snapshot, step, traveled),
            result = solveSupportHeight(
              this.pose,
              feet.targets,
              all,
              0,
              feet.footAngles,
            );
          if (!result.ok) {
            polygons = [];
            break;
          }
          const a = segment === 0 ? e : 1 - e,
            b = segment === 0 ? 0 : e,
            offset =
              (segment === 0 ? snapshot.bodyY * (1 - e) : 0) + rise * wave(u);
          polygons = polygons.flatMap((polygon) =>
            result.intervals
              .map(([lo, hi]) =>
                halfPlane(
                  halfPlane(polygon, a, b, hi - heightSafety - offset),
                  -a,
                  -b,
                  offset - lo - heightSafety,
                ),
              )
              .filter((polygon) => polygon.length),
          );
          if (polygons.length > 32) {
            polygons = [];
            break;
          }
        }
      if (polygons.length) {
        const preferred = step.preferredBodyY ?? 0,
          endBody = closest(polygons, [preferred, preferred]);
        this.plan = {
          snapshot: structuredClone(snapshot),
          step: structuredClone(step),
          endBody,
          rise,
        };
        this.distance = 0;
        return { ok: true, rise };
      }
    }
    return { ok: false, reason: "support-window-infeasible" };
  }
  sample(travel: Point): WalkSupportSample | WalkSupportFailure {
    return this.sampleAt(travel);
  }
  /** Stationary pose recovery uses elapsed progress, never simulated window travel. */
  settle(
    progress: number,
    travel: Point,
  ): WalkSupportSample | WalkSupportFailure {
    if (!this.plan?.step.stationary)
      return { ok: false, reason: "no-active-window" };
    return this.sampleAt(travel, progress);
  }
  private sampleAt(
    travel: Point,
    progress?: number,
  ): WalkSupportSample | WalkSupportFailure {
    if (this.failure) return this.failure;
    const plan = this.plan;
    if (!plan) return { ok: false, reason: "no-active-window" };
    const d = progress ?? travel[0] - plan.snapshot.travel[0];
    if (
      !finite(travel) ||
      !Number.isFinite(d) ||
      Math.abs(travel[1] - plan.snapshot.travel[1]) > tolerance
    ) {
      this.failure = { ok: false, reason: "invalid-step-input" };
      return this.failure;
    }
    if (d < this.distance - tolerance) {
      this.failure = { ok: false, reason: "travel-reversed" };
      return this.failure;
    }
    if (d > plan.step.distance + plan.step.futureDistance + tolerance) {
      this.failure = { ok: false, reason: "window-exhausted" };
      return this.failure;
    }
    const bodyY = bodyAt(plan, d),
      feet = feetAt(plan.snapshot, plan.step, d);
    if (plan.step.stationary)
      for (const leg of legs)
        feet.targets[leg][0] -= travel[0] - plan.snapshot.travel[0];
    // Check the chosen immutable curve; do not project it or relocate a planted
    // shoe if a receipt falls between preflight nodes or changes the walk plane.
    const valid = solveSupportHeight(
      this.pose,
      feet.targets,
      { legBack: true, legFront: true },
      bodyY,
      feet.footAngles,
    );
    if (!valid.ok || Math.abs(valid.bodyY - bodyY) > tolerance) {
      this.failure = { ok: false, reason: "planned-pose-unreachable" };
      return this.failure;
    }
    this.distance = d;
    return {
      ok: true,
      bodyY,
      ...feet,
      progress: Math.min(1, d / plan.step.distance),
      complete: d >= plan.step.distance,
      rise: plan.rise,
    };
  }
}
