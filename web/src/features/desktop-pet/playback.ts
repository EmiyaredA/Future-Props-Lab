import type { PetDocument, PetReaction } from "./api";
import type { CharacterDocument } from "@shared/live2d/types";
import {
  clipForFrame,
  modelSequences,
  sequenceClipUnavailable,
} from "./sequences/capabilities";

export type PetPlaybackMode = "runtime" | "inspect" | "event";
export type PetEvent = "idle" | "click" | "pet" | "grab" | "drop" | "roam";
export const EVENT_LABELS: Record<PetEvent, string> = {
  idle: "待机",
  click: "点击身体",
  pet: "摸头",
  grab: "拖起",
  drop: "放下",
  roam: "自主走动",
};
export const MOTION_LABELS: Record<string, string> = {
  stand: "站立",
  jump: "跳跃",
  hop: "轻跳",
  look: "张望",
  turn: "转身",
  nod: "点头",
  shake: "摇头",
  spin: "旋转",
  sit: "坐下",
  sleep: "睡觉",
  dizzy: "晕眩",
  walk: "走路",
  run: "跑步",
};
export const EXPRESSION_LABELS: Record<string, string> = {
  neutral: "自然",
  happy: "开心",
  wink: "眨单眼",
  love: "喜欢",
  shy: "害羞",
  surprised: "惊讶",
  angry: "生气",
  sad: "难过",
  sleepy: "困倦",
  thinking: "思考",
};
const DEFAULT_MOTIONS: Partial<Record<PetEvent, string>> = {
  click: "hop",
  pet: "nod",
  grab: "look",
  drop: "stand",
  roam: "walk",
};
export function reactionFor(
  document: PetDocument,
  name: PetEvent,
): PetReaction {
  return (
    document.config.events?.[name] ?? {
      motionId:
        document.sourceType === "coopanion-whale"
          ? (DEFAULT_MOTIONS[name] ?? null)
          : null,
      expressionId: null,
      lines: [],
      sound: "none",
    }
  );
}
/** Capability feedback does not edit the saved reaction or substitute another action. */
export function reactionMotionUnavailable(
  document: PetDocument,
  id: string | null | undefined,
): string | null {
  if (!id) return null;
  if (document.sourceType !== "coopanion-whale")
    return document.character?.motions?.some((motion) => motion.id === id)
      ? null
      : "当前角色缺少此动作资源";
  if (!Object.hasOwn(MOTION_LABELS, id)) return "当前动作尚未接入渲染器";
  const resource = modelSequences(document.whaleModel);
  if (resource.kind === "invalid") return resource.reason;
  if (resource.kind === "valid") {
    // These legacy actions change physics/pulses rather than request their own
    // complete-cel mode. A similarly named atlas cannot make them render.
    if (["jump", "hop", "nod", "shake", "spin", "turn"].includes(id))
      return "完整序列帧尚未接入此动作阶段，暂不支持";
    const clip = clipForFrame({ mode: id, facing: 1 });
    const unavailable = sequenceClipUnavailable(resource.sequences, clip);
    if (unavailable) return unavailable;
    if (id === "walk" || id === "run") {
      const walk = resource.sequences.clips[clip];
      if (!walk.loop || !walk.distancePerCycle)
        return "完整序列帧缺少循环步距，暂不支持此动作";
    }
    return null;
  }
  const model = document.whaleModel;
  const rig = model?.motionRig;
  if (
    model?.rigProfile === "human-chibi" &&
    rig &&
    typeof rig === "object" &&
    "version" in rig &&
    rig.version === 1 &&
    !["stand", "sit", "sleep"].includes(id)
  )
    return "当前人物资源已暂停旧分件动作；仅保留站立、坐下和睡觉";
  return null;
}

export function reactionExpressionUnavailable(
  document: PetDocument,
  id: string | null | undefined,
): string | null {
  if (!id) return null;
  if (document.sourceType !== "coopanion-whale")
    return document.character?.expressions?.some(
      (expression) => expression.id === id,
    )
      ? null
      : "当前角色缺少此表情资源";
  if (!Object.hasOwn(EXPRESSION_LABELS, id)) return "当前表情尚未接入渲染器";
  const resource = modelSequences(document.whaleModel);
  if (resource.kind === "invalid") return resource.reason;
  if (resource.kind === "valid")
    return id === "neutral" ? null : "完整序列帧未提供表情变体，暂不支持";
  return document.whaleModel?.rigProfile === "human-chibi" &&
    ["wink", "sad"].includes(id)
    ? "当前角色未支持此表情素材"
    : null;
}

export function expressionSupported(document: PetDocument, id: string) {
  return reactionExpressionUnavailable(document, id) === null;
}
export function playbackDuration(document: PetDocument, name: PetEvent) {
  if (document.sourceType === "coopanion-whale") return 1800;
  const motion = document.character?.motions?.find(
    (item) => item.id === reactionFor(document, name).motionId,
  );
  return Math.max(500, motion ? (motion.duration / motion.fps) * 1000 : 850);
}

/** Time relative to a trigger, with inspection expressions held after a one-shot motion. */
export function live2dPlayback(
  character: CharacterDocument,
  events: PetDocument["config"]["events"],
  name: string,
  mode: PetPlaybackMode,
  elapsed: number,
) {
  const selected = events?.[name as PetEvent];
  const motion = character.motions.find(
    (item) => item.id === selected?.motionId,
  );
  const duration = Math.max(
    500,
    motion ? (motion.duration / motion.fps) * 1000 : 850,
  );
  const playing = name === "idle" || elapsed < duration;
  const reaction = playing
    ? selected
    : mode === "inspect"
      ? { ...selected, motionId: null }
      : events?.idle;
  const clip = character.motions.find((item) => item.id === reaction?.motionId);
  const time = playing ? elapsed : elapsed - duration;
  const clipFrame = clip
    ? name === "idle" || !playing
      ? ((time / 1000) * clip.fps) % Math.max(1, clip.loopEnd || clip.duration)
      : Math.min(clip.duration, (time / 1000) * clip.fps)
    : 0;
  return { reaction, clipFrame };
}
