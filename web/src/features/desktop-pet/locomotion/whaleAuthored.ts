import type { PetEdge } from "@platform/petMotion";
import { validatePartRegistrations } from "../partRegistration";
import type { Deformer, RigPart, RigState } from "../whale-vendor/rig/rig.js";
import type { ArticulationFrame, Limb, Point } from "./articulation";
import { jointDeformers } from "./articulation";
import {
  AuthoredPoseAnimation,
  authoredViewBindings,
  bindAuthoredViews,
  posePartIds,
  type AuthoredPose,
  type PoseName,
} from "./authoredPose";

import {
  readAuthoredTransitions,
  type AuthoredTransitions,
} from "./motionTransitions";

export type WhaleFaceProjection = {
  kind: "whale";
  /** Canonical face-canvas pixels to model space; reflection belongs to facing. */
  transform: [number, number, number, number, number, number];
  clip: Point[];
};
export const whaleLayerSlots = [
  "headBack",
  "headFront",
  "skirt",
  "tail",
  "finNear",
  "finFar",
] as const;
export type WhalePose = Omit<AuthoredPose, "face" | "head"> & {
  neck: Point;
  face: WhaleFaceProjection;
  layers: Record<(typeof whaleLayerSlots)[number], string[]>;
};
export type WhaleAuthoredRig = {
  version: 2;
  waist: Point;
  neck: Point;
  hiddenParts: string[];
  supportedEdges: PetEdge[];
  poses: Record<PoseName, WhalePose>;
  transitions?: AuthoredTransitions<WhalePose>;
};
const poseNames: PoseName[] = [
  "walk",
  "held",
  "side",
  "top",
  "bottom",
  "glide",
];
const edges: PetEdge[] = ["left", "right", "top", "bottom"];
const limbs = ["armNear", "armFar", "legBack", "legFront"] as const;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown, limit: number): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  Math.abs(value) <= limit;
const tuple = (
  value: unknown,
  length: number,
  limit: number,
): value is number[] =>
  Array.isArray(value) &&
  value.length === length &&
  value.every((n) => finite(n, limit));
const point = (value: unknown): value is Point => tuple(value, 2, 512);
const exact = (
  value: Record<string, unknown>,
  keys: string[],
  optional: string[] = [],
) =>
  keys.every((key) => key in value) &&
  Object.keys(value).every(
    (key) => keys.includes(key) || optional.includes(key),
  );

/** Defense at the renderer boundary; authorized API import remains the complete package validator. */
export function readWhaleAuthoredRig(
  value: unknown,
  parts: RigPart[],
): WhaleAuthoredRig | null {
  validatePartRegistrations(parts, value);
  if (value == null) return null;
  const fail = (): never => {
    throw new Error("鲸鱼动作资源缺少有效的版本二姿势与四边绑定");
  };
  if (
    !record(value) ||
    !exact(
      value,
      ["version", "waist", "neck", "hiddenParts", "supportedEdges", "poses"],
      ["transitions"],
    ) ||
    value.version !== 2 ||
    !point(value.waist) ||
    !point(value.neck) ||
    !record(value.poses) ||
    !exact(value.poses, poseNames) ||
    !Array.isArray(value.supportedEdges) ||
    value.supportedEdges.length !== 4 ||
    new Set(value.supportedEdges).size !== 4 ||
    !edges.every(
      (edge) =>
        value.supportedEdges instanceof Array &&
        value.supportedEdges.includes(edge),
    )
  )
    return fail();
  const registered = new Map(parts.map((part) => [part.id, part]));
  const seen = new Set<string>();
  if (
    !Array.isArray(value.hiddenParts) ||
    !value.hiddenParts.length ||
    value.hiddenParts.length > 80 ||
    new Set(value.hiddenParts).size !== value.hiddenParts.length ||
    !value.hiddenParts.every(
      (id) => typeof id === "string" && registered.has(id),
    )
  )
    return fail();
  const poseValues = value.poses;
  const read = (name: PoseName) => readWhalePose(poseValues[name], parts, seen);
  const poses = {
    walk: read("walk"),
    held: read("held"),
    side: read("side"),
    top: read("top"),
    bottom: read("bottom"),
    glide: read("glide"),
  };
  const transitions = readAuthoredTransitions(
    value.transitions,
    poses,
    (pose) => readWhalePose(pose, parts),
    whalePosePartIds,
  );
  for (const transition of transitions ?? [])
    for (const frame of transition.keyframes)
      if (typeof frame.pose !== "string")
        for (const id of whalePosePartIds(frame.pose)) seen.add(id);
  if (value.hiddenParts.some((id) => seen.has(id))) return fail();
  // Every shape and reference above has been checked without pretending whale features are human sprites.
  return {
    ...value,
    poses,
    ...(transitions ? { transitions } : {}),
  } as WhaleAuthoredRig;
}

