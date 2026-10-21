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
