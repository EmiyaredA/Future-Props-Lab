import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import {
  batchUploadGalgameProjectAssets,
  getGalgameProjectAssets,
  previewGalgamePortraitUpgrade,
  uploadGalgameProjectAsset,
  type GalgameStoryCharacter,
  type GalgameStoryCharacterExpression,
  type GalgameStoryProject,
  type GalgameStoryAudioAsset,
} from "@features/galgame-workshop/api";
import { dialogueSpeakerIds } from "@features/galgame-workshop/editor/dialogue";
import {
  characterStageSettings,
  stableId,
} from "@features/galgame-workshop/editor/model";
import { type StoryImagePickerState } from "@features/galgame-workshop/editor/StoryImagePicker";
import {
  portraitFootprintWidth,
  type PortraitNaturalSize,
} from "@features/galgame-workshop/editor/portraitSizing";
import { CharacterStageSettingsWorkspace } from "@features/galgame-workshop/editor/CharacterStageSettingsWorkspace";
import { type StoryAudioPickerSource } from "@features/galgame-workshop/editor/StoryAudioPicker";
import { CustomSelect } from "@shared/ui/CustomSelect";
type Reference = {
  kind: "dialogue" | "showCharacter" | "removeCharacter";
  chapterId: string;
  chapterTitle: string;
  fragmentId: string;
  fragmentTitle: string;
  blockId: string;
  blockIndex: number;
  text: string;
  expressionId?: string | null;
};

type CharacterWorkspaceMode = "character" | "stage" | "templates";

type CharacterReferenceTab = "preview" | "references";

type SortPlacement = "before" | "after";

type SortDropTarget = {
  id: string;
  placement: SortPlacement;
};

const CHARACTER_PALETTE = [
  "#E75B55",
  "#4AA3DF",
  "#46B978",
  "#A56DE2",
  "#E59B3D",
  "#D85E9D",
  "#32A6A0",
  "#7586E5",
];

const characterStageScopeKey = (projectId: string) =>
  `future_props_galgame_character_stage_scope:${projectId}`;

function reorderById<T extends { id: string }>(
  items: T[],
  sourceId: string,
  targetId: string,
  placement: SortPlacement,
) {
  if (sourceId === targetId) return items;
  const source = items.find((item) => item.id === sourceId);
  if (!source || !items.some((item) => item.id === targetId)) return items;
  const reordered = items.filter((item) => item.id !== sourceId);
  const targetIndex = reordered.findIndex((item) => item.id === targetId);
  reordered.splice(targetIndex + (placement === "after" ? 1 : 0), 0, source);
  return reordered;
}

function characterPortraitAssetIds(characters: GalgameStoryCharacter[]) {
  return new Set(
    characters.flatMap((character) => [
      ...(character.expressions ?? []).flatMap((expression) => [
        expression.assetId,
        ...(expression.sequence?.frames.map((frame) => frame.assetId) ?? []),
      ]),
      ...(character.portraitSkins ?? []).flatMap((skin) =>
        (skin.overrides ?? []).map((override) => override.assetId),
      ),
    ]),
  );
}

function referencesForCharacter(
  document: GalgameStoryProject,
  characterId: string,
) {
  const references: Reference[] = [];
  for (const chapter of document.chapters ?? []) {
    for (const fragment of chapter.fragments ?? []) {
      for (const [blockIndex, block] of (fragment.blocks ?? []).entries()) {
        if (
          (block.type !== "dialogue" &&
            block.type !== "showCharacter" &&
            block.type !== "removeCharacter") ||
          (block.type === "dialogue"
            ? !dialogueSpeakerIds(block).includes(characterId)
            : block.characterId !== characterId)
        )
          continue;
        references.push({
          kind: block.type,
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          fragmentId: fragment.id,
          fragmentTitle: fragment.title,
          blockId: block.id,
          blockIndex,
          text:
            block.type === "dialogue"
              ? block.text
              : block.type === "showCharacter"
                ? "角色登场 / 调整"
                : "角色退场",
          expressionId:
            block.type === "dialogue" || block.type === "showCharacter"
              ? block.expressionId
              : undefined,
        });
      }
    }
  }
  return references;
}

