import type { PetEdge } from "@platform/petMotion";
import type { RigState } from "../whale-vendor/rig/rig.js";
import {
  solveLimb,
  type ArticulationFrame,
  type LimbName,
  type Point,
} from "./articulation";
import { cycle } from "./phases";
export { skinAuthoredPart } from "./poseSkin";
import { WalkStartTransition } from "./walkStart";
import { walkArmPose } from "./walkArmPose";
import { HeldReleaseWindow, relaxedHeldPose } from "./heldRecovery";
import type { WalkMotionFailure } from "./walkRuntime";
import { AuthoredWalkView } from "./authoredWalkView";
import {
  AuthoredTransitionPlayer,
  type AuthoredTransitionOptions,
  type AuthoredTransitionInfo,
  type AuthoredTransitionFailure,
} from "./transitions/transitionPlayer";

export type PoseName = "walk" | "held" | "side" | "top" | "bottom" | "glide";
type PoseFeature =
  | "eyes"
  | "closed_eyes"
  | "angry_eyes"
  | "surprised_eyes"
  | "brows"
  | "neutral_mouth"
  | "happy_mouth";
export type PoseLimb = {
  part?: string;
  /** Independently painted upper, lower and distal pieces; each follows one rigid joint. */
  segments?: [string, string, string];
  root: Point;
  joint: Point;
  end: Point;
  /** Painted sole/palm contact, distinct from the ankle/wrist joint. */
  contact?: Point;
  region: Point[];
  limits: [number, number, number, number];
  bend: -1 | 1;
};
export type AuthoredPose = {
  stride?: number;
  part: string;
  head?: { part: string; neck: Point };
  waist: Point;
  limbs: Record<LimbName, PoseLimb>;
  edges: Record<PetEdge, Point>;
  face: {
    eye: [number, number, number, number];
    brow: [number, number, number, number];
    mouth: [number, number, number, number];
    twoEyes: boolean;
    angle: number;
    /** Exposed face polygon: features may not paint over the authored fringe. */
    clip?: Point[];
    /** Optional clean pose-specific features; existing standing features remain unchanged. */
    sprites?: Partial<Record<PoseFeature, string>>;
    /** Pixel crops of whole-pose references; preserve their original eye artwork. */
    sourceRects?: Partial<
      Record<PoseFeature, [number, number, number, number]>
    >;
  };
};
export type AuthoredPoses = Record<PoseName, AuthoredPose>;
export type AuthoredPoseGeometry = Omit<AuthoredPose, "face">;
const names: LimbName[] = ["armNear", "armFar", "legBack", "legFront"];
export {
  posePartIds,
  bindPoseParts,
  bindAuthoredViews,
  authoredViewBindings,
} from "./transitions/poseBindings";
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const smoothstep = (u: number) => {
  const v = clamp(u, 0, 1);
  return v * v * (3 - 2 * v);
};
export type PoseSample<P extends AuthoredPoseGeometry = AuthoredPose> = {
  name: PoseName;
  pose: P;
  state: RigState;
  endpoints: Record<LimbName, Point>;
  contacts: Record<LimbName, boolean>;
  motionFailure?: WalkMotionFailure | AuthoredTransitionFailure;
  /** Renderer binding identity; name is the compatible skin mode, not a view lookup. */
  view?: string;
  alignment?: Point;
  /** Stable ground view; a missing reversal view must not be mirrored silently. */
  displayFacing?: number;
  /** A same-core recovery is not an authored cross-view recovery animation. */
  transition?:
    | AuthoredTransitionInfo
    | {
        kind: "held-release";
        progress: number;
        needsView: "held-recovery";
      };
};
type WalkSnapshot<P extends AuthoredPoseGeometry = AuthoredPose> = {
  sample: PoseSample<P>;
  points: Record<LimbName, Point>;
  phase: number;
  travel: Point;
};
const angleOf = (state: RigState, key: string) => Number(state[key]?.a ?? 0);
/** Forward kinematics of the displayed rigid walk pieces, before the outer scene transform. */
function walkPoint(
  pose: AuthoredPoseGeometry,
  state: RigState,
  name: LimbName,
): Point {
  const limb = pose.limbs[name];
  let point: Point = [...(limb.contact ?? limb.end)];
  for (const [key, pivot] of [
    [`${name}End`, limb.end],
    [`${name}Lower`, limb.joint],
    [name, limb.root],
  ] as [string, Point][]) {
    const a = (angleOf(state, key) * Math.PI) / 180;
    const dx = point[0] - pivot[0],
      dy = point[1] - pivot[1];
    point = [
      pivot[0] + dx * Math.cos(a) - dy * Math.sin(a),
      pivot[1] + dx * Math.sin(a) + dy * Math.cos(a),
    ];
  }
  const pivot = (state.body.pivot ?? pose.waist) as Point;
  const a = (angleOf(state, "body") * Math.PI) / 180;
  const dx = point[0] - pivot[0],
    dy = point[1] - pivot[1];
  return [
    pivot[0] + dx * Math.cos(a) - dy * Math.sin(a) + Number(state.body.tx ?? 0),
    pivot[1] + dx * Math.sin(a) + dy * Math.cos(a) + Number(state.body.ty ?? 0),
  ];
}

