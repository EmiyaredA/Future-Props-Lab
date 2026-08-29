import type { CSSProperties } from "react";
import type {
  GalgameStoryDialogueBoxStyle,
  GalgameStoryUiComponent,
} from "@features/galgame-workshop/api";

export const DIALOGUE_STYLE_PRESETS: Array<{
  id: Exclude<GalgameStoryDialogueBoxStyle["preset"], "custom">;
  label: string;
}> = [
  { id: "dark", label: "暗夜" },
  { id: "light", label: "雾白" },
  { id: "accent", label: "珊瑚" },
  { id: "classicGradient", label: "经典渐隐" },
];

export const DIALOGUE_VISIBILITY_OPTIONS: Array<{
  value: GalgameStoryUiComponent["visibility"];
  label: string;
}> = [
  { value: "always", label: "始终显示" },
  { value: "content", label: "剧情播放时" },
  { value: "dialogue", label: "对白与旁白时" },
  { value: "choices", label: "分支选择时" },
];

export const dialogueRangeProgress = (
  value: number,
  min: number,
  max: number,
) =>
  ({
    "--range-progress": `${((value - min) / (max - min)) * 100}%`,
  }) as CSSProperties;
export type DialogueAssetTarget =
  { kind: "dialogueBox" } | { kind: "uiComponent"; componentId: string };
