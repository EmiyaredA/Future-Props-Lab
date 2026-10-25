import type { VideoEditorTimelineTransition } from "./types";

type TransitionKind = VideoEditorTimelineTransition["kind"];
type Direction = VideoEditorTimelineTransition["direction"];

export type TransitionDefinition = {
  kind: TransitionKind;
  label: string;
  category: string;
  direction: Direction;
  description: string;
  media: "visual" | "audio";
  keywords?: string;
  defaultDurationUs?: number;
};

export const transitionDefinitions: TransitionDefinition[] = [
  {
    kind: "crossfade",
    label: "交叉淡化",
    category: "叠化",
    direction: "left",
    description: "在前后画面之间平滑混合",
    media: "visual",
  },
  {
    kind: "fade-black",
    label: "黑场过渡",
    category: "基础",
    direction: "left",
    description: "通过完整黑场连接画面",
    media: "visual",
  },
  {
    kind: "fade-white",
    label: "白场过渡",
    category: "基础",
    direction: "left",
    description: "通过完整白场连接画面",
    media: "visual",
  },
  {
    kind: "wipe",
    label: "擦除",
    category: "擦除",
    direction: "left",
    description: "按指定方向揭示或覆盖画面",
    media: "visual",
  },
  {
    kind: "zoom",
    label: "镜头缩放",
    category: "缩放",
    direction: "left",
    description: "用连续缩放连接画面",
    media: "visual",
  },
  {
    kind: "blur",
    label: "径向模糊",
    category: "模糊",
    direction: "left",
    description: "用清晰度变化连接画面",
    media: "visual",
  },
  {
    kind: "spin-blur",
    label: "旋转模糊",
    category: "模糊",
    direction: "left",
    description: "画面围绕中心旋转，以角向拖影衔接下一画面",
    media: "visual",
  },
  {
    kind: "whip-pan",
    label: "甩镜模糊",
    category: "模糊",
    direction: "left",
    description: "沿指定方向快速甩动，以方向性拖影衔接画面",
    keywords: "whip pan 甩镜 横向 纵向 运动模糊",
    defaultDurationUs: 400_000,
    media: "visual",
  },
  {
    kind: "light-leak",
    label: "漏光扫过",
    category: "光效",
    direction: "left",
    description: "黄绿色柔光与白色亮核扫过画面，在亮处衔接镜头",
    keywords: "light leak 漏光 扫光 黄绿 柔光",
    defaultDurationUs: 500_000,
    media: "visual",
  },
  {
    kind: "flash",
    label: "闪白",
    category: "光效",
    direction: "left",
    description: "在切点产生短促白色脉冲",
    media: "visual",
  },
  {
    kind: "eyelid",
    label: "闭眼睁眼",
    category: "风格",
    direction: "left",
    description: "上下眼睑弧形合拢，切换画面后再睁开",
    media: "visual",
  },
  {
    kind: "audio-crossfade",
    label: "交叉淡化",
    category: "音频",
    direction: "left",
    description: "片段头尾改变增益，重叠区交叉淡化",
    media: "audio",
  },
  {
    kind: "audio-equal-power",
    label: "等功率交叉淡化",
    category: "音频",
    direction: "left",
    description: "用互补曲线维持接缝处的听感响度",
    media: "audio",
  },
  {
    kind: "audio-dip",
    label: "淡出再淡入",
    category: "音频",
    direction: "left",
    description: "前一段淡到静音，再由后一段进入",
    media: "audio",
  },
  {
    kind: "audio-filter-sweep",
    label: "频率扫掠",
    category: "音频",
    direction: "left",
    description: "淡化时收窄前一段，并逐步展开后一段频率",
    media: "audio",
  },
];

export const transitionCategories = [
  "全部",
  "基础",
  "叠化",
  "擦除",
  "缩放",
  "模糊",
  "光效",
  "风格",
  "音频",
];

export const directionalTransition = (kind: TransitionKind) =>
  kind === "wipe" || kind === "whip-pan" || kind === "light-leak";

export const transitionDefaultDuration = (kind: TransitionKind) =>
  transitionDefinitions.find((item) => item.kind === kind)?.defaultDurationUs ??
  500_000;

export function transitionLabel(kind: string) {
  if (kind === "wipe-left" || kind === "wipe-right") return "擦除";
  if (kind === "audio-crossfade") return "音频淡化";
  return (
    transitionDefinitions.find((item) => item.kind === kind)?.label ?? kind
  );
}
