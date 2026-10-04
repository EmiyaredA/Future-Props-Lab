import type { AuthoredPoseGeometry } from "./authoredPose";
import { solveLimb, type LimbName, type Point } from "./articulation";
import type { RigState } from "../whale-vendor/rig/rig.js";
import { solveSupportHeight, type GroundLeg } from "./supportHeight";
import {
  WalkSupportController,
  captureWalkSupportSnapshot,
  type WalkSupportFailure,
  type WalkSupportSample,
  type WalkSupportSnapshot,
} from "./walkSupport";
import { walkArmPose } from "./walkArmPose";

const legs: GroundLeg[] = ["legBack", "legFront"];
const arms: LimbName[] = ["armNear", "armFar"];
const other = (leg: GroundLeg): GroundLeg =>
  leg === "legBack" ? "legFront" : "legBack";
export type WalkMotionFailure = {
  reason:
    | WalkSupportFailure["reason"]
    | "needs-walk-turn-view"
    | "invalid-source-floor";
  leg?: GroundLeg;
};
export type WalkRuntimeSample = {
  state: RigState;
  endpoints: Record<LimbName, Point>;
  contacts: Record<LimbName, boolean>;
  motionFailure?: WalkMotionFailure;
};

/** Ground gait owns support windows; render time can only settle a stopped foot. */
export class AuthoredWalkRuntime {
  private readonly controller: WalkSupportController;
  private last: WalkRuntimeSample;
  private travel: Point;
  private free: GroundLeg;
  private failure: WalkMotionFailure | null = null;
  private moving = false;
  private stopping: number | null = null;
  private armFrom: RigState;
  private armAt: number;
  private armTravel: number;
  private phaseOrigin: number;
  private windowEnd = 0;
  private stepDistance: number | null = null;

