import {
  canvasToBlob,
  sanitizeExportBaseName,
} from "@shared/media/videoFrameExport";
import { pixelCrop, type CropRect, type ImageSize } from "./imageCropGeometry";

export async function exportImageCrop(
  source: CanvasImageSource,
  size: ImageSize,
  rect: CropRect,
  title: string,
): Promise<File> {
  const crop = pixelCrop(rect, size);
  const canvas = document.createElement("canvas");
  canvas.width = crop.width;
  canvas.height = crop.height;
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法创建裁剪图片。");
    context.drawImage(
      source,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      crop.width,
      crop.height,
    );
    const blob = await canvasToBlob(canvas, "image/png", 1);
    const name = sanitizeExportBaseName(
      title.replace(/\.(png|jpe?g|webp|gif|avif|svg)$/i, ""),
    );
    return new File([blob], `${name}-裁剪.png`, { type: "image/png" });
  } finally {
    canvas.width = canvas.height = 0;
  }
}
