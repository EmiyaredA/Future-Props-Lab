import type { AnimatedNumber } from "../animation/channels.ts";
export const CAMERA_CHANNELS = {
  focal: { label: "焦距 / mm", min: 8, max: 300, default: 28 },
  roll: { label: "画面倾斜 / 度", min: -1080, max: 1080, default: 0 },
  pan: { label: "水平摇镜 / 度", min: -1080, max: 1080, default: 0 },
  tilt: { label: "俯仰摇镜 / 度", min: -1080, max: 1080, default: 0 },
  offsetX: { label: "机身左右偏移 / m", min: -1000, max: 1000, default: 0 },
  offsetY: { label: "机身升降偏移 / m", min: -1000, max: 1000, default: 0 },
  offsetZ: { label: "机身前后偏移 / m", min: -1000, max: 1000, default: 0 },
  frameX: { label: "主体横向位置", min: -0.9, max: 0.9, default: 0 },
  frameY: { label: "主体纵向位置", min: -0.9, max: 0.9, default: 0 },
  focusDistance: { label: "对焦距离 / m", min: 0.05, max: 2000, default: 5 },
  blur: { label: "景深虚化强度", min: 0, max: 1, default: 0 },
  bloom: { label: "高光泛光", min: 0, max: 2, default: 0 },
  distortion: { label: "畸变强度", min: 0, max: 1, default: 0 },
} as const;
export type CameraChannel = keyof typeof CAMERA_CHANNELS;
export const SHAKE_PRESETS = {
  breath: "呼吸浮动",
  walk: "行走手持",
  run: "奔跑追逐",
  impact: "短促冲击",
  pov: "第一视角奔跑",
} as const;
export interface CameraEffects {
  channels?: Partial<Record<CameraChannel, AnimatedNumber>>;
  distortionType?: "barrel" | "pincushion" | "fisheye";
  focusTargetId?: string;
  followLag?: number;
  shake?: {
    preset: keyof typeof SHAKE_PRESETS;
    amount: number;
    frequency: number;
    seed: number;
    start: number;
    end: number;
  } | null;
  dollyZoom?: { distance: number; focal: number } | null;
}
