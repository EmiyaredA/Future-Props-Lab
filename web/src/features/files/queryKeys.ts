import type { QueryClient } from "@tanstack/react-query";
import type { MediaKind } from "./api";

export type FileListKeyOptions = {
  projectId?: string;
  folderId?: string;
  query?: string;
  mediaKind?: MediaKind;
  sort?: "updated" | "name";
  includeReferences?: boolean;
};

const scope = (projectId?: string) => projectId ?? "library";

export const fileQueryKeys = {
  storageLayout: ["file-storage-layout"] as const,
  allFiles: ["managed-files"] as const,
  allFolders: ["managed-folders"] as const,
  files: (projectId?: string) => ["managed-files", scope(projectId)] as const,
  folders: (projectId?: string) =>
    ["managed-folders", scope(projectId)] as const,
  list: ({
    projectId,
    folderId,
    query = "",
    mediaKind,
    sort = "updated",
    includeReferences = false,
  }: FileListKeyOptions) =>
    [
      "managed-files",
      scope(projectId),
      folderId ?? "root",
      {
        query,
        mediaKind: mediaKind ?? "all",
        sort,
        includeReferences,
      },
    ] as const,
};

export async function invalidateFileScope(
  client: QueryClient,
  projectId?: string,
  options: { folders?: boolean } = {},
) {
  const invalidations: Promise<unknown>[] = [
    client.invalidateQueries({ queryKey: fileQueryKeys.files(projectId) }),
  ];
  if (options.folders) {
    invalidations.push(
      client.invalidateQueries({ queryKey: fileQueryKeys.folders(projectId) }),
    );
  }
  await Promise.all(invalidations);
}
