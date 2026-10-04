import type { MotionDemo } from "./demo";
import {
  modelSequences,
  sequenceClipUnavailable,
  sequenceDemoClips,
  sequenceEdges,
  sequenceLinkUnavailable,
  sequencePhysicalLinkUnavailable,
} from "../sequences/capabilities";

/** Old human rigs split standing bitmaps; they cannot supply coherent motion views. */
function legacyHumanUnavailable(model: unknown): string | null {
  if (!model || typeof model !== "object") return null;
  const value = model as { rigProfile?: unknown; motionRig?: unknown };
  if (
    value.rigProfile !== "human-chibi" ||
    !value.motionRig ||
    typeof value.motionRig !== "object"
  )
    return null;
  return (value.motionRig as { version?: unknown }).version === 1
    ? "当前人物资源缺少完整动作姿势，已暂停旧分件动画；站姿、表情和换装仍可使用"
    : null;
}

/** Autonomous walking needs both authored directions and their entry/return resources. */
export function humanMotionUnavailable(model: unknown): string | null {
  const resource = modelSequences(model);
  if (resource.kind === "invalid") return resource.reason;
  if (resource.kind === "absent") return legacyHumanUnavailable(model);
  for (const clip of ["walk-left", "walk-right"]) {
    const missing = sequenceClipUnavailable(resource.sequences, clip);
    if (missing) return `${missing}，已暂停自主走动`;
    const walk = resource.sequences.clips[clip];
    if (!walk.loop || !walk.distancePerCycle)
      return `完整序列帧缺少循环步距：${clip}，已暂停自主走动`;
    const support =
      sequencePhysicalLinkUnavailable(resource.sequences, "idle", clip) ??
      sequencePhysicalLinkUnavailable(resource.sequences, clip, "idle");
    if (support) return `${support}，已暂停自主走动`;
  }
  return null;
}

/** Partial new resources enable individual demos without borrowing legacy cutout poses. */
export function sequenceDemoUnavailable(
  model: unknown,
  demo: MotionDemo,
): string | null {
  const resource = modelSequences(model);
  if (resource.kind === "invalid") return resource.reason;
  if (resource.kind === "absent") {
    const unavailable = legacyHumanUnavailable(model);
    if (unavailable) return unavailable;
    if (demo === "climb-top" || demo === "climb-bottom") {
      const rig =
        model && typeof model === "object" && "motionRig" in model
          ? model.motionRig
          : undefined;
      if (
        !rig ||
        typeof rig !== "object" ||
        !("version" in rig) ||
        rig.version !== 2
      )
        return "此资源包未提供四边姿势";
    }
    return null;
  }
  const sequences = resource.sequences;
  if (demo.startsWith("climb-")) {
    const edge =
      demo === "climb-left"
        ? "left"
        : demo === "climb-right"
          ? "right"
          : demo === "climb-top"
            ? "top"
            : "bottom";
    if (!sequenceEdges(sequences).includes(edge))
      return "完整序列帧缺少该边的接触与支撑姿势";
  }
  for (const clip of sequenceDemoClips(demo)) {
    if (demo.startsWith("walk-") || demo.startsWith("climb-")) {
      const support =
        sequencePhysicalLinkUnavailable(sequences, "idle", clip) ??
        sequencePhysicalLinkUnavailable(sequences, clip, "idle");
      if (support) return support;
    }
    if (demo.startsWith("glide-")) {
      const unavailable =
        sequenceLinkUnavailable(sequences, "idle", clip) ??
        sequenceLinkUnavailable(sequences, clip, "land") ??
        sequenceLinkUnavailable(sequences, "land", "idle");
      if (unavailable) return unavailable;
    } else {
      const unavailable = sequenceClipUnavailable(sequences, clip);
      if (unavailable) return unavailable;
    }
  }
  return null;
}