  constructor(
    private readonly pose: AuthoredPoseGeometry,
    travel: Point,
    private readonly facing: number,
    t: number,
    initialContacts?: Record<LimbName, boolean>,
  ) {
    this.pose = structuredClone(pose);
    this.controller = new WalkSupportController(pose);
    this.travel = [...travel];
    this.phaseOrigin = travel[0];
    this.armAt = t;
    this.armTravel = travel[0];
    this.armFrom = { alpha: {}, body: {} };
    const state: RigState = {
      alpha: {},
      body: { ty: 0, pivot: pose.waist },
      torso: {},
      neck: {},
      head: {},
    };
    for (const [name, limb] of Object.entries(pose.limbs)) {
      state[name] = { a: 0, pivot: limb.root };
      state[`${name}Lower`] = { a: 0, pivot: limb.joint };
      state[`${name}End`] = { a: 0, pivot: limb.end };
    }
    const supported =
      initialContacts?.legBack && !initialContacts.legFront
        ? "legBack"
        : pose.limbs.legFront.contact![1] >= pose.limbs.legBack.contact![1]
          ? "legFront"
          : "legBack";
    this.free = other(supported);
    this.last = {
      state,
      endpoints: Object.fromEntries(
        Object.entries(pose.limbs).map(([key, limb]) => [
          key,
          [...limb.contact!],
        ]),
      ) as Record<LimbName, Point>,
      contacts: {
        armNear: false,
        armFar: false,
        legBack: initialContacts?.legBack ?? supported === "legBack",
        legFront: initialContacts?.legFront ?? supported === "legFront",
      },
    };
    if (
      Math.abs(pose.limbs[supported].contact![1] - pose.edges.bottom[1]) > 0.01
    )
      this.fail({ reason: "invalid-source-floor", leg: supported });
  }
  getMotionFailure(): WalkMotionFailure | null {
    return this.failure ? { ...this.failure } : null;
  }
  confirmedTravel(): Point {
    return [...this.travel];
  }
  private fail(
    failure: WalkMotionFailure,
    travel: Point = this.travel,
  ): WalkRuntimeSample {
    this.failure = failure;
    this.controller.cancel();
    // A failed or late receipt may already have moved the native window.
    // Preserve the last displayed pose in world space while movement stops;
    // this affine scene compensation is not an IK/pelvis reach projection.
    const validTravel = travel.every(Number.isFinite);
    const dx = validTravel ? this.travel[0] - travel[0] : 0,
      dy = validTravel ? this.travel[1] - travel[1] : 0;
    this.last = {
      ...this.last,
      state:
        dx || dy
          ? {
              ...this.last.state,
              body: {
                ...this.last.state.body,
                tx: Number(this.last.state.body.tx ?? 0) + dx,
                ty: Number(this.last.state.body.ty ?? 0) + dy,
              },
            }
          : this.last.state,
      endpoints: Object.fromEntries(
        Object.entries(this.last.endpoints).map(([name, p]) => [
          name,
          [p[0] + dx, p[1] + dy],
        ]),
      ) as Record<LimbName, Point>,
      motionFailure: { ...failure },
    };
    if (validTravel) this.travel = [...travel];
    return this.last;
  }
  private snapshot(): WalkSupportSnapshot {
    return captureWalkSupportSnapshot(
      this.pose,
      this.last.state,
      this.last.contacts,
      this.travel,
    );
  }
  private neutral(leg: GroundLeg, lead = 0): Point {
    const limb = this.pose.limbs[leg];
    return [
      limb.root[0] + limb.contact![0] - limb.end[0] + lead,
      this.pose.edges.bottom[1],
    ];
  }
  private phaseAt(travel: Point): number {
    return (
      ((travel[0] - this.phaseOrigin) / (this.stepDistance ?? 12)) * Math.PI
    );
  }
  private beginMoving(): WalkSupportFailure | null {
    const snapshot = this.snapshot();
    const walkingHeight = Math.max(
      0,
      ...legs.map((leg) => {
        const l = this.pose.limbs[leg],
          length =
            Math.hypot(l.joint[0] - l.root[0], l.joint[1] - l.root[1]) +
            Math.hypot(l.end[0] - l.joint[0], l.end[1] - l.joint[1]);
        return (
          this.pose.edges.bottom[1] -
          (l.contact![1] - l.end[1]) -
          l.root[1] -
          length * 0.94
        );
      }),
    );
    // Shorten only a not-yet-established stride. Existing world supports and
    // resource joint limits are never changed to make a requested step fit.
    const nominal =
      this.stepDistance ??
      Math.min(12, Math.max(3, (this.pose.stride ?? 40) * 0.2));
    let failure: WalkSupportFailure = {
      ok: false,
      reason: "support-window-infeasible",
    };
    for (const factor of [1, 0.75, 0.5, 0.25]) {
      const distance = nominal * factor;
      const landing = this.neutral(this.free, distance * 0.5);
      const nextLanding = this.neutral(other(this.free), distance * 0.5);
      // Startup/restart may have a shorter painted support than a periodic
      // gait. Bound each not-yet-planted shoe's world excursion to two steps;
      // otherwise the second first-cycle foot rushes 2.5 steps in one swing.
      landing[0] = Math.min(
        landing[0],
        snapshot.joints[this.free].sole[0] + distance,
      );
      nextLanding[0] = Math.min(
        nextLanding[0],
        snapshot.joints[other(this.free)].sole[0],
      );
      const result = this.controller.beginStep(snapshot, {
        distance,
        initialOverlapDistance: distance * 0.2,
        landing: {
          leg: this.free,
          point: landing,
        },
        futureDistance: distance,
        overlapDistance: distance * 0.2,
        nextLanding,
        // An endpoint needs room for the following support, rather than
        // ending at singular reach and trying to drop the pelvis next frame.
        preferredBodyY: walkingHeight,
        rise: -0.3,
        footLift: Math.min(4.65, distance * 0.5),
      });
      if (result.ok) {
        const phase = this.stepDistance ? this.phaseAt(snapshot.travel) : 0;
        this.stepDistance = distance;
        this.phaseOrigin = snapshot.travel[0] - (phase * distance) / Math.PI;
        this.windowEnd = snapshot.travel[0] + distance * 2;
        return null;
      }
      failure = result;
      if (result.reason !== "support-window-infeasible") break;
    }
    return failure;
  }
  private beginStopping(t: number): WalkSupportFailure | null {
    const supported = legs.filter((leg) => this.last.contacts[leg]);
    if (supported.length === 1) this.free = other(supported[0]);
    else if (supported.length === 2) {
      // First bring the more remote foot back; the other remains a real pin.
      this.free = [...legs].sort(
        (a, b) =>
          Math.abs(this.last.endpoints[b][0] - this.neutral(b)[0]) -
          Math.abs(this.last.endpoints[a][0] - this.neutral(a)[0]),
      )[0];
    }
    const natural = solveSupportHeight(
      this.pose,
      { legBack: this.neutral("legBack"), legFront: this.neutral("legFront") },
      { legBack: true, legFront: true },
      -1000,
    );
    if (!natural.ok) return { ok: false, reason: "support-window-infeasible" };
    const result = this.controller.beginStep(this.snapshot(), {
      stationary: true,
      initialOverlapDistance: 0.16,
      distance: 1,
      landing: { leg: this.free, point: this.neutral(this.free) },
      futureDistance: 1,
      overlapDistance: 0.16,
      nextLanding: this.neutral(other(this.free)),
      // Choose the final neutral support height once. It is part of the whole
      // preflighted handoff curve, never a frame-by-frame pelvis projection.
      preferredBodyY: natural.bodyY + 0.06,
      rise: 0,
      footLift: 2,
    });
    if (!result.ok) return result;
    this.stopping = t;
    this.armFrom = this.last.state;
    this.armAt = t;
    return null;
  }
  private render(
    sample: WalkSupportSample,
    t: number,
    phase: number,
    stopped: boolean,
  ): WalkRuntimeSample {
    const state: RigState = {
      alpha: {},
      body: { ty: sample.bodyY, pivot: this.pose.waist },
      torso: {},
      neck: {},
      head: {},
    };
    const endpoints = { ...this.last.endpoints };
    const contacts = { armNear: false, armFar: false, ...sample.contacts };
    for (const leg of legs) {
      const limb = this.pose.limbs[leg],
        radians = (sample.footAngles[leg] * Math.PI) / 180;
      const ox = limb.contact![0] - limb.end[0],
        oy = limb.contact![1] - limb.end[1];
      const ankle: Point = [
        sample.targets[leg][0] -
          ox * Math.cos(radians) +
          oy * Math.sin(radians),
        sample.targets[leg][1] -
          ox * Math.sin(radians) -
          oy * Math.cos(radians) -
          sample.bodyY,
      ];
      const bone = solveLimb(
        { ...limb, parts: ["", "", ""] },
        ankle,
        limb.bend,
      );
      // The planner already proved exact reach and limits. Do not clamp here.
      state[leg] = { a: bone.upper, pivot: limb.root };
      state[`${leg}Lower`] = { a: bone.lower, pivot: limb.joint };
      state[`${leg}End`] = {
        a: sample.footAngles[leg] - bone.upper - bone.lower,
        pivot: limb.end,
      };
      endpoints[leg] = [...sample.targets[leg]];
    }
    const progress = Math.min(
      1,
      Math.max(
        0,
        stopped
          ? (t - this.armAt) / 0.22
          : (this.travel[0] - this.armTravel) / 5,
      ),
    );
    for (const [i, arm] of arms.entries()) {
      if (stopped) {
        for (const key of [arm, `${arm}Lower`, `${arm}End`])
          state[key] = {
            ...this.armFrom[key],
            a: Number(this.armFrom[key]?.a ?? 0) * (1 - progress),
          };
      } else
        Object.assign(
          state,
          walkArmPose(
            this.pose.limbs[arm],
            phase + i * Math.PI,
            progress,
            this.armFrom,
            arm,
          ),
        );
      // FK for free palms is separate from the ground-support solver.
      const limb = this.pose.limbs[arm];
      let point: Point = [...limb.contact!];
      for (const [key, pivot] of [
        [`${arm}End`, limb.end],
        [`${arm}Lower`, limb.joint],
        [arm, limb.root],
      ] as [string, Point][]) {
        const a = (Number(state[key]?.a ?? 0) * Math.PI) / 180,
          x = point[0] - pivot[0],
          y = point[1] - pivot[1];
        point = [
          pivot[0] + x * Math.cos(a) - y * Math.sin(a),
          pivot[1] + x * Math.sin(a) + y * Math.cos(a),
        ];
      }
      endpoints[arm] = [point[0], point[1] + sample.bodyY];
    }
    this.last = { state, endpoints, contacts };
    return this.last;
  }
  sample(
    t: number,
    walking: boolean,
    travel: Point,
    facing: number,
  ): WalkRuntimeSample {
    if (this.failure) return this.fail(this.failure, travel);
    const displayed = this.last,
      displayedTravel = [...this.travel] as Point;
    const reject = (failure: WalkMotionFailure) => {
      this.last = displayed;
      this.travel = displayedTravel;
      return this.fail(failure, travel);
    };
    if (facing !== this.facing)
      return reject({ reason: "needs-walk-turn-view" });
    const phase = this.phaseAt(travel);
    if (!walking) {
      if (this.stopping === null) {
        // Stop may arrive together with the final host acknowledgement. First
        // consume that already confirmed segment through the active walk
        // window, then preflight recovery from its actual displayed FK.
        if (
          this.moving &&
          (travel[0] !== this.travel[0] || travel[1] !== this.travel[1])
        ) {
          const confirmed = this.sample(t, true, travel, facing);
          if (confirmed.motionFailure) return confirmed;
        }
        const error = this.beginStopping(t);
        if (error) return reject(error);
        this.moving = false;
      }
      const result = this.controller.settle(
        Math.min(2, Math.max(0, (t - this.stopping!) / 0.25)),
        travel,
      );
      if (!result.ok) return reject(result);
      if (
        t === this.stopping &&
        travel[0] === this.travel[0] &&
        travel[1] === this.travel[1]
      )
        return this.last;
      this.travel = [...travel];
      return this.render(result, t, phase, true);
    }
    if (!this.moving) {
      this.stopping = null;
      this.armFrom = this.last.state;
      this.armAt = t;
      this.armTravel = this.travel[0];
      const supported = legs.filter((leg) => this.last.contacts[leg]);
      if (supported.length === 1) this.free = other(supported[0]);
      const error = this.beginMoving();
      if (error) return reject(error);
      this.moving = true;
    }
    // A confirmed receipt may span a support boundary. Consume its known
    // forward segment at the exact boundary before preparing the next window;
    // do not restart the free arc prematurely at the first landing.
    for (let windows = 0; travel[0] > this.windowEnd + 1e-8; windows++) {
      if (windows >= 8) return reject({ reason: "window-exhausted" });
      const endTravel: Point = [this.windowEnd, this.travel[1]];
      const end = this.controller.sample(endTravel);
      if (!end.ok) return reject(end);
      this.travel = endTravel;
      this.render(end, t, this.phaseAt(this.travel), false);
      const error = this.beginMoving();
      if (error) return reject(error);
    }
    const result = this.controller.sample(travel);
    if (!result.ok) return reject(result);
    this.travel = [...travel];
    const rendered = this.render(result, t, this.phaseAt(travel), false);
    if (travel[0] >= this.windowEnd - 1e-8) {
      const error = this.beginMoving();
      if (error) return reject(error);
    }
    return rendered;
  }
}
