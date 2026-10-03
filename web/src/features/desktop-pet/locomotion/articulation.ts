import type { PetMotionFrame } from "@platform/petMotion";
import type { Deformer, RigState } from "../whale-vendor/rig/rig.js";
import { cycle } from "./phases";

export type Point = [number, number];
export type LimbName = "armNear" | "armFar" | "legBack" | "legFront";
export type Limb = { root: Point; joint: Point; end: Point; parts: [string, string, string]; jointPart?: string };
export type MotionRig = { version: 1; limbs: Record<LimbName, Limb>; hiddenParts: string[] };
export type ArticulationFrame = {
  t: number; mode: string; worldScale?: number; facing?: number;
  locomotion?: PetMotionFrame | null;
  gait?: { phase: number; stride: number; lift: number };
  swing: number; sit: number;
  gripPoint?: Point | null;
};
const names: LimbName[] = ["armNear", "armFar", "legBack", "legFront"];
const rad = Math.PI / 180;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const distance = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const angle = (a: Point, b: Point) => Math.atan2(b[1] - a[1], b[0] - a[0]);
const degrees = (a: number) => Math.atan2(Math.sin(a), Math.cos(a)) / rad;
const ease = (x: number) => { const v = clamp(x, 0, 1); return v * v * (3 - 2 * v); };

/** Two rigid segments: endpoint clamping prevents hyperextension without stretching artwork. */
export function solveLimb(limb: Limb, target: Point, bend: -1 | 1) {
  const a = distance(limb.root, limb.joint), b = distance(limb.joint, limb.end);
  const d = clamp(distance(limb.root, target), Math.abs(a - b) + 0.01, a + b - 0.01);
  const axis = angle(limb.root, target);
  const upper = axis + bend * Math.acos(clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1));
  const joint: Point = [limb.root[0] + Math.cos(upper) * a, limb.root[1] + Math.sin(upper) * a];
  const end: Point = [limb.root[0] + Math.cos(axis) * d, limb.root[1] + Math.sin(axis) * d];
  const lower = angle(joint, end);
  const upperDelta = degrees(upper - angle(limb.root, limb.joint));
  const lowerDelta = degrees(lower - angle(limb.joint, limb.end)) - upperDelta;
  return { upper: upperDelta, lower: lowerDelta, joint, end };
}

export function jointDeformers(rig: MotionRig): Record<string, Deformer> {
  return Object.fromEntries(names.flatMap((name) => [
    [name, { kind: "rot", parent: "body", pivot: rig.limbs[name].root }],
    [`${name}Lower`, { kind: "rot", parent: name, pivot: rig.limbs[name].joint }],
    [`${name}End`, { kind: "rot", parent: `${name}Lower`, pivot: rig.limbs[name].end }],
  ]));
}

type Anchor = { at: Point; travel: Point; mode: string; cycle: number };
export type ArticulatedPose = { state: RigState; endpoints: Record<LimbName, Point>; contacts: Record<LimbName, boolean> };

