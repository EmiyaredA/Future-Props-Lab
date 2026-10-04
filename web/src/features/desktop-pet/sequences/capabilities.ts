import type { PetEdge } from "@platform/petMotion";
import type { ArticulationFrame } from "../locomotion/articulation";
import type { MotionDemo } from "../locomotion/demo";
import type { FrameSequences, SequenceFrame } from "./types";
import { readFrameSequences } from "./validation";

const edges: PetEdge[] = ["left", "right", "top", "bottom"];
const direction = (facing = 1) => (facing < 0 ? "left" : "right");
const edgeClip = (edge: PetEdge, facing: number) =>
  edge === "left" || edge === "right"
    ? `side-${edge}`
    : `${edge}-${direction(facing)}`;

/** Shared selection for physical motion and event inspection; no implicit mirroring. */
export function clipForFrame(
  frame: Pick<ArticulationFrame, "mode" | "facing" | "locomotion">,
): string {
  const motion = frame.locomotion;
  if (motion) {
    if (motion.state === "walk" || motion.state === "glide")
      return `${motion.state}-${direction(motion.facing)}`;
    if (motion.state === "climb" && motion.edge)
      return edgeClip(motion.edge, motion.facing);
    return motion.state;
  }
  if (frame.mode === "stand") return "idle";
  if (frame.mode === "walk" || frame.mode === "run")
    return `walk-${direction(frame.facing)}`;
  return frame.mode;
}

/** Declared painted support planes only; this does not certify the source art. */
export function sequenceEdges(sequences: FrameSequences): PetEdge[] {
  const scale = sequences.modelBox[2] / sequences.frameSize[0];
  return edges.filter((edge) => {
    const ids =
      edge === "left" || edge === "right"
        ? [edgeClip(edge, 1)]
        : [edgeClip(edge, -1), edgeClip(edge, 1)];
    return ids.every((id) =>
      sequences.clips[id]?.frames.every((frame) => {
        const contact = frame.contacts?.[edge];
        const supports = Object.entries(frame.supports ?? {});
        if (!contact || !supports.length) return false;
        if (edge === "top" && !supports.some(([key]) => key.startsWith("arm")))
          return false;
        if (edge === "bottom" && supports.length < 2) return false;
        const axis = edge === "left" || edge === "right" ? 0 : 1;
        return supports.every(
          ([, point]) => Math.abs(point[axis] - contact[axis]) * scale <= 1,
        );
      }),
    );
  });
}

export type ModelSequences =
  | { kind: "absent" }
  | { kind: "invalid"; reason: string }
  | { kind: "valid"; sequences: FrameSequences };

/** Absence is compatible; a declared invalid namespace must never activate legacy motion. */
export function modelSequences(model: unknown): ModelSequences {
  if (!model || typeof model !== "object" || !("frameSequences" in model))
    return { kind: "absent" };
  try {
    const sequences = readFrameSequences(model.frameSequences);
    return sequences
      ? { kind: "valid", sequences }
      : { kind: "invalid", reason: "完整序列帧资源无效：缺少序列描述" };
  } catch (error: unknown) {
    return {
      kind: "invalid",
      reason: error instanceof Error ? error.message : "完整序列帧资源无效",
    };
  }
}

const sameCel = (a: SequenceFrame, b: SequenceFrame) => {
  const anchors = (value: SequenceFrame) =>
    ["contacts", "supports"].map((key) =>
      Object.entries(value[key as "contacts" | "supports"] ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, point]) => [name, ...point]),
    );
  return (
    a.texture === b.texture &&
    JSON.stringify([a.rect, a.grip, a.foot, a.head, anchors(a)]) ===
      JSON.stringify([b.rect, b.grip, b.foot, b.head, anchors(b)])
  );
};

/** Player selects a direct authored bridge; graph reachability alone is insufficient. */
export function sequenceLinkUnavailable(
  sequences: FrameSequences,
  from: string,
  to: string,
): string | null {
  if (from === to) return null;
  const source = sequences.clips[from],
    target = sequences.clips[to];
  if (!source || !target) return `完整序列帧缺少动作：${!source ? from : to}`;
  const link = sequences.transitions.find(
    (item) => item.from === from && item.to === to,
  );
  const bridge = link && sequences.clips[link.clip];
  if (!bridge) return `完整序列帧缺少过渡：${from} → ${to}`;
  if (bridge.loop || bridge.distancePerCycle !== undefined)
    return `完整序列帧过渡不能循环或由位移驱动：${from} → ${to}`;
  if (
    !source.frames.every((frame) =>
      bridge.frames.some((cel) => sameCel(frame, cel)),
    )
  )
    return `完整序列帧过渡缺少当前动作端点：${from} → ${to}`;
  if (!sameCel(bridge.frames.at(-1)!, target.frames[0]))
    return `完整序列帧过渡末帧与目标不一致：${from} → ${to}`;
  return null;
}

export function sequenceDemoClips(demo: MotionDemo): string[] {
  if (demo === "climb-top" || demo === "climb-bottom") {
    const edge = demo === "climb-top" ? "top" : "bottom";
    return [edgeClip(edge, 1)];
  }
  if (demo === "climb-left" || demo === "climb-right")
    return [edgeClip(demo === "climb-left" ? "left" : "right", 1)];
  return [demo];
}

export function sequenceClipUnavailable(
  sequences: FrameSequences,
  clip: string,
): string | null {
  if (!sequences.clips[clip]) return `完整序列帧缺少动作：${clip}`;
  return (
    sequenceLinkUnavailable(sequences, "idle", clip) ??
    sequenceLinkUnavailable(sequences, clip, "idle")
  );
}
