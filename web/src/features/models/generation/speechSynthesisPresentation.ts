const statuses: Record<string, string> = {
  queued: "等待生成",
  submitting: "正在提交",
  pending: "等待处理",
  processing: "正在生成",
  running: "正在生成",
  completed: "已完成",
  failed: "生成失败",
};
const languages: Record<string, string> = {
  Chinese: "中文",
  English: "英语",
  Japanese: "日语",
  Korean: "韩语",
  German: "德语",
  French: "法语",
  Russian: "俄语",
  Portuguese: "葡萄牙语",
  Spanish: "西班牙语",
  Italian: "意大利语",
};
export const speechCloningLabels: Record<string, string> = {
  embedding: "提取说话人音色",
  reference: "原始参考音频",
  neutral: "不施加情绪",
  happy: "高兴",
  angry: "生气",
  sad: "悲伤",
  serene: "平静",
  scared: "害怕",
  confused: "困惑",
};
export function speechCloningSummary(payload: Record<string, unknown>) {
  if (typeof payload.clone_mode !== "string") return "";
  const emotion = String(payload.emotion ?? "neutral");
  return [
    speechCloningLabels[payload.clone_mode] ?? payload.clone_mode,
    speechCloningLabels[emotion] ?? emotion,
    ...(emotion !== "neutral" && typeof payload.emotion_strength === "number"
      ? [`强度 ${Math.round(payload.emotion_strength * 100)}%`]
      : []),
    `种子 ${String(payload.seed ?? 42)}`,
  ].join(" · ");
}
export function speechTaskStatus(status: string) {
  return statuses[status] ?? "状态待确认";
}
export function speechLanguageLabel(language: string) {
  return languages[language] ?? language;
}
export function speechAudioTime(seconds: number) {
  const value =
    Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
