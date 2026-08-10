import type { components } from "@generated/api";
import { api, unwrap } from "@platform/api/client";

export type GalgameWorkshopProject =
  components["schemas"]["GalgameWorkshopProjectOut"];
export type GalgameWorkshopProjectStatus = GalgameWorkshopProject["status"];
type GeneratedGalgameStoryDocument =
  components["schemas"]["GalgameStoryDocumentOut"];
type GeneratedGalgameStoryProject =
  components["schemas"]["GalgameStoryProject"];
type GeneratedGalgameStoryFragment =
  components["schemas"]["GalgameStoryFragment"];
type GeneratedGalgameStoryBlock = NonNullable<
  GeneratedGalgameStoryFragment["blocks"]
>[number];
type CompatibleGalgameStoryBlock<T> = T extends { type: "dialogue" }
  ? Omit<T, "hideDialogueAfter" | "portrait"> & {
      hideDialogueAfter?: boolean;
      portrait?: T extends { portrait?: infer P }
        ? P extends object
          ? Omit<P, "visible"> & { visible?: boolean }
          : P
        : never;
    }
  : T extends { type: "scene" }
    ? T & { backgroundId?: string | null }
    : T extends { type: "narration" }
      ? Omit<T, "hideDialogueAfter"> & { hideDialogueAfter?: boolean }
      : T;
export type GalgameStorySettings =
  components["schemas"]["GalgameStorySettings"];
export type GalgameStoryCharacterStageSettings =
  components["schemas"]["GalgameStoryCharacterStageSettings"];
export type GalgameStoryCharacter = Omit<
  components["schemas"]["GalgameStoryCharacter"],
  "themeColor"
> & { themeColor?: string };
export type GalgameStoryBlock =
  CompatibleGalgameStoryBlock<GeneratedGalgameStoryBlock>;
export type GalgameStoryFragment = Omit<
  GeneratedGalgameStoryFragment,
  "blocks"
> & { blocks?: GalgameStoryBlock[] };
export type GalgameStoryChapter = Omit<
  components["schemas"]["GalgameStoryChapter"],
  "fragments"
> & { fragments?: GalgameStoryFragment[] };
export type GalgameStoryProject = Omit<
  GeneratedGalgameStoryProject,
  "characters" | "chapters" | "scenes" | "assets" | "schemaVersion"
> & {
  characters?: GalgameStoryCharacter[];
  chapters?: GalgameStoryChapter[];
  scenes?: GalgameStoryScene[];
  assets?: GalgameStoryAsset[];
  schemaVersion: "1.0" | "1.1" | "1.2";
};
export type GalgameStoryDocument = Omit<
  GeneratedGalgameStoryDocument,
  "document"
> & { document: GalgameStoryProject };
export type GalgameStoryCharacterExpression =
  components["schemas"]["GalgameStoryCharacterExpression"];
export type GalgameStoryCharacterDisplayName =
  components["schemas"]["GalgameStoryCharacterDisplayName"];
export type GalgameStoryPortraitSkin =
  components["schemas"]["GalgameStoryPortraitSkin"];
export type GalgameStoryRichTextDocument =
  components["schemas"]["GalgameStoryRichTextDocument"];
export type GalgameStoryRichTextNode = NonNullable<
  GalgameStoryRichTextDocument["nodes"]
>[number];
export type GalgameStorySourceRef =
  components["schemas"]["GalgameStorySourceRef"];
export type GalgameStoryParagraphStyle =
  components["schemas"]["GalgameStoryParagraphStyle"];
export type GalgameStorySystemMessageStyle =
  components["schemas"]["GalgameStorySystemMessageStyle"];
export type GalgameStoryAudioAsset =
  components["schemas"]["GalgameStoryAudioAsset"];
export type GalgameStoryVideoAsset =
  components["schemas"]["GalgameStoryVideoAsset"];
type GeneratedGalgameStoryImageAsset =
  components["schemas"]["GalgameStoryImageAsset"];
export type GalgameStoryImageAsset = Omit<
  GeneratedGalgameStoryImageAsset,
  "role"
