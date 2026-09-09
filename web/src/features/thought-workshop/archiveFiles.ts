import { Unzip } from "fflate";
import type { JSONContent } from "@tiptap/core";

export const attachmentMimes: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  zip: "application/zip",
};
export function attachments(doc: JSONContent): JSONContent[] {
  return [
    ...(doc.type === "attachment" ? [doc] : []),
    ...(doc.content || []).flatMap(attachments),
  ];
}
/** Scan compressed entries without starting decompression or retaining asset bytes. */
export async function isBackup(file: File): Promise<boolean> {
  let found = false;
  const parser = new Unzip((entry) => {
    if (entry.name === "manifest.json") found = true;
  });
  const chunkSize = 256 * 1024;
  for (let offset = 0; offset < file.size; offset += chunkSize) {
    parser.push(
      new Uint8Array(
        await file.slice(offset, offset + chunkSize).arrayBuffer(),
      ),
      offset + chunkSize >= file.size,
    );
    if (found) return true;
  }
  return false;
}

export function attachmentArchivePath(id: string, filename: string) {
  const cleaned = filename
    .replace(/[\\/:*?"<>|]/g, "_")
    .split("")
    .map((c) => (c.charCodeAt(0) < 32 ? "_" : c))
    .join("");
  const dot = cleaned.lastIndexOf(".");
  const name =
    dot > 0
      ? `${cleaned.slice(0, dot).slice(0, 90)}${cleaned.slice(dot)}`
      : cleaned.slice(0, 100);
  return `attachments/${id}/${name || "附件"}`;
}
export const encodedFilePath = (path: string) =>
  path
    .split("/")
    .map((part) =>
      encodeURIComponent(part).replace(/\(/g, "%28").replace(/\)/g, "%29"),
    )
    .join("/");