function readWhalePose(
  pose: unknown,
  parts: RigPart[],
  seen = new Set<string>(),
): WhalePose {
  const fail = (): never => {
    throw new Error("鲸鱼动作资源缺少有效的版本二姿势与四边绑定");
  };
  const registered = new Map(parts.map((part) => [part.id, part]));
  const reference = (id: unknown) => {
    if (
      typeof id !== "string" ||
      seen.has(id) ||
      registered.get(id)?.parent !== "body"
    )
      return false;
    seen.add(id);
    return true;
  };
  if (
    !record(pose) ||
    !exact(
      pose,
      ["part", "waist", "neck", "limbs", "edges", "layers", "face"],
      ["stride"],
    ) ||
    !reference(pose.part) ||
    !point(pose.waist) ||
    !point(pose.neck) ||
    !record(pose.limbs) ||
    !exact(pose.limbs, [...limbs]) ||
    !record(pose.edges) ||
    !exact(pose.edges, edges) ||
    !Object.values(pose.edges).every(point) ||
    (pose.stride !== undefined && (!finite(pose.stride, 96) || pose.stride < 8))
  )
    return fail();
  for (const limb of Object.values(pose.limbs)) {
    if (
      !record(limb) ||
      !exact(
        limb,
        ["root", "joint", "end", "region", "limits", "bend"],
        ["contact", "part", "segments"],
      ) ||
      !point(limb.root) ||
      !point(limb.joint) ||
      !point(limb.end) ||
      (limb.contact !== undefined && !point(limb.contact)) ||
      !Array.isArray(limb.region) ||
      limb.region.length < 3 ||
      limb.region.length > 16 ||
      !limb.region.every(point) ||
      !tuple(limb.limits, 4, 120) ||
      limb.limits[0] > 0 ||
      limb.limits[1] < 0 ||
      limb.limits[2] > 0 ||
      limb.limits[3] < 0 ||
      (limb.bend !== 1 && limb.bend !== -1)
    )
      return fail();
    for (const [a, b] of [
      [limb.root, limb.joint],
      [limb.joint, limb.end],
    ]) {
      const length = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (length < 1 || length > 256) return fail();
    }
    if (limb.part !== undefined) {
      if (limb.segments !== undefined || !reference(limb.part)) return fail();
    } else if (
      !Array.isArray(limb.segments) ||
      limb.segments.length !== 3 ||
      !limb.segments.every(reference)
    )
      return fail();
  }
  if (!record(pose.layers) || !exact(pose.layers, [...whaleLayerSlots]))
    return fail();
  for (const [slot, ids] of Object.entries(pose.layers)) {
    if (
      !Array.isArray(ids) ||
      ids.length > 4 ||
      ids.length < (slot === "headBack" ? 0 : 1) ||
      !ids.every(reference)
    )
      return fail();
  }
  const face = pose.face;
  if (
    !record(face) ||
    !exact(face, ["kind", "transform", "clip"]) ||
    face.kind !== "whale" ||
    !Array.isArray(face.transform) ||
    face.transform.length !== 6 ||
    !face.transform.every((n, i) => finite(n, i < 4 ? 4 : 512)) ||
    face.transform[0] * face.transform[3] -
      face.transform[1] * face.transform[2] <=
      1e-8 ||
    !Array.isArray(face.clip) ||
    face.clip.length < 3 ||
    face.clip.length > 16 ||
    !face.clip.every(point)
  )
    return fail();
  const clip: Point[] = face.clip;
  if (
    Math.abs(
      clip.reduce((sum, p, i) => {
        const q = clip[(i + 1) % clip.length];
        return sum + p[0] * q[1] - p[1] * q[0];
      }, 0),
    ) <= 0.01
  )
    return fail();
  return pose as WhalePose;
}

export function whalePosePartIds(pose: WhalePose) {
  return [...posePartIds(pose), ...Object.values(pose.layers).flat()];
}

export function bindWhaleAuthoredParts(
  parts: RigPart[],
  rig: WhaleAuthoredRig,
) {
  const views = authoredViewBindings(rig.poses, {
    transitions: rig.transitions,
  });
  const layers = new Map<string, string>();
  for (const { pose } of Object.values(views))
    for (const [slot, ids] of Object.entries(pose.layers))
      for (const id of ids) layers.set(id, slot);
  return bindAuthoredViews(parts, views).map((part) => {
    const parent = layers.get(part.id);
    return parent ? { ...part, parent, grid: [1, 1], skin: undefined } : part;
  });
}

