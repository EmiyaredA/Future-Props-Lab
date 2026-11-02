import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  getGalgameProjectAssets,
  previewGalgamePortraitUpgrade,
  type GalgameStoryCharacter,
  type GalgameStoryCharacterExpression,
  type GalgameStoryProject,
} from "@features/galgame-workshop/api";
import { stableId } from "@features/galgame-workshop/editor/model";
import { type StoryImagePickerState } from "@features/galgame-workshop/editor/StoryImagePicker";
import { type PortraitNaturalSize } from "@features/galgame-workshop/editor/portraitSizing";
import {
  CharacterStageWorkspace,
  CharacterTemplatesWorkspace,
} from "@features/galgame-workshop/editor/characters/CharacterWorkspaceModes";
import {
  characterPortraitAssetIds,
  characterStageScopeKey,
  referencesForCharacter,
  reorderById,
  type CharacterReferenceTab,
  type CharacterWorkspaceMode,
  type SortDropTarget,
  type SortPlacement,
} from "@features/galgame-workshop/editor/characters/model";
import { useCharacterAssetBindings } from "@features/galgame-workshop/editor/characters/useCharacterAssetBindings";
import { useCharacterCollectionActions } from "@features/galgame-workshop/editor/characters/useCharacterCollectionActions";
import { createCharacterViewModel } from "@features/galgame-workshop/editor/characters/characterViewModel";
import { type StoryAudioPickerSource } from "@features/galgame-workshop/editor/StoryAudioPicker";
import { galgameQueryKeys } from "@features/galgame-workshop/queryKeys";

