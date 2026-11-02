import { useTransferProgress } from "@platform/api/useTransferProgress";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  batchUploadGalgameProjectAssets,
  uploadGalgameProjectAsset,
  type GalgameStoryAudioAsset,
  type GalgameStoryCharacter,
  type GalgameStoryCharacterExpression,
  type GalgameStoryProject,
} from "@features/galgame-workshop/api";
import {
  CHARACTER_PALETTE,
  displayLabel,
} from "@features/galgame-workshop/editor/characters/model";
import { stableId } from "@features/galgame-workshop/editor/model";
import type { StoryImagePickerState } from "@features/galgame-workshop/editor/StoryImagePicker";
import { invalidateGalgameAssetQueries } from "@features/galgame-workshop/queryKeys";

export function useCharacterAssetBindings({
  projectId,
  document,
  characters,
  selectedCharacter,
  expressions,
  selectedExpression,
  picker,
  setPicker,
  setSelectedCharacterId,
  setSelectedExpressionId,
  setSelectedExpressionIds,
  setVoicePickerOpen,
  setUploadError,
  appendSequenceFiles,
  onDocument,
  onNotice,
}: {
  projectId: string;
  document: GalgameStoryProject;
  characters: GalgameStoryCharacter[];
  selectedCharacter?: GalgameStoryCharacter;
  expressions: GalgameStoryCharacterExpression[];
  selectedExpression?: GalgameStoryCharacterExpression;
  picker?: StoryImagePickerState;
  setPicker: (picker: StoryImagePickerState | undefined) => void;
  setSelectedCharacterId: (id: string | undefined) => void;
  setSelectedExpressionId: (id: string | undefined) => void;
  setSelectedExpressionIds: (ids: Set<string>) => void;
  setVoicePickerOpen: (open: boolean) => void;
  setUploadError: (message: string) => void;
  appendSequenceFiles: (files: Array<{ fileId: string; name: string }>) => void;
  onDocument: (document: GalgameStoryProject) => void;
  onNotice: (message: string) => void;
}) {
  const { run: runTransfer, progress: activeTransferProgress } =
    useTransferProgress();

  const client = useQueryClient();

  const bindFile = (fileId: string, name: string) => {
    if (!selectedCharacter || !picker) return;
    if (picker.mode === "replace" && selectedExpression) {
      onDocument({
        ...document,
        assets: (document.assets ?? []).map((asset) =>
          asset.id === selectedExpression.assetId
            ? { ...asset, fileId }
            : asset,
        ),
      });
      setPicker(undefined);
      return;
    }
    const assetId = stableId();
    const expressionId = stableId();
    const expression: GalgameStoryCharacterExpression = {
      id: expressionId,
      label: displayLabel(name, `表情 ${expressions.length + 1}`),
      assetId,
    };
    onDocument({
      ...document,
      assets: [
        ...(document.assets ?? []),
        {
          id: assetId,
          type: "image",
          role: "characterPortrait",
          fileId,
          status: "ready",
        },
      ],
      characters: characters.map((character) =>
        character.id === selectedCharacter.id
          ? {
              ...character,
              expressions: [...(character.expressions ?? []), expression],
              defaultExpressionId:
                character.defaultExpressionId ?? expressionId,
            }
          : character,
      ),
    });
    setSelectedExpressionId(expressionId);
    setPicker(undefined);
  };

  const upload = useMutation({
    mutationFn: (file: File) =>
      runTransfer((onProgress) =>
        uploadGalgameProjectAsset(projectId, file, "character", { onProgress }),
      ),
    onSuccess: (asset) => {
      setUploadError("");
      void invalidateGalgameAssetQueries(client, projectId);
      bindFile(asset.id, asset.display_name);
    },
    onError: (caught) =>
      setUploadError(caught instanceof Error ? caught.message : "立绘上传失败"),
  });

  const batchUpload = useMutation({
    mutationFn: (files: File[]) =>
      runTransfer((onProgress) =>
        batchUploadGalgameProjectAssets(projectId, files, "character", {
          onProgress,
        }),
      ),
    onSuccess: (result) => {
      const nextCharacters = characters.map((character) => ({
        ...character,
        expressions: [...(character.expressions ?? [])],
      }));
      const nextAssets = [...(document.assets ?? [])];
      let lastCharacterId = selectedCharacter?.id;
      let lastExpressionId: string | undefined;
      result.items.forEach((file, index) => {
        const finalName =
          result.importItems[index]?.finalName ?? file.display_name;
        const stem = displayLabel(finalName, `表情 ${index + 1}`);
        const separator = stem.lastIndexOf("_");
        const inferredCharacter =
          separator > 0
            ? stem.slice(0, separator).trim()
            : selectedCharacter?.name || stem;
        const inferredExpression =
          separator > 0 ? stem.slice(separator + 1).trim() || "默认" : stem;
        let character = nextCharacters.find(
          (item) => item.name === inferredCharacter,
        );
        if (!character) {
          character = {
            id: stableId(),
            name: inferredCharacter,
            description: "",
            themeColor:
              CHARACTER_PALETTE[
                nextCharacters.length % CHARACTER_PALETTE.length
              ],
            expressions: [],
            defaultExpressionId: null,
            attributes: Object.fromEntries(
              (document.characterAttributeTemplates ?? []).map((attribute) => [
                attribute.id,
                attribute.defaultValue,
              ]),
            ),
          };
          nextCharacters.push(character);
        }
        const storyAssetId = stableId();
        const expressionId = stableId();
        nextAssets.push({
          id: storyAssetId,
          type: "image",
          role: "characterPortrait",
          fileId: file.id,
          status: "ready",
        });
        character.expressions = [
          ...(character.expressions ?? []),
          {
            id: expressionId,
            label: inferredExpression,
            assetId: storyAssetId,
          },
        ];
        character.defaultExpressionId ??= expressionId;
        lastCharacterId = character.id;
        lastExpressionId = expressionId;
      });
      onDocument({
        ...document,
        characters: nextCharacters,
        assets: nextAssets,
      });
      setSelectedCharacterId(lastCharacterId);
      setSelectedExpressionId(lastExpressionId);
      setSelectedExpressionIds(
        lastExpressionId ? new Set([lastExpressionId]) : new Set(),
      );
      setPicker(undefined);
      setUploadError("");
      void invalidateGalgameAssetQueries(client, projectId);
      onNotice(
        `已导入 ${result.items.length} 张立绘，并按“角色名_表情名”归组。`,
      );
    },
    onError: (caught) =>
      setUploadError(caught instanceof Error ? caught.message : "批量导入失败"),
  });

  const sequenceBatchUpload = useMutation({
    mutationFn: (files: File[]) => {
      const sequence = selectedExpression?.sequence;
      if (
        sequence?.playbackMode === "lipSync" &&
        sequence.frames.length + files.length > 3
      )
        throw new Error("语音口型固定为闭口、半口和张口三帧。");
      return runTransfer((onProgress) =>
        batchUploadGalgameProjectAssets(projectId, files, "character", {
          onProgress,
        }),
      );
    },
    onSuccess: (result) => {
      appendSequenceFiles(
        result.items.map((file, index) => ({
          fileId: file.id,
          name: result.importItems[index]?.finalName ?? file.display_name,
        })),
      );
      setUploadError("");
      void invalidateGalgameAssetQueries(client, projectId);
      onNotice(`已向当前表情追加 ${result.items.length} 个序列帧。`);
    },
    onError: (caught) =>
      setUploadError(
        caught instanceof Error ? caught.message : "序列帧导入失败",
      ),
  });

  const bindVoiceSample = (fileId: string, name: string) => {
    if (!selectedCharacter) return;
    const previousId = selectedCharacter.voiceProfile?.sampleAssetId;
    const previousStillUsed = characters.some(
      (character) =>
        character.id !== selectedCharacter.id &&
        character.voiceProfile?.sampleAssetId === previousId,
    );
    const assetId = stableId();
    const asset: GalgameStoryAudioAsset = {
      id: assetId,
      type: "audio",
      role: "voiceSample",
      label: displayLabel(name, "声线样本"),
      fileId,
      status: "ready",
    };
    onDocument({
      ...document,
      assets: [
        ...(document.assets ?? []).filter(
          (item) => item.id !== previousId || previousStillUsed,
        ),
        asset,
      ],
      characters: characters.map((character) =>
        character.id === selectedCharacter.id
          ? {
              ...character,
              voiceProfile: {
                name: character.voiceProfile?.name ?? "默认声线",
                language: character.voiceProfile?.language ?? "zh-CN",
                description: character.voiceProfile?.description ?? "",
                sampleAssetId: assetId,
              },
            }
          : character,
      ),
    });
    setVoicePickerOpen(false);
  };

  const voiceUpload = useMutation({
    mutationFn: (file: File) =>
      runTransfer((onProgress) =>
        uploadGalgameProjectAsset(projectId, file, undefined, { onProgress }),
      ),
    onSuccess: (asset) => {
      void invalidateGalgameAssetQueries(client, projectId);
      bindVoiceSample(asset.id, asset.display_name);
    },
    onError: (caught) =>
      onNotice(caught instanceof Error ? caught.message : "声线样本上传失败"),
  });

  return {
    transferProgress: activeTransferProgress,
    bindFile,
    upload,
    batchUpload,
    sequenceBatchUpload,
    bindVoiceSample,
    voiceUpload,
  };
}