export function whaleAuthoredDeformers(
  rig: WhaleAuthoredRig,
  source: Record<string, Deformer>,
): Record<string, Deformer> {
  const pose = rig.poses.walk;
  const limb = (name: (typeof limbs)[number]): Limb => ({
    ...pose.limbs[name],
    parts: pose.limbs[name].segments ?? ["", "", ""],
  });
  return {
    ...source,
    ...jointDeformers({
      version: 2,
      hiddenParts: rig.hiddenParts,
      waist: rig.waist,
      limbs: {
        armNear: limb("armNear"),
        armFar: limb("armFar"),
        legBack: limb("legBack"),
        legFront: limb("legFront"),
      },
    }),
    neck: { ...source.neck, parent: "torso" },
    skirt: { ...source.skirt, parent: "torso" },
  };
}

export class WhaleAuthoredAnimation {
  private engine;
  private views;
  private current: WhalePose | null = null;
  constructor(
    readonly rig: WhaleAuthoredRig,
    private readonly parts: RigPart[],
  ) {
    this.views = authoredViewBindings(rig.poses, {
      transitions: rig.transitions,
    });
    this.engine = new AuthoredPoseAnimation(rig.poses, {
      transitions: rig.transitions,
    });
  }
  getMotionFailure() {
    return this.engine.getMotionFailure();
  }
  getMotionTransition() {
    return this.engine.getMotionTransition();
  }
  cancelMotionPlayback() {
    this.engine.cancelMotionPlayback();
  }
  displayFacing(requested: number, t?: number) {
    return this.engine.displayFacing(requested, t);
  }
  get pose() {
    return this.current;
  }
  reset() {
    this.engine = new AuthoredPoseAnimation(this.rig.poses, {
      transitions: this.rig.transitions,
    });
    this.current = null;
  }
  apply(frame: ArticulationFrame, state: RigState) {
    const sample = this.engine.sample(frame);
    this.current = sample?.pose ?? null;
    for (const { pose } of Object.values(this.views))
      for (const id of whalePosePartIds(pose)) state.alpha[id] = 0;
    if (!sample) return null;
    Object.assign(state, sample.state);
    state.alpha = { ...sample.state.alpha };
    // A complete authored silhouette replaces standing/sitting pieces; z stays package-authored.
    const visible = new Set(whalePosePartIds(sample.pose));
    for (const part of this.parts)
      state.alpha[part.id] = visible.has(part.id)
        ? "alpha" in part && typeof part.alpha === "number"
          ? part.alpha
          : 1
        : 0;
    state.alpha.faceFx = 1;
    state.alpha.brows_through = 0;
    state.body = { ...sample.state.body, sx: 1, sy: 1 };
    state.torso = { ...sample.state.torso, pivot: sample.pose.waist };
    state.neck = { pivot: sample.pose.neck };
    // Authored layer art already owns its angle and overlap. Standing-head warps
    // must not counter-rotate the bent neck or apply the original fin/tail pivots.
    for (const slot of [
      ...whaleLayerSlots,
      "headMid",
      "headFeat",
      "tailBend",
      "hairSway",
      "bangsSway",
      "ahoge",
      "brows",
      "creases",
    ])
      state[slot] = {};
    return sample;
  }
}

/** Project the fully composed native face, including its eye clipping and eyelash motion. */
export function projectWhaleFace(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  face: WhaleFaceProjection,
  view: number[],
) {
  const [x, y, x1, y1] = view;
  const sx = context.canvas.width / (x1 - x),
    sy = context.canvas.height / (y1 - y);
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  context.save();
  context.setTransform(sx, 0, 0, sy, -x * sx, -y * sy);
  context.beginPath();
  face.clip.forEach(([px, py], i) =>
    i ? context.lineTo(px, py) : context.moveTo(px, py),
  );
  context.closePath();
  context.clip();
  context.transform(...face.transform);
  context.drawImage(source, 0, 0);
  context.restore();
}

/** Reuse one projection surface; changing a face or pose never reconstructs GPU geometry. */
export function createWhaleFaceProjector(
  authored: WhaleAuthoredAnimation | null,
  view: number[],
  standing: WhaleFaceProjection,
) {
  if (!authored) return (source: HTMLCanvasElement) => source;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round((view[2] - view[0]) * 3);
  canvas.height = Math.round((view[3] - view[1]) * 3);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("鲸鱼五官画布不可用");
  return (source: HTMLCanvasElement) => {
    projectWhaleFace(context, source, authored.pose?.face ?? standing, view);
    return canvas;
  };
}

/** Explicit capabilities let geometry consumers avoid inferring four edges from a profile name. */
export function whaleGeometryAttributes(
  group: SVGGElement,
  supported: PetEdge[],
  pose: WhalePose | null,
) {
  group.setAttribute("data-pet-supported-edges", supported.join(","));
  if (pose) {
    group.setAttribute("data-pet-edges", JSON.stringify(pose.edges));
    if (pose.stride) group.setAttribute("data-pet-stride", String(pose.stride));
    else group.removeAttribute("data-pet-stride");
  } else {
    group.removeAttribute("data-pet-edges");
    group.removeAttribute("data-pet-stride");
  }
}
