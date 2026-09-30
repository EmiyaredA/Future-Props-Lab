export const MAX_VIDEO_REFERENCE_BYTES = 350 * 1024;

export type VideoReferenceImage = {
  mime_type: "image/jpeg";
  data_base64: string;
  byte_size: number;
  positions_ms: number[];
};

function readBlobAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("视频帧图读取失败"));
    reader.onload = () => {
      const result = String(reader.result || "");
      const separator = result.indexOf(",");
      if (separator < 0) reject(new Error("视频帧图编码失败"));
      else resolve(result.slice(separator + 1));
    };
    reader.readAsDataURL(blob);
  });
}

export async function encodeVideoContactSheet(
  source: Blob,
  positionsMs: number[],
): Promise<VideoReferenceImage> {
  if (![4, 9].includes(positionsMs.length))
    throw new Error("视频帧联系表需要 4 或 9 个时间点");
  if (positionsMs.some((value) => !Number.isSafeInteger(value) || value < 0))
    throw new Error("视频帧时间点无效");

  const bitmap = await createImageBitmap(source);
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法处理视频帧图像");
    for (const maxDimension of [1800, 1400, 1100, 900, 720]) {
      const ratio = Math.min(
        1,
        maxDimension / Math.max(bitmap.width, bitmap.height),
      );
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
      canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.82, 0.72, 0.62, 0.52]) {
        const encoded = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", quality),
        );
        if (encoded && encoded.size <= MAX_VIDEO_REFERENCE_BYTES) {
          return {
            mime_type: "image/jpeg",
            data_base64: await readBlobAsBase64(encoded),
            byte_size: encoded.size,
            positions_ms: positionsMs,
          };
        }
      }
    }
    throw new Error("视频帧联系表无法压缩到模型输入限制");
  } finally {
    bitmap.close();
  }
}