export function useCharacterWorkspaceController({
  projectId,
  document,
  onDocument,
  onCommitDocument,
  onLocate,
  onNotice,
  focusCharacterId,
  onUpgradePortraitSizes,
}: {
  projectId: string;
  document: GalgameStoryProject;
  onDocument: (document: GalgameStoryProject) => void;
  onCommitDocument: (document: GalgameStoryProject) => Promise<boolean>;
  onLocate: (fragmentId: string, blockId: string) => void;
  onNotice: (message: string) => void;
  focusCharacterId?: string;
  onUpgradePortraitSizes: () => Promise<boolean>;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const voiceFileInput = useRef<HTMLInputElement>(null);
  const characters = useMemo(
    () => document.characters ?? [],
    [document.characters],
  );
  const [query, setQuery] = useState("");
  const [selectedCharacterId, setSelectedCharacterId] = useState<
    string | undefined
  >(characters[0]?.id);
  const [selectedExpressionId, setSelectedExpressionId] = useState<string>();
  const [selectedExpressionIds, setSelectedExpressionIds] = useState<
    Set<string>
  >(new Set());
  const [lastExpressionIndex, setLastExpressionIndex] = useState<number>();
  const [draggedCharacterId, setDraggedCharacterId] = useState<string>();
  const [characterDropTarget, setCharacterDropTarget] =
    useState<SortDropTarget>();
  const [draggedExpressionId, setDraggedExpressionId] = useState<string>();
  const [expressionDropTarget, setExpressionDropTarget] =
    useState<SortDropTarget>();
  const [selectedDisplayNameId, setSelectedDisplayNameId] =
    useState<string>("main");
  const [selectedSkinId, setSelectedSkinId] = useState<string>();
  const [tab, setTab] = useState<
    "expressions" | "skins" | "displayNames" | "attributes" | "voice"
  >("expressions");
  const [workspaceMode, setWorkspaceMode] =
    useState<CharacterWorkspaceMode>("character");
  const [stageScopeId, setStageScopeId] = useState(() => {
    const remembered = localStorage.getItem(characterStageScopeKey(projectId));
    return remembered === "global" ||
      characters.some((character) => character.id === remembered)
      ? (remembered ?? "global")
      : "global";
  });
  const [referenceTab, setReferenceTab] =
    useState<CharacterReferenceTab>("preview");
  const [previewEnabled, setPreviewEnabled] = useState(true);
  const [previewBackgroundMode, setPreviewBackgroundMode] = useState<
    "scene" | "dark" | "light" | "checkerboard"
  >("scene");
  const [previewSceneId, setPreviewSceneId] = useState(
    document.scenes?.[0]?.id ?? "",
  );
  const [previewPositionId, setPreviewPositionId] = useState("position-center");
  const [naturalPortraitSizes, setNaturalPortraitSizes] = useState<
    Map<string, PortraitNaturalSize>
  >(new Map());
  const [picker, setPicker] = useState<StoryImagePickerState>();
  const [confirmStaticMode, setConfirmStaticMode] = useState(false);
  const [expandedExpressionPreview, setExpandedExpressionPreview] =
    useState(false);
  const [referencePanelOpen, setReferencePanelOpen] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const portraitPreview = useMutation({
    mutationFn: () => previewGalgamePortraitUpgrade(projectId),
    onError: (caught) =>
      onNotice(
        caught instanceof Error ? caught.message : "无法生成立绘尺寸预览",
      ),
  });
  const projectAssetsQuery = useQuery({
    queryKey: galgameQueryKeys.projectAssets(projectId, ""),
    queryFn: () => getGalgameProjectAssets(projectId),
  });
  const [voicePickerOpen, setVoicePickerOpen] = useState(false);
  const [voicePickerSource, setVoicePickerSource] =
    useState<StoryAudioPickerSource>("project");
  const selectedCharacter =
    characters.find((character) => character.id === selectedCharacterId) ??
    characters[0];
  const expressions = useMemo(
    () => selectedCharacter?.expressions ?? [],
    [selectedCharacter?.expressions],
  );
  const selectedExpression = expressions.find(
    (expression) => expression.id === selectedExpressionId,
  );
  const previewExpression =
    expressions.find(
      (expression) => expression.id === selectedCharacter?.defaultExpressionId,
    ) ?? expressions[0];
  const selectedDisplayName = selectedCharacter?.displayNames?.find(
    (scheme) => scheme.id === selectedDisplayNameId,
  );
  const selectedSkin = selectedCharacter?.portraitSkins?.find(
    (skin) => skin.id === selectedSkinId,
  );
  const selectedSkinAssetId = selectedSkin?.overrides?.find(
    (override) => override.expressionId === selectedExpression?.id,
  )?.assetId;
  const previewSkinAssetId = selectedCharacter?.portraitSkins
    ?.find((skin) => skin.id === selectedCharacter.defaultPortraitSkinId)
    ?.overrides?.find(
      (override) => override.expressionId === previewExpression?.id,
    )?.assetId;
  const references = selectedCharacter
    ? referencesForCharacter(document, selectedCharacter.id)
    : [];
  const expressionDetailLayout =
    workspaceMode === "character" && tab === "expressions";
  const fragmentCount = new Set(
    references.map((reference) => reference.fragmentId),
  ).size;
  const filtered = characters.filter((character) =>
    character.name
      .toLocaleLowerCase("zh-CN")
      .includes(query.toLocaleLowerCase("zh-CN")),
  );
  const assetsById = new Map(
    (document.assets ?? []).map((asset) => [asset.id, asset]),
  );
  const usedFileIds = useMemo(
    () => new Set((document.assets ?? []).map((asset) => asset.fileId)),
    [document.assets],
  );

  useEffect(() => {
    if (!selectedCharacter && characters[0])
      setSelectedCharacterId(characters[0].id);
  }, [characters, selectedCharacter]);

  useEffect(() => {
    if (
      stageScopeId !== "global" &&
      !characters.some((character) => character.id === stageScopeId)
    ) {
      setStageScopeId("global");
      localStorage.setItem(characterStageScopeKey(projectId), "global");
    }
  }, [characters, projectId, stageScopeId]);

  const selectStageScope = (scopeId: string) => {
    setStageScopeId(scopeId);
    localStorage.setItem(characterStageScopeKey(projectId), scopeId);
  };

  useEffect(() => {
    if (!focusCharacterId) return;
    if (characters.some((character) => character.id === focusCharacterId)) {
      setSelectedCharacterId(focusCharacterId);
      setSelectedExpressionId(undefined);
      setSelectedExpressionIds(new Set());
      setLastExpressionIndex(undefined);
      setSelectedDisplayNameId("main");
      setSelectedSkinId(undefined);
      setWorkspaceMode("character");
      setTab("expressions");
    }
  }, [characters, focusCharacterId]);

  useEffect(() => {
    if (selectedDisplayNameId !== "main" && !selectedDisplayName)
      setSelectedDisplayNameId("main");
  }, [selectedDisplayName, selectedDisplayNameId]);

  useEffect(() => {
    if (selectedSkinId && !selectedSkin) setSelectedSkinId(undefined);
  }, [selectedSkin, selectedSkinId]);

  const updateCharacter = (
    characterId: string,
    updater: (character: GalgameStoryCharacter) => GalgameStoryCharacter,
  ) =>
    onDocument({
      ...document,
      characters: characters.map((character) =>
        character.id === characterId ? updater(character) : character,
      ),
    });

  const moveCharacter = (
    sourceId: string,
    targetId: string,
    placement: SortPlacement,
  ) => {
    const reordered = reorderById(characters, sourceId, targetId, placement);
    if (reordered === characters) return;
    onDocument({ ...document, characters: reordered });
  };

  const moveCharacterByOffset = (characterId: string, offset: -1 | 1) => {
    const sourceIndex = characters.findIndex(
      (character) => character.id === characterId,
    );
    const target = characters[sourceIndex + offset];
    if (!target) return;
    moveCharacter(characterId, target.id, offset < 0 ? "before" : "after");
  };

  const setDefaultExpression = (expressionId: string) => {
    if (!selectedCharacter) return;
    const previousDefaultId = selectedCharacter.defaultExpressionId;
    const affectedBlockIds = new Set(
      previousDefaultId
        ? references
            .filter(
              (reference) =>
                reference.expressionId === previousDefaultId &&
                reference.kind !== "removeCharacter",
            )
            .map((reference) => reference.blockId)
        : [],
    );
    onDocument({
      ...document,
      characters: characters.map((character) =>
        character.id === selectedCharacter.id
          ? { ...character, defaultExpressionId: expressionId }
          : character,
      ),
      chapters: (document.chapters ?? []).map((chapter) => ({
        ...chapter,
        fragments: (chapter.fragments ?? []).map((fragment) => ({
          ...fragment,
          blocks: (fragment.blocks ?? []).map((block) =>
            !affectedBlockIds.has(block.id)
              ? block
              : block.type === "dialogue" || block.type === "showCharacter"
                ? { ...block, expressionId: null }
                : block.type === "setStageCast"
                  ? {
                      ...block,
                      members: (block.members ?? []).map((member) =>
                        member.characterId === selectedCharacter.id &&
                        member.expressionId === previousDefaultId
                          ? { ...member, expressionId: null }
                          : member,
                      ),
                    }
                  : block,
          ),
        })),
      })),
    });
    if (affectedBlockIds.size)
      onNotice(
        `已设为默认表情，并让 ${affectedBlockIds.size} 处旧默认引用改为跟随角色默认。`,
      );
  };

  const updateExpression = (
    expressionId: string,
    updater: (
      expression: GalgameStoryCharacterExpression,
    ) => GalgameStoryCharacterExpression,
  ) => {
    if (!selectedCharacter) return;
    updateCharacter(selectedCharacter.id, (character) => ({
      ...character,
      expressions: (character.expressions ?? []).map((expression) =>
        expression.id === expressionId ? updater(expression) : expression,
      ),
    }));
  };

  const switchExpressionToSequence = () => {
    if (!selectedExpression) return;
    updateExpression(selectedExpression.id, (expression) => ({
      ...expression,
      renderMode: "frameSequence",
      sequence: expression.sequence ?? {
        playbackMode: "timed",
        fps: 2,
        loop: true,
        frames: [{ id: stableId(), assetId: expression.assetId }],
      },
    }));
  };

  const setSequencePlaybackMode = (playbackMode: "timed" | "lipSync") => {
    if (!selectedExpression?.sequence) return;
    if (
      playbackMode === "lipSync" &&
      selectedExpression.sequence.frames.length !== 3
    ) {
      onNotice("语音口型需要依次准备闭口、半口和张口三帧。");
      return;
    }
    updateExpression(selectedExpression.id, (expression) => ({
      ...expression,
      sequence: expression.sequence
        ? { ...expression.sequence, playbackMode }
        : expression.sequence,
    }));
  };

  const applyExpressionStaticMode = () => {
    if (!selectedCharacter || !selectedExpression) return;
    const nextCharacters = characters.map((character) =>
      character.id === selectedCharacter.id
        ? {
            ...character,
            expressions: (character.expressions ?? []).map((expression) =>
              expression.id === selectedExpression.id
                ? {
                    ...expression,
                    assetId:
                      expression.sequence?.frames[0]?.assetId ??
                      expression.assetId,
                    renderMode: "staticImage" as const,
                    sequence: undefined,
                  }
                : expression,
            ),
          }
        : character,
    );
    const usedPortraitAssets = characterPortraitAssetIds(nextCharacters);
    onDocument({
      ...document,
      characters: nextCharacters,
      assets: (document.assets ?? []).filter(
        (asset) =>
          asset.type !== "image" ||
          asset.role !== "characterPortrait" ||
          usedPortraitAssets.has(asset.id),
      ),
    });
    setConfirmStaticMode(false);
  };

  const switchExpressionToStatic = () => {
    if (!selectedExpression) return;
    if ((selectedExpression.sequence?.frames.length ?? 0) > 1) {
      setConfirmStaticMode(true);
      return;
    }
    applyExpressionStaticMode();
  };

  const appendExistingExpressionFrame = (sourceExpressionId: string) => {
    if (!selectedExpression || !sourceExpressionId) return;
    if (
      selectedExpression.sequence?.playbackMode === "lipSync" &&
      selectedExpression.sequence.frames.length >= 3
    ) {
      onNotice("语音口型固定为闭口、半口和张口三帧。");
      return;
    }
    const source = expressions.find((item) => item.id === sourceExpressionId);
    if (!source) return;
    updateExpression(selectedExpression.id, (expression) => ({
      ...expression,
      renderMode: "frameSequence",
      sequence: {
        playbackMode: expression.sequence?.playbackMode ?? "timed",
        fps: expression.sequence?.fps ?? 2,
        loop: expression.sequence?.loop ?? true,
        frames: [
          ...(expression.sequence?.frames ?? [
            { id: stableId(), assetId: expression.assetId },
          ]),
          { id: stableId(), assetId: source.assetId },
        ],
      },
    }));
  };

  const appendSequenceFiles = (
    files: Array<{ fileId: string; name: string }>,
  ) => {
    if (!selectedCharacter || !selectedExpression || !files.length) return;
    const currentFrames = selectedExpression.sequence?.frames.length ?? 1;
    if (
      selectedExpression.sequence?.playbackMode === "lipSync" &&
      currentFrames + files.length > 3
    ) {
      onNotice("语音口型固定为闭口、半口和张口三帧。");
      return;
    }
    const addedAssets = files.map(({ fileId }) => ({
      id: stableId(),
      type: "image" as const,
      role: "characterPortrait" as const,
      fileId,
      status: "ready" as const,
    }));
    const frames = addedAssets.map((asset) => ({
      id: stableId(),
      assetId: asset.id,
    }));
    onDocument({
      ...document,
      assets: [...(document.assets ?? []), ...addedAssets],
      characters: characters.map((character) =>
        character.id === selectedCharacter.id
          ? {
              ...character,
              expressions: (character.expressions ?? []).map((expression) =>
                expression.id === selectedExpression.id
                  ? {
                      ...expression,
                      renderMode: "frameSequence" as const,
                      sequence: {
                        playbackMode:
                          expression.sequence?.playbackMode ?? "timed",
                        fps: expression.sequence?.fps ?? 2,
                        loop: expression.sequence?.loop ?? true,
                        frames: [
                          ...(expression.sequence?.frames ?? [
                            {
                              id: stableId(),
                              assetId: expression.assetId,
                            },
                          ]),
                          ...frames,
                        ],
                      },
                    }
                  : expression,
              ),
            }
          : character,
      ),
    });
    setPicker(undefined);
  };

  const updateSequenceFrames = (
    updater: (
      frames: NonNullable<
        GalgameStoryCharacterExpression["sequence"]
      >["frames"],
    ) => NonNullable<GalgameStoryCharacterExpression["sequence"]>["frames"],
  ) => {
    if (!selectedCharacter || !selectedExpression?.sequence) return;
    const nextFrames = updater(selectedExpression.sequence.frames);
    if (!nextFrames.length) return;
    if (
      selectedExpression.sequence.playbackMode === "lipSync" &&
      nextFrames.length !== 3
    ) {
      onNotice("语音口型固定为闭口、半口和张口三帧。");
      return;
    }
    const nextCharacters = characters.map((character) =>
      character.id === selectedCharacter.id
        ? {
            ...character,
            expressions: (character.expressions ?? []).map((expression) =>
              expression.id === selectedExpression.id
                ? {
                    ...expression,
                    assetId: nextFrames[0].assetId,
                    sequence: { ...expression.sequence!, frames: nextFrames },
                  }
                : expression,
            ),
          }
        : character,
    );
    const usedPortraitAssets = characterPortraitAssetIds(nextCharacters);
    onDocument({
      ...document,
      characters: nextCharacters,
      assets: (document.assets ?? []).filter(
        (asset) =>
          asset.type !== "image" ||
          asset.role !== "characterPortrait" ||
          usedPortraitAssets.has(asset.id),
      ),
    });
  };

  const {
    bindFile,
    upload,
    batchUpload,
    sequenceBatchUpload,
    bindVoiceSample,
    voiceUpload,
    transferProgress,
  } = useCharacterAssetBindings({
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
  });

  const {
    deleteExpression,
    deleteSelectedExpressions,
    moveExpression,
    moveExpressionByOffset,
    deleteCharacter,
  } = useCharacterCollectionActions({
    document,
    characters,
    selectedCharacter,
    expressions,
    references,
    selectedExpressionIds,
    updateCharacter,
    onDocument,
    onNotice,
    setSelectedCharacterId,
    setSelectedExpressionId,
    setSelectedExpressionIds,
  });

  const {
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
    selectedFootprintHeight,
    selectedFootprintWidth,
  } = createCharacterViewModel({
    document,
    selectedCharacter,
    expressions,
    selectedExpression,
    previewExpression,
    selectedSkinAssetId,
    previewSkinAssetId,
    assetsById,
    projectAssets: projectAssetsQuery.data?.items ?? [],
    naturalPortraitSizes,
    previewSceneId,
    previewPositionId,
  });

  useEffect(() => {
    if (!previewPosition) return;
    if (previewPosition.id !== previewPositionId)
      setPreviewPositionId(previewPosition.id);
  }, [previewPosition, previewPositionId]);

  const stageWorkspace = (
    <CharacterStageWorkspace
      document={document}
      selectedCharacterId={selectedCharacter?.id}
      stageScopeId={stageScopeId}
      projectAssets={projectAssetsQuery.data?.items ?? []}
      portraitUpgradePreview={portraitPreview.data}
      portraitUpgradePending={portraitPreview.isPending}
      onStageScopeId={selectStageScope}
      onDocument={onDocument}
      onCommitDocument={onCommitDocument}
      onNotice={onNotice}
      onPreviewPortraitUpgrade={() => portraitPreview.mutate()}
      onApplyPortraitUpgrade={() => void onUpgradePortraitSizes()}
    />
  );
  const templatesWorkspace = (
    <CharacterTemplatesWorkspace
      document={document}
      characters={characters}
      onDocument={onDocument}
    />
  );

  return {
    transferProgress,
    projectId,
    document,
    onDocument,
    onLocate,
    onNotice,
    fileInput,
    voiceFileInput,
    characters,
    query,
    setQuery,
    setSelectedCharacterId,
    setSelectedExpressionId,
    selectedExpressionIds,
    setSelectedExpressionIds,
    lastExpressionIndex,
    setLastExpressionIndex,
    draggedCharacterId,
    setDraggedCharacterId,
    characterDropTarget,
    setCharacterDropTarget,
    draggedExpressionId,
    setDraggedExpressionId,
    expressionDropTarget,
    setExpressionDropTarget,
    selectedDisplayNameId,
    setSelectedDisplayNameId,
    selectedSkinId,
    setSelectedSkinId,
    tab,
    setTab,
    workspaceMode,
    setWorkspaceMode,
    stageScopeId,
    referenceTab,
    setReferenceTab,
    previewEnabled,
    setPreviewEnabled,
    previewBackgroundMode,
    setPreviewBackgroundMode,
    previewSceneId,
    setPreviewSceneId,
    setPreviewPositionId,
    setNaturalPortraitSizes,
    picker,
    setPicker,
    confirmStaticMode,
    setConfirmStaticMode,
    expandedExpressionPreview,
    setExpandedExpressionPreview,
    referencePanelOpen,
    setReferencePanelOpen,
    uploadError,
    projectAssetsQuery,
    voicePickerOpen,
    setVoicePickerOpen,
    voicePickerSource,
    setVoicePickerSource,
    selectedCharacter,
    expressions,
    selectedExpression,
    previewExpression,
    selectedDisplayName,
    selectedSkin,
    selectedSkinAssetId,
    previewSkinAssetId,
    references,
    expressionDetailLayout,
    fragmentCount,
    filtered,
    assetsById,
    usedFileIds,
    selectStageScope,
    updateCharacter,
    moveCharacter,
    moveCharacterByOffset,
    setDefaultExpression,
    updateExpression,
    switchExpressionToSequence,
    setSequencePlaybackMode,
    applyExpressionStaticMode,
    switchExpressionToStatic,
    appendExistingExpressionFrame,
    appendSequenceFiles,
    updateSequenceFrames,
    bindFile,
    upload,
    batchUpload,
    sequenceBatchUpload,
    bindVoiceSample,
    voiceUpload,
    deleteExpression,
    deleteSelectedExpressions,
    moveExpression,
    moveExpressionByOffset,
    deleteCharacter,
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
    selectedFootprintHeight,
    selectedFootprintWidth,
    stageWorkspace,
    templatesWorkspace,
  };
}
