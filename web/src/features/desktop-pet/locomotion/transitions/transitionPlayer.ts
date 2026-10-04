import type { PetEdge } from "@platform/petMotion";
import type { RigState } from "../../whale-vendor/rig/rig.js";
import type { ArticulationFrame, LimbName, Point } from "../articulation";
import type {
  AuthoredPoseGeometry,
  PoseName,
  PoseSample,
} from "../authoredPose";
import type {
  AuthoredTransitions,
  MotionTransitionEndpoint,
  PoseTransition,
  TransitionSupport,
} from "../motionTransitions";

export type AuthoredTransitionOptions<P> = {
  transitions?: AuthoredTransitions<P>;
  stand?: P;
};
export type AuthoredTransitionFailure = {
  reason:
    | "needs-stand-view"
    | "ambiguous-stand-view"
    | "needs-authored-transition"
    | "transition-interrupted"
    | "transition-entry-view-mismatch"
    | "transition-bone-length-mismatch"
    | "transition-support-mismatch"
    | "transition-support-plane-mismatch"
    | "transition-support-handoff"
    | "transition-invalid-time"
    | "needs-authored-turn-basis";
};
export type AuthoredTransitionInfo = {
  kind: "authored";
  id: string;
  progress: number;
  from: MotionTransitionEndpoint;
  to: MotionTransitionEndpoint;
  needsView?: never;
};
const limbs: LimbName[] = ["armNear", "armFar", "legBack", "legFront"];
const zeroContacts = () => ({
  armNear: false,
  armFar: false,
  legBack: false,
  legFront: false,
});
const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const sameEndpoint = (
  a: MotionTransitionEndpoint,
  b: MotionTransitionEndpoint,
) => a.pose === b.pose && a.facing === b.facing && a.edge === b.edge;
const transform = (
  p: Point,
  state: RigState,
  key: string,
  pivot: Point,
): Point => {
  const s = state[key] ?? {},
    origin = (s.pivot ?? pivot) as Point;
  const angle = (Number(s.a ?? 0) * Math.PI) / 180;
  const x = (p[0] - origin[0]) * Number(s.sx ?? 1),
    y = (p[1] - origin[1]) * Number(s.sy ?? 1);
  return [
    origin[0] + x * Math.cos(angle) - y * Math.sin(angle) + Number(s.tx ?? 0),
    origin[1] + x * Math.sin(angle) + y * Math.cos(angle) + Number(s.ty ?? 0),
  ];
};

/** Same public joint hierarchy as createRig: contact -> distal -> lower -> upper -> torso/body. */
export function authoredContactPoint(
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
  ] as [string, Point][])
    point = transform(point, state, key, pivot);
  if (name.startsWith("arm"))
    point = transform(point, state, "torso", pose.waist);
  return transform(point, state, "body", pose.waist);
}
export function authoredRestSample<P extends AuthoredPoseGeometry>(
  pose: P,
  name: PoseName,
  view: string,
  facing: number,
): PoseSample<P> {
  const state: RigState = {
    alpha: {},
    body: { pivot: pose.waist },
    torso: { pivot: pose.waist },
    neck: {},
    head: {},
  };
  for (const limb of limbs) {
    state[limb] = { a: 0, pivot: pose.limbs[limb].root };
    state[`${limb}Lower`] = { a: 0, pivot: pose.limbs[limb].joint };
    state[`${limb}End`] = { a: 0, pivot: pose.limbs[limb].end };
  }
  return {
    name,
    pose,
    state,
    view,
    displayFacing: facing,
    endpoints: Object.fromEntries(
      limbs.map((limb) => [limb, authoredContactPoint(pose, state, limb)]),
    ) as Record<LimbName, Point>,
    contacts: zeroContacts(),
  };
}
type WorldSupport = TransitionSupport & { world: Point };
type Active<P extends AuthoredPoseGeometry> = {
  resource: PoseTransition<P>;
  at: number;
  index: number;
  entry: PoseSample<P>;
  fromTravel: Point;
  fromScale: number;
  lastTime: number;
  /** Grab in display-oriented model units, relative to the native window. */
  grip?: Point;
  origin: Point;
  anchors: Partial<Record<LimbName, WorldSupport>>;
};
type Playback<P extends AuthoredPoseGeometry> = {
  sample: PoseSample<P> | null;
  complete?: MotionTransitionEndpoint;
};