> & {
  role: GeneratedGalgameStoryImageAsset["role"] | "sceneBackground";
};
export type GalgameStoryAsset =
  GalgameStoryImageAsset | GalgameStoryAudioAsset | GalgameStoryVideoAsset;
export type GalgameStoryVariable =
  components["schemas"]["GalgameStoryVariable"];
export type GalgameStoryCharacterAttributeTemplate =
  components["schemas"]["GalgameStoryCharacterAttributeTemplate"];
export type GalgameStoryVoiceProfile =
  components["schemas"]["GalgameStoryVoiceProfile"];
export type GalgameStoryDialogueBoxStyle =
  components["schemas"]["GalgameStoryDialogueBoxStyle"];
export type GalgameStoryStageStyle =
  components["schemas"]["GalgameStoryStageStyle"];
export type GalgameStoryCharacterTransform =
  components["schemas"]["GalgameStoryCharacterTransform"];
export type GalgameStoryCharacterTransition =
  components["schemas"]["GalgameStoryCharacterTransition"];
export type GalgameStoryDialoguePortrait =
  components["schemas"]["GalgameStoryDialoguePortrait"];
export type GalgameStoryShowCharacterBlock =
  components["schemas"]["GalgameStoryShowCharacterBlock"];
export type GalgameStoryRemoveCharacterBlock =
  components["schemas"]["GalgameStoryRemoveCharacterBlock"];
export type GalgameStoryUiStyle = components["schemas"]["GalgameStoryUiStyle"];
export type GalgameStoryUiComponent =
  components["schemas"]["GalgameStoryUiComponent"];
type GeneratedGalgameProjectAsset =
  components["schemas"]["GalgameProjectAssetOut"];
type GalgameAssetMetadataKeys =
  | "category"
  | "packagingPolicy"
  | "transcriptRevision"
  | "transcriptStatus"
  | "virtualPath";
export type GalgameProjectAsset = Omit<
  GeneratedGalgameProjectAsset,
  GalgameAssetMetadataKeys
> &
  Partial<Pick<GeneratedGalgameProjectAsset, GalgameAssetMetadataKeys>>;
type GeneratedGalgameAssetOverview =
  components["schemas"]["GalgameAssetOverviewOut"];
export type GalgameAssetOverview = Omit<
  GeneratedGalgameAssetOverview,
  | "items"
  | "totalBytes"
  | "referencedCount"
  | "orphanedCount"
  | "estimatedPackageBytes"
> & {
  items: Array<
    Omit<
      GeneratedGalgameAssetOverview["items"][number],
      GalgameAssetMetadataKeys
    > &
      Partial<
        Pick<
          GeneratedGalgameAssetOverview["items"][number],
          GalgameAssetMetadataKeys
        >
      >
  >;
  totalBytes?: number;
  referencedCount?: number;
  orphanedCount?: number;
  estimatedPackageBytes?: number;
};
export type GalgameStorySceneLayer =
  components["schemas"]["GalgameStorySceneLayer"];
export type GalgameStorySceneGroup =
  components["schemas"]["GalgameStorySceneGroup"];
export type GalgameStoryScene = components["schemas"]["GalgameStoryScene"] & {
  /** Read-only compatibility for unsaved Story 1.0/1.1 fixtures. */
  backgrounds?: Array<{ id: string; label: string; assetId: string }>;
  defaultBackgroundId?: string | null;
};
export type GalgameStoryCg = components["schemas"]["GalgameStoryCg"];
export type GalgameStoryCgVariant =
  components["schemas"]["GalgameStoryCgVariant"];
export type GalgameStoryCgTransition =
  components["schemas"]["GalgameStoryCgTransition"];
export type GalgameStoryCgOverlay =
  components["schemas"]["GalgameStoryCgOverlay"];
export type GalgameStoryShowCgBlock =
  components["schemas"]["GalgameStoryShowCgBlock"];
export type GalgameStoryHideCgBlock =
  components["schemas"]["GalgameStoryHideCgBlock"];
export type GalgameStoryBranchBlock =
  components["schemas"]["GalgameStoryBranchBlock"];
