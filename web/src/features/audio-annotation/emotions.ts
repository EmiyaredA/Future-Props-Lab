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

export function normalizeImportedEmotion(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !value.trim() || value.trim().length > 40)
    throw new Error("情绪必须是 1 到 40 个字符");
  return value.trim();
}
