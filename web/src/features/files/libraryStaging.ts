import type { ManagedFile } from "./api";
import { fileDisplayName } from "./AssetBrowserParts";

export type LibrarySourceProject = {
  id: string;
  title: string;
};

export type LibraryStagingLocal = {
  key: string;
  kind: "local";
  file: File;
  displayName: string;
};

export type LibraryStagingProject = {
  key: string;
  kind: "project";
  asset: ManagedFile;
  sourceProjectId: string;
  displayName: string;
};

export type LibraryStagingItem = LibraryStagingLocal | LibraryStagingProject;

export type LibrarySourcePickerMode = "project" | "cross";

function localBaseName(filename: string) {
  const index = filename.lastIndexOf(".");
  return index > 0 ? filename.slice(0, index) : filename;
}

export function stageLocalFiles(files: File[]): LibraryStagingLocal[] {
  return files.map((file, index) => ({
    key: `local-${file.name}-${file.size}-${file.lastModified}-${index}`,
    kind: "local" as const,
    file,
    displayName: localBaseName(file.name),
  }));
}

export function stageProjectFiles(
  files: ManagedFile[],
  sourceProjectId: string,
): LibraryStagingProject[] {
  return files.map((asset) => ({
    key: `project-${sourceProjectId}-${asset.id}`,
    kind: "project" as const,
    asset,
    sourceProjectId,
    displayName: fileDisplayName(asset),
  }));
}
