import type { Deformer, RigPart, RigState } from "../whale-vendor/rig/rig.js";
import type { ArticulationFrame, MotionRig, Point } from "./articulation";
import { Articulation, jointDeformers } from "./articulation";
import {
  bindWhaleAuthoredParts,
  readWhaleAuthoredRig,
  whaleAuthoredDeformers,
  WhaleAuthoredAnimation,
} from "./whaleAuthored";
import type { PetEdge } from "@platform/petMotion";

export type WhaleMotionModel = {
  rig: MotionRig | null;
  engine: Articulation | null;
  authored: WhaleAuthoredAnimation | null;
  parts: RigPart[];
  deformers: Record<string, Deformer>;
  view: number[];
  supportedEdges: PetEdge[];
  waist: Point | null;
};

/** Adapt Coo's painted short limbs without changing the imported package or its texture addresses. */
export function whaleMotionRig(
  model: {
    parts: RigPart[];
    pivots: Record<string, Point>;
    view: number[];
    motionRig?: unknown;
  },
  sourceDeformers: Record<string, Deformer>,
): WhaleMotionModel {
  const authoredRig = readWhaleAuthoredRig(model.motionRig, model.parts);
  if (authoredRig)
    return {
      rig: null,
      engine: null,
      authored: new WhaleAuthoredAnimation(authoredRig, model.parts),
      parts: bindWhaleAuthoredParts(model.parts, authoredRig),
      deformers: whaleAuthoredDeformers(authoredRig, sourceDeformers),
      view: model.view,
      supportedEdges: authoredRig.supportedEdges,
      waist: authoredRig.waist,
    };
  const parts = model.parts.map((part) => ({ ...part }));
  const pv = model.pivots;
  const empty = (): [string, string, string] => ["", "", ""];
  const rig: MotionRig = {
    version: 1,
    waist: pv.waist ?? [128, 188.93],
    neck: pv.neck,
    hiddenParts: ["arm_near", "arm_far", "leg_back", "leg_front"],
    limbs: {
      armNear: {
        root: pv.armNear,
        joint: [108, 185],
        end: [103, 203],
        parts: empty(),
      },
      armFar: {
        root: pv.armFar,
        joint: [161, 183],
        end: [168, 198],
        parts: empty(),
      },
      legBack: {
        root: pv.legBack,
        joint: [112, 228],
        end: [110, 248],
        parts: empty(),
      },
      legFront: {
        root: pv.legFront,
        joint: [143, 228],
        end: [142, 246],
        parts: empty(),
      },
    },
  };
  if (!rig.hiddenParts.every((id) => parts.some((part) => part.id === id)))
    return {
      rig: null,
      parts,
      view: model.view,
      deformers: sourceDeformers,
      engine: null,
      authored: null,
      supportedEdges: [] as PetEdge[],
      waist: null,
    };
  parts.forEach((part) => {
    if (part.parent === "body" && !part.id.includes("sit"))
      part.parent = "torso";
  });
  Object.entries(rig.limbs).forEach(([name, limb], index) => {
    const source = parts.find((part) => part.id === rig.hiddenParts[index])!;
    const [x, y, w, h] = source.box,
      cuts = [y, limb.joint[1], limb.end[1], y + h];
    limb.parts = [name, `${name}Lower`, `${name}End`].map((parent, segment) => {
      const top = Math.max(y, cuts[segment] - (segment ? 2 : 0));
      const bottom = Math.min(y + h, cuts[segment + 1] + (segment < 2 ? 2 : 0));
      const id = `motion_${parent}`;
      parts.push({
        ...source,
        id,
        parent,
        box: [x, top, w, bottom - top],
        uvBox: [0, (top - y) / h, 1, (bottom - y) / h],
      });
      return id;
    }) as [string, string, string];
  });
  return {
    rig,
    parts,
    engine: new Articulation(rig, pv.body),
    authored: null,
    supportedEdges: ["left", "right"] as PetEdge[],
    waist: rig.waist ?? null,
    deformers: {
      ...sourceDeformers,
      ...jointDeformers(rig),
      neck: { ...sourceDeformers.neck, parent: "torso" },
      skirt: { ...sourceDeformers.skirt, parent: "torso" },
    },
    view: [
      Math.min(-100, model.view[0]),
      model.view[1],
      Math.max(300, model.view[2]),
      Math.max(400, model.view[3]),
    ],
  };
}

/** Sitting retains the original Coo lower body; physical poses replace only their registered pieces. */
export function applyWhaleMotionPose(
  engine: Articulation | null,
  frame: ArticulationFrame,
  rig: MotionRig | null,
  sit: number,
  state: RigState,
) {
  if (!engine || !rig) return;
  if (sit < 0.4) {
    const pose = engine.sample(frame);
    Object.assign(state, pose.state, {
      alpha: { ...state.alpha, ...pose.state.alpha },
      z: { ...state.z, ...pose.state.z },
    });
  } else {
    for (const limb of Object.values(rig.limbs))
      for (const id of limb.parts) state.alpha[id] = 0;
    state.alpha.arm_near = state.alpha.arm_far = 1;
  }
}
