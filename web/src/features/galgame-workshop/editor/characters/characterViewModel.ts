import type {
  GalgameProjectAsset,
  GalgameStoryAsset,
  GalgameStoryAudioAsset,
  GalgameStoryCharacter,
  GalgameStoryCharacterExpression,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import { characterStageSettings } from "@features/galgame-workshop/editor/model";
import {
  portraitFootprintWidth,
  type PortraitNaturalSize,
} from "@features/galgame-workshop/editor/portraitSizing";

export function createCharacterViewModel({
  document,
  selectedCharacter,
  expressions,
  selectedExpression,
  previewExpression,
  selectedSkinAssetId,
  previewSkinAssetId,
  assetsById,
  projectAssets,
  naturalPortraitSizes,
  previewSceneId,
  previewPositionId,
}: {
  document: GalgameStoryProject;
  selectedCharacter?: GalgameStoryCharacter;
  expressions: GalgameStoryCharacterExpression[];
  selectedExpression?: GalgameStoryCharacterExpression;
  previewExpression?: GalgameStoryCharacterExpression;
  selectedSkinAssetId?: string;
  previewSkinAssetId?: string;
  assetsById: Map<string, GalgameStoryAsset>;
  projectAssets: GalgameProjectAsset[];
  naturalPortraitSizes: Map<string, PortraitNaturalSize>;
  previewSceneId: string;
  previewPositionId: string;
}) {
  const activeAsset = selectedExpression
    ? assetsById.get(selectedExpression.assetId)
    : undefined;
  const previewExpressionAsset = previewExpression
    ? assetsById.get(previewExpression.assetId)
    : undefined;
  const previewResolvedAsset = previewSkinAssetId
    ? assetsById.get(previewSkinAssetId)
    : previewExpressionAsset;
  const voiceSampleAsset = (document.assets ?? []).find(
    (asset): asset is GalgameStoryAudioAsset =>
      asset.type === "audio" &&
      asset.id === selectedCharacter?.voiceProfile?.sampleAssetId,
  );
  const previewScene = (document.scenes ?? []).find(
    (scene) => scene.id === previewSceneId,
  );
  const previewBackground = previewScene?.layers?.[0];
  const previewBackgroundAsset = (document.assets ?? []).find(
    (asset) => asset.id === previewBackground?.assetId,
  );
  const selectedStageOverride = selectedCharacter
    ? document.settings?.characterStageOverrides?.[selectedCharacter.id]
    : undefined;
  const stageSettings = characterStageSettings(document, selectedCharacter?.id);
  const inheritedExpressionHeight =
    selectedStageOverride?.defaultHeightPercent ??
    selectedCharacter?.portraitHeightPercent ??
    stageSettings.defaultHeightPercent;
  const inheritedExpressionHeightSource =
    selectedStageOverride != null
      ? "角色独立方案"
      : selectedCharacter?.portraitHeightPercent != null
        ? "角色默认"
        : "项目全局";
  const previewPosition =
    stageSettings.positionPresets.find(
      (preset) => preset.id === previewPositionId,
    ) ?? stageSettings.positionPresets[0];
  const portraitFileId = previewResolvedAsset?.fileId;
  const portraitMetadata = projectAssets.find(
    (asset) => asset.id === portraitFileId,
  );
  const matchingNaturalPortraitSize = portraitFileId
    ? naturalPortraitSizes.get(portraitFileId)
    : undefined;
  const portraitWidth =
    portraitMetadata?.width ?? matchingNaturalPortraitSize?.width;
  const portraitHeight =
    portraitMetadata?.height ?? matchingNaturalPortraitSize?.height;
  const footprintHeight =
    previewExpression?.heightPercent ?? inheritedExpressionHeight;
  const canvasWidth = document.settings?.canvas?.width ?? 1920;
  const canvasHeight = document.settings?.canvas?.height ?? 1080;
  const portraitSize =
    portraitWidth && portraitHeight
      ? { width: portraitWidth, height: portraitHeight }
      : undefined;
  const footprintWidth = portraitFootprintWidth(
    footprintHeight,
    canvasWidth,
    canvasHeight,
    portraitSize,
  );
  const selectedResolvedAsset = selectedSkinAssetId
    ? assetsById.get(selectedSkinAssetId)
    : activeAsset;
  const selectedPortraitFileId = selectedResolvedAsset?.fileId;
  const selectedPortraitMetadata = projectAssets.find(
    (asset) => asset.id === selectedPortraitFileId,
  );
  const selectedNaturalPortraitSize = selectedPortraitFileId
    ? naturalPortraitSizes.get(selectedPortraitFileId)
    : undefined;
  const selectedPortraitWidth =
    selectedPortraitMetadata?.width ?? selectedNaturalPortraitSize?.width;
  const selectedPortraitHeight =
    selectedPortraitMetadata?.height ?? selectedNaturalPortraitSize?.height;
  const selectedExpressionHeight =
    selectedExpression?.heightPercent ?? inheritedExpressionHeight;
  const selectedPortraitSize =
    selectedPortraitWidth && selectedPortraitHeight
      ? { width: selectedPortraitWidth, height: selectedPortraitHeight }
      : undefined;
  const cachedCharacterPortraitSize = expressions
    .map((expression) => assetsById.get(expression.assetId)?.fileId)
    .filter((fileId): fileId is string => Boolean(fileId))
    .map((fileId) => {
      const metadata = projectAssets.find((asset) => asset.id === fileId);
      const cached = naturalPortraitSizes.get(fileId);
      const width = metadata?.width ?? cached?.width;
      const height = metadata?.height ?? cached?.height;
      return width && height ? { width, height } : undefined;
    })
    .find((size): size is PortraitNaturalSize => Boolean(size));
  const selectedFootprintWidth = portraitFootprintWidth(
    selectedExpressionHeight,
    canvasWidth,
    canvasHeight,
    selectedPortraitSize,
    portraitSize ?? cachedCharacterPortraitSize,
  );

  return {
    activeAsset,
    previewResolvedAsset,
    voiceSampleAsset,
    previewBackgroundAsset,
    stageSettings,
    inheritedExpressionHeight,
    inheritedExpressionHeightSource,
    previewPosition,
    canvasWidth,
    canvasHeight,
    footprintHeight,
    footprintWidth,
    selectedPortraitFileId,
    selectedExpressionHeight,
    selectedFootprintHeight: selectedExpressionHeight,
    selectedFootprintWidth,
  };
}
