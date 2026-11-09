import { fetchApiJson } from "@platform/api/client";
import type { Reference, WorkFile } from "./protocol";

const clipboardExtensions: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
  "image/svg+xml": "svg",
  "image/avif": "avif",
};

export function clipboardAttachments(clipboard: DataTransfer): File[] {
  const files = Array.from(clipboard.files);
  const entries = files.length
    ? files
    : Array.from(clipboard.items).flatMap((item) => {
        const file = item.kind === "file" ? item.getAsFile() : null;
        return file ? [file] : [];
      });
  return entries.map((file) => {
    const extension = clipboardExtensions[file.type];
    if (extension && (!file.name || /^image\.[a-z0-9]+$/i.test(file.name))) {
      return new File([file], `剪贴图像-${crypto.randomUUID()}.${extension}`, {
        type: file.type,
      });
    }
    return file;
  });
}

export async function importConversationFile(
  conversationId: string,
  file: File,
): Promise<Reference> {
  const form = new FormData();
  form.append("upload", file, file.name);
  const result = await fetchApiJson<WorkFile>(
    `/v1/amadeus/conversations/${conversationId}/imports`,
    { method: "POST", body: form },
  );
  return {
    id: `file:${result.name}`,
    application: "会话文件",
    name: result.name,
    value: `${Math.ceil(result.bytes / 1024)} KiB`,
    source: "imports",
  };
}
