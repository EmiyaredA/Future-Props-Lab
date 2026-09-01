import type { ApiDownload } from "@platform/api/client";

export function downloadProjectSnapshot(
  download: ApiDownload,
  fallbackFilename = "project-snapshot.zip",
) {
  const url = URL.createObjectURL(download.blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = download.filename || fallbackFilename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
