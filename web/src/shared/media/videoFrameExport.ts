export type ImageFormat = "png" | "jpeg" | "webp";

export type FrameSnapshot = {
  blob: Blob;
  capturedAt: number;
  width: number;
  height: number;
};

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

export function formatFramePlaybackTime(seconds: number): string {
  const timestamp = formatFrameTimestamp(seconds).replaceAll("-", ":");
  return `${timestamp.slice(0, 8)}.${timestamp.slice(9)}`;
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

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("当前浏览器无法生成所选图片格式。"));
          return;
        }
        if (blob.type && blob.type !== mimeType) {
          reject(new Error("当前浏览器不支持所选图片格式，请尝试其他格式。"));
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality,
    );
  });
}

export async function captureVideoFrame(
  video: HTMLVideoElement,
  capturedAt = video.currentTime,
  signal?: AbortSignal,
): Promise<FrameSnapshot> {
  video.pause();
  signal?.throwIfAborted();
  if (
    Math.abs(video.currentTime - capturedAt) > 0.0005 ||
    video.seeking ||
    video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
  ) {
    await seekVideo(video, capturedAt, signal);
  }
  if (
    video.seeking ||
    video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
    !video.videoWidth ||
    !video.videoHeight
  ) {
    throw new Error("当前视频帧尚未准备好，请稍后重试。");
  }
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("浏览器无法创建图片画布。");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  signal?.throwIfAborted();
  return {
    blob: await canvasToBlob(canvas, "image/png", 1),
    capturedAt,
    width: canvas.width,
    height: canvas.height,
  };
}

function seekVideo(
  video: HTMLVideoElement,
  capturedAt: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener("seeked", handleSeeked);
      video.removeEventListener("error", handleError);
      signal?.removeEventListener("abort", handleAbort);
    };
    const handleSeeked = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("无法定位到所选视频时间点。"));
    };
    const handleAbort = () => {
      cleanup();
      reject(signal?.reason ?? new DOMException("操作已取消。", "AbortError"));
    };
    video.addEventListener("seeked", handleSeeked);
    video.addEventListener("error", handleError);
    signal?.addEventListener("abort", handleAbort, { once: true });
    try {
      video.currentTime = capturedAt;
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

async function imageSourceFromBlob(blob: Blob): Promise<{
  source: CanvasImageSource;
  release: () => void;
}> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    return { source: bitmap, release: () => bitmap.close() };
  }
  const url = URL.createObjectURL(blob);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("导出帧预览无法读取。"));
      image.src = url;
    });
    return { source: image, release: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export async function encodeFrameSnapshot(
  snapshot: FrameSnapshot,
  format: ImageFormat,
  quality: number,
): Promise<Blob> {
  const mimeType = MIME_BY_FRAME_FORMAT[format];
  if (format === "png" && snapshot.blob.type === mimeType) return snapshot.blob;
  const { source, release } = await imageSourceFromBlob(snapshot.blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = snapshot.width;
    canvas.height = snapshot.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法创建图片画布。");
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return await canvasToBlob(canvas, mimeType, quality / 100);
  } finally {
    release();
  }
}

export function downloadFrameBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
