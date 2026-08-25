export const EMOTION_PRESETS = [
  { value: "平静", tone: "calm" },
  { value: "开心", tone: "happy" },
  { value: "悲伤", tone: "sad" },
  { value: "愤怒", tone: "angry" },
  { value: "惊讶", tone: "surprised" },
  { value: "恐惧", tone: "fearful" },
] as const;

export function normalizeImportedEmotion(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !value.trim() || value.trim().length > 40)
    throw new Error("情绪必须是 1 到 40 个字符");
  return value.trim();
}
