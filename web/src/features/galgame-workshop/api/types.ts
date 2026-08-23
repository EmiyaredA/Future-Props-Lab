import type { components } from "@generated/api";

export type GalgameWorkshopProject =
  components["schemas"]["GalgameWorkshopProjectOut"];
export type GalgameWorkshopProjectStatus = GalgameWorkshopProject["status"];
export type GalgameVideoExportPreview =
  components["schemas"]["GalgameVideoExportPreviewOut"];
export type GalgameVideoExportTask =
  components["schemas"]["GalgameVideoExportTaskOut"];
export type GalgameVideoExportPreset =
  components["schemas"]["GalgameVideoExportPreviewIn"]["preset"];
export type GalgameVideoExportBranchSelection =
  components["schemas"]["GalgameVideoExportBranchSelection"];
export type GalgameVideoExportCaptureFrame =
  components["schemas"]["GalgameVideoExportCaptureFrame"];
type GeneratedGalgameStoryDocument =
  components["schemas"]["GalgameStoryDocumentOut"];
export type GeneratedGalgameStoryProject =
  components["schemas"]["GalgameStoryProject"];
export type GeneratedGalgameStoryFragment =
  components["schemas"]["GalgameStoryFragment"];
export type GeneratedGalgameStoryBlock = NonNullable<
  GeneratedGalgameStoryFragment["blocks"]
>[number];
type CompatibleGalgameStoryBlock<T> = T extends { type: "dialogue" }
  ? Omit<T, "hideDialogueAfter" | "portrait"> & {
      hideDialogueAfter?: boolean;
      portrait?: T extends { portrait?: infer P }
        ? P extends object
          ? Omit<P, "visible" | "distance"> & {
              visible?: boolean;
              distance?: P extends { distance: infer D } ? D : never;
            }
          : P
        : never;
    }
  : T extends { type: "showCharacter"; distance: infer D }
    ? Omit<T, "distance"> & { distance?: D }
    : T extends { type: "scene" }
      ? T & { backgroundId?: string | null }
      : T extends { type: "narration" }
        ? Omit<T, "hideDialogueAfter"> & { hideDialogueAfter?: boolean }
        : T;
export type GalgameStorySettings =
  components["schemas"]["GalgameStorySettings"];
export type GalgameStoryCharacterStageSettings =
  components["schemas"]["GalgameStoryCharacterStageSettings"];
export type GalgameStoryPositionPreset =
  components["schemas"]["GalgameStoryPositionPreset"];
export type GeneratedGalgameStoryCharacterExpression =
  components["schemas"]["GalgameStoryCharacterExpression"];
export type GalgameStoryCharacterExpression = Omit<
  GeneratedGalgameStoryCharacterExpression,
  "flipX" | "renderMode"
> & {
  flipX?: boolean;
  renderMode?: GeneratedGalgameStoryCharacterExpression["renderMode"];
};
export type GalgameStoryCharacter = Omit<
  components["schemas"]["GalgameStoryCharacter"],
  "expressions" | "themeColor"
> & {
  expressions?: GalgameStoryCharacterExpression[];
  themeColor?: string;
};
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
  schemaVersion: "1.0" | "1.1" | "1.2" | "1.3" | "1.4";
};
export type CurrentGalgameStoryFragment = Omit<
  GeneratedGalgameStoryFragment,
  "blocks"
> & { blocks: GeneratedGalgameStoryBlock[] };
export type CurrentGalgameStoryChapter = Omit<
  components["schemas"]["GalgameStoryChapter"],
  "fragments"
> & { fragments: CurrentGalgameStoryFragment[] };
export type CurrentGalgameStoryCharacter = Omit<
  components["schemas"]["GalgameStoryCharacter"],
  "expressions"
> & { expressions: GeneratedGalgameStoryCharacterExpression[] };
export type CurrentGalgameStoryScene = Omit<
  components["schemas"]["GalgameStoryScene"],
  "layers"
> & { layers: GalgameStorySceneLayer[] };
export type CurrentGalgameStoryCg = Omit<
  components["schemas"]["GalgameStoryCg"],
  "variants"
> & { variants: GalgameStoryCgVariant[] };
export type CurrentGalgameStoryProject = Omit<
  GeneratedGalgameStoryProject,
  | "assets"
  | "cgs"
  | "chapters"
  | "characterAttributeTemplates"
  | "characters"
  | "sceneGroups"
  | "scenes"
  | "schemaVersion"
  | "variables"
> & {
  assets: NonNullable<GeneratedGalgameStoryProject["assets"]>;
  cgs: CurrentGalgameStoryCg[];
  chapters: CurrentGalgameStoryChapter[];
  characterAttributeTemplates: GalgameStoryCharacterAttributeTemplate[];
  characters: CurrentGalgameStoryCharacter[];
  sceneGroups: GalgameStorySceneGroup[];
  scenes: CurrentGalgameStoryScene[];
  schemaVersion: "1.4";
  variables: GalgameStoryVariable[];
};
export type GalgameStoryDocument = Omit<
  GeneratedGalgameStoryDocument,
  "document"
> & { document: GalgameStoryProject };
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
export type GeneratedGalgameStoryImageAsset =
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
export type GalgameStoryStageCastMember =
  components["schemas"]["GalgameStoryStageCastMember"];
export type GalgameStorySetStageCastBlock =
  components["schemas"]["GalgameStorySetStageCastBlock"];
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
  | "transcriptSegments"
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
export type GalgameStoryLocalizations =
  components["schemas"]["GalgameStoryLocalizations"];
export type GalgameStoryLocalizationTarget =
  components["schemas"]["GalgameStoryLocalizationTarget"];
export type GalgameStoryLocalizationEntry =
  components["schemas"]["GalgameStoryLocalizationEntry"];
export type GalgameStoryAudioBlock =
  components["schemas"]["GalgameStoryAudioBlock"];
export type GalgameStoryRouteReport =
  components["schemas"]["GalgameStoryRouteReportOut"];
export type GalgameAssetCategory =
  components["schemas"]["GalgameProjectAssetOut"]["category"];
export type GalgamePackageManifest =
  components["schemas"]["GalgamePackageManifestOut"];
export type GalgameAsrSettings = components["schemas"]["GalgameAsrSettingsOut"];
