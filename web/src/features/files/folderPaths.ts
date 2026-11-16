import type { ManagedFolder } from "./api";

export function pathToFolder(
  folderId: string | undefined,
  folders: ManagedFolder[],
) {
  const path: ManagedFolder[] = [];
  let current = folders.find((folder) => folder.id === folderId);
  while (current) {
    path.unshift(current);
    current = folders.find((folder) => folder.id === current?.parent_id);
  }
  return path;
}

export function folderOptionLabel(
  folder: ManagedFolder,
  folders: ManagedFolder[],
) {
  return pathToFolder(folder.id, folders)
    .map((item) => item.name)
    .join(" / ");
}

export function isFolderWithin(
  candidate: ManagedFolder,
  folderId: string,
  folders: ManagedFolder[],
) {
  let current: ManagedFolder | undefined = candidate;
  while (current) {
    if (current.id === folderId) return true;
    current = folders.find((folder) => folder.id === current?.parent_id);
  }
  return false;
}
