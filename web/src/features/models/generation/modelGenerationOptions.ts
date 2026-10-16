import type { SelectOption } from "@shared/ui/CustomSelect";
import type { ModelTestGenerationTask } from "@features/models/api";
import { formatFileSize } from "@shared/lib/fileSize";

export type GenerationKind = "image" | "video";
export type Resolution = "480p" | "720p" | "1080p";
export type Ratio = "16:9" | "9:16" | "4:3" | "3:4" | "1:1";
export type ReferenceKind = "image" | "audio" | "video";

export type LocalReference = {
  id: string;
  file: File;
  kind: ReferenceKind;
  previewUrl: string;
};

export type TestModel = {
  value: string;
  label: string;
  description: string;
  providerKind: string;
  capabilities?: string[];
};

export const statusLabel: Record<ModelTestGenerationTask["status"], string> = {
  queued: "等待提交",
  submitting: "正在提交",
  pending: "等待生成",
  processing: "生成中",
  completed: "已完成",
  failed: "失败",
};

export const pendingStatuses: ModelTestGenerationTask["status"][] = [
  "queued",
  "submitting",
  "pending",
  "processing",
];

export const durationOptions: SelectOption[] = Array.from(
  { length: 12 },
  (_, index) => {
    const value = String(index + 4);
    return { value, label: `${value} 秒` };
  },
);

export const resolutions: Resolution[] = ["480p", "720p", "1080p"];
export const ratios: Ratio[] = ["16:9", "9:16", "4:3", "3:4", "1:1"];
export const referenceLimits: Record<ReferenceKind, number> = {
  image: 9,
  audio: 3,
  video: 3,
};
const referenceMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "video/mp4",
  "video/quicktime",
]);
export const maxReferenceBytes = 45 * 1024 * 1024;

export function referenceKind(file: File): ReferenceKind | null {
  if (!referenceMimeTypes.has(file.type)) return null;
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("video/")) return "video";
  return null;
}

export const formatBytes = (bytes: number) =>
  formatFileSize(bytes, { minimumUnit: "KB", fractionalDigits: 0 });

export function modelGenerationKind(model: TestModel): GenerationKind | null {
  if (["senseaudio_image", "volcengine_image"].includes(model.providerKind))
    return "image";
  if (["senseaudio_video", "zealman_video"].includes(model.providerKind))
    return "video";
  return null;
}

export function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatElapsed(task: ModelTestGenerationTask, now: number) {
  const start = new Date(task.created_at).getTime();
  const end = task.completed_at ? new Date(task.completed_at).getTime() : now;
  const totalSeconds = Math.max(0, Math.floor((end - start) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [minutes, seconds].map((part) => String(part).padStart(2, "0"));
  if (hours) parts.unshift(String(hours).padStart(2, "0"));
  return parts.join(":");
}