export function poseName(frame: ArticulationFrame): PoseName | null {
  const mode = frame.locomotion?.state ?? frame.mode;
  if (mode === "held" || mode === "drag") return "held";
  if (mode === "climb")
    return frame.locomotion?.edge === "top"
      ? "top"
      : frame.locomotion?.edge === "bottom"
        ? "bottom"
        : "side";
  if (mode === "walk" || mode === "run" || mode === "land") return "walk";
  if (mode === "glide" || mode === "air") return "glide";
  return null;
}

/** Painted anatomical silhouettes supply the rest pose; IK only adds bounded movement. */
export class AuthoredPoseAnimation<
  P extends AuthoredPoseGeometry = AuthoredPose,
> {
  private name: PoseName | null = null;
  private direction = "";
  private at = 0;
  private last: PoseSample<P> | null = null;
  private walkInput: { phase: number; travel: Point } | null = null;
  private walkStop: {
    at: number;
    from: WalkSnapshot<P>;
    steps: LimbName[];
  } | null = null;
  private walkResume: {
    at: number;
    from: WalkSnapshot<P>;
    contactAfter?: number;
  } | null = null;
  private phaseOffset = 0;
  private walkStart: WalkStartTransition | null = null;
  private walkRuntime: AuthoredWalkView<P> | null = null;
  private heldSwing = { value: 0, at: 0 };
  private heldEntry: { at: number; source: RigState } | null = null;
  private heldRelease: {
    window: HeldReleaseWindow;
    sample: PoseSample<P>;
  } | null = null;
  private contacts = new Map<
    LimbName,
    { target: Point; travel: Point; lap: number }
  >();
  private readonly poses: Record<PoseName, P>;
  private readonly transitions: AuthoredTransitionPlayer<P>;
  constructor(
    poses: Record<PoseName, P>,
    options: AuthoredTransitionOptions<P> = {},
  ) {
    this.poses = { ...poses };
    this.transitions = new AuthoredTransitionPlayer(poses, options);
  }
  getMotionFailure(): string | null {
    return (
      this.transitions.getMotionFailure()?.reason ??
      this.walkRuntime?.getMotionFailure()?.reason ??
      null
    );
  }
  getMotionFailureDetails():
    WalkMotionFailure | AuthoredTransitionFailure | null {
    return (
      this.transitions.getMotionFailure() ??
      this.walkRuntime?.getMotionFailure() ??
      null
    );
  }
  getMotionTransition(): AuthoredTransitionInfo | null {
    return !this.last?.motionFailure &&
      this.last?.transition?.kind === "authored"
      ? structuredClone(this.last.transition)
      : null;
  }
  cancelMotionPlayback(): void {
    this.last = this.transitions.cancelMotionPlayback(this.last);
    this.heldRelease = null;
  }
  displayFacing(requested: number, t?: number): number {
    return this.transitions.displayFacing(
      this.walkRuntime ? (this.last?.displayFacing ?? requested) : requested,
      t,
    );
  }
  private snapshotWalk(): WalkSnapshot<P> {
    const sample = this.last!;
    return {
      sample,
      points: Object.fromEntries(
        names.map((name) => [name, walkPoint(sample.pose, sample.state, name)]),
      ) as Record<LimbName, Point>,
      phase: this.walkInput!.phase,
      travel: [...this.walkInput!.travel],
    };
  }
  private stopSteps(from: WalkSnapshot<P>): LimbName[] {
    const legs: LimbName[] = ["legBack", "legFront"];
    const planted = legs.filter((name) => from.sample.contacts[name]);
    if (planted.length === 1) return planted;
    return legs.sort((a, b) => {
      const deviation = (name: LimbName) => {
        const limb = from.sample.pose.limbs[name];
        const neutral =
          limb.root[0] + (limb.contact?.[0] ?? limb.end[0]) - limb.end[0];
        return Math.abs(from.points[name][0] - neutral);
      };
      return deviation(b) - deviation(a);
    });
  }
  private stopWalk(frame: ArticulationFrame): PoseSample<P> {
    const stop = this.walkStop!;
    const { sample, points, travel } = stop.from;
    const elapsed = Math.max(0, frame.t - stop.at);
    const progress = smoothstep(elapsed / 0.25);
    if (progress === 0) return sample;
    const pose = sample.pose;
    let bodyLift = Number(sample.state.body.ty ?? 0) * (1 - progress);
    const scale = Math.max(0.1, frame.worldScale ?? 1);
    const facing =
      Math.sign(frame.facing ?? frame.locomotion?.facing ?? 1) || 1;
    const currentTravel: Point = frame.locomotion?.travel
      ? [
          frame.locomotion.travel.x / scale / facing,
          frame.locomotion.travel.y / scale,
        ]
      : travel;
    const targets = {} as Record<LimbName, Point>;
    const footAngles = {} as Record<LimbName, number>;
    const contacts = { ...sample.contacts };
    const stepDuration = stop.steps.length === 1 ? 0.25 : 0.175;
    const stepHeight = stop.steps.length === 1 ? 3 : 1.5;
    const stepAge = Math.max(0, elapsed - 0.25);
    const active = Math.min(
      stop.steps.length,
      Math.floor((stepAge + 1e-9) / stepDuration),
    );
    const stepProgress = smoothstep(
      (stepAge - active * stepDuration - 0.04) / (stepDuration - 0.04),
    );
    for (const name of ["legBack", "legFront"] as const) {
      const limb = pose.limbs[name];
      const offsetX = (limb.contact?.[0] ?? limb.end[0]) - limb.end[0];
      const neutral: Point = [limb.root[0] + offsetX, pose.edges.bottom[1]];
      const supported = sample.contacts[name];
      const point: Point = [
        points[name][0] +
          (supported ? 0 : (neutral[0] - points[name][0]) * progress),
        points[name][1] +
          (supported ? 0 : (neutral[1] - points[name][1]) * progress),
      ];
      let footAngle =
        (angleOf(sample.state, name) +
          angleOf(sample.state, `${name}Lower`) +
          angleOf(sample.state, `${name}End`)) *
        (1 - progress);
      contacts[name] = supported || progress === 1;
      if (elapsed >= 0.25) {
        const index = stop.steps.indexOf(name);
        if (index < active || index === -1) {
          point[0] = neutral[0];
          point[1] = neutral[1];
        } else if (index === active) {
          // A new neutral support is established before the old foot releases.
          point[0] += (neutral[0] - point[0]) * stepProgress;
          point[1] =
            neutral[1] - stepHeight * Math.sin(Math.PI * stepProgress) ** 2;
          footAngle =
            (-8 * stepHeight * Math.sin(Math.PI * stepProgress) ** 2) / 3;
          // Display the newly grounded pair for at least one 30 fps frame
          // before releasing the old support, including between short steps.
          contacts[name] = stepProgress === 0;
        }
      }
      targets[name] = [
        point[0] - currentTravel[0] + travel[0],
        point[1] - currentTravel[1] + travel[1],
      ];
      footAngles[name] = footAngle;
    }
    if (elapsed >= 0.25 && active >= stop.steps.length - 1) {
      bodyLift = active >= stop.steps.length ? -3 : -3 * stepProgress;
      for (const name of ["legBack", "legFront"] as const) {
        if (!contacts[name]) continue;
        const limb = pose.limbs[name];
        const offset = limb.contact
          ? [limb.contact[0] - limb.end[0], limb.contact[1] - limb.end[1]]
          : [0, 0];
        const reach =
          Math.hypot(
            limb.joint[0] - limb.root[0],
            limb.joint[1] - limb.root[1],
          ) +
          Math.hypot(limb.end[0] - limb.joint[0], limb.end[1] - limb.joint[1]) -
          0.5;
        const dx = targets[name][0] - offset[0] - limb.root[0];
        const verticalReach = Math.sqrt(Math.max(0, reach * reach - dx * dx));
        // Raise the pelvis only as far as the planted ankle can reach. The
        // original remote foot cannot be a permanent support during this rise.
        bodyLift = Math.max(
          bodyLift,
          targets[name][1] - offset[1] - limb.root[1] - verticalReach,
        );
      }
    }
    const state: RigState = {
      ...sample.state,
      body: { ...sample.state.body, ty: bodyLift },
    };
    const endpoints = {} as Record<LimbName, Point>;
    for (const name of names) {
      const limb = pose.limbs[name];
      if (!name.startsWith("leg")) {
        for (const key of [name, `${name}Lower`, `${name}End`])
          state[key] = {
            ...sample.state[key],
            a: angleOf(sample.state, key) * (1 - progress),
          };
        endpoints[name] = walkPoint(pose, state, name);
        continue;
      }
      const offset: Point = limb.contact
        ? [limb.contact[0] - limb.end[0], limb.contact[1] - limb.end[1]]
        : [0, 0];
      const target = targets[name];
      const footAngle = footAngles[name];
      const radians = (footAngle * Math.PI) / 180;
      const rotated: Point = [
        offset[0] * Math.cos(radians) - offset[1] * Math.sin(radians),
        offset[0] * Math.sin(radians) + offset[1] * Math.cos(radians),
      ];
      const ankle: Point = [
        target[0] - rotated[0],
        target[1] - rotated[1] - bodyLift,
      ];
      if (!contacts[name]) {
        const reach =
          Math.hypot(
            limb.joint[0] - limb.root[0],
            limb.joint[1] - limb.root[1],
          ) +
          Math.hypot(limb.end[0] - limb.joint[0], limb.end[1] - limb.joint[1]) -
          0.5;
        const dx = ankle[0] - limb.root[0],
          dy = ankle[1] - limb.root[1];
        const distance = Math.hypot(dx, dy);
        if (distance > reach) {
          ankle[0] = limb.root[0] + (dx * reach) / distance;
          ankle[1] = limb.root[1] + (dy * reach) / distance;
        }
      }
      const bone = solveLimb(
        { ...limb, parts: ["", "", ""] },
        ankle,
        limb.bend,
      );
      const upper = clamp(bone.upper, limb.limits[0], limb.limits[1]);
      const lower = clamp(bone.lower, limb.limits[2], limb.limits[3]);
      state[name] = { a: upper, pivot: limb.root };
      state[`${name}Lower`] = { a: lower, pivot: limb.joint };
      state[`${name}End`] = { a: footAngle - upper - lower, pivot: limb.end };
      endpoints[name] = target;
    }
    this.last = { ...sample, state, endpoints, contacts };
    return this.last;
  }
  private sampleHeldRelease(t: number): PoseSample<P> | null {
    const release = this.heldRelease!;
    const recovery = release.window.sample(t);
    if (recovery.progress >= 1) return null;
    const sample = release.sample;
    this.last = {
      ...sample,
      state: recovery.state,
      endpoints: Object.fromEntries(
        names.map((name) => [
          name,
          walkPoint(sample.pose, recovery.state, name),
        ]),
      ) as Record<LimbName, Point>,
      contacts: {
        armNear: false,
        armFar: false,
        legBack: false,
        legFront: false,
      },
      transition: {
        kind: "held-release",
        progress: recovery.progress,
        needsView: "held-recovery",
      },
    };
    return this.last;
  }
  sample(frame: ArticulationFrame): PoseSample<P> | null {
    const playback = this.transitions.sample(frame, poseName(frame), this.last);
    if (playback) {
      this.last = playback.sample;
      if (
        this.last?.transition?.kind === "authored" &&
        !this.last.motionFailure
      )
        this.walkRuntime = null;
      if (playback.complete && this.last) {
        if (playback.complete.pose !== "stand")
          this.poses[playback.complete.pose] = this.last.pose;
        this.walkRuntime = null;
        this.walkStart = null;
        this.walkStop = null;
        this.walkResume = null;
        this.walkInput = null;
        this.heldRelease = null;
        this.contacts.clear();
        this.name = null;
      }
      return this.last;
    }
    this.last = this.transitions.localSample(this.last);
    this.last = this.transitions.observe(
      this.sampleMotion(this.transitions.localFrame(frame)),
      frame,
    );
    return this.last;
  }
  private sampleMotion(frame: ArticulationFrame) {
    const name = poseName(frame);
    const motion = frame.locomotion;
    const direction = `${frame.facing ?? motion?.facing ?? 1}:${motion?.edge ?? ""}`;
    const ordinaryIdle =
      frame.mode === "idle" &&
      (!motion || motion.state === "idle") &&
      frame.sit < 0.4;
    const releaseRequested = ordinaryIdle || motion?.state === "land";
    if (this.heldRelease) {
      if (name === "held") {
        this.heldEntry = { at: frame.t, source: this.last!.state };
        this.heldSwing = {
          value: angleOf(this.last!.state, "body") / 0.12,
          at: frame.t,
        };
      } else if (releaseRequested && frame.sit < 0.4) {
        const sample = this.sampleHeldRelease(frame.t);
        if (sample) return sample;
        this.last = null;
      }
      this.heldRelease = null;
    } else if (
      releaseRequested &&
      this.last?.name === "held" &&
      Object.values(this.last.pose.limbs).every((limb) => limb.contact)
    ) {
      this.heldRelease = {
        window: new HeldReleaseWindow(this.last.pose, this.last.state, frame.t),
        sample: this.last,
      };
      return this.sampleHeldRelease(frame.t);
    }
    const supportedWalk = Object.values(this.poses.walk.limbs).every(
      (limb) => limb.contact,
    );
    if (
      supportedWalk &&
      frame.sit < 0.4 &&
      (name === "walk" || (ordinaryIdle && this.walkRuntime))
    ) {
      const scale = Math.max(0.1, frame.worldScale ?? 1);
      const facing =
        Math.sign(
          motion?.facing ?? frame.facing ?? this.last?.displayFacing ?? 1,
        ) || 1;
      // Keep the current view's coordinate basis across rejected reversal.
      const viewFacing = this.last?.displayFacing ?? facing;
      const travel: Point = motion?.travel
        ? [motion.travel.x, motion.travel.y]
        : [0, 0];
      if (!this.walkRuntime) {
        const start = this.transitions.loopStart();
        this.walkRuntime = new AuthoredWalkView(
          this.poses.walk,
          start?.travel ?? travel,
          facing,
          viewFacing,
          scale,
          start?.t ?? frame.t,
          start?.contacts,
        );
        this.contacts.clear();
        this.walkStart = null;
        this.walkStop = null;
        this.walkResume = null;
        this.walkInput = null;
      }
      const sampled = this.walkRuntime.sample(
        frame,
        name === "walk" && !ordinaryIdle,
        facing,
      );
      this.name = "walk";
      this.direction = direction;
      this.last = {
        name: "walk",
        pose: this.poses.walk,
        ...sampled,
        displayFacing: viewFacing,
      };
      return this.last;
    }
    // Held, other authored views and configured idle events relinquish ground
    // contacts. A later walk constructs its own same-view source snapshot.
    this.walkRuntime = null;
    if (
      ordinaryIdle &&
      (this.walkStop || (this.walkInput && this.last?.name === "walk"))
    ) {
      if (!this.walkStop) {
        const from = this.snapshotWalk();
        this.walkStop = { at: frame.t, from, steps: this.stopSteps(from) };
        this.walkStart = null;
      }
      return this.stopWalk(frame);
    }
    if (this.walkStop) {
      if (
        name === "walk" &&
        motion?.state === "walk" &&
        direction === this.direction
      ) {
        this.walkResume = { at: frame.t, from: this.snapshotWalk() };
        if (frame.t - this.walkStop.at >= 0.25) {
          const from = this.walkResume.from;
          const legs = ["legBack", "legFront"] as const;
          const available = legs.filter((key) => from.sample.contacts[key]);
          const deviation = (key: LimbName) => {
            const limb = from.sample.pose.limbs[key];
            const neutral =
              limb.root[0] + (limb.contact?.[0] ?? limb.end[0]) - limb.end[0];
            return from.points[key][0] - neutral;
          };
          const supported =
            available.sort((a, b) => deviation(b) - deviation(a))[0] ??
            "legBack";
          const limb = from.sample.pose.limbs[supported];
          const offset = (limb.contact?.[0] ?? limb.end[0]) - limb.end[0];
          const u = clamp(
            0.3 -
              (from.points[supported][0] - limb.root[0] - offset) /
                (from.sample.pose.stride ?? 60),
            0.01,
            0.59,
          );
          from.phase =
            2 * Math.PI * u - (supported === "legFront" ? Math.PI : 0);
          if (from.phase < 0) from.phase += 2 * Math.PI;
          this.walkResume.contactAfter = from.phase + 2 * Math.PI * (0.6 - u);
        }
        this.phaseOffset = this.walkResume.from.phase - motion.phase;
        this.contacts.clear();
      } else {
        this.walkResume = null;
        this.phaseOffset = 0;
      }
      this.walkStop = null;
    }
    if (name !== this.name || direction !== this.direction) {
      const heldBefore =
        name === "held" && this.last?.name === "held" ? this.last : null;
      this.name = name;
      this.direction = direction;
      this.at = frame.t;
      this.contacts.clear();
      this.last = null;
      this.walkInput = null;
      this.walkResume = null;
      this.walkStart = null;
      this.phaseOffset = 0;
      this.heldEntry = heldBefore
        ? { at: frame.t, source: heldBefore.state }
        : null;
      this.heldSwing = {
        value: heldBefore ? angleOf(heldBefore.state, "body") / 0.12 : 0,
        at: frame.t,
      };
    }
    if (!name || frame.sit >= 0.4) return null;
    const pose = this.poses[name];
    if (motion?.attachment === "resting" && this.last) return this.last;
    const climbing = name === "side" || name === "top" || name === "bottom";
    const horizontal = name !== "side";
    const scale = Math.max(0.1, frame.worldScale ?? 1);
    const facing = Math.sign(frame.facing ?? motion?.facing ?? 1) || 1;
    const travel: Point = [
      (motion?.travel?.x ?? 0) / scale / facing,
      (motion?.travel?.y ?? 0) / scale,
    ];
    const contactWalk =
      name === "walk" &&
      Object.values(pose.limbs).every((limb) => limb.contact);
    if (contactWalk && motion?.state !== "walk" && this.walkStart) {
      this.walkStart = null;
      this.phaseOffset = 0;
      this.contacts.clear();
    }
    const rawPhase = motion?.phase ?? frame.gait?.phase ?? 0;
    if (
      contactWalk &&
      motion?.state === "walk" &&
      !this.walkInput &&
      !this.walkResume &&
      !this.walkStart
    ) {
      this.walkStart = new WalkStartTransition(pose, frame.t, travel);
      this.phaseOffset = this.walkStart.phase - rawPhase;
    }
    const phase = rawPhase + this.phaseOffset;
    const resting =
      motion?.attachment === "resting" ||
      motion?.attachment === "settling" ||
      motion?.attachment === "turning";
    const state: RigState = {
      alpha: {},
      body: {},
      torso: {},
      neck: {},
      head: {},
    };
    const held = name === "held";
    const swing = clamp(motion?.swing ?? frame.swing, -18, 18);
    const contactHeld =
      held && Object.values(pose.limbs).every((limb) => limb.contact);
    if (contactHeld) {
      const dt = clamp(frame.t - this.heldSwing.at, 0, 0.05);
      this.heldSwing.value +=
        (swing - this.heldSwing.value) * (1 - Math.exp(-dt * 12));
      this.heldSwing.at = frame.t;
    }
    // The pelvis rises over the supporting foot. Host travel still owns foot
    // placement; subtract this local lift from IK targets rather than sliding soles.
    const resumeBlend = this.walkResume
      ? smoothstep((frame.t - this.walkResume.at) / 0.25)
      : 1;
    const gaitLift = contactWalk
      ? -3 * Math.max(0, Math.cos(2 * (phase - Math.PI * 0.6)))
      : 0;
    const starting = this.walkStart?.sample(frame.t, phase, travel, gaitLift);
    const bodyLift = starting
      ? starting.bodyLift
      : this.walkResume
        ? Number(this.walkResume.from.sample.state.body.ty ?? 0) *
            (1 - resumeBlend) +
          gaitLift * resumeBlend
        : gaitLift;
    state.body = {
      a: held ? (contactHeld ? this.heldSwing.value : swing) * 0.12 : 0,
      ty: bodyLift,
      pivot: held ? (frame.gripPoint ?? pose.waist) : pose.waist,
    };
    if (pose.head)
      state.neck = {
        pivot: pose.head.neck,
        a: held && !contactHeld ? swing * 0.03 : 0,
      };
    if (contactHeld) {
      const entry = this.heldEntry;
      const blend = smoothstep((frame.t - (entry?.at ?? this.at)) / 0.22);
      Object.assign(
        state,
        relaxedHeldPose(
          pose,
          state,
          this.heldSwing.value,
          blend,
          entry?.source,
        ),
      );
      if (blend === 1) this.heldEntry = null;
    }
    const endpoints = {} as Record<LimbName, Point>;
    const contacts = {} as Record<LimbName, boolean>;
    for (let index = 0; index < names.length; index++) {
      const key = names[index],
        limb = pose.limbs[key],
        leg = index >= 2,
        i = index % 2;
      const offset: Point = limb.contact
        ? [limb.contact[0] - limb.end[0], limb.contact[1] - limb.end[1]]
        : [0, 0];
      if (contactHeld) {
        endpoints[key] = walkPoint(pose, state, key);
        contacts[key] = false;
        continue;
      }
      if (contactWalk && !leg) {
        Object.assign(
          state,
          walkArmPose(
            limb,
            phase + i * Math.PI,
            this.walkResume
              ? resumeBlend
              : smoothstep((frame.t - this.at) / 0.2),
            this.walkResume?.from.sample.state,
            key,
          ),
        );
        endpoints[key] = walkPoint(pose, state, key);
        contacts[key] = false;
        continue;
      }
      const ph = phase + i * Math.PI + (climbing && !leg ? Math.PI * 0.3 : 0);
      const u = cycle(ph),
        stance = climbing ? 0.68 : 0.6;
      let contact =
        !resting &&
        ((name === "walk" && leg) || (climbing && !(name === "top" && leg))) &&
        u < stance;
      if (
        this.walkResume?.contactAfter !== undefined &&
        !this.walkResume.from.sample.contacts[key] &&
        phase < this.walkResume.contactAfter
      )
        contact = false;
      const neutral: Point =
        contactWalk && leg
          ? // Center the ankle below its own hip. A fixed +/- offset for soles
            // biases differently shaped boots and can overextend one trailing leg.
            [limb.root[0] + offset[0], pose.edges.bottom[1]]
          : name === "walk" && leg && (limb.part || limb.segments)
            ? [limb.root[0] + (i ? 3 : -3), pose.edges.bottom[1]]
            : [...(limb.contact ?? limb.end)];
      let target: Point = [...neutral];
      const stride = pose.stride ?? (motion?.strideLength ?? 30) / scale;
      if (!resting && ((name === "walk" && leg) || climbing)) {
        const displacement =
          u < stance
            ? stride * (stance / 2 - u)
            : stride *
              (-stance / 2 + smoothstep((u - stance) / (1 - stance)) * stance);
        const liftBase = Math.sin(
          Math.PI * clamp((u - stance) / (1 - stance), 0, 1),
        );
        // Zero lift velocity at takeoff and touchdown avoids a sudden knee bend.
        const lift = contactWalk && leg ? liftBase * liftBase : liftBase;
        if (horizontal) {
          target = [
            neutral[0] + displacement,
            neutral[1] +
              (name === "top" && !leg ? lift * 5 : -lift * (leg ? 7 : 4)),
          ];
          if (name === "top" && leg)
            target = [neutral[0] + Math.sin(ph) * 2, neutral[1]];
        } else target = [neutral[0] - lift * 5, neutral[1] - displacement];
      } else if (name === "walk" && !leg)
        target = [
          neutral[0] + Math.sin(ph + Math.PI) * 4,
          neutral[1] - Math.cos(ph),
        ];
      else if (held)
        target = [neutral[0] + swing * (leg ? 0.1 : 0.15), neutral[1]];
      else if (name === "glide")
        target = [neutral[0], neutral[1] + Math.sin(frame.t * 2 + i) * 1.5];
      const firstFoot = this.walkStart?.foot(key, target);
      if (firstFoot) {
        target = firstFoot.target;
        contact = firstFoot.contact;
        this.contacts.delete(key);
      } else if (contact) {
        const lap = Math.floor(ph / (2 * Math.PI));
        let planted = this.contacts.get(key);
        if (!planted || planted.lap !== lap) {
          const resuming =
            this.walkResume && frame.t - this.walkResume.at < 0.25;
          if (resuming && this.last && this.walkInput) {
            const displayed = walkPoint(pose, this.last.state, key);
            target = [
              displayed[0] - travel[0] + this.walkInput.travel[0],
              pose.edges.bottom[1],
            ];
          }
          // Reserve reachable room for the rest of this support phase. A nearly
          // straight raised arm otherwise hits its reach limit and slides along the wall.
          if (!resuming && (climbing || name === "walk")) {
            const reach =
              Math.hypot(
                limb.joint[0] - limb.root[0],
                limb.joint[1] - limb.root[1],
              ) +
              Math.hypot(
                limb.end[0] - limb.joint[0],
                limb.end[1] - limb.joint[1],
              ) -
              0.02;
            const axis = horizontal ? 0 : 1,
              fixed = horizontal ? 1 : 0;
            const span = Math.sqrt(
              Math.max(
                0,
                reach * reach -
                  (target[fixed] -
                    offset[fixed] -
                    limb.root[fixed] -
                    (fixed === 1 ? bodyLift : 0)) **
                    2,
              ),
            );
            const lo = limb.root[axis] - span + offset[axis],
              hi = limb.root[axis] + span + offset[axis];
            const remaining =
              -Math.sign(
                horizontal
                  ? (motion?.velocity.x ?? 1) / facing
                  : (motion?.velocity.y ?? -1),
              ) *
              stride *
              (stance - u);
            target[axis] = clamp(
              target[axis],
              Math.max(lo, lo - remaining),
              Math.min(hi, hi - remaining),
            );
          }
          planted = { target: [...target], travel: [...travel], lap };
          this.contacts.set(key, planted);
        }
        target = [
          planted.target[0] - travel[0] + planted.travel[0],
          planted.target[1] - travel[1] + planted.travel[1],
        ];
      } else this.contacts.delete(key);
      if (contactWalk && leg && !contact && !resting && !starting?.first) {
        // Free feet stay inside the rigid leg's reach, with a small flexion
        // margin; entering/exiting a fully straight IK clamp creates a knee snap.
        // Supporting contacts remain fixed in world space and bypass this guard.
        const reach =
          Math.hypot(
            limb.joint[0] - limb.root[0],
            limb.joint[1] - limb.root[1],
          ) +
          Math.hypot(limb.end[0] - limb.joint[0], limb.end[1] - limb.joint[1]) -
          (firstFoot ? 0.01 + 0.49 * (starting?.blend ?? 1) : 0.5);
        const dx = target[0] - offset[0] - limb.root[0],
          dy = target[1] - offset[1] - bodyLift - limb.root[1];
        const distance = Math.hypot(dx, dy);
        if (distance > reach && reach > 0) {
          target = [
            limb.root[0] + (dx * reach) / distance + offset[0],
            limb.root[1] + (dy * reach) / distance + offset[1] + bodyLift,
          ];
        }
      }
      const bone = solveLimb(
        { ...limb, parts: ["", "", ""] },
        [target[0] - offset[0], target[1] - offset[1] - bodyLift],
        limb.bend,
      );
      const upper = clamp(bone.upper, limb.limits[0], limb.limits[1]);
      const lower = clamp(bone.lower, limb.limits[2], limb.limits[3]);
      let blend = this.walkResume
        ? resumeBlend
        : smoothstep((frame.t - this.at) / 0.2);
      if (contactWalk && leg && this.walkStart) blend = starting?.first ? 0 : 1;
      if (this.walkResume && leg && !contact) {
        const startPhase = this.walkResume.from.phase + i * Math.PI;
        const startCycle = cycle(startPhase);
        if (startCycle >= 0.6) {
          // A stopped free foot must finish rejoining the gait before its next
          // touchdown. A fixed-time blend can plant it too far behind the hip,
          // leaving insufficient reach for the ensuing confirmed host travel.
          blend = Math.max(
            blend,
            clamp(
              (phase - this.walkResume.from.phase) /
                (2 * Math.PI * (1 - startCycle)),
              0,
              1,
            ),
          );
        } else if (
          !this.walkResume.from.sample.contacts[key] &&
          this.walkResume.contactAfter !== undefined
        ) {
          blend = Math.max(
            blend,
            clamp(
              (phase - this.walkResume.from.phase) /
                (this.walkResume.contactAfter - this.walkResume.from.phase),
              0,
              1,
            ),
          );
        }
      }
      const before = this.walkResume?.from.sample.state;
      const upperAngle =
        before && !contact
          ? angleOf(before, key) * (1 - blend) + upper * blend
          : upper * (before ? 1 : blend);
      const lowerAngle =
        before && !contact
          ? angleOf(before, `${key}Lower`) * (1 - blend) + lower * blend
          : lower * (before ? 1 : blend);
      state[key] = { a: upperAngle, pivot: limb.root };
      state[`${key}Lower`] = { a: lowerAngle, pivot: limb.joint };
      const swingProgress = clamp((u - stance) / (1 - stance), 0, 1);
      const gaitFootAngle =
        contactWalk && leg
          ? -12 *
            Math.sin(Math.PI * swingProgress) *
            (firstFoot ? (starting?.blend ?? 1) : 1)
          : 0;
      const footAngle =
        before && !contact
          ? (angleOf(before, key) +
              angleOf(before, `${key}Lower`) +
              angleOf(before, `${key}End`)) *
              (1 - blend) +
            gaitFootAngle * blend
          : gaitFootAngle;
      state[`${key}End`] = {
        // Releasing a planted boot must not switch rotation formulas in one
        // frame. Its swing starts and ends flat, with a small continuous toe lift.
        a:
          contactWalk && leg
            ? before
              ? footAngle - upperAngle - lowerAngle
              : (footAngle - upper - lower) * blend
            : contact
              ? -(upper + lower) * blend
              : before
                ? angleOf(before, `${key}End`) * (1 - blend) -
                  lower * blend * 0.15
                : -lower * blend * 0.15,
        pivot: limb.end,
      };
      endpoints[key] = target;
      contacts[key] = contact;
    }
    this.last = { name, pose, state, endpoints, contacts };
    if (contactWalk && motion?.state === "walk")
      this.walkInput = { phase, travel: [...travel] };
    else this.walkInput = null;
    if (this.walkResume && resumeBlend === 1) this.walkResume = null;
    return this.last;
  }
}
