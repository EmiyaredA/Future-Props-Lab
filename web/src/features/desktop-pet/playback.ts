import type { PetDocument, PetReaction } from "./api";
import type { CharacterDocument } from "@shared/live2d/types";

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
export function expressionSupported(document: PetDocument, id: string) {
  return (
    document.whaleModel?.rigProfile !== "human-chibi" ||
    !["wink", "sad"].includes(id)
  );
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
