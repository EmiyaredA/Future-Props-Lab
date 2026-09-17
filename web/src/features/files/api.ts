import type { components } from "@generated/api";
import { api, fetchApiDownload, fetchApiJson, unwrap } from "@platform/api/client";

export type ManagedFile = components["schemas"]["VisualAssetOut"];
export type ManagedFolder = components["schemas"]["VisualAssetFolderOut"];
export type MediaKind = ManagedFile["media_kind"];
export type StorageLayoutStatus =
  components["schemas"]["StorageLayoutStatusOut"];
export type StorageLayoutMigration =
  components["schemas"]["StorageLayoutMigrationOut"];

export async function getFolders(projectId?: string) {
  return unwrap(
    await api.GET("/v1/file-folders", {
      params: { query: { project_id: projectId } },
    }),
  );
}

export async function createFolder(
  name: string,
  projectId?: string,
  parentId?: string,
) {
  return unwrap(
    await api.POST("/v1/file-folders", {
      body: {
        name,
        scope: projectId ? "project" : "library",
        project_id: projectId,
        parent_id: parentId,
      },
    }),
  );
}

export async function patchFolder(
  folder: ManagedFolder,
  changes: { name?: string; parent_id?: string; move_to_root?: boolean },
) {
  return unwrap(
    await api.PATCH("/v1/file-folders/{folder_id}", {
      params: { path: { folder_id: folder.id } },
      body: {
        ...changes,
        move_to_root: changes.move_to_root ?? false,
        expected_revision: folder.revision,
      },
    }),
  );
}

export async function deleteFolder(folder: ManagedFolder) {
  return unwrap(
    await api.DELETE("/v1/file-folders/{folder_id}", {
      params: {
        path: { folder_id: folder.id },
        query: { expected_revision: folder.revision },
      },
    }),
  );
}

export async function getFiles(options: {
  projectId?: string;
  folderId?: string;
  query?: string;
  mediaKind?: MediaKind;
  sort?: "updated" | "name";
  includeReferences?: boolean;
}) {
  return unwrap(
    await api.GET("/v1/files", {
      params: {
        query: {
          project_id: options.projectId,
          folder_id: options.folderId,
          query: options.query,
          media_kind: options.mediaKind,
          sort: options.sort,
          include_references: options.includeReferences,
          include_svg: true,
        },
      },
    }),
  );
}

export async function uploadManagedFile(
  file: File,
  projectId?: string,
  folderId?: string,
) {
  return unwrap(
    await api.POST("/v1/files", {
      body: {
        upload: file as unknown as string,
        project_id: projectId,
        folder_id: folderId,
      },
      bodySerializer(body) {
        const form = new FormData();
        form.set("upload", file);
        if (body.project_id) form.set("project_id", body.project_id);
        if (body.folder_id) form.set("folder_id", body.folder_id);
        return form;
      },
    }),
  );
}

export async function patchManagedFile(
  file: ManagedFile,
  changes: {
    display_name?: string;
    folder_id?: string;
    move_to_root?: boolean;
  },
) {
  if (file.is_reference && file.project_id && file.reference_id) {
    return unwrap(
      await api.PATCH(
        "/v1/visual-workshop/projects/{project_id}/asset-references/{reference_id}",
        {
          params: {
            path: {
              project_id: file.project_id,
              reference_id: file.reference_id,
            },
          },
          body: {
            ...changes,
            move_to_root: changes.move_to_root ?? false,
            expected_revision: file.revision,
          },
        },
      ),
    );
  }
  return unwrap(
    await api.PATCH("/v1/files/{asset_id}", {
      params: { path: { asset_id: file.id } },
      body: {
        ...changes,
        move_to_root: changes.move_to_root ?? false,
        expected_revision: file.revision,
      },
    }),
  );
}

export async function deleteManagedFile(file: ManagedFile) {
  if (file.is_reference && file.project_id && file.reference_id) {
    return unwrap(
      await api.DELETE(
        "/v1/visual-workshop/projects/{project_id}/asset-references/{reference_id}",
        {
          params: {
            path: {
              project_id: file.project_id,
              reference_id: file.reference_id,
            },
            query: { expected_revision: file.revision },
          },
        },
      ),
    );
  }
  return unwrap(
    await api.DELETE("/v1/files/{asset_id}", {
      params: {
        path: { asset_id: file.id },
        query: { expected_revision: file.revision },
      },
    }),
  );
}

export async function importFile(projectId: string, assetId: string) {
  return unwrap(
    await api.POST(
      "/v1/visual-workshop/projects/{project_id}/asset-references",
      {
        params: { path: { project_id: projectId } },
        body: { asset_id: assetId },
      },
    ),
  );
}

export async function importManagedFiles(
  projectId: string,
  options:
    | { sourceScope: "library"; assetIds: string[] }
    | { sourceScope: "project"; sourceProjectId: string; assetIds: string[] },
) {
  return unwrap(
    await api.POST("/v1/visual-workshop/projects/{project_id}/asset-imports", {
      params: { path: { project_id: projectId } },
      body: {
        source_scope: options.sourceScope,
        source_project_id:
          options.sourceScope === "project"
            ? options.sourceProjectId
            : undefined,
        asset_ids: options.assetIds,
      },
    }),
  );
}

export async function getStorageLayoutStatus() {
  return unwrap(await api.GET("/v1/file-storage/layout"));
}

export async function migrateStorageLayout(limit = 50) {
  return unwrap(
    await api.POST("/v1/file-storage/layout/migrate", {
      params: { query: { limit } },
    }),
  );
}

export async function openLibraryFolder() {
  return unwrap(await api.POST("/v1/file-storage/open-folder"));
}

export type LibraryFolderImportResult = {
  created_folders: number;
  created_files: number;
  skipped: Array<{ path: string; code: string; message: string }>;
};

export async function exportLibraryFolderArchive(folderId?: string) {
  const query = folderId
    ? `?folder_id=${encodeURIComponent(folderId)}`
    : "";
  return fetchApiDownload(`/v1/file-library/folder-exports${query}`);
}

export async function importLibraryFolderArchive(
  archive: File,
  parentFolderId?: string,
) {
  const form = new FormData();
  form.set("archive", archive);
  if (parentFolderId) form.set("parent_folder_id", parentFolderId);
  return fetchApiJson<LibraryFolderImportResult>(
    "/v1/file-library/folder-archive-imports",
    { method: "POST", body: form },
  );
}

export async function importLibraryFolderEntries(
  entries: Array<{ file: File; relativePath: string }>,
  parentFolderId?: string,
) {
  const form = new FormData();
  for (const entry of entries) {
    form.append("files", entry.file);
    form.append("relative_paths", entry.relativePath);
  }
  if (parentFolderId) form.set("parent_folder_id", parentFolderId);
  return fetchApiJson<LibraryFolderImportResult>(
    "/v1/file-library/folder-entry-imports",
    { method: "POST", body: form },
  );
}
