const STAGE_VIEWPORT_PREFERENCES_KEY = "future_props_galgame_stage_viewport";

export type StageAspectMode = "auto" | "16:9" | "16:10" | "4:3" | "custom";

export type StageViewportPreferences = {
  aspectMode: StageAspectMode;
  customWidth: number;
  customHeight: number;
  collapsed: boolean;
};

export const DEFAULT_STAGE_VIEWPORT_PREFERENCES: StageViewportPreferences = {
  aspectMode: "auto",
  customWidth: 16,
  customHeight: 9,
  collapsed: false,
};

const ASPECT_MODES = new Set<StageAspectMode>([
  "auto",
  "16:9",
  "16:10",
  "4:3",
  "custom",
]);

function sanitizePositiveInt(value: unknown, fallback: number) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(9999, Math.round(number));
}

export function loadStageViewportPreferences(): StageViewportPreferences {
  try {
    const value = JSON.parse(
      localStorage.getItem(STAGE_VIEWPORT_PREFERENCES_KEY) ?? "null",
    ) as Partial<StageViewportPreferences> | null;
    const aspectMode = ASPECT_MODES.has(value?.aspectMode as StageAspectMode)
      ? (value?.aspectMode as StageAspectMode)
      : DEFAULT_STAGE_VIEWPORT_PREFERENCES.aspectMode;
    return {
      aspectMode,
      customWidth: sanitizePositiveInt(
        value?.customWidth,
        DEFAULT_STAGE_VIEWPORT_PREFERENCES.customWidth,
      ),
      customHeight: sanitizePositiveInt(
        value?.customHeight,
        DEFAULT_STAGE_VIEWPORT_PREFERENCES.customHeight,
      ),
      collapsed: value?.collapsed === true,
    };
  } catch {
    return { ...DEFAULT_STAGE_VIEWPORT_PREFERENCES };
  }
}

export function storeStageViewportPreferences(value: StageViewportPreferences) {
  localStorage.setItem(STAGE_VIEWPORT_PREFERENCES_KEY, JSON.stringify(value));
}

export function resolveStageAspectParts(
  preferences: StageViewportPreferences,
): { width: number; height: number } | null {
  if (preferences.aspectMode === "auto") return null;
  if (preferences.aspectMode === "custom") {
    return {
      width: preferences.customWidth,
      height: preferences.customHeight,
    };
  }
  const [widthText, heightText] = preferences.aspectMode.split(":");
  return {
    width: Number(widthText),
    height: Number(heightText),
  };
}

export function stageAspectModeLabel(mode: StageAspectMode) {
  switch (mode) {
    case "auto":
      return "自动";
    case "custom":
      return "自定义";
    default:
      return mode;
  }
}