function displayLabel(filename: string, fallback: string) {
  const label = filename.replace(/\.[^.]+$/, "").trim();
  return label || fallback;
}

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
  const client = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const voiceFileInput = useRef<HTMLInputElement>(null);
  const characters = useMemo(
    () => document.characters ?? [],
    [document.characters],
  );
  const [query, setQuery] = useState("");
  const [selectedCharacterId, setSelectedCharacterId] = useState(
    characters[0]?.id,
  );
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
    queryKey: ["galgame-project-assets", projectId, ""],
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
            affectedBlockIds.has(block.id) &&
            (block.type === "dialogue" || block.type === "showCharacter")
              ? { ...block, expressionId: null }
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
      uploadGalgameProjectAsset(projectId, file, "character"),
    onSuccess: (asset) => {
      setUploadError("");
      void client.invalidateQueries({
        queryKey: ["galgame-project-assets", projectId],
      });
      bindFile(asset.id, asset.display_name);
    },
    onError: (caught) =>
      setUploadError(caught instanceof Error ? caught.message : "立绘上传失败"),
  });

  const batchUpload = useMutation({
    mutationFn: (files: File[]) =>
      batchUploadGalgameProjectAssets(projectId, files, "character"),
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
      void client.invalidateQueries({
        queryKey: ["galgame-project-assets", projectId],
      });
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
      return batchUploadGalgameProjectAssets(projectId, files, "character");
    },
    onSuccess: (result) => {
      appendSequenceFiles(
        result.items.map((file, index) => ({
          fileId: file.id,
          name: result.importItems[index]?.finalName ?? file.display_name,
        })),
      );
      setUploadError("");
      void client.invalidateQueries({
        queryKey: ["galgame-project-assets", projectId],
      });
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
    mutationFn: (file: File) => uploadGalgameProjectAsset(projectId, file),
    onSuccess: (asset) => {
      void client.invalidateQueries({
        queryKey: ["galgame-project-assets", projectId],
      });
      bindVoiceSample(asset.id, asset.display_name);
    },
    onError: (caught) =>
      onNotice(caught instanceof Error ? caught.message : "声线样本上传失败"),
  });

  const deleteExpression = (expression: GalgameStoryCharacterExpression) => {
    if (!selectedCharacter) return;
    const explicit = references.filter(
      (reference) => reference.expressionId === expression.id,
    );
    if (explicit.length) {
      onNotice(`无法删除：表情仍被 ${explicit.length} 处剧本演出显式引用。`);
      return;
    }
    if (
      selectedCharacter.defaultExpressionId === expression.id &&
      expressions.length > 1
    ) {
      onNotice("请先将其他表情设为默认，再删除当前默认表情。");
      return;
    }
    const remaining = expressions.filter((item) => item.id !== expression.id);
    const nextCharacters = characters.map((character) =>
      character.id === selectedCharacter.id
        ? {
            ...character,
            expressions: remaining,
            defaultExpressionId: remaining.length
              ? character.defaultExpressionId
              : null,
          }
        : character,
    );
    const usedPortraitAssets = characterPortraitAssetIds(nextCharacters);
    onDocument({
      ...document,
      assets: (document.assets ?? []).filter(
        (asset) =>
          asset.type !== "image" ||
          asset.role !== "characterPortrait" ||
          usedPortraitAssets.has(asset.id),
      ),
      characters: nextCharacters,
    });
    setSelectedExpressionId(remaining[0]?.id);
  };

  const deleteSelectedExpressions = () => {
    if (!selectedCharacter || !selectedExpressionIds.size) return;
    const selected = new Set(selectedExpressionIds);
    const referenced = references.filter(
      (reference) =>
        reference.expressionId && selected.has(reference.expressionId),
    );
    if (referenced.length) {
      onNotice(`无法批量删除：所选表情仍被 ${referenced.length} 处演出引用。`);
      return;
    }
    if (
      selectedCharacter.defaultExpressionId &&
      selected.has(selectedCharacter.defaultExpressionId)
    ) {
      onNotice("默认表情不能批量删除，请先指定新的默认表情。");
      return;
    }
    const remaining = expressions.filter(
      (expression) => !selected.has(expression.id),
    );
    const nextCharacters = characters.map((character) =>
      character.id === selectedCharacter.id
        ? { ...character, expressions: remaining }
        : character,
    );
    const usedPortraitAssets = characterPortraitAssetIds(nextCharacters);
    onDocument({
      ...document,
      assets: (document.assets ?? []).filter(
        (asset) =>
          asset.type !== "image" ||
          asset.role !== "characterPortrait" ||
          usedPortraitAssets.has(asset.id),
      ),
      characters: nextCharacters,
    });
    setSelectedExpressionIds(new Set());
    setSelectedExpressionId(remaining[0]?.id);
  };

  const moveExpression = (
    sourceId: string,
    targetId: string,
    placement: SortPlacement,
  ) => {
    if (!selectedCharacter) return;
    const reordered = reorderById(expressions, sourceId, targetId, placement);
    if (reordered === expressions) return;
    updateCharacter(selectedCharacter.id, (character) => ({
      ...character,
      expressions: reordered,
    }));
  };

  const moveExpressionByOffset = (expressionId: string, offset: -1 | 1) => {
    const sourceIndex = expressions.findIndex(
      (expression) => expression.id === expressionId,
    );
    const target = expressions[sourceIndex + offset];
    if (!target) return;
    moveExpression(expressionId, target.id, offset < 0 ? "before" : "after");
  };

  const deleteCharacter = () => {
    if (!selectedCharacter) return;
    if (references.length) {
      onNotice(`无法删除：角色仍被 ${references.length} 处剧本演出引用。`);
      return;
    }
    const remainingCharacters = characters.filter(
      (character) => character.id !== selectedCharacter.id,
    );
    const usedPortraitAssets = characterPortraitAssetIds(remainingCharacters);
    const characterStageOverrides = {
      ...(document.settings?.characterStageOverrides ?? {}),
    };
    delete characterStageOverrides[selectedCharacter.id];
    onDocument({
      ...document,
      characters: remainingCharacters,
      settings: {
        ...(document.settings ?? {}),
        characterStageOverrides,
      },
      assets: (document.assets ?? []).filter(
        (asset) =>
          asset.type !== "image" ||
          asset.role !== "characterPortrait" ||
          usedPortraitAssets.has(asset.id),
      ),
    });
    setSelectedCharacterId(remainingCharacters[0]?.id);
  };

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

  useEffect(() => {
    if (!previewPosition) return;
    if (previewPosition.id !== previewPositionId)
      setPreviewPositionId(previewPosition.id);
  }, [previewPosition, previewPositionId]);

  const portraitFileId = previewResolvedAsset?.fileId;
  const portraitMetadata = projectAssetsQuery.data?.items.find(
    (asset) => asset.id === portraitFileId,
  );
  const matchingNaturalPortraitSize = portraitFileId
    ? naturalPortraitSizes.get(portraitFileId)
    : undefined;
  const portraitWidth =
    portraitMetadata?.width ?? matchingNaturalPortraitSize?.width;
  const portraitHeight =
    portraitMetadata?.height ?? matchingNaturalPortraitSize?.height;
  const effectivePortraitHeight =
    previewExpression?.heightPercent ??
    selectedStageOverride?.defaultHeightPercent ??
    selectedCharacter?.portraitHeightPercent ??
    stageSettings.defaultHeightPercent;
  const canvasWidth = document.settings?.canvas?.width ?? 1920;
  const canvasHeight = document.settings?.canvas?.height ?? 1080;
  const footprintHeight = effectivePortraitHeight;
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
  const selectedPortraitMetadata = projectAssetsQuery.data?.items.find(
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
  const selectedFootprintHeight = selectedExpressionHeight;
  const selectedPortraitSize =
    selectedPortraitWidth && selectedPortraitHeight
      ? { width: selectedPortraitWidth, height: selectedPortraitHeight }
      : undefined;
  const cachedCharacterPortraitSize = expressions
    .map((expression) => assetsById.get(expression.assetId)?.fileId)
    .filter((fileId): fileId is string => Boolean(fileId))
    .map((fileId) => {
      const metadata = projectAssetsQuery.data?.items.find(
        (asset) => asset.id === fileId,
      );
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
  const stageWorkspace = (
    <CharacterStageSettingsWorkspace
      document={document}
      selectedCharacterId={selectedCharacter?.id}
      scopeId={stageScopeId}
      projectAssets={projectAssetsQuery.data?.items ?? []}
      portraitUpgradePreview={portraitPreview.data}
      portraitUpgradePending={portraitPreview.isPending}
      onScopeId={selectStageScope}
      onDocument={onDocument}
      onCommitDocument={onCommitDocument}
      onNotice={onNotice}
      onPreviewPortraitUpgrade={() => portraitPreview.mutate()}
      onApplyPortraitUpgrade={() => void onUpgradePortraitSizes()}
    />
  );
  const templatesWorkspace = (
    <div className="galgame-character-global-workspace galgame-character-template-workspace">
      <header>
        <span>
          <strong>角色属性模板</strong>
          <em>{document.characterAttributeTemplates?.length ?? 0}</em>
        </span>
        <button
          type="button"
          onClick={() => {
            const id = stableId();
            onDocument({
              ...document,
              characterAttributeTemplates: [
                ...(document.characterAttributeTemplates ?? []),
                {
                  id,
                  name: `属性 ${(document.characterAttributeTemplates?.length ?? 0) + 1}`,
                  type: "string",
                  defaultValue: "",
                  description: "",
                },
              ],
              characters: characters.map((character) => ({
                ...character,
                attributes: { ...(character.attributes ?? {}), [id]: "" },
              })),
            });
          }}
        >
          <Plus aria-hidden /> 新增属性
        </button>
      </header>
      <p>
        模板决定全部角色可填写的属性结构；修改会随 Story revision 自动保存。
      </p>
      <div className="galgame-character-template-table">
        <header>
          <span>属性</span>
          <span>类型</span>
          <span>模板默认值</span>
          <span>说明</span>
          <span />
        </header>
        {(document.characterAttributeTemplates ?? []).map((attribute) => (
          <div key={attribute.id}>
            <input
              aria-label={`${attribute.name}名称`}
              value={attribute.name}
              onChange={(event) =>
                onDocument({
                  ...document,
                  characterAttributeTemplates: (
                    document.characterAttributeTemplates ?? []
                  ).map((item) =>
                    item.id === attribute.id
                      ? { ...item, name: event.target.value }
                      : item,
                  ),
                })
              }
            />
            <CustomSelect
              ariaLabel={`${attribute.name}类型`}
              value={attribute.type}
              onChange={(value) => {
                const type = value as "string" | "number" | "boolean";
                const defaultValue =
                  type === "string" ? "" : type === "number" ? 0 : false;
                onDocument({
                  ...document,
                  characterAttributeTemplates: (
                    document.characterAttributeTemplates ?? []
                  ).map((item) =>
                    item.id === attribute.id
                      ? { ...item, type, defaultValue }
                      : item,
                  ),
                  characters: characters.map((character) => ({
                    ...character,
                    attributes: {
                      ...(character.attributes ?? {}),
                      [attribute.id]: defaultValue,
                    },
                  })),
                });
              }}
              options={[
                { value: "string", label: "文本" },
                { value: "number", label: "数值" },
                { value: "boolean", label: "开关" },
              ]}
            />
            {attribute.type === "boolean" ? (
              <input
                aria-label={`${attribute.name}默认值`}
                type="checkbox"
                checked={Boolean(attribute.defaultValue)}
                onChange={(event) =>
                  onDocument({
                    ...document,
                    characterAttributeTemplates: (
                      document.characterAttributeTemplates ?? []
                    ).map((item) =>
                      item.id === attribute.id
                        ? { ...item, defaultValue: event.target.checked }
                        : item,
                    ),
                  })
                }
              />
            ) : (
              <input
                aria-label={`${attribute.name}默认值`}
                type={attribute.type === "number" ? "number" : "text"}
                value={String(attribute.defaultValue)}
                onChange={(event) =>
                  onDocument({
                    ...document,
                    characterAttributeTemplates: (
                      document.characterAttributeTemplates ?? []
                    ).map((item) =>
                      item.id === attribute.id
                        ? {
                            ...item,
                            defaultValue:
                              attribute.type === "number"
                                ? Number(event.target.value)
                                : event.target.value,
                          }
                        : item,
                    ),
                  })
                }
              />
            )}
            <input
              aria-label={`${attribute.name}说明`}
              placeholder="属性用途说明"
              value={attribute.description ?? ""}
              onChange={(event) =>
                onDocument({
                  ...document,
                  characterAttributeTemplates: (
                    document.characterAttributeTemplates ?? []
                  ).map((item) =>
                    item.id === attribute.id
                      ? { ...item, description: event.target.value }
                      : item,
                  ),
                })
              }
            />
            <button
              type="button"
              className="danger"
              aria-label={`删除属性 ${attribute.name}`}
              onClick={() =>
                onDocument({
                  ...document,
                  characterAttributeTemplates: (
                    document.characterAttributeTemplates ?? []
                  ).filter((item) => item.id !== attribute.id),
                  characters: characters.map((character) => {
                    const attributes = { ...(character.attributes ?? {}) };
                    delete attributes[attribute.id];
                    return { ...character, attributes };
                  }),
                })
              }
            >
              <Trash2 aria-hidden />
            </button>
          </div>
        ))}
        {!document.characterAttributeTemplates?.length ? (
          <div className="galgame-character-template-empty">
            <strong>还没有角色属性模板</strong>
            <span>新增模板后，每个角色都可以填写对应的属性值。</span>
          </div>
        ) : null}
      </div>
    </div>
  );

  return {
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
