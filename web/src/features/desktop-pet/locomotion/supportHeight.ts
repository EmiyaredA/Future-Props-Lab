import { solveLimb, type Point } from "./articulation";
import type { AuthoredPoseGeometry, PoseLimb } from "./authoredPose";

export type GroundLeg = "legBack" | "legFront";
export type GroundSupportPose = {
  limbs: Pick<AuthoredPoseGeometry["limbs"], GroundLeg>;
};
type Interval = [number, number];
export type SupportHeightConstraint = {
  name: GroundLeg;
  ankle: Point;
  lengths: Point;
  intervals: Interval[];
};
export type SupportHeightResult =
  | {
      ok: true;
      bodyY: number;
      intervals: Interval[];
      constraints: SupportHeightConstraint[];
    }
  | {
      ok: false;
      reason:
        | "invalid-support-input"
        | "missing-sole-contact"
        | "horizontal-reach"
        | "joint-limits"
        | "no-common-height";
      constraints: SupportHeightConstraint[];
      name?: GroundLeg;
    };
const legs: GroundLeg[] = ["legBack", "legFront"];
const radians = Math.PI / 180;
const margin = 0.02;
const epsilon = 1e-7;
const angle = (a: Point, b: Point) => Math.atan2(b[1] - a[1], b[0] - a[0]);
const finite = (point: number[]) =>
  point.length === 2 && point.every(Number.isFinite);
const length = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** All analytic boundary crossings of the existing two-bone IK's joint limits. */
function verticalIntervals(
  limb: PoseLimb,
  dx: number,
  lengths: Point,
): Interval[] {
  const [a, b] = lengths,
    maximum = a + b - margin,
    minimum = Math.abs(a - b) + margin;
  if (Math.abs(dx) > maximum) return [];
  const low = Math.sqrt(Math.max(0, minimum * minimum - dx * dx)),
    high = Math.sqrt(Math.max(0, maximum * maximum - dx * dx));
  const boundaries = [low, high];
  const add = (y: number) => {
    if (Number.isFinite(y) && y > low && y < high) boundaries.push(y);
  };
  const restUpper = angle(limb.root, limb.joint),
    restLower = angle(limb.joint, limb.end);
  // Fixing the upper direction gives a lower-bone circle's two intersections
  // with the requested ankle x. Include angle-wrap boundaries of solveLimb.
  for (const delta of [limb.limits[0], limb.limits[1], -180, 180]) {
    const axis = restUpper + delta * radians,
      x = dx - a * Math.cos(axis),
      square = b * b - x * x;
    if (square < 0) continue;
    add(a * Math.sin(axis) - Math.sqrt(square));
    add(a * Math.sin(axis) + Math.sqrt(square));
  }
  // A relative lower-angle boundary fixes the root-to-ankle radius.
  for (const delta of [limb.limits[2], limb.limits[3]]) {
    const relative = restLower - restUpper + delta * radians;
    add(
      Math.sqrt(
        Math.max(0, a * a + b * b + 2 * a * b * Math.cos(relative) - dx * dx),
      ),
    );
  }
  // The separately normalized lower direction can wrap before its relative
  // rotation is formed. Partition at that boundary too, rather than sampling
  // a small valid interval away or silently clamping the resulting angle.
  for (const delta of [-180, 180]) {
    const axis = restLower + delta * radians,
      x = dx - b * Math.cos(axis),
      square = a * a - x * x;
    if (square < 0) continue;
    add(b * Math.sin(axis) - Math.sqrt(square));
    add(b * Math.sin(axis) + Math.sqrt(square));
  }
  boundaries.sort((x, y) => x - y);
  const unique = boundaries.filter(
    (n, i) => i === 0 || n - boundaries[i - 1] > epsilon,
  );
  const valid = (dy: number) => {
    const result = solveLimb(
      { ...limb, parts: ["", "", ""] },
      [limb.root[0] + dx, limb.root[1] + dy],
      limb.bend,
    );
    return (
      result.upper >= limb.limits[0] - epsilon &&
      result.upper <= limb.limits[1] + epsilon &&
      result.lower >= limb.limits[2] - epsilon &&
      result.lower <= limb.limits[3] + epsilon
    );
  };
  const pieces: Interval[] = unique.filter(valid).map((y) => [y, y]);
  for (let i = 0; i < unique.length - 1; i++) {
    const lo = unique[i],
      hi = unique[i + 1];
    if (valid((lo + hi) / 2)) pieces.push([lo, hi]);
  }
  pieces.sort((a, b) => a[0] - b[0]);
  const feasible: Interval[] = [];
  for (const [lo, hi] of pieces) {
    const previous = feasible.at(-1);
    if (previous && lo <= previous[1] + epsilon)
      previous[1] = Math.max(previous[1], hi);
    else feasible.push([lo, hi]);
  }
  return feasible;
}

