export type ImageFormat = "png" | "jpeg" | "webp";

export const FRAME_FORMAT_OPTIONS = [
  { value: "png", label: "PNG", description: "无损画质，文件较大" },
  { value: "jpeg", label: "JPEG", description: "通用格式，体积较小" },
  { value: "webp", label: "WebP", description: "高压缩率，适合网页" },
];

export const MIME_BY_FRAME_FORMAT: Record<ImageFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const EXTENSION_BY_FORMAT: Record<ImageFormat, string> = {
  png: "png",
  jpeg: "jpg",
  webp: "webp",
};

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

export function formatFrameTimestamp(seconds: number): string {
  const totalMilliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;
  return `${pad(hours)}-${pad(minutes)}-${pad(wholeSeconds)}-${pad(milliseconds, 3)}`;
}

export function sanitizeExportBaseName(value: string): string {
  const printable = Array.from(value)
    .filter((character) => (character.codePointAt(0) ?? 0) >= 32)
    .join("");
  const sanitized = printable
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 100);
  return sanitized || "video-frame";
}

export function frameBaseNameFromFile(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^.]+$/, "");
  return `${sanitizeExportBaseName(withoutExtension)}-frame`;
}

export function buildFrameFileName(
  baseName: string,
  format: ImageFormat,
  seconds: number,
  includeTimestamp: boolean,
): string {
  const safeName = sanitizeExportBaseName(baseName);
  const timestamp = includeTimestamp ? `_${formatFrameTimestamp(seconds)}` : "";
  return `${safeName}${timestamp}.${EXTENSION_BY_FORMAT[format]}`;
}

export function isAcceptedVideoFile(file: File): boolean {
  if (file.type.startsWith("video/")) return true;
  return /\.(mp4|m4v|mov|webm|ogv|ogg)$/i.test(file.name);
}