/** Complete authored cels, never alpha/whole-body-angle interpolation between different drawings. */
export class AuthoredTransitionPlayer<P extends AuthoredPoseGeometry> {
  private endpoint: MotionTransitionEndpoint | null = null;
  private active: Active<P> | null = null;
  private failure: AuthoredTransitionFailure | null = null;
  private last: PoseSample<P> | null = null;
  private travel: Point = [0, 0];
  private scale = 1;
  private alignment: Point = [0, 0];
  private request = "";
  private needsEntry = false;
  private terminal: {
    travel: Point;
    t: number;
    contacts: Record<LimbName, boolean>;
  } | null = null;
  private loopAnchors: Partial<Record<LimbName, WorldSupport>> = {};
  private readonly poses: Record<PoseName, P>;
  private readonly options: AuthoredTransitionOptions<P>;
  constructor(
    poses: Record<PoseName, P>,
    options: AuthoredTransitionOptions<P>,
  ) {
    this.poses = structuredClone(poses);
    this.options = structuredClone(options);
  }
  getMotionFailure() {
    return this.failure ? { ...this.failure } : null;
  }
  /** Cancel a selection's clock, retaining its actual drawing and world contacts. */
  cancelMotionPlayback(previous: PoseSample<P> | null): PoseSample<P> | null {
    const sample = previous ?? this.last;
    const playback = sample?.transition;
    if (sample && playback?.kind === "authored" && playback.progress < 1) {
      const resource = this.options.transitions?.find(
        (item) => item.id === playback.id,
      );
      const first = resource?.keyframes[0];
      const pose =
        first &&
        (typeof first.pose === "string" ? this.poses[first.pose] : first.pose);
      this.needsEntry =
        !pose ||
        sample.pose.part !== pose.part ||
        JSON.stringify(sample.pose.limbs) !== JSON.stringify(pose.limbs) ||
        sample.displayFacing !== (first!.viewFacing ?? resource!.from.facing);
    }
    this.active = null;
    this.failure = null;
    this.request = "";
    this.last = sample
      ? { ...sample, transition: undefined, motionFailure: undefined }
      : null;
    return this.last;
  }
  loopStart() {
    return this.endpoint?.pose === "walk" && this.terminal
      ? structuredClone(this.terminal)
      : null;
  }
  displayFacing(requested: number, t?: number) {
    if (this.active && t !== undefined) {
      const progress = Math.max(
        0,
        Math.min(
          1,
          ((t - this.active.at) * 1000) / this.active.resource.durationMs,
        ),
      );
      const keyframe = [...this.active.resource.keyframes]
        .reverse()
        .find((item) => item.progress <= progress)!;
      return keyframe.viewFacing ?? this.active.resource.from.facing;
    }
    if (!this.last) {
      const entry = this.options.transitions?.find(
        (resource) =>
          resource.from.pose === "stand" && resource.to.facing === requested,
      );
      if (entry) return entry.keyframes[0].viewFacing ?? entry.from.facing;
    }
    return this.last?.displayFacing ?? requested;
  }
  private stand(facing: number): P | null {
    if (this.options.stand) return this.options.stand;
    const candidates: P[] = [];
    for (const transition of this.options.transitions ?? []) {
      if (
        transition.from.pose === "stand" &&
        transition.from.facing === facing &&
        typeof transition.keyframes[0].pose !== "string"
      )
        candidates.push(transition.keyframes[0].pose);
      const final = transition.keyframes.at(-1)!;
      if (
        transition.to.pose === "stand" &&
        transition.to.facing === facing &&
        typeof final.pose !== "string"
      )
        candidates.push(final.pose);
    }
    if (!candidates.length) {
      this.failure = { reason: "needs-stand-view" };
      return null;
    }
    if (
      candidates.some(
        (pose) => JSON.stringify(pose) !== JSON.stringify(candidates[0]),
      )
    ) {
      this.failure = { reason: "ambiguous-stand-view" };
      return null;
    }
    return candidates[0];
  }
  private reject(
    reason: AuthoredTransitionFailure["reason"],
    frame: ArticulationFrame,
  ): Playback<P> {
    this.failure = { reason };
    this.active = null;
    if (this.last) {
      const travel: Point = frame.locomotion?.travel
        ? [frame.locomotion.travel.x, frame.locomotion.travel.y]
        : this.travel;
      const safeTravel = travel.every(Number.isFinite) ? travel : this.travel;
      const facing = this.last.displayFacing ?? 1;
      const delta: Point = [
        (this.travel[0] - safeTravel[0]) / this.scale / facing,
        (this.travel[1] - safeTravel[1]) / this.scale,
      ];
      this.last = this.translate(this.last, delta);
      this.last.motionFailure = { ...this.failure };
      this.travel = [...safeTravel];
    }
    return { sample: this.last };
  }
  private translate(sample: PoseSample<P>, delta: Point): PoseSample<P> {
    const state = {
      ...sample.state,
      body: {
        ...sample.state.body,
        tx: Number(sample.state.body.tx ?? 0) + delta[0],
        ty: Number(sample.state.body.ty ?? 0) + delta[1],
      },
    };
    return {
      ...sample,
      state,
      contacts: { ...sample.contacts },
      alignment: [Number(state.body.tx), Number(state.body.ty)],
      endpoints: Object.fromEntries(
        limbs.map((name) => [
          name,
          authoredContactPoint(sample.pose, state, name),
        ]),
      ) as Record<LimbName, Point>,
    };
  }
  private world(
    sample: PoseSample<P>,
    name: LimbName,
    travel: Point,
    scale: number,
  ): Point {
    const point = authoredContactPoint(sample.pose, sample.state, name);
    return [
      point[0] * scale * (sample.displayFacing ?? 1) + travel[0],
      point[1] * scale + travel[1],
    ];
  }
  /** Return undefined only when the existing pose-local animation owns the same endpoint. */
  sample(
    frame: ArticulationFrame,
    requested: PoseName | null,
    previous: PoseSample<P> | null,
  ): Playback<P> | undefined {
    if (this.options.transitions === undefined) return undefined;
    if (!Number.isFinite(frame.t))
      return this.reject("transition-invalid-time", frame);
    if (
      !(
        Number.isFinite(frame.worldScale ?? 1) && (frame.worldScale ?? 1) > 0
      ) ||
      (frame.locomotion?.travel &&
        ![frame.locomotion.travel.x, frame.locomotion.travel.y].every(
          Number.isFinite,
        ))
    )
      return this.reject("transition-support-mismatch", frame);
    const ordinaryIdle =
      frame.mode === "idle" &&
      (!frame.locomotion || frame.locomotion.state === "idle") &&
      frame.sit < 0.4;
    if (!requested && !ordinaryIdle) {
      this.active = null;
      this.endpoint = null;
      this.failure = null;
      this.alignment = [0, 0];
      this.loopAnchors = {};
      this.terminal = null;
      this.request = "";
      this.needsEntry = false;
      return undefined;
    }
    const facing = (Math.sign(frame.locomotion?.facing ?? frame.facing ?? 1) ||
      1) as -1 | 1;
    const edge: PetEdge | undefined =
      requested === "side" || requested === "top" || requested === "bottom"
        ? (frame.locomotion?.edge ?? undefined)
        : undefined;
    const target: MotionTransitionEndpoint = {
      pose: requested ?? "stand",
      facing,
      ...(edge ? { edge } : {}),
    };
    const request = JSON.stringify(target);
    if (this.failure) {
      // Render ticks cannot recover a failed trajectory. Only a new selection replaces it.
      if (request === this.request)
        return this.reject(this.failure.reason, frame);
      this.failure = null;
    }
    this.request = request;
    if (!this.endpoint) {
      const entry = this.options.transitions?.find(
        (resource) =>
          resource.from.pose === "stand" && sameEndpoint(resource.to, target),
      );
      const initialFacing = entry?.from.facing ?? facing;
      const pose = this.stand(initialFacing);
      if (!pose) return this.reject(this.failure!.reason, frame);
      this.endpoint = { pose: "stand", facing: initialFacing };
      this.last = authoredRestSample(
        pose,
        "walk",
        "stand",
        entry?.keyframes[0].viewFacing ?? initialFacing,
      );
      this.travel = frame.locomotion?.travel
        ? [frame.locomotion.travel.x, frame.locomotion.travel.y]
        : [0, 0];
      this.scale = frame.worldScale ?? 1;
    } else if (previous) this.last = previous;
    if (this.active && !sameEndpoint(this.active.resource.to, target))
      return this.reject("transition-interrupted", frame);
    if (
      !this.active &&
      (this.needsEntry || !sameEndpoint(this.endpoint, target))
    ) {
      const resource = this.options.transitions!.find(
        (item) =>
          sameEndpoint(item.from, this.endpoint!) &&
          sameEndpoint(item.to, target),
      );
      if (!resource) return this.reject("needs-authored-transition", frame);
      if (
        resource.from.facing !== resource.to.facing &&
        resource.keyframes.some((keyframe) => keyframe.viewFacing === undefined)
      )
        return this.reject("needs-authored-turn-basis", frame);
      const first = resource.keyframes[0],
        firstPose =
          typeof first.pose === "string" ? this.poses[first.pose] : first.pose;
      if (
        (first.viewFacing ?? resource.from.facing) !==
          this.last!.displayFacing ||
        firstPose.part !== this.last!.pose.part ||
        JSON.stringify(firstPose.limbs) !==
          JSON.stringify(this.last!.pose.limbs)
      )
        return this.reject("transition-entry-view-mismatch", frame);
      for (const keyframe of resource.keyframes) {
        const pose =
          typeof keyframe.pose === "string"
            ? this.poses[keyframe.pose]
            : keyframe.pose;
        if (
          limbs.some((name) => {
            const a = firstPose.limbs[name],
              b = pose.limbs[name];
            return (
              Math.abs(dist(a.root, a.joint) - dist(b.root, b.joint)) > 0.1 ||
              Math.abs(dist(a.joint, a.end) - dist(b.joint, b.end)) > 0.1
            );
          })
        )
          return this.reject("transition-bone-length-mismatch", frame);
      }
      this.active = {
        resource,
        at: frame.t,
        index: -1,
        entry: this.last!,
        fromTravel: [...this.travel],
        fromScale: this.scale,
        lastTime: frame.t,
        origin: (() => {
          const p = transform(
            this.last!.pose.waist,
            this.last!.state,
            "body",
            this.last!.pose.waist,
          );
          return [
            p[0] - firstPose.waist[0],
            p[1] - firstPose.waist[1],
          ] as Point;
        })(),
        ...(resource.to.pose === "held"
          ? { grip: [...(frame.gripPoint ?? this.last!.pose.waist)] as Point }
          : {}),
        anchors: {},
      };
      this.needsEntry = false;
    }
    if (!this.active) {
      if (target.pose === "stand") {
        const travel: Point = frame.locomotion?.travel
          ? [frame.locomotion.travel.x, frame.locomotion.travel.y]
          : this.travel;
        this.last = this.translate(this.last!, [
          (this.travel[0] - travel[0]) /
            this.scale /
            (this.last!.displayFacing ?? 1),
          (this.travel[1] - travel[1]) / this.scale,
        ]);
        this.travel = [...travel];
        return { sample: this.last };
      }
      return undefined;
    }
    return this.play(frame);
  }
  private play(frame: ArticulationFrame): Playback<P> {
    const active = this.active!,
      resource = active.resource;
    const displayed = this.last,
      displayedTravel = [...this.travel] as Point,
      displayedScale = this.scale;
    const abort = (reason: AuthoredTransitionFailure["reason"]) => {
      this.last = displayed;
      this.travel = displayedTravel;
      this.scale = displayedScale;
      return this.reject(reason, frame);
    };
    const progress = Math.max(
      0,
      Math.min(1, ((frame.t - active.at) * 1000) / resource.durationMs),
    );
    const travel: Point = frame.locomotion?.travel
      ? [frame.locomotion.travel.x, frame.locomotion.travel.y]
      : this.travel;
    const scale = frame.worldScale ?? 1;
    if (
      !(scale > 0) ||
      !travel.every(Number.isFinite) ||
      Math.abs(scale - active.fromScale) > 1e-9
    )
      return abort("transition-support-mismatch");
    let index = 0;
    resource.keyframes.forEach((keyframe, i) => {
      if (keyframe.progress <= progress) index = i;
    });
    if (index < active.index || frame.t < active.lastTime)
      return abort("transition-invalid-time");
    active.lastTime = frame.t;
    // Visit skipped authored handoffs too; a low render rate cannot bypass invalid contacts.
    for (let next = active.index + 1; next <= index; next++) {
      const framePose = resource.keyframes[next],
        supports = framePose.supports ?? {};
      const pose =
        typeof framePose.pose === "string"
          ? this.poses[framePose.pose]
          : framePose.pose;
      const name =
        typeof framePose.pose === "string"
          ? framePose.pose
          : resource.to.pose === "stand"
            ? "walk"
            : resource.to.pose;
      const view =
        typeof framePose.pose === "string"
          ? framePose.pose
          : `transition:${resource.id}:${next}`;
      const facing = framePose.viewFacing ?? resource.from.facing;
      let sample =
        next === 0
          ? { ...active.entry, view, displayFacing: facing }
          : authoredRestSample(pose, name, view, facing);
      sample.motionFailure = undefined;
      const shared = limbs.filter(
        (name) =>
          supports[name] && active.anchors[name]?.edge === supports[name]!.edge,
      );
      if (
        resource.from.edge &&
        resource.to.edge &&
        !Object.keys(supports).length
      )
        return abort("transition-support-handoff");
      if (
        next > 0 &&
        Object.keys(active.anchors).length &&
        Object.keys(supports).length &&
        !shared.length
      )
        return abort("transition-support-handoff");
      const alignment: Point = [0, 0];
      if (shared.length) {
        const anchor = active.anchors[shared[0]]!.world,
          actual = this.world(sample, shared[0], travel, scale);
        alignment[0] = (anchor[0] - actual[0]) / scale / facing;
        alignment[1] = (anchor[1] - actual[1]) / scale;
        sample = this.translate(sample, alignment);
      } else if (active.grip && next > 0) {
        // gripPoint is already rendered model space, not another source point to transform.
        const grip = frame.gripPoint ?? active.grip;
        sample = this.translate(sample, [
          grip[0] - pose.waist[0],
          grip[1] - pose.waist[1],
        ]);
      } else if (next === 0) {
        if (!active.grip && Object.keys(supports).length)
          sample = this.translate(sample, [
            (active.fromTravel[0] - travel[0]) / scale / facing,
            (active.fromTravel[1] - travel[1]) / scale,
          ]);
      } else {
        sample = this.translate(sample, active.origin);
      }
      const anchors: Active<P>["anchors"] = {};
      for (const name of limbs)
        if (supports[name]) {
          if (
            next === 0 &&
            !active.entry.contacts[name] &&
            active.entry.pose.part !== this.standPosePart()
          )
            return abort("transition-support-handoff");
          const point = this.world(sample, name, travel, scale),
            previous = active.anchors[name];
          if (
            previous &&
            previous.edge === supports[name]!.edge &&
            dist(point, previous.world) > 1
          )
            return abort("transition-support-mismatch");
          anchors[name] = {
            ...supports[name]!,
            world:
              previous?.edge === supports[name]!.edge ? previous.world : point,
          };
        }
      sample.contacts = Object.fromEntries(
        limbs.map((name) => [name, !!supports[name]]),
      ) as Record<LimbName, boolean>;
      for (const edge of ["left", "right", "top", "bottom"] as const) {
        const points = Object.values(anchors)
          .filter((anchor) => anchor.edge === edge)
          .map((anchor) => anchor.world);
        const axis = edge === "top" || edge === "bottom" ? 1 : 0;
        if (points.some((point) => Math.abs(point[axis] - points[0][axis]) > 1))
          return abort("transition-support-plane-mismatch");
      }
      active.anchors = anchors;
      active.index = next;
      this.last = sample;
      this.travel = [...travel];
      this.scale = scale;
    }
    // Supported cels stay fixed in world space; a grabbed cel follows the native window.
    if (!active.grip && Object.keys(active.anchors).length)
      this.last = this.translate(this.last!, [
        (this.travel[0] - travel[0]) / scale / (this.last!.displayFacing ?? 1),
        (this.travel[1] - travel[1]) / scale,
      ]);
    if (active.grip && frame.gripPoint) {
      const desired = frame.gripPoint;
      const current =
        active.index === 0
          ? active.grip
          : transform(
              this.last!.pose.waist,
              this.last!.state,
              "body",
              this.last!.pose.waist,
            );
      this.last = this.translate(this.last!, [
        desired[0] - current[0],
        desired[1] - current[1],
      ]);
      active.grip = [...desired];
    }
    this.travel = [...travel];
    if (!this.last) return abort("transition-entry-view-mismatch");
    this.last.transition = {
      kind: "authored",
      id: resource.id,
      progress,
      from: resource.from,
      to: resource.to,
    };
    if (progress === 1) {
      this.endpoint = resource.to;
      this.active = null;
      this.alignment = [
        Number(this.last.state.body.tx ?? 0),
        Number(this.last.state.body.ty ?? 0),
      ];
      this.terminal = {
        travel: [...travel],
        t: frame.t,
        contacts: { ...this.last.contacts },
      };
      this.loopAnchors = structuredClone(active.anchors);
      return { sample: this.last, complete: resource.to };
    }
    return { sample: this.last };
  }
  private standPosePart() {
    return (
      this.options.stand?.part ??
      (this.endpoint?.pose === "stand" ? this.last?.pose.part : undefined)
    );
  }
  /** Pose-local loops inherit the terminal complete drawing and scene origin. */
  observe(
    sample: PoseSample<P> | null,
    frame: ArticulationFrame,
  ): PoseSample<P> | null {
    if (this.options.transitions === undefined || !sample) return sample;
    if (this.endpoint?.pose === "held" && frame.gripPoint)
      this.alignment = [
        frame.gripPoint[0] - sample.pose.waist[0],
        frame.gripPoint[1] - sample.pose.waist[1],
      ];
    const view = this.last?.view,
      basis = this.last?.displayFacing;
    const candidate = this.translate(sample, this.alignment);
    candidate.view ??= view;
    candidate.displayFacing = sample.displayFacing ?? basis;
    const travel: Point = frame.locomotion?.travel
      ? [frame.locomotion.travel.x, frame.locomotion.travel.y]
      : this.travel;
    const scale = frame.worldScale ?? 1;
    if (this.endpoint?.edge && frame.locomotion?.attachment === "resting")
      for (const name of limbs)
        if (this.loopAnchors[name]) candidate.contacts[name] = true;
    const activeNames = limbs.filter((name) => candidate.contacts[name]);
    const shared = activeNames.filter((name) => this.loopAnchors[name]);
    if (
      this.endpoint?.edge &&
      Object.keys(this.loopAnchors).length &&
      !shared.length
    )
      return this.reject("transition-support-handoff", frame).sample;
    const anchors: typeof this.loopAnchors = {};
    for (const name of activeNames) {
      const actual = this.world(candidate, name, travel, scale),
        previous = this.loopAnchors[name];
      if (previous && dist(actual, previous.world) > 1)
        return this.reject("transition-support-mismatch", frame).sample;
      anchors[name] = {
        edge: this.endpoint?.edge ?? "bottom",
        point:
          candidate.pose.limbs[name].contact ?? candidate.pose.limbs[name].end,
        world: previous?.world ?? actual,
      };
    }
    for (const edge of ["left", "right", "top", "bottom"] as const) {
      const points = Object.values(anchors)
        .filter((anchor) => anchor.edge === edge)
        .map((anchor) => anchor.world);
      const axis = edge === "top" || edge === "bottom" ? 1 : 0;
      if (points.some((point) => Math.abs(point[axis] - points[0][axis]) > 1))
        return this.reject("transition-support-plane-mismatch", frame).sample;
    }
    this.last = candidate;
    this.loopAnchors = anchors;
    this.travel = [...travel];
    this.scale = scale;
    return this.last;
  }
  localSample(sample: PoseSample<P> | null) {
    return sample && this.options.transitions !== undefined
      ? this.translate(sample, [-this.alignment[0], -this.alignment[1]])
      : sample;
  }
  localFrame(frame: ArticulationFrame): ArticulationFrame {
    return this.options.transitions !== undefined &&
      this.endpoint?.pose === "held" &&
      this.last
      ? { ...frame, gripPoint: this.last.pose.waist }
      : frame;
  }
}
