import { createUploadTransfer } from "@platform/api/transfer";
import { type TransferOptions } from "@platform/api/transfer";
import { api, unwrap } from "@platform/api/client";
import type {
  GalgameAssetCategory,
  GalgameAssetOverview,
  GalgameProjectAsset,
  GalgameStoryDocument,
} from "./types";

export async function getGalgameProjectAssets(projectId: string, query = "") {
  return (await unwrap(
    await api.GET("/v1/galgame-workshop/projects/{project_id}/assets", {
      params: { path: { project_id: projectId }, query: { query } },
    }),
  )) as { items: GalgameProjectAsset[] };
}

export async function getGalgameAssetOverview(
  projectId: string,
): Promise<GalgameAssetOverview> {
  return (await unwrap(
    await api.GET(
      "/v1/galgame-workshop/projects/{project_id}/assets/overview",
      { params: { path: { project_id: projectId } } },
    ),
  )) as GalgameAssetOverview;
}

export async function uploadGalgameProjectAsset(
  projectId: string,
  file: File,
  category?: GalgameAssetCategory,
  transfer: TransferOptions = {},
): Promise<GalgameProjectAsset> {
  const uploadTransfer = createUploadTransfer(transfer.onProgress);

  return (await unwrap(
    await api.POST("/v1/galgame-workshop/projects/{project_id}/assets", {
      fetch: uploadTransfer.fetch,
      params: { path: { project_id: projectId } },
      body: { upload: file as unknown as string, category: category ?? null },
      bodySerializer(body) {
        const form = new FormData();
        form.set("upload", body.upload as unknown as File);
        if (body.category) form.set("category", body.category);
        return uploadTransfer.capture(form);
      },
    }),
  )) as GalgameProjectAsset;
}

export async function previewGalgameAssetImport(
  projectId: string,
  filenames: string[],
  category: GalgameAssetCategory,
) {
  return unwrap(
    await api.POST(
      "/v1/galgame-workshop/projects/{project_id}/assets/import-preview",
      {
        params: { path: { project_id: projectId } },
        body: { filenames, category },
      },
    ),
  );
}

export async function batchUploadGalgameProjectAssets(
  projectId: string,
  files: File[],
  category: GalgameAssetCategory,
  transfer: TransferOptions = {},
) {
  const uploadTransfer = createUploadTransfer(transfer.onProgress);

  return unwrap(
    await api.POST("/v1/galgame-workshop/projects/{project_id}/assets/batch", {
      fetch: uploadTransfer.fetch,
      params: { path: { project_id: projectId } },
      body: { uploads: files as unknown as string[], category },
      bodySerializer(body) {
        const form = new FormData();
        for (const file of body.uploads as unknown as File[])
          form.append("uploads", file);
        form.set("category", body.category);
        return uploadTransfer.capture(form);
      },
    }),
  );
}

export async function patchGalgameProjectAsset(
  projectId: string,
  asset: GalgameProjectAsset,
  changes: Partial<
    Pick<
      GalgameProjectAsset,
      "display_name" | "category" | "virtualPath" | "packagingPolicy"
    >
  >,
) {
  return unwrap(
    await api.PATCH(
      "/v1/galgame-workshop/projects/{project_id}/assets/{asset_id}",
      {
        params: { path: { project_id: projectId, asset_id: asset.id } },
        body: {
          expectedRevision: asset.revision,
          displayName: changes.display_name,
          category: changes.category,
          virtualPath: changes.virtualPath,
          packagingPolicy: changes.packagingPolicy,
        },
      },
    ),
  );
}

export async function repairGalgameMissingAsset(
  projectId: string,
  expectedStoryRevision: number,
  storyAssetId: string,
  replacementFileId: string,
): Promise<GalgameStoryDocument> {
  return (await unwrap(
    await api.POST("/v1/galgame-workshop/projects/{project_id}/assets/repair", {
      params: { path: { project_id: projectId } },
      body: {
        expectedStoryRevision,
        storyAssetId,
        replacementFileId,
      },
    }),
  )) as GalgameStoryDocument;
}

export async function scanGalgameAssetMetadata(projectId: string) {
  return unwrap(
    await api.POST(
      "/v1/galgame-workshop/projects/{project_id}/assets/metadata-scan",
      { params: { path: { project_id: projectId } } },
    ),
  );
}

export async function getGalgamePackageManifest(projectId: string) {
  return unwrap(
    await api.GET(
      "/v1/galgame-workshop/projects/{project_id}/assets/package-manifest",
      { params: { path: { project_id: projectId } } },
    ),
  );
}

export async function deleteGalgameProjectAsset(
  projectId: string,
  asset: GalgameProjectAsset,
) {
  return unwrap(
    await api.DELETE(
      "/v1/galgame-workshop/projects/{project_id}/assets/{asset_id}",
      {
        params: {
          path: { project_id: projectId, asset_id: asset.id },
          query: { expected_revision: asset.revision },
        },
      },
    ),
  );
}
