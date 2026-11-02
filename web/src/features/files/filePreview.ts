import type { ManagedFile } from "./api";

export function filePreviewKind(file: ManagedFile) {
  if (["image", "video", "audio"].includes(file.media_kind))
    return file.media_kind;
  if (file.mime_type === "application/pdf") return "pdf";
  if (/\.(txt|md|json|csv)$/i.test(file.original_filename ?? "")) return "text";
  return "unsupported";
}

export function previewTime(seconds: number) {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
