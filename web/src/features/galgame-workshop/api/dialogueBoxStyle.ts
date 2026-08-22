import type { GalgameStoryDialogueBoxStyle } from "./types";

export type DialogueBoxPreset = Exclude<
  GalgameStoryDialogueBoxStyle["preset"],
  "custom"
>;

export type ResolvedDialogueBoxStyle = GalgameStoryDialogueBoxStyle & {
  layout: NonNullable<GalgameStoryDialogueBoxStyle["layout"]>;
  background: NonNullable<GalgameStoryDialogueBoxStyle["background"]>;
  body: NonNullable<GalgameStoryDialogueBoxStyle["body"]>;
  speakerName: NonNullable<GalgameStoryDialogueBoxStyle["speakerName"]>;
  advanceIndicator: NonNullable<
    GalgameStoryDialogueBoxStyle["advanceIndicator"]
  >;
};

const BASE_DIALOGUE_BOX_STYLE: ResolvedDialogueBoxStyle = {
  preset: "dark",
  assetId: null,
  backgroundColor: "#080E18",
  textColor: "#FFFFFF",
  nameColor: "#FFFFFF",
  backgroundOpacity: 0.82,
  borderRadius: 12,
  fontScale: 1,
  layout: {
    mode: "boxed",
    widthPercent: 100,
    heightPercent: 22,
    bottomOffsetPercent: 0,
    contentInsetXPercent: 0,
    contentInsetTopPercent: 0,
    contentInsetBottomPercent: 0,
  },
  background: {
    mode: "solid",
    gradientTopOpacity: 0.2,
    gradientBottomOpacity: 0.94,
    topRule: "none",
    topRuleColor: "#FFFFFF",
    topRuleOpacity: 0.22,
  },
  body: {
    fontSizePx: null,
    lineHeight: 1.35,
    align: "left",
    maxWidthPercent: 100,
  },
  speakerName: {
    placement: "topLeft",
    fontSizePx: null,
    decoration: "none",
  },
  advanceIndicator: {
    visible: true,
    position: "bottomRight",
    style: "descriptive",
    showInExport: true,
  },
};

export const DIALOGUE_BOX_PRESETS: Record<
  DialogueBoxPreset,
  ResolvedDialogueBoxStyle
> = {
  dark: BASE_DIALOGUE_BOX_STYLE,
  light: {
    ...BASE_DIALOGUE_BOX_STYLE,
    preset: "light",
    backgroundColor: "#F7F3EA",
    textColor: "#172033",
    nameColor: "#B94A48",
    backgroundOpacity: 0.92,
  },
  accent: {
    ...BASE_DIALOGUE_BOX_STYLE,
    preset: "accent",
    backgroundColor: "#2F1720",
    textColor: "#FFF8F6",
    nameColor: "#FF8B84",
    backgroundOpacity: 0.88,
  },
  classicGradient: {
    ...BASE_DIALOGUE_BOX_STYLE,
    preset: "classicGradient",
    backgroundColor: "#05070B",
    textColor: "#F7F7F5",
    nameColor: "#F3F1EB",
    backgroundOpacity: 0.94,
    borderRadius: 0,
    layout: {
      mode: "bottomOverlay",
      widthPercent: 100,
      heightPercent: 30,
      bottomOffsetPercent: 0,
      contentInsetXPercent: 11,
      contentInsetTopPercent: 12,
      contentInsetBottomPercent: 6,
    },
    background: {
      mode: "verticalGradient",
      gradientTopOpacity: 0.18,
      gradientBottomOpacity: 0.94,
      topRule: "double",
      topRuleColor: "#E6E4DD",
      topRuleOpacity: 0.24,
    },
    body: {
      fontSizePx: 30,
      lineHeight: 1.55,
      align: "left",
      maxWidthPercent: 78,
    },
    speakerName: {
      placement: "bottomCenter",
      fontSizePx: 22,
      decoration: "sideLines",
    },
    advanceIndicator: {
      visible: true,
      position: "bottomLeft",
      style: "compact",
      showInExport: true,
    },
  },
};

function deepMergeStyle(
  base: ResolvedDialogueBoxStyle,
  style?: Partial<GalgameStoryDialogueBoxStyle>,
): ResolvedDialogueBoxStyle {
  if (!style) return structuredClone(base);
  return {
    ...base,
    ...style,
    layout: { ...base.layout, ...style.layout },
    background: { ...base.background, ...style.background },
    body: { ...base.body, ...style.body },
    speakerName: { ...base.speakerName, ...style.speakerName },
    advanceIndicator: {
      ...base.advanceIndicator,
      ...style.advanceIndicator,
    },
  };
}

export function dialogueBoxPresetStyle(
  preset: DialogueBoxPreset,
): ResolvedDialogueBoxStyle {
  return structuredClone(DIALOGUE_BOX_PRESETS[preset]);
}

export function resolveDialogueBoxStyle(
  style?: Partial<GalgameStoryDialogueBoxStyle>,
  runtimePreset?: GalgameStoryDialogueBoxStyle["preset"],
): ResolvedDialogueBoxStyle {
  const configuredPreset = style?.preset ?? "dark";
  const selectedPreset = runtimePreset ?? configuredPreset;
  const base =
    selectedPreset === "custom"
      ? DIALOGUE_BOX_PRESETS.dark
      : DIALOGUE_BOX_PRESETS[selectedPreset];
  const usesConfiguredValues =
    runtimePreset == null || selectedPreset === configuredPreset;
  return deepMergeStyle(base, usesConfiguredValues ? style : undefined);
}

export const DEFAULT_DIALOGUE_BOX_STYLE = dialogueBoxPresetStyle("dark");