export type GalgameStoryAudioBlock =
  components["schemas"]["GalgameStoryAudioBlock"];
export type GalgameStoryRouteReport =
  components["schemas"]["GalgameStoryRouteReportOut"];
export type GalgameAssetCategory =
  components["schemas"]["GalgameProjectAssetOut"]["category"];
export type GalgamePackageManifest =
  components["schemas"]["GalgamePackageManifestOut"];
export type GalgameAsrSettings = components["schemas"]["GalgameAsrSettingsOut"];

export async function getGalgameWorkshopProjects() {
  return unwrap(await api.GET("/v1/galgame-workshop/projects"));
}

export async function getGalgameWorkshopProject(projectId: string) {
  return unwrap(
    await api.GET("/v1/galgame-workshop/projects/{project_id}", {
      params: { path: { project_id: projectId } },
    }),
  );
}

export async function createGalgameWorkshopProject(title: string) {
  return unwrap(
    await api.POST("/v1/galgame-workshop/projects", {
      body: { title },
    }),
  );
}

export async function patchGalgameWorkshopProject(
  project: GalgameWorkshopProject,
  changes: Partial<Pick<GalgameWorkshopProject, "title" | "status">>,
) {
  return unwrap(
    await api.PATCH("/v1/galgame-workshop/projects/{project_id}", {
      params: { path: { project_id: project.id } },
      body: { ...changes, expected_revision: project.revision },
    }),
  );
}

export async function deleteGalgameWorkshopProject(
  project: GalgameWorkshopProject,
) {
  return unwrap(
    await api.DELETE("/v1/galgame-workshop/projects/{project_id}", {
      params: {
        path: { project_id: project.id },
        query: { expected_revision: project.revision },
      },
    }),
  );
}

export async function getGalgameStoryDocument(
  projectId: string,
): Promise<GalgameStoryDocument> {
  return (await unwrap(
    await api.GET("/v1/galgame-workshop/projects/{project_id}/story", {
      params: { path: { project_id: projectId } },
    }),
  )) as GalgameStoryDocument;
}

export async function putGalgameStoryDocument(
  projectId: string,
  document: GalgameStoryProject,
  expectedRevision: number,
) {
  const requestDocument = {
    ...document,
    characters: (document.characters ?? []).map((character, index) => ({
      ...character,
      themeColor:
        character.themeColor ??
        ["#E75B55", "#4AA3DF", "#46B978", "#A56DE2"][index % 4],
    })),
  } as GeneratedGalgameStoryProject;
  return (await unwrap(
    await api.PUT("/v1/galgame-workshop/projects/{project_id}/story", {
      params: { path: { project_id: projectId } },
      body: { document: requestDocument, expected_revision: expectedRevision },
    }),
  )) as GalgameStoryDocument;
}

