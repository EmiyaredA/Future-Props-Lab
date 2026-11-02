import type { ManagedFile } from "./api";

export function originalExtension(file: ManagedFile) {
  const match = /(\.[^./\\]+)$/.exec(file.original_filename);
  return match?.[1] ?? "";
}

export function stripOriginalExtension(name: string, file: ManagedFile) {
  const extension = originalExtension(file);
  const trimmed = name.trim();
  if (!extension || trimmed.length <= extension.length) return trimmed;
  return trimmed
    .toLocaleLowerCase("zh-CN")
    .endsWith(extension.toLocaleLowerCase("zh-CN"))
    ? trimmed.slice(0, -extension.length).trim()
    : trimmed;
}

export function fileDisplayName(file: ManagedFile) {
  return stripOriginalExtension(file.display_name, file) || file.display_name;
}

export function fileDownloadName(file: ManagedFile) {
  const baseName = fileDisplayName(file).replace(/[\\/]/g, "-").trim();
  const fallback = stripOriginalExtension(file.original_filename, file);
  return `${baseName || fallback || "download"}${originalExtension(file)}`;
}
