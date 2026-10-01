import { JOINT_LABELS } from "./assets/joint-schema.ts";
import type { Action } from "./model.ts";
import type { MediaResource } from "./media/model.ts";
export const ASPECTS = ["9:16", "16:9", "21:9", "3:4", "4:3", "1:1"];
export const FRAME_RATES = [24, 30, 50, 59, 60, 90, 120];
export const ACTIONS: Record<Action, string> = {
  idle: "站立 / 待机",
  walk: "走路",
  run: "跑步",
  sit: "坐姿",
  standup: "起身",
  crouch: "蹲下",
  crawl: "爬行",
  jump: "跳跃",
  lie: "躺下",
  fall: "倒地",
  wave: "挥手",
  point: "指向",
  turn: "转身",
};
export const JOINTS = JOINT_LABELS;
export const COLORS = [
  "#a7bdd7",
  "#b8c7b3",
  "#d1bfa0",
  "#c5b3c9",
  "#d0d2d0",
  "#bdaca4",
];
export const uid = () => crypto.randomUUID();
/** Media strings are immutable; clone metadata without copying hundreds of MB per undo point. */
export const clone = <T>(x: T): T => {
  if (
    x &&
    typeof x === "object" &&
    !Array.isArray(x) &&
    Array.isArray((x as { media?: unknown }).media)
  ) {
    const { media, ...rest } = x as T & { media: MediaResource[] };
    return {
      ...structuredClone(rest),
      media: media.map((r) => ({ ...r })),
    } as T;
  }
  return structuredClone(x);
};
export const aspectNumber = (a: string) => {
  const [w, h] = a.split(":").map(Number);
  return w / h;
};
export function outputSize(aspect: string, longEdge: number): [number, number] {
  const [w, h] = aspect.split(":").map(Number);
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const divisor = gcd(w, h),
    a = w / divisor,
    b = h / divisor;
  const scale = Math.max(2, Math.floor(longEdge / Math.max(a, b) / 2) * 2);
  return [a * scale, b * scale];
}
export function getFrameCount(start: number, end: number, fps: number) {
  return Math.max(0, Math.ceil((end - start) * fps - 1e-8));
}