export async function getGalgameStoryReport(projectId: string) {
  return unwrap(
    await api.GET("/v1/galgame-workshop/projects/{project_id}/story/report", {
      params: { path: { project_id: projectId } },
    }),
  );
}

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
): Promise<GalgameProjectAsset> {
  return (await unwrap(
    await api.POST("/v1/galgame-workshop/projects/{project_id}/assets", {
      params: { path: { project_id: projectId } },
      body: { upload: file as unknown as string, category: category ?? null },
      bodySerializer(body) {
        const form = new FormData();
        form.set("upload", body.upload as unknown as File);
        if (body.category) form.set("category", body.category);
        return form;
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
) {
  return unwrap(
    await api.POST("/v1/galgame-workshop/projects/{project_id}/assets/batch", {
      params: { path: { project_id: projectId } },
      body: { uploads: files as unknown as string[], category },
      bodySerializer(body) {
        const form = new FormData();
        for (const file of body.uploads as unknown as File[])
          form.append("uploads", file);
        form.set("category", body.category);
        return form;
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
    await api.POST(
      "/v1/galgame-workshop/projects/{project_id}/assets/repair",
      {
        params: { path: { project_id: projectId } },
        body: {
          expectedStoryRevision,
          storyAssetId,
          replacementFileId,
        },
      },
    ),
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

export async function previewGalgamePortraitUpgrade(projectId: string) {
  return unwrap(
    await api.GET(
      "/v1/galgame-workshop/projects/{project_id}/story/portrait-upgrade",
      { params: { path: { project_id: projectId } } },
    ),
  );
}

export async function applyGalgamePortraitUpgrade(
  projectId: string,
  expectedStoryRevision: number,
) {
  return (await unwrap(
    await api.POST(
      "/v1/galgame-workshop/projects/{project_id}/story/portrait-upgrade",
      {
        params: { path: { project_id: projectId } },
        body: { expectedStoryRevision },
      },
    ),
  )) as GalgameStoryDocument;
}

export async function listGalgamePortraitSnapshots(projectId: string) {
  return unwrap(
    await api.GET(
      "/v1/galgame-workshop/projects/{project_id}/story/snapshots",
      { params: { path: { project_id: projectId } } },
    ),
  );
}

export async function restoreGalgamePortraitSnapshot(
  projectId: string,
  snapshotId: string,
  expectedStoryRevision: number,
) {
  return (await unwrap(
    await api.POST(
      "/v1/galgame-workshop/projects/{project_id}/story/snapshots/{snapshot_id}/restore",
      {
        params: {
          path: { project_id: projectId, snapshot_id: snapshotId },
        },
        body: { expectedStoryRevision },
      },
    ),
  )) as GalgameStoryDocument;
}

export async function getGalgamePackageManifest(projectId: string) {
  return unwrap(
    await api.GET(
      "/v1/galgame-workshop/projects/{project_id}/assets/package-manifest",
      { params: { path: { project_id: projectId } } },
    ),
  );
}

export async function getGalgameAsrSettings(projectId: string) {
  return unwrap(
    await api.GET(
      "/v1/galgame-workshop/projects/{project_id}/assets/asr/settings",
      { params: { path: { project_id: projectId } } },
    ),
  );
}

export async function patchGalgameAsrSettings(
  projectId: string,
  settings: GalgameAsrSettings,
  changes: {
    modelId?: string | null;
    defaultLanguage?: "auto" | "zh" | "ja";
    concurrency?: number;
  },
) {
  return unwrap(
    await api.PATCH(
      "/v1/galgame-workshop/projects/{project_id}/assets/asr/settings",
      {
        params: { path: { project_id: projectId } },
        body: { expectedRevision: settings.revision, ...changes },
      },
    ),
  );
}

export async function createGalgameTranscriptions(
  projectId: string,
  options: {
    assetIds?: string[];
    language?: "auto" | "zh" | "ja";
    force?: boolean;
  },
) {
  return unwrap(
    await api.POST(
      "/v1/galgame-workshop/projects/{project_id}/assets/asr/transcriptions",
      {
        params: { path: { project_id: projectId } },
        body: { ...options, force: options.force ?? false },
      },
    ),
  );
}

export async function getGalgameTranscriptions(projectId: string) {
  return unwrap(
    await api.GET(
      "/v1/galgame-workshop/projects/{project_id}/assets/asr/transcriptions",
      { params: { path: { project_id: projectId } } },
    ),
  );
}

export async function patchGalgameTranscript(
  projectId: string,
  assetId: string,
  expectedRevision: number,
  text: string,
  language?: "auto" | "zh" | "ja",
) {
  return unwrap(
    await api.PATCH(
      "/v1/galgame-workshop/projects/{project_id}/assets/{asset_id}/transcript",
      {
        params: { path: { project_id: projectId, asset_id: assetId } },
        body: { expectedRevision, text, language },
      },
    ),
  );
}

export async function matchGalgameVoiceDialogue(
  projectId: string,
  expectedStoryRevision: number,
  assetIds?: string[],
) {
  return unwrap(
    await api.POST(
      "/v1/galgame-workshop/projects/{project_id}/assets/asr/match-dialogue",
      {
        params: { path: { project_id: projectId } },
        body: { expectedStoryRevision, assetIds, minimumSimilarity: 0.72 },
      },
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
