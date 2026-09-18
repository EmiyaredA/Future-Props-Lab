export const EMOTION_PRESETS = [
  { value: "平静", tone: "calm" },
  { value: "开心", tone: "happy" },
  { value: "笑容", tone: "happy" },
  { value: "微笑", tone: "happy" },
  { value: "温柔", tone: "calm" },
  { value: "得意", tone: "happy" },
  { value: "从容得意", tone: "happy" },
  { value: "冷静自信", tone: "calm" },
  { value: "俏皮眨眼", tone: "happy" },
  { value: "闭眼笑", tone: "happy" },
  { value: "开朗笑容", tone: "happy" },
  { value: "爽朗", tone: "happy" },
  { value: "释然", tone: "calm" },
  { value: "害羞", tone: "happy" },
  { value: "悲伤", tone: "sad" },
  { value: "难过", tone: "sad" },
  { value: "含泪悲伤", tone: "sad" },
  { value: "担忧", tone: "fearful" },
  { value: "疲惫", tone: "sad" },
  { value: "无奈", tone: "sad" },
  { value: "愤怒", tone: "angry" },
  { value: "生气", tone: "angry" },
  { value: "不悦", tone: "angry" },
  { value: "严肃不悦", tone: "angry" },
  { value: "严厉", tone: "angry" },
  { value: "惊讶", tone: "surprised" },
  { value: "疑惑", tone: "surprised" },
  { value: "认真", tone: "calm" },
  { value: "严肃", tone: "calm" },
  { value: "闭眼沉思", tone: "calm" },
  { value: "冷淡", tone: "calm" },
  { value: "恐惧", tone: "fearful" },
] as const;

export const EMOTION_COLORS = [
  "#28B8A7",
  "#4C8FE8",
  "#9B62D0",
  "#E7A72F",
  "#ED7A52",
  "#D85E9D",
  "#7586E5",
  "#46B978",
] as const;

export const MAX_CUSTOM_EMOTIONS = 64;
export const MAX_EMOTION_LENGTH = 40;

export type CustomEmotionEntry = {
  name: string;
  color: string;
};

export type EmotionDuplicateOf = "preset" | "custom" | null;

export function normalizeEmotionLabel(value: string): string | null {
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > MAX_EMOTION_LENGTH) return null;
  return cleaned;
}

export function emotionKey(value: string): string {
  return value.trim().toLocaleLowerCase("zh-CN");
}

export function isPresetEmotion(value: string): boolean {
  const key = emotionKey(value);
  return EMOTION_PRESETS.some((preset) => emotionKey(preset.value) === key);
}

export function normalizeCustomEmotions(value: unknown): CustomEmotionEntry[] {
  if (!Array.isArray(value)) return [];
  const cleaned: CustomEmotionEntry[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item === "string") {
      const name = normalizeEmotionLabel(item);
      if (!name) continue;
      cleaned.push({
        name,
        color: EMOTION_COLORS[index % EMOTION_COLORS.length]!,
      });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const record = item as { name?: unknown; color?: unknown };
    const name =
      typeof record.name === "string"
        ? normalizeEmotionLabel(record.name)
        : null;
    if (!name) continue;
    const color =
      typeof record.color === "string" && /^#[0-9A-Fa-f]{6}$/.test(record.color)
        ? record.color.toUpperCase()
        : EMOTION_COLORS[index % EMOTION_COLORS.length]!;
    cleaned.push({ name, color });
  }
  return cleaned;
}

export function mergeCustomEmotion(
  customEmotions: CustomEmotionEntry[],
  candidate: string,
  color?: string,
): {
  emotions: CustomEmotionEntry[];
  added: boolean;
  duplicateOf: EmotionDuplicateOf;
  label: string | null;
} {
  const label = normalizeEmotionLabel(candidate);
  if (!label) {
    return {
      emotions: customEmotions,
      added: false,
      duplicateOf: null,
      label: null,
    };
  }
  const key = emotionKey(label);
  if (EMOTION_PRESETS.some((preset) => emotionKey(preset.value) === key)) {
    return {
      emotions: customEmotions,
      added: false,
      duplicateOf: "preset",
      label,
    };
  }
  if (customEmotions.some((item) => emotionKey(item.name) === key)) {
    return {
      emotions: customEmotions,
      added: false,
      duplicateOf: "custom",
      label,
    };
  }
  if (customEmotions.length >= MAX_CUSTOM_EMOTIONS) {
    return {
      emotions: customEmotions,
      added: false,
      duplicateOf: null,
      label,
    };
  }
  return {
    emotions: [
      ...customEmotions,
      {
        name: label,
        color:
          color && /^#[0-9A-Fa-f]{6}$/.test(color)
            ? color.toUpperCase()
            : EMOTION_COLORS[customEmotions.length % EMOTION_COLORS.length]!,
      },
    ],
    added: true,
    duplicateOf: null,
    label,
  };
}

export function emotionDuplicateWarning(
  duplicateOf: EmotionDuplicateOf,
  label: string,
): string {
  if (duplicateOf === "preset") return `「${label}」已在预设中`;
  if (duplicateOf === "custom") return `「${label}」已在词库中`;
  return "";
}

export function normalizeImportedEmotion(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !value.trim() || value.trim().length > 40)
    throw new Error("情绪必须是 1 到 40 个字符");
  return value.trim();
}