/**
 * Ground-walk body translation before IK: both painted soles keep their actual
 * targets. Body angle must be zero; upward wall/hanging contacts use another
 * support plane. The result never moves a target, changes a bone or hides an
 * infeasible support behind solveLimb's endpoint/angle clamps.
 */
export function solveSupportHeight(
  pose: GroundSupportPose,
  targets: Partial<Record<GroundLeg, Point>>,
  contacts: Partial<Record<GroundLeg, boolean>>,
  proposedBodyY: number,
  footAngles: Partial<Record<GroundLeg, number>> = {},
): SupportHeightResult {
  const constraints: SupportHeightConstraint[] = [];
  if (!Number.isFinite(proposedBodyY))
    return { ok: false, reason: "invalid-support-input", constraints };
  for (const name of legs) {
    if (!contacts[name]) continue;
    const limb = pose.limbs[name],
      target = targets[name],
      degrees = footAngles[name] ?? 0;
    if (!limb.contact)
      return { ok: false, reason: "missing-sole-contact", name, constraints };
    if (
      !target ||
      ![limb.root, limb.joint, limb.end, limb.contact, target].every(finite) ||
      !Number.isFinite(degrees) ||
      limb.limits.length !== 4 ||
      !limb.limits.every(Number.isFinite) ||
      limb.limits[0] > limb.limits[1] ||
      limb.limits[2] > limb.limits[3] ||
      (limb.bend !== -1 && limb.bend !== 1)
    )
      return { ok: false, reason: "invalid-support-input", name, constraints };
    const lengths: Point = [
      length(limb.root, limb.joint),
      length(limb.joint, limb.end),
    ];
    if (Math.min(...lengths) <= margin)
      return { ok: false, reason: "invalid-support-input", name, constraints };
    const theta = degrees * radians,
      offset: Point = [
        limb.contact[0] - limb.end[0],
        limb.contact[1] - limb.end[1],
      ],
      ankle: Point = [
        target[0] - offset[0] * Math.cos(theta) + offset[1] * Math.sin(theta),
        target[1] - offset[0] * Math.sin(theta) - offset[1] * Math.cos(theta),
      ];
    const dx = ankle[0] - limb.root[0],
      relativeY = ankle[1] - limb.root[1];
    if (Math.abs(dx) > lengths[0] + lengths[1] - margin)
      return { ok: false, reason: "horizontal-reach", name, constraints };
    const intervals: Interval[] = verticalIntervals(limb, dx, lengths).map(
      ([lo, hi]) => [relativeY - hi, relativeY - lo],
    );
    constraints.push({ name, ankle, lengths, intervals });
    if (!intervals.length)
      return { ok: false, reason: "joint-limits", name, constraints };
  }
  // No planted leg imposes a support constraint; preserve the proposed pose.
  if (!constraints.length)
    return { ok: true, bodyY: proposedBodyY, intervals: [], constraints };
  let intervals = constraints[0].intervals;
  for (const constraint of constraints.slice(1))
    intervals = intervals.flatMap(([lo, hi]) =>
      constraint.intervals.flatMap(([otherLo, otherHi]) => {
        const a = Math.max(lo, otherLo),
          b = Math.min(hi, otherHi);
        return a <= b ? [[a, b] as Interval] : [];
      }),
    );
  if (!intervals.length)
    return { ok: false, reason: "no-common-height", constraints };
  const bodyY = intervals
    .map(([lo, hi]) => Math.max(lo, Math.min(hi, proposedBodyY)))
    .sort(
      (a, b) => Math.abs(a - proposedBodyY) - Math.abs(b - proposedBodyY),
    )[0];
  return { ok: true, bodyY, intervals, constraints };
}