/** Renderer-owned contact anchors. Input is immutable; world motion comes exclusively from host receipts. */
export class Articulation {
  private anchors = new Map<LimbName, Anchor>();
  private previous = new Map<string, number>();
  private lastTime = 0;
  private mode = "idle";
  private modeAt = 0;
  constructor(private readonly rig: MotionRig, private readonly bodyPivot: Point) {}
  sample(frame: ArticulationFrame): ArticulatedPose {
    const mode = frame.locomotion?.state ?? frame.mode;
    const moving = mode === "walk" || mode === "run";
    const climb = mode === "climb";
    const held = mode === "held" || mode === "drag";
    const glide = mode === "glide" || mode === "air";
    const land = mode === "land";
    const dt = clamp(frame.t - this.lastTime || 1 / 60, 0.001, 0.05);
    this.lastTime = frame.t;
    if (mode !== this.mode) {
      this.anchors.clear();
      this.mode = mode;
      this.modeAt = frame.t;
    }
    const age = frame.t - this.modeAt;
    const phase = frame.locomotion?.phase ?? frame.gait?.phase ?? 0;
    const side = frame.locomotion?.edge === "right" ? 1 : -1;
    const facing = Math.sign(frame.facing ?? frame.locomotion?.facing ?? 1) || 1;
    const scale = Math.max(0.1, frame.worldScale ?? 1);
    const travel: Point = frame.locomotion?.travel
      ? [frame.locomotion.travel.x / scale / (climb ? 1 : facing), frame.locomotion.travel.y / scale]
      : [phase / (Math.PI * 2) * 44, 0];
    const swing = clamp(frame.locomotion?.swing ?? frame.swing, -18, 18);
    const landing = land ? Math.sin(Math.PI * clamp(age / 0.2, 0, 1)) : 0;
    const bodyAngle = climb ? side * -4 : glide ? 8 : held ? swing * 0.15 : moving ? 1.5 : 0;
    const bodyX = climb ? side * 20 : glide ? 2 : moving ? Math.sin(phase) * 1.2 : 0;
    const bodyY = moving ? 5 + 1.2 * Math.cos(phase * 2) : climb ? 1.5 * Math.sin(phase * 2) : land ? 7 * landing : 0;
    const state: RigState = { alpha: {}, z: {}, body: {} };
    const smooth = (id: string, target: number) => {
      const before = this.previous.get(id) ?? 0;
      const after = before + (target - before) * (1 - Math.exp(-dt * 22));
      this.previous.set(id, after);
      return after;
    };
    const body = { a: smooth("body.a", bodyAngle), tx: smooth("body.x", bodyX), ty: smooth("body.y", bodyY), sx: 1 - smooth("body.yaw", climb ? 0.26 : moving ? 0.12 : glide ? 0.08 : 0) };
    const pivot = held && frame.gripPoint ? frame.gripPoint : this.bodyPivot;
    state.body = { ...body, pivot };
    // IK targets are expressed before the body transform, so supporting limbs compensate for weight shift.
    const inverseBody = (p: Point): Point => {
      const x = p[0] - pivot[0] - body.tx, y = p[1] - pivot[1] - body.ty;
      const a = -body.a * rad;
      return [pivot[0] + (x * Math.cos(a) - y * Math.sin(a)) / body.sx, pivot[1] + x * Math.sin(a) + y * Math.cos(a)];
    };
    const endpoints = {} as Record<LimbName, Point>;
    const contacts = {} as Record<LimbName, boolean>;
    const active = frame.sit < 0.4;
    for (const id of this.rig.hiddenParts) state.alpha[id] = active ? 0 : 1;
    names.forEach((name, index) => {
      const limb = this.rig.limbs[name], leg = index >= 2, i = index % 2;
      const ph = phase + i * Math.PI + (climb && !leg ? Math.PI * 0.3 : 0);
      const u = cycle(ph), stance = climb ? 0.68 : 0.6;
      const support = (moving && leg || climb) && u < stance;
      const lift = Math.sin(Math.PI * clamp((u - stance) / (1 - stance), 0, 1));
      let target: Point = [...limb.end];
      if (moving && leg) {
        // Step length matches the distance-based controller phase. No sinusoidal planted-foot slide.
        const stride = frame.locomotion ? (frame.locomotion.strideLength ?? 48.4) / scale : 44;
        const x = u < stance ? stride * (stance / 2 - u) : stride * (-stance / 2 + ease((u - stance) / (1 - stance)) * stance);
        target = [limb.end[0] + x, limb.end[1] - lift * 13];
      } else if (moving) {
        target = [limb.end[0] - Math.sin(ph) * 5, limb.end[1] - 1 - Math.max(0, Math.sin(ph)) * 2];
      } else if (climb) {
        const reachX = side < 0 ? leg ? 91 + i * 6 : 85 + i * 4 : leg ? 165 - i * 6 : 171 - i * 4;
        const stride = (frame.locomotion?.strideLength ?? 48.4) / scale;
        const y = u < stance ? stride * (u - stance / 2) : stride * (stance / 2 - ease((u - stance) / (1 - stance)) * stance);
        target = [reachX - side * lift * (leg ? 9 : 5), (leg ? 215 : 157) + y];
      } else if (held) {
        const length = distance(limb.root, limb.joint) + distance(limb.joint, limb.end);
        const wobble = swing * (leg ? 0.12 : 0.3);
        target = [limb.root[0] + (i ? 2 : -2) + wobble, limb.root[1] + length - (leg ? 1 : 2)];
      } else if (glide) {
        target = leg ? [limb.root[0] - 8 + i * 10, limb.end[1] - 15 - i * 4] : [limb.root[0] + (i ? 1 : -1) * 34, limb.root[1] - 2 + i * 3];
      } else if (land && leg) target = [limb.end[0], limb.end[1]];
      if (support) {
        const lap = Math.floor(ph / (Math.PI * 2));
        let anchor = this.anchors.get(name);
        if (!anchor || anchor.mode !== mode || anchor.cycle !== lap) {
          anchor = { at: [...target], travel: [...travel], mode, cycle: lap };
          this.anchors.set(name, anchor);
        }
        target = [anchor.at[0] - travel[0] + anchor.travel[0], anchor.at[1] - travel[1] + anchor.travel[1]];
      } else this.anchors.delete(name);
      const blend = mode === "idle" ? 1 : ease(age / (held ? 0.12 : 0.18));
      const rest: Point = [...limb.end];
      const blended: Point = [rest[0] + (target[0] - rest[0]) * blend, rest[1] + (target[1] - rest[1]) * blend];
      // Once planted, contact correction is exact; only free limbs use joint smoothing.
      const pose = solveLimb(limb, inverseBody(blended), (leg ? -1 : i ? -1 : 1));
      const upper = support && age >= 0.18 ? pose.upper : smooth(`${name}.upper`, pose.upper);
      const lower = support && age >= 0.18 ? pose.lower : smooth(`${name}.lower`, pose.lower);
      this.previous.set(`${name}.upper`, upper);
      this.previous.set(`${name}.lower`, lower);
      state[name] = { a: upper };
      state[`${name}Lower`] = { a: lower };
      state[`${name}End`] = { a: leg && support ? -upper - lower - body.a : -lower * 0.25 };
      for (const id of limb.parts) state.alpha[id] = active ? 1 : 0;
      if (limb.jointPart) state.alpha[limb.jointPart] = active ? 1 : 0;
      state.z![limb.parts[0]] = leg ? i ? 2.7 : 2 : i ? 5.3 : 6;
      endpoints[name] = blended;
      contacts[name] = support;
    });
    return { state, endpoints, contacts };
  }
}
