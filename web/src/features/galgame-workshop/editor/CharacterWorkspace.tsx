import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  FileImage,
  FolderOpen,
  GripVertical,
  ImagePlus,
  LocateFixed,
  Maximize2,
  Mic2,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Star,
  Trash2,
  Upload,
  UserRound,
  Volume2,
} from "lucide-react";
import {
  batchUploadGalgameProjectAssets,
  getGalgameProjectAssets,
  previewGalgamePortraitUpgrade,
  uploadGalgameProjectAsset,
  type GalgameStoryCharacter,
  type GalgameStoryCharacterExpression,
  type GalgameStoryProject,
  type GalgameStoryPositionPreset,
  type GalgameStoryAudioAsset,
} from "@features/galgame-workshop/api";
import { dialogueSpeakerIds } from "@features/galgame-workshop/editor/dialogue";
import {
  DEFAULT_CHARACTER_POSITION_PRESETS,
  stableId,
} from "@features/galgame-workshop/editor/model";
import {
  StoryImagePicker,
  type StoryImagePickerState,
} from "@features/galgame-workshop/editor/StoryImagePicker";
import { StoryAssetImage } from "@features/galgame-workshop/editor/StoryAssetImage";
import {
  StoryAudioPicker,
  type StoryAudioPickerSource,
} from "@features/galgame-workshop/editor/StoryAudioPicker";
import { StoryAudioPreview } from "@features/galgame-workshop/editor/StoryAudioPreview";

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

type CharacterWorkspaceMode = "character" | "positions" | "size" | "templates";

type CharacterReferenceTab = "preview" | "references";

const DEFAULT_CHARACTER_STAGE = {
  anchor: "center" as const,
  defaultPositionId: "position-center",
  defaultHeightPercent: 100,
  positionPresets: DEFAULT_CHARACTER_POSITION_PRESETS,
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

function CharacterAvatar({
  character,
  document,
}: {
  character: GalgameStoryCharacter;
  document: GalgameStoryProject;
}) {
  const expression = (character.expressions ?? []).find(
    (item) => item.id === character.defaultExpressionId,
  );
  const asset = (document.assets ?? []).find(
    (item) => item.id === expression?.assetId,
  );
  return (
    <span className="galgame-character-avatar">
      <StoryAssetImage
        fileId={asset?.fileId}
        alt=""
        fallback={<b>{character.name.slice(0, 1) || "角"}</b>}
      />
    </span>
  );
}

export function CharacterWorkspace({
  projectId,
  document,
  onDocument,
  onLocate,
  onNotice,
  focusCharacterId,
  onUpgradePortraitSizes,
}: {
  projectId: string;
  document: GalgameStoryProject;
  onDocument: (document: GalgameStoryProject) => void;
  onLocate: (fragmentId: string, blockId: string) => void;
  onNotice: (message: string) => void;
  focusCharacterId?: string;
  onUpgradePortraitSizes: () => Promise<boolean>;
}) {
  const client = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const voiceFileInput = useRef<HTMLInputElement>(null);
  const stageDragPointerId = useRef<number | null>(null);
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
  const [selectedDisplayNameId, setSelectedDisplayNameId] =
    useState<string>("main");
  const [selectedSkinId, setSelectedSkinId] = useState<string>();
  const [tab, setTab] = useState<
    "expressions" | "skins" | "displayNames" | "attributes" | "voice"
  >("expressions");
  const [workspaceMode, setWorkspaceMode] =
    useState<CharacterWorkspaceMode>("character");
  const [referenceTab, setReferenceTab] =
    useState<CharacterReferenceTab>("preview");
  const [previewEnabled, setPreviewEnabled] = useState(true);
  const [previewBackgroundMode, setPreviewBackgroundMode] = useState<
    "scene" | "dark" | "light" | "checkerboard"
  >("scene");
  const [selectedStagePositionId, setSelectedStagePositionId] =
    useState("position-center");
  const [previewSceneId, setPreviewSceneId] = useState(
    document.scenes?.[0]?.id ?? "",
  );
  const [previewPositionId, setPreviewPositionId] = useState("position-center");
  const [addingPositionPreset, setAddingPositionPreset] = useState(false);
  const [editingPositionPresetId, setEditingPositionPresetId] =
    useState<string>();
  const [positionNameDraft, setPositionNameDraft] = useState("");
  const [draggedPositionPresetId, setDraggedPositionPresetId] =
    useState<string>();
  const [naturalPortraitSize, setNaturalPortraitSize] = useState<{
    fileId: string;
    width: number;
    height: number;
  }>();
  const [picker, setPicker] = useState<StoryImagePickerState>();
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
  const references = selectedCharacter
    ? referencesForCharacter(document, selectedCharacter.id)
    : [];
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
    const assetStillUsed = characters.some((character) =>
      (character.expressions ?? []).some(
        (item) =>
          (character.id !== selectedCharacter.id ||
            item.id !== expression.id) &&
          item.assetId === expression.assetId,
      ),
    );
    onDocument({
      ...document,
      assets: assetStillUsed
        ? document.assets
        : (document.assets ?? []).filter(
            (asset) => asset.id !== expression.assetId,
          ),
      characters: characters.map((character) =>
        character.id === selectedCharacter.id
          ? {
              ...character,
              expressions: remaining,
              defaultExpressionId: remaining.length
                ? character.defaultExpressionId
                : null,
            }
          : character,
      ),
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
    const removedAssetIds = new Set(
      expressions
        .filter((expression) => selected.has(expression.id))
        .map((expression) => expression.assetId),
    );
    const remaining = expressions.filter(
      (expression) => !selected.has(expression.id),
    );
    const stillUsed = new Set(
      characters.flatMap((character) =>
        (character.expressions ?? [])
          .filter(
            (expression) =>
              character.id !== selectedCharacter.id ||
              !selected.has(expression.id),
          )
          .map((expression) => expression.assetId),
      ),
    );
    onDocument({
      ...document,
      assets: (document.assets ?? []).filter(
        (asset) => !removedAssetIds.has(asset.id) || stillUsed.has(asset.id),
      ),
      characters: characters.map((character) =>
        character.id === selectedCharacter.id
          ? { ...character, expressions: remaining }
          : character,
      ),
    });
    setSelectedExpressionIds(new Set());
    setSelectedExpressionId(remaining[0]?.id);
  };

  const moveExpression = (sourceId: string, targetId: string) => {
    if (!selectedCharacter || sourceId === targetId) return;
    const sourceIndex = expressions.findIndex((item) => item.id === sourceId);
    const targetIndex = expressions.findIndex((item) => item.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const reordered = [...expressions];
    const [moved] = reordered.splice(sourceIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    updateCharacter(selectedCharacter.id, (character) => ({
      ...character,
      expressions: reordered,
    }));
  };

  const deleteCharacter = () => {
    if (!selectedCharacter) return;
    if (references.length) {
      onNotice(`无法删除：角色仍被 ${references.length} 处剧本演出引用。`);
      return;
    }
    const expressionAssetIds = new Set(
      expressions.map((expression) => expression.assetId),
    );
    const remainingCharacters = characters.filter(
      (character) => character.id !== selectedCharacter.id,
    );
    const assetsUsedElsewhere = new Set(
      remainingCharacters.flatMap((character) =>
        (character.expressions ?? []).map((expression) => expression.assetId),
      ),
    );
    onDocument({
      ...document,
      characters: remainingCharacters,
      assets: (document.assets ?? []).filter(
        (asset) =>
          !expressionAssetIds.has(asset.id) ||
          assetsUsedElsewhere.has(asset.id),
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
  const stageSettings = {
    ...DEFAULT_CHARACTER_STAGE,
    ...document.settings?.characterStage,
    positionPresets: document.settings?.characterStage?.positionPresets?.length
      ? document.settings.characterStage.positionPresets
      : DEFAULT_CHARACTER_POSITION_PRESETS.map((preset) => ({ ...preset })),
  };
  const updateStageSettings = (next: typeof stageSettings) =>
    onDocument({
      ...document,
      settings: {
        ...(document.settings ?? {}),
        characterStage: next,
      },
    });
  const selectedStagePosition =
    stageSettings.positionPresets.find(
      (preset) => preset.id === selectedStagePositionId,
    ) ?? stageSettings.positionPresets[0];
  const previewPosition =
    stageSettings.positionPresets.find(
      (preset) => preset.id === previewPositionId,
    ) ?? selectedStagePosition;

  useEffect(() => {
    if (!selectedStagePosition) return;
    if (selectedStagePosition.id !== selectedStagePositionId)
      setSelectedStagePositionId(selectedStagePosition.id);
  }, [selectedStagePosition, selectedStagePositionId]);

  useEffect(() => {
    if (!previewPosition) return;
    if (previewPosition.id !== previewPositionId)
      setPreviewPositionId(previewPosition.id);
  }, [previewPosition, previewPositionId]);

  const updateStagePosition = (
    presetId: string,
    patch: Partial<Pick<GalgameStoryPositionPreset, "name" | "x" | "y">>,
  ) =>
    updateStageSettings({
      ...stageSettings,
      positionPresets: stageSettings.positionPresets.map((preset) =>
        preset.id === presetId ? { ...preset, ...patch } : preset,
      ),
    });
  const updateStageCoordinates = (requestedX: number, requestedY: number) => {
    if (!selectedStagePosition) return;
    updateStagePosition(selectedStagePosition.id, {
      x: Math.min(100, Math.max(0, Number(requestedX.toFixed(1)))),
      y: Math.min(100, Math.max(0, Number(requestedY.toFixed(1)))),
    });
  };
  const updateStagePoint = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    updateStageCoordinates(
      ((event.clientX - rect.left) / rect.width) * 100,
      ((event.clientY - rect.top) / rect.height) * 100,
    );
  };
  const moveStagePosition = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    const sourceIndex = stageSettings.positionPresets.findIndex(
      (preset) => preset.id === sourceId,
    );
    const targetIndex = stageSettings.positionPresets.findIndex(
      (preset) => preset.id === targetId,
    );
    if (sourceIndex < 0 || targetIndex < 0) return;
    const positionPresets = [...stageSettings.positionPresets];
    const [moved] = positionPresets.splice(sourceIndex, 1);
    positionPresets.splice(targetIndex, 0, moved);
    updateStageSettings({ ...stageSettings, positionPresets });
  };
  const submitPositionName = (presetId?: string) => {
    const name = positionNameDraft.trim();
    if (!name) {
      onNotice("位置预设名称不能为空。");
      return;
    }
    if (
      stageSettings.positionPresets.some(
        (preset) =>
          preset.id !== presetId &&
          preset.name.toLocaleLowerCase("zh-CN") ===
            name.toLocaleLowerCase("zh-CN"),
      )
    ) {
      onNotice("位置预设名称不能重复。");
      return;
    }
    if (presetId) {
      updateStagePosition(presetId, { name });
      setEditingPositionPresetId(undefined);
    } else {
      if (stageSettings.positionPresets.length >= 20) {
        onNotice("位置预设最多可创建 20 个。");
        return;
      }
      const id = stableId();
      updateStageSettings({
        ...stageSettings,
        positionPresets: [
          ...stageSettings.positionPresets,
          { id, name, x: 50, y: 50 },
        ],
      });
      setSelectedStagePositionId(id);
      setPreviewPositionId(id);
      setAddingPositionPreset(false);
    }
    setPositionNameDraft("");
  };
  const deleteSelectedStagePosition = () => {
    if (!selectedStagePosition || selectedStagePosition.builtinKey) return;
    const positionPresets = stageSettings.positionPresets.filter(
      (preset) => preset.id !== selectedStagePosition.id,
    );
    const fallback =
      positionPresets.find(
        (preset) => preset.id === stageSettings.defaultPositionId,
      ) ?? positionPresets[0];
    updateStageSettings({
      ...stageSettings,
      positionPresets,
      defaultPositionId:
        stageSettings.defaultPositionId === selectedStagePosition.id
          ? fallback.id
          : stageSettings.defaultPositionId,
    });
    setSelectedStagePositionId(fallback.id);
    if (previewPositionId === selectedStagePosition.id)
      setPreviewPositionId(fallback.id);
  };
  const resetStagePositions = () => {
    const hasCustom = stageSettings.positionPresets.some(
      (preset) => !preset.builtinKey,
    );
    if (
      hasCustom &&
      !window.confirm("恢复默认会删除所有自定义位置预设，是否继续？")
    )
      return;
    updateStageSettings({
      ...stageSettings,
      anchor: "center",
      defaultPositionId: "position-center",
      positionPresets: DEFAULT_CHARACTER_POSITION_PRESETS.map((preset) => ({
        ...preset,
      })),
    });
    setSelectedStagePositionId("position-center");
    setPreviewPositionId("position-center");
  };

  const portraitFileId = previewExpressionAsset?.fileId;
  const portraitMetadata = projectAssetsQuery.data?.items.find(
    (asset) => asset.id === portraitFileId,
  );
  const matchingNaturalPortraitSize =
    naturalPortraitSize?.fileId === portraitFileId
      ? naturalPortraitSize
      : undefined;
  const portraitWidth =
    portraitMetadata?.width ?? matchingNaturalPortraitSize?.width;
  const portraitHeight =
    portraitMetadata?.height ?? matchingNaturalPortraitSize?.height;
  const effectivePortraitHeight =
    previewExpression?.heightPercent ??
    selectedCharacter?.portraitHeightPercent ??
    stageSettings.defaultHeightPercent;
  const canvasWidth = document.settings?.canvas?.width ?? 1920;
  const canvasHeight = document.settings?.canvas?.height ?? 1080;
  const hasPortraitDimensions = Boolean(portraitWidth && portraitHeight);
  const footprintHeight = hasPortraitDimensions ? effectivePortraitHeight : 30;
  const footprintWidth =
    portraitWidth && portraitHeight
      ? effectivePortraitHeight *
        (portraitWidth / portraitHeight) *
        (canvasHeight / canvasWidth)
      : 30;
  const footprintSource = previewExpression?.heightPercent
    ? "表情高度"
    : selectedCharacter?.portraitHeightPercent
      ? "角色立绘高度"
      : "全局默认高度";
  const footprintTitle = hasPortraitDimensions
    ? `原图 ${portraitWidth} × ${portraitHeight}px · ${footprintSource} ${effectivePortraitHeight}%`
    : "当前素材缺少可用的图片尺寸元数据";

  const positionWorkspace = (
    <div className="galgame-character-global-workspace">
      <header>
        <span>
          <LocateFixed aria-hidden />
          <strong>位置预设</strong>
          <em>{stageSettings.positionPresets.length}</em>
        </span>
        <div>
          <button type="button" className="reset" onClick={resetStagePositions}>
            <RotateCcw aria-hidden /> 恢复默认
          </button>
          <button
            type="button"
            onClick={() => {
              setAddingPositionPreset(true);
              setEditingPositionPresetId(undefined);
              setPositionNameDraft("");
            }}
            disabled={stageSettings.positionPresets.length >= 20}
          >
            <Plus aria-hidden /> 新增
          </button>
          <button
            type="button"
            aria-label="删除位置预设"
            onClick={deleteSelectedStagePosition}
            disabled={
              !selectedStagePosition ||
              Boolean(selectedStagePosition.builtinKey)
            }
          >
            <Trash2 aria-hidden />
          </button>
        </div>
      </header>
      <div className="galgame-character-position-presets">
        {stageSettings.positionPresets.map((preset) => (
          <div
            key={preset.id}
            className={selectedStagePosition?.id === preset.id ? "active" : ""}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (draggedPositionPresetId)
                moveStagePosition(draggedPositionPresetId, preset.id);
              setDraggedPositionPresetId(undefined);
            }}
          >
            <button
              type="button"
              className="galgame-character-position-grip"
              aria-label={`移动位置预设 ${preset.name}`}
              draggable
              onDragStart={() => setDraggedPositionPresetId(preset.id)}
              onDragEnd={() => setDraggedPositionPresetId(undefined)}
              onKeyDown={(event) => {
                const index = stageSettings.positionPresets.findIndex(
                  (item) => item.id === preset.id,
                );
                const targetIndex =
                  event.key === "ArrowLeft"
                    ? index - 1
                    : event.key === "ArrowRight"
                      ? index + 1
                      : -1;
                const target = stageSettings.positionPresets[targetIndex];
                if (!target) return;
                event.preventDefault();
                moveStagePosition(preset.id, target.id);
              }}
            >
              <GripVertical aria-hidden />
            </button>
            {editingPositionPresetId === preset.id ? (
              <input
                aria-label="位置预设名称"
                autoFocus
                value={positionNameDraft}
                maxLength={40}
                onChange={(event) => setPositionNameDraft(event.target.value)}
                onBlur={() => submitPositionName(preset.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submitPositionName(preset.id);
                  if (event.key === "Escape") {
                    setEditingPositionPresetId(undefined);
                    setPositionNameDraft("");
                  }
                }}
              />
            ) : (
              <button
                type="button"
                className="galgame-character-position-select"
                onClick={() => {
                  setSelectedStagePositionId(preset.id);
                  setPreviewPositionId(preset.id);
                }}
                onDoubleClick={() => {
                  if (preset.builtinKey) return;
                  setEditingPositionPresetId(preset.id);
                  setPositionNameDraft(preset.name);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "F2" || preset.builtinKey) return;
                  event.preventDefault();
                  setEditingPositionPresetId(preset.id);
                  setPositionNameDraft(preset.name);
                }}
              >
                <strong>{preset.name}</strong>
                <small>
                  {preset.x}，{preset.y}
                </small>
              </button>
            )}
            {stageSettings.defaultPositionId === preset.id ? (
              <Star
                className="galgame-character-position-star"
                aria-label="默认位置"
              />
            ) : null}
          </div>
        ))}
        {addingPositionPreset ? (
          <form
            className="galgame-character-position-new"
            onSubmit={(event) => {
              event.preventDefault();
              submitPositionName();
            }}
          >
            <input
              aria-label="新增位置预设名称"
              autoFocus
              value={positionNameDraft}
              maxLength={40}
              placeholder="位置名称"
              onChange={(event) => setPositionNameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setAddingPositionPreset(false);
                  setPositionNameDraft("");
                }
              }}
            />
          </form>
        ) : null}
      </div>
      <div
        className="galgame-character-position-canvas"
        role="application"
        tabIndex={0}
        aria-label="角色位置与锚点可视化编辑器"
        onPointerDown={(event) => {
          if (event.pointerType === "mouse" && event.button !== 0) return;
          event.preventDefault();
          stageDragPointerId.current = event.pointerId;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          updateStagePoint(event);
        }}
        onPointerMove={(event) => {
          if (stageDragPointerId.current === event.pointerId)
            updateStagePoint(event);
        }}
        onPointerUp={(event) => {
          if (stageDragPointerId.current !== event.pointerId) return;
          updateStagePoint(event);
          stageDragPointerId.current = null;
          event.currentTarget.releasePointerCapture?.(event.pointerId);
        }}
        onPointerCancel={(event) => {
          if (stageDragPointerId.current !== event.pointerId) return;
          stageDragPointerId.current = null;
          event.currentTarget.releasePointerCapture?.(event.pointerId);
        }}
        onLostPointerCapture={(event) => {
          if (stageDragPointerId.current === event.pointerId)
            stageDragPointerId.current = null;
        }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 2.5 : 0.5;
          const delta = {
            ArrowLeft: [-step, 0],
            ArrowRight: [step, 0],
            ArrowUp: [0, -step],
            ArrowDown: [0, step],
          }[event.key];
          if (!delta) return;
          event.preventDefault();
          updateStageCoordinates(
            selectedStagePosition.x + delta[0],
            selectedStagePosition.y + delta[1],
          );
        }}
      >
        <span
          className={`galgame-character-position-footprint is-${stageSettings.anchor}`}
          title={footprintTitle}
          style={{
            left: `${selectedStagePosition.x}%`,
            top: `${selectedStagePosition.y}%`,
            width: `${footprintWidth}%`,
            height: `${footprintHeight}%`,
          }}
        >
          <em>
            {hasPortraitDimensions
              ? `${Number(footprintWidth.toFixed(1))}% × ${Number(footprintHeight.toFixed(1))}%`
              : "尺寸未知"}
          </em>
        </span>
        <span
          className="galgame-character-position-guide"
          style={{
            left: `${selectedStagePosition.x}%`,
            top: `${selectedStagePosition.y}%`,
          }}
        >
          <i />
          <em
            style={{
              left: selectedStagePosition.x > 80 ? "auto" : 12,
              right: selectedStagePosition.x > 80 ? 12 : "auto",
              top: selectedStagePosition.y > 85 ? "auto" : 13,
              bottom: selectedStagePosition.y > 85 ? 13 : "auto",
            }}
          >
            {selectedStagePosition.x}%，{selectedStagePosition.y}%
          </em>
        </span>
      </div>
      <footer className="galgame-character-position-fields">
        <strong className="galgame-character-anchor-label">锚点</strong>
        <div className="galgame-character-anchor-options">
          <button
            type="button"
            className={stageSettings.anchor === "center" ? "active" : ""}
            onClick={() =>
              updateStageSettings({ ...stageSettings, anchor: "center" })
            }
          >
            居中
          </button>
          <button
            type="button"
            className={stageSettings.anchor === "topLeft" ? "active" : ""}
            onClick={() =>
              updateStageSettings({ ...stageSettings, anchor: "topLeft" })
            }
          >
            左上
          </button>
        </div>
        <label className="is-position">
          <b>X</b>
          <input
            aria-label={`${selectedStagePosition.name}站位 X`}
            type="number"
            min="0"
            max="100"
            step="0.5"
            value={selectedStagePosition.x}
            onChange={(event) =>
              updateStageCoordinates(
                Number(event.target.value),
                selectedStagePosition.y,
              )
            }
          />
          <small>%</small>
        </label>
        <label>
          <b>Y</b>
          <input
            aria-label={`${selectedStagePosition.name}站位 Y`}
            type="number"
            min="0"
            max="100"
            step="0.5"
            value={selectedStagePosition.y}
            onChange={(event) =>
              updateStageCoordinates(
                selectedStagePosition.x,
                Number(event.target.value),
              )
            }
          />
          <small>%</small>
        </label>
        <button
          type="button"
          className="galgame-character-default-position"
          onClick={() =>
            updateStageSettings({
              ...stageSettings,
              defaultPositionId: selectedStagePosition.id,
            })
          }
          disabled={
            stageSettings.defaultPositionId === selectedStagePosition.id
          }
        >
          <Star aria-hidden /> 默认位置
        </button>
      </footer>
    </div>
  );

  const sizeWorkspace = (
    <div className="galgame-character-global-workspace galgame-character-size-workspace">
      <header>
        <span>
          <strong>全局默认尺寸</strong>
          <small>用于没有单独覆盖尺寸的立绘</small>
        </span>
        <button
          type="button"
          onClick={() =>
            updateStageSettings({
              ...stageSettings,
              defaultHeightPercent:
                DEFAULT_CHARACTER_STAGE.defaultHeightPercent,
            })
          }
        >
          <RotateCcw aria-hidden /> 恢复默认
        </button>
      </header>
      <section>
        <strong>默认尺寸按素材原始宽高比换算</strong>
        <label>
          <span>画面高度</span>
          <input
            aria-label="默认画面高度"
            type="number"
            min="1"
            max="400"
            value={stageSettings.defaultHeightPercent}
            onChange={(event) =>
              updateStageSettings({
                ...stageSettings,
                defaultHeightPercent: Math.min(
                  400,
                  Math.max(1, Number(event.target.value)),
                ),
              })
            }
          />
          <em>%</em>
        </label>
        <p>立绘宽度会保持素材原始比例；角色和表情级尺寸仍可覆盖此默认值。</p>
      </section>
      <section className="galgame-character-size-preview">
        <span
          style={{
            height: `${Math.min(stageSettings.defaultHeightPercent, 140)}%`,
          }}
        >
          <UserRound aria-hidden />
        </span>
      </section>
      <section className="galgame-portrait-maintenance">
        <header>
          <strong>旧立绘尺寸维护</strong>
          <button
            type="button"
            onClick={() => portraitPreview.mutate()}
            disabled={portraitPreview.isPending}
          >
            {portraitPreview.isPending ? "正在扫描…" : "预览旧立绘尺寸升级"}
          </button>
        </header>
        {portraitPreview.data ? (
          <div className="galgame-portrait-upgrade-preview">
            <small>
              可升级{" "}
              {
                portraitPreview.data.items.filter(
                  (item) => item.status === "ready",
                ).length
              }{" "}
              项，缺少尺寸{" "}
              {
                portraitPreview.data.items.filter(
                  (item) => item.status === "missing_metadata",
                ).length
              }{" "}
              项。
            </small>
            <ul>
              {portraitPreview.data.items.slice(0, 6).map((item) => (
                <li key={`${item.characterId}:${item.expressionId}`}>
                  {item.expressionId.slice(0, 8)}：
                  {item.status === "ready"
                    ? `${item.currentHeightPercent ?? "旧模式"} → ${item.targetHeightPercent}%`
                    : "保留旧模式（无法读取尺寸）"}
                </li>
              ))}
            </ul>
            <button
              type="button"
              disabled={
                !portraitPreview.data.items.some(
                  (item) => item.status === "ready",
                )
              }
              onClick={() => void onUpgradePortraitSizes()}
            >
              确认应用并保存快照
            </button>
          </div>
        ) : null}
      </section>
    </div>
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
            <select
              aria-label={`${attribute.name}类型`}
              value={attribute.type}
              onChange={(event) => {
                const type = event.target.value as
                  "string" | "number" | "boolean";
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
            >
              <option value="string">文本</option>
              <option value="number">数值</option>
              <option value="boolean">开关</option>
            </select>
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

  return (
    <section className="galgame-character-workspace">
      <header className="galgame-character-workspace-header">
        <span>
          <UserRound aria-hidden />
          <strong>角色</strong>
          <em>{characters.length} 项</em>
        </span>
      </header>
      <aside className="galgame-character-list-panel">
        <section className="galgame-character-global-navigation">
          <small>全局设置</small>
          <button
            type="button"
            className={workspaceMode === "positions" ? "active" : ""}
            onClick={() => setWorkspaceMode("positions")}
          >
            <SlidersHorizontal aria-hidden />
            <span>位置与锚点</span>
          </button>
          <button
            type="button"
            className={workspaceMode === "size" ? "active" : ""}
            onClick={() => setWorkspaceMode("size")}
          >
            <Maximize2 aria-hidden />
            <span>默认尺寸</span>
          </button>
          <button
            type="button"
            className={workspaceMode === "templates" ? "active" : ""}
            onClick={() => setWorkspaceMode("templates")}
          >
            <span aria-hidden>#</span>
            <span>属性模板</span>
          </button>
        </section>
        <header className="galgame-character-list-heading">
          <span>
            <strong>角色列表</strong>
            <em>
              {characters.length} 个角色 ·{" "}
              {characters.reduce(
                (count, character) =>
                  count + (character.expressions?.length ?? 0),
                0,
              )}{" "}
              个表情
            </em>
          </span>
          <button
            type="button"
            aria-label="新建角色"
            onClick={() => {
              const id = stableId();
              onDocument({
                ...document,
                characters: [
                  ...characters,
                  {
                    id,
                    name: "新角色",
                    description: "",
                    themeColor:
                      CHARACTER_PALETTE[
                        characters.length % CHARACTER_PALETTE.length
                      ],
                    expressions: [],
                    defaultExpressionId: null,
                    attributes: Object.fromEntries(
                      (document.characterAttributeTemplates ?? []).map(
                        (attribute) => [attribute.id, attribute.defaultValue],
                      ),
                    ),
                  },
                ],
              });
              setSelectedCharacterId(id);
              setSelectedExpressionId(undefined);
              setSelectedExpressionIds(new Set());
              setLastExpressionIndex(undefined);
              setSelectedDisplayNameId("main");
              setSelectedSkinId(undefined);
              setWorkspaceMode("character");
              setTab("expressions");
            }}
          >
            <Plus aria-hidden />
          </button>
        </header>
        <label className="galgame-character-search">
          <Search aria-hidden />
          <input
            aria-label="搜索角色"
            value={query}
            placeholder="搜索角色…"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="galgame-character-list">
          {filtered.map((character) => {
            const count = referencesForCharacter(document, character.id).length;
            return (
              <button
                key={character.id}
                type="button"
                className={
                  character.id === selectedCharacter?.id ? "active" : ""
                }
                style={
                  {
                    "--character-theme": character.themeColor ?? "#E75B55",
                  } as CSSProperties
                }
                onClick={() => {
                  setSelectedCharacterId(character.id);
                  setSelectedExpressionId(undefined);
                  setSelectedExpressionIds(new Set());
                  setLastExpressionIndex(undefined);
                  setSelectedDisplayNameId("main");
                  setSelectedSkinId(undefined);
                  setWorkspaceMode("character");
                  setTab("expressions");
                }}
              >
                <CharacterAvatar character={character} document={document} />
                <span>
                  <strong>{character.name}</strong>
                  <small>
                    {character.expressions?.length ?? 0} 个表情 · {count} 处引用
                  </small>
                </span>
                <ChevronRight aria-hidden />
              </button>
            );
          })}
        </div>
      </aside>

      <main className="galgame-character-detail-panel">
        {workspaceMode === "positions" ? (
          positionWorkspace
        ) : workspaceMode === "size" ? (
          sizeWorkspace
        ) : workspaceMode === "templates" ? (
          templatesWorkspace
        ) : selectedCharacter ? (
          <>
            <header>
              <div className="galgame-character-current-summary">
                <CharacterAvatar
                  character={selectedCharacter}
                  document={document}
                />
                <span>
                  <strong>{selectedCharacter.name}</strong>
                  <small>{expressions.length} 个表情</small>
                </span>
              </div>
              <nav aria-label="角色资料分类">
                <button
                  type="button"
                  className={tab === "expressions" ? "active" : ""}
                  onClick={() => setTab("expressions")}
                >
                  表情资源 <em>{expressions.length}</em>
                </button>
                <button
                  type="button"
                  className={tab === "skins" ? "active" : ""}
                  onClick={() => {
                    setTab("skins");
                    setSelectedSkinId(
                      selectedCharacter.defaultPortraitSkinId ??
                        selectedCharacter.portraitSkins?.[0]?.id,
                    );
                  }}
                >
                  立绘皮肤{" "}
                  <em>{selectedCharacter.portraitSkins?.length ?? 0}</em>
                </button>
                <button
                  type="button"
                  className={tab === "displayNames" ? "active" : ""}
                  onClick={() => {
                    setTab("displayNames");
                    setSelectedDisplayNameId("main");
                  }}
                >
                  显示名 <em>{selectedCharacter.displayNames?.length ?? 0}</em>
                </button>
                <button
                  type="button"
                  className={tab === "attributes" ? "active" : ""}
                  onClick={() => setTab("attributes")}
                >
                  角色属性{" "}
                  <em>{document.characterAttributeTemplates?.length ?? 0}</em>
                </button>
              </nav>
            </header>
            {tab === "displayNames" || tab === "attributes" ? (
              <div
                className={`galgame-character-base-form is-${tab} ${
                  tab === "displayNames"
                    ? selectedDisplayNameId === "main"
                      ? "is-main"
                      : "is-scheme"
                    : ""
                }`}
              >
                {tab === "displayNames" ? (
                  <section className="galgame-display-name-browser">
                    <header>
                      <span>
                        <strong>可用名字</strong>
                        <small>选择后在下方编辑</small>
                      </span>
                      <div>
                        <button
                          type="button"
                          onClick={() => {
                            const id = stableId();
                            updateCharacter(
                              selectedCharacter.id,
                              (character) => ({
                                ...character,
                                displayNames: [
                                  ...(character.displayNames ?? []),
                                  {
                                    id,
                                    label: `别名 ${(character.displayNames?.length ?? 0) + 1}`,
                                    source: "literal",
                                    value: character.name,
                                    variableId: null,
                                  },
                                ],
                              }),
                            );
                            setSelectedDisplayNameId(id);
                          }}
                        >
                          <Plus aria-hidden /> 别名
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const id = stableId();
                            updateCharacter(
                              selectedCharacter.id,
                              (character) => ({
                                ...character,
                                displayNames: [
                                  ...(character.displayNames ?? []),
                                  {
                                    id,
                                    label: `变量值 ${(character.displayNames?.length ?? 0) + 1}`,
                                    source: "variable",
                                    value: null,
                                    variableId:
                                      document.variables?.find(
                                        (variable) =>
                                          variable.type === "string",
                                      )?.id ?? null,
                                  },
                                ],
                              }),
                            );
                            setSelectedDisplayNameId(id);
                          }}
                        >
                          <span aria-hidden>#</span> 变量值
                        </button>
                      </div>
                    </header>
                    <div>
                      <button
                        type="button"
                        className={
                          selectedDisplayNameId === "main" ? "active" : ""
                        }
                        onClick={() => setSelectedDisplayNameId("main")}
                      >
                        <span>
                          <UserRound aria-hidden />
                          <small>主名称</small>
                        </span>
                        <strong>{selectedCharacter.name}</strong>
                        <Check aria-hidden />
                      </button>
                      {(selectedCharacter.displayNames ?? []).map((scheme) => (
                        <button
                          key={scheme.id}
                          type="button"
                          className={
                            selectedDisplayNameId === scheme.id ? "active" : ""
                          }
                          onClick={() => setSelectedDisplayNameId(scheme.id)}
                        >
                          <span>
                            <span aria-hidden>#</span>
                            <small>{scheme.label}</small>
                          </span>
                          <strong>
                            {scheme.source === "literal"
                              ? scheme.value || "未填写"
                              : scheme.source === "variable"
                                ? "字符串变量"
                                : "角色属性"}
                          </strong>
                          {selectedCharacter.defaultDisplayNameId ===
                          scheme.id ? (
                            <em>默认</em>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null}
                <label className="galgame-field">
                  <span>角色名称</span>
                  <input
                    value={selectedCharacter.name}
                    onChange={(event) =>
                      updateCharacter(selectedCharacter.id, (character) => ({
                        ...character,
                        name: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="galgame-field">
                  <span>设定说明</span>
                  <textarea
                    value={selectedCharacter.description}
                    onChange={(event) =>
                      updateCharacter(selectedCharacter.id, (character) => ({
                        ...character,
                        description: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="galgame-field">
                  <span>角色 ID（只读）</span>
                  <input value={selectedCharacter.id} readOnly />
                </label>
                <label className="galgame-field galgame-character-theme-field">
                  <span>角色主题色</span>
                  <input
                    type="color"
                    value={selectedCharacter.themeColor ?? "#E75B55"}
                    onChange={(event) =>
                      updateCharacter(selectedCharacter.id, (character) => ({
                        ...character,
                        themeColor: event.target.value,
                      }))
                    }
                  />
                </label>
                <section className="galgame-character-official-settings galgame-display-name-editor">
                  <header>
                    <span>
                      <strong>
                        {selectedDisplayName?.label ?? "显示名方案"}
                      </strong>
                      <small>设置对白中实际显示的角色名称</small>
                    </span>
                    {selectedDisplayName ? (
                      <button
                        type="button"
                        disabled={
                          selectedCharacter.defaultDisplayNameId ===
                          selectedDisplayName.id
                        }
                        onClick={() => {
                          updateCharacter(
                            selectedCharacter.id,
                            (character) => ({
                              ...character,
                              defaultDisplayNameId: selectedDisplayName.id,
                            }),
                          );
                        }}
                      >
                        <Check aria-hidden /> 设为默认
                      </button>
                    ) : null}
                  </header>
                  {(selectedCharacter.displayNames ?? [])
                    .filter((scheme) => scheme.id === selectedDisplayNameId)
                    .map((scheme) => (
                      <div key={scheme.id} className="galgame-display-name-row">
                        <input
                          aria-label="显示名方案名称"
                          value={scheme.label}
                          onChange={(event) =>
                            updateCharacter(
                              selectedCharacter.id,
                              (character) => ({
                                ...character,
                                displayNames: (
                                  character.displayNames ?? []
                                ).map((item) =>
                                  item.id === scheme.id
                                    ? { ...item, label: event.target.value }
                                    : item,
                                ),
                              }),
                            )
                          }
                        />
                        <select
                          aria-label="显示名来源"
                          value={scheme.source}
                          onChange={(event) =>
                            updateCharacter(
                              selectedCharacter.id,
                              (character) => ({
                                ...character,
                                displayNames: (
                                  character.displayNames ?? []
                                ).map((item) =>
                                  item.id === scheme.id
                                    ? event.target.value === "variable"
                                      ? {
                                          ...item,
                                          source: "variable",
                                          value: null,
                                          attributeId: null,
                                          variableId:
                                            document.variables?.find(
                                              (variable) =>
                                                variable.type === "string",
                                            )?.id ?? null,
                                        }
                                      : event.target.value === "attribute"
                                        ? {
                                            ...item,
                                            source: "attribute",
                                            value: null,
                                            variableId: null,
                                            attributeId:
                                              document.characterAttributeTemplates?.find(
                                                (attribute) =>
                                                  attribute.type === "string",
                                              )?.id ?? null,
                                          }
                                        : {
                                            ...item,
                                            source: "literal",
                                            value: selectedCharacter.name,
                                            variableId: null,
                                            attributeId: null,
                                          }
                                    : item,
                                ),
                              }),
                            )
                          }
                        >
                          <option value="literal">固定名称</option>
                          <option value="variable">字符串变量</option>
                          <option value="attribute">角色属性</option>
                        </select>
                        {scheme.source === "variable" ? (
                          <select
                            aria-label="显示名变量"
                            value={scheme.variableId ?? ""}
                            onChange={(event) =>
                              updateCharacter(
                                selectedCharacter.id,
                                (character) => ({
                                  ...character,
                                  displayNames: (
                                    character.displayNames ?? []
                                  ).map((item) =>
                                    item.id === scheme.id
                                      ? {
                                          ...item,
                                          variableId:
                                            event.target.value || null,
                                        }
                                      : item,
                                  ),
                                }),
                              )
                            }
                          >
                            <option value="">选择变量</option>
                            {(document.variables ?? [])
                              .filter((variable) => variable.type === "string")
                              .map((variable) => (
                                <option key={variable.id} value={variable.id}>
                                  {variable.name}
                                </option>
                              ))}
                          </select>
                        ) : scheme.source === "attribute" ? (
                          <select
                            aria-label="显示名角色属性"
                            value={scheme.attributeId ?? ""}
                            onChange={(event) =>
                              updateCharacter(
                                selectedCharacter.id,
                                (character) => ({
                                  ...character,
                                  displayNames: (
                                    character.displayNames ?? []
                                  ).map((item) =>
                                    item.id === scheme.id
                                      ? {
                                          ...item,
                                          attributeId:
                                            event.target.value || null,
                                        }
                                      : item,
                                  ),
                                }),
                              )
                            }
                          >
                            <option value="">选择属性</option>
                            {(document.characterAttributeTemplates ?? [])
                              .filter(
                                (attribute) => attribute.type === "string",
                              )
                              .map((attribute) => (
                                <option key={attribute.id} value={attribute.id}>
                                  {attribute.name}
                                </option>
                              ))}
                          </select>
                        ) : (
                          <input
                            aria-label="固定显示名"
                            value={scheme.value ?? ""}
                            onChange={(event) =>
                              updateCharacter(
                                selectedCharacter.id,
                                (character) => ({
                                  ...character,
                                  displayNames: (
                                    character.displayNames ?? []
                                  ).map((item) =>
                                    item.id === scheme.id
                                      ? { ...item, value: event.target.value }
                                      : item,
                                  ),
                                }),
                              )
                            }
                          />
                        )}
                        <button
                          type="button"
                          className="danger"
                          aria-label={`删除显示名 ${scheme.label}`}
                          onClick={() => {
                            updateCharacter(
                              selectedCharacter.id,
                              (character) => ({
                                ...character,
                                displayNames: (
                                  character.displayNames ?? []
                                ).filter((item) => item.id !== scheme.id),
                                defaultDisplayNameId:
                                  character.defaultDisplayNameId === scheme.id
                                    ? null
                                    : character.defaultDisplayNameId,
                              }),
                            );
                            setSelectedDisplayNameId("main");
                          }}
                        >
                          <Trash2 aria-hidden />
                        </button>
                      </div>
                    ))}
                </section>
                <section className="galgame-character-official-settings galgame-character-dialogue-avatar-settings">
                  <header>
                    <strong>仅对白头像</strong>
                  </header>
                  <label className="galgame-stage-checkbox">
                    <input
                      type="checkbox"
                      checked={
                        selectedCharacter.dialogueAvatar?.enabled ?? false
                      }
                      onChange={(event) =>
                        updateCharacter(selectedCharacter.id, (character) => ({
                          ...character,
                          dialogueAvatar: {
                            enabled: event.target.checked,
                          },
                        }))
                      }
                    />
                    <span>允许对白使用头像模式</span>
                  </label>
                  <div className="galgame-avatar-crop-grid">
                    {(["x", "y", "scale"] as const).map((key) => (
                      <label key={key}>
                        <span>
                          {key === "scale"
                            ? "缩放"
                            : `裁切 ${key.toUpperCase()}`}
                        </span>
                        <input
                          type="number"
                          min={key === "scale" ? 0.5 : 0}
                          max={key === "scale" ? 6 : 100}
                          step={key === "scale" ? 0.1 : 1}
                          value={
                            selectedExpression?.dialogueAvatar?.crop?.[key] ??
                            { x: 50, y: 25, scale: 1.8 }[key]
                          }
                          onChange={(event) =>
                            updateCharacter(
                              selectedCharacter.id,
                              (character) => ({
                                ...character,
                                expressions: (character.expressions ?? []).map(
                                  (expression) =>
                                    expression.id === selectedExpression?.id
                                      ? {
                                          ...expression,
                                          dialogueAvatar: {
                                            ...(expression.dialogueAvatar ?? {
                                              source: "portrait" as const,
                                              crop: {
                                                x: 50,
                                                y: 25,
                                                scale: 1.8,
                                              },
                                            }),
                                            crop: {
                                              ...(expression.dialogueAvatar
                                                ?.crop ?? {
                                                x: 50,
                                                y: 25,
                                                scale: 1.8,
                                              }),
                                              [key]: Number(event.target.value),
                                            },
                                          },
                                        }
                                      : expression,
                                ),
                              }),
                            )
                          }
                        />
                      </label>
                    ))}
                  </div>
                </section>
                <section className="galgame-character-attributes">
                  <header>
                    <span>
                      <strong>角色属性</strong>
                      <small>{selectedCharacter.name} · 当前角色覆盖值</small>
                    </span>
                    <div>
                      <button
                        type="button"
                        onClick={() =>
                          updateCharacter(
                            selectedCharacter.id,
                            (character) => ({
                              ...character,
                              attributes: Object.fromEntries(
                                (
                                  document.characterAttributeTemplates ?? []
                                ).map((attribute) => [
                                  attribute.id,
                                  attribute.defaultValue,
                                ]),
                              ),
                            }),
                          )
                        }
                      >
                        <RotateCcw aria-hidden /> 恢复默认
                      </button>
                      <button
                        type="button"
                        onClick={() => setWorkspaceMode("templates")}
                      >
                        管理属性
                      </button>
                    </div>
                  </header>
                  <p>
                    属性结构由全局模板统一维护；这里仅覆盖当前角色的默认值。
                  </p>
                  {(document.characterAttributeTemplates ?? []).map(
                    (attribute) => (
                      <div key={attribute.id}>
                        <span>
                          <strong>
                            {attribute.name} <em>{attribute.type}</em>
                          </strong>
                          <small>
                            {attribute.description || attribute.type}
                          </small>
                        </span>
                        {attribute.type === "boolean" ? (
                          <input
                            aria-label={`${attribute.name}值`}
                            type="checkbox"
                            checked={Boolean(
                              selectedCharacter.attributes?.[attribute.id],
                            )}
                            onChange={(event) =>
                              updateCharacter(
                                selectedCharacter.id,
                                (character) => ({
                                  ...character,
                                  attributes: {
                                    ...(character.attributes ?? {}),
                                    [attribute.id]: event.target.checked,
                                  },
                                }),
                              )
                            }
                          />
                        ) : (
                          <input
                            aria-label={`${attribute.name}值`}
                            type={
                              attribute.type === "number" ? "number" : "text"
                            }
                            value={String(
                              selectedCharacter.attributes?.[attribute.id] ??
                                attribute.defaultValue,
                            )}
                            onChange={(event) =>
                              updateCharacter(
                                selectedCharacter.id,
                                (character) => ({
                                  ...character,
                                  attributes: {
                                    ...(character.attributes ?? {}),
                                    [attribute.id]:
                                      attribute.type === "number"
                                        ? Number(event.target.value)
                                        : event.target.value,
                                  },
                                }),
                              )
                            }
                          />
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            updateCharacter(
                              selectedCharacter.id,
                              (character) => {
                                const attributes = {
                                  ...(character.attributes ?? {}),
                                };
                                delete attributes[attribute.id];
                                return { ...character, attributes };
                              },
                            )
                          }
                        >
                          清除
                        </button>
                      </div>
                    ),
                  )}
                  {!document.characterAttributeTemplates?.length ? (
                    <div className="galgame-character-attribute-empty">
                      还没有属性模板，请先前往全局设置创建。
                    </div>
                  ) : null}
                </section>
                <small>修改将在 650ms 后自动保存。</small>
              </div>
            ) : tab === "expressions" || tab === "skins" ? (
              <div className={`galgame-portrait-editor is-${tab}`}>
                <div className="galgame-portrait-stage-column">
                  {selectedExpression ? (
                    <>
                      <div className="galgame-portrait-stage">
                        <StoryAssetImage
                          fileId={activeAsset?.fileId}
                          alt={`${selectedCharacter.name} · ${selectedExpression.label}`}
                          fallback={
                            <span>
                              <UserRound aria-hidden />
                              <strong>尚未绑定基准立绘</strong>
                              <small>上传图片或从文件库选择。</small>
                            </span>
                          }
                        />
                      </div>
                      <div className="galgame-portrait-actions">
                        <button
                          type="button"
                          onClick={() => {
                            setPicker({
                              mode: "replace",
                              source: "project",
                            });
                            requestAnimationFrame(() =>
                              fileInput.current?.click(),
                            );
                          }}
                        >
                          <Upload aria-hidden /> 替换立绘
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setPicker({
                              mode: "replace",
                              source: "library",
                            })
                          }
                        >
                          <FolderOpen aria-hidden /> 从文件库选择
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="galgame-expression-detail-empty">
                      <FileImage aria-hidden />
                      <span>选择一个表情查看详情</span>
                    </div>
                  )}
                  <input
                    ref={fileInput}
                    hidden
                    type="file"
                    multiple
                    accept=".jpg,.jpeg,.png,.webp,.avif"
                    onChange={(event) => {
                      const files = [...(event.target.files ?? [])];
                      if (files.length === 1 && picker?.mode === "replace")
                        upload.mutate(files[0]);
                      else if (files.length) batchUpload.mutate(files);
                      event.target.value = "";
                    }}
                  />
                  {upload.isPending || batchUpload.isPending ? (
                    <small>正在导入立绘…</small>
                  ) : null}
                  {uploadError ? (
                    <small className="danger">{uploadError}</small>
                  ) : null}
                </div>
                <div className="galgame-expression-column">
                  <label className="galgame-expression-avatar-toggle">
                    <span className="galgame-expression-avatar-icon">
                      <UserRound aria-hidden />
                    </span>
                    <strong>对白头像</strong>
                    <input
                      type="checkbox"
                      checked={
                        selectedCharacter.dialogueAvatar?.enabled ?? false
                      }
                      onChange={(event) =>
                        updateCharacter(selectedCharacter.id, (character) => ({
                          ...character,
                          dialogueAvatar: { enabled: event.target.checked },
                        }))
                      }
                    />
                    <i aria-hidden />
                  </label>
                  <div className="galgame-expression-grid">
                    {selectedExpressionIds.size > 1 ? (
                      <div className="galgame-expression-selection-actions">
                        <span>已选择 {selectedExpressionIds.size} 个表情</span>
                        <button
                          type="button"
                          className="danger"
                          onClick={deleteSelectedExpressions}
                        >
                          <Trash2 aria-hidden /> 删除所选（
                          {selectedExpressionIds.size}）
                        </button>
                      </div>
                    ) : null}
                    {expressions.map((expression) => {
                      const asset = assetsById.get(expression.assetId);
                      return (
                        <button
                          key={expression.id}
                          type="button"
                          draggable
                          className={
                            expression.id === selectedExpression?.id ||
                            selectedExpressionIds.has(expression.id)
                              ? "active"
                              : ""
                          }
                          onClick={(event) => {
                            const index = expressions.findIndex(
                              (item) => item.id === expression.id,
                            );
                            if (event.shiftKey && lastExpressionIndex != null) {
                              const [start, end] = [
                                lastExpressionIndex,
                                index,
                              ].sort((left, right) => left - right);
                              setSelectedExpressionIds(
                                new Set(
                                  expressions
                                    .slice(start, end + 1)
                                    .map((item) => item.id),
                                ),
                              );
                            } else if (event.metaKey || event.ctrlKey) {
                              setSelectedExpressionIds((current) => {
                                const next = new Set(current);
                                if (next.has(expression.id))
                                  next.delete(expression.id);
                                else next.add(expression.id);
                                return next;
                              });
                            } else {
                              setSelectedExpressionIds(
                                new Set([expression.id]),
                              );
                            }
                            setSelectedExpressionId(expression.id);
                            setLastExpressionIndex(index);
                          }}
                          onDoubleClick={() => {
                            const label = window
                              .prompt("重命名表情", expression.label)
                              ?.trim();
                            if (!label) return;
                            updateCharacter(
                              selectedCharacter.id,
                              (character) => ({
                                ...character,
                                expressions: (character.expressions ?? []).map(
                                  (item) =>
                                    item.id === expression.id
                                      ? { ...item, label }
                                      : item,
                                ),
                              }),
                            );
                          }}
                          onDragStart={(event) =>
                            event.dataTransfer.setData(
                              "application/x-galgame-expression",
                              expression.id,
                            )
                          }
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => {
                            event.preventDefault();
                            moveExpression(
                              event.dataTransfer.getData(
                                "application/x-galgame-expression",
                              ),
                              expression.id,
                            );
                          }}
                        >
                          <span>
                            <StoryAssetImage
                              fileId={asset?.fileId}
                              alt=""
                              fallback={<FileImage aria-hidden />}
                            />
                          </span>
                          <strong>{expression.label}</strong>
                          {expression.id ===
                          selectedCharacter.defaultExpressionId ? (
                            <em>默认</em>
                          ) : null}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      className="galgame-expression-add"
                      onClick={() =>
                        setPicker({ mode: "add", source: "project" })
                      }
                    >
                      <ImagePlus aria-hidden /> 添加表情
                    </button>
                  </div>
                  <div className="galgame-expression-import-actions">
                    <button
                      type="button"
                      onClick={() => {
                        setPicker({ mode: "add", source: "project" });
                        requestAnimationFrame(() => fileInput.current?.click());
                      }}
                    >
                      <Upload aria-hidden /> 批量导入
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setPicker({ mode: "add", source: "library" })
                      }
                    >
                      <FolderOpen aria-hidden /> 文件库
                    </button>
                  </div>
                  {selectedExpression ? (
                    <div className="galgame-expression-form">
                      <label className="galgame-field">
                        <span>表情名称</span>
                        <input
                          value={selectedExpression.label}
                          onChange={(event) =>
                            updateCharacter(
                              selectedCharacter.id,
                              (character) => ({
                                ...character,
                                expressions: (character.expressions ?? []).map(
                                  (expression) =>
                                    expression.id === selectedExpression.id
                                      ? {
                                          ...expression,
                                          label: event.target.value,
                                        }
                                      : expression,
                                ),
                              }),
                            )
                          }
                        />
                      </label>
                      <label className="galgame-field">
                        <span>表情 ID（只读）</span>
                        <input value={selectedExpression.id} readOnly />
                      </label>
                      <label className="galgame-field">
                        <span>画面高度（%）</span>
                        <input
                          type="number"
                          min={1}
                          max={300}
                          placeholder={String(
                            selectedCharacter.portraitHeightPercent ??
                              document.settings?.characterStage
                                ?.defaultHeightPercent ??
                              100,
                          )}
                          value={selectedExpression.heightPercent ?? ""}
                          onChange={(event) =>
                            updateCharacter(
                              selectedCharacter.id,
                              (character) => ({
                                ...character,
                                expressions: (character.expressions ?? []).map(
                                  (expression) =>
                                    expression.id === selectedExpression.id
                                      ? {
                                          ...expression,
                                          heightPercent: event.target.value
                                            ? Number(event.target.value)
                                            : null,
                                        }
                                      : expression,
                                ),
                              }),
                            )
                          }
                        />
                      </label>
                      <fieldset className="galgame-expression-crop-settings">
                        <legend>编辑器缩略图裁剪</legend>
                        {(["x", "y", "scale"] as const).map((key) => (
                          <label key={key}>
                            <span>{key.toUpperCase()}</span>
                            <input
                              type="number"
                              min={key === "scale" ? 0.5 : 0}
                              max={key === "scale" ? 6 : 100}
                              step={key === "scale" ? 0.1 : 1}
                              value={
                                selectedExpression.thumbnailCrop?.[key] ??
                                { x: 50, y: 25, scale: 1.8 }[key]
                              }
                              onChange={(event) =>
                                updateCharacter(
                                  selectedCharacter.id,
                                  (character) => ({
                                    ...character,
                                    expressions: (
                                      character.expressions ?? []
                                    ).map((expression) =>
                                      expression.id === selectedExpression.id
                                        ? {
                                            ...expression,
                                            thumbnailCrop: {
                                              ...(expression.thumbnailCrop ?? {
                                                x: 50,
                                                y: 25,
                                                scale: 1.8,
                                              }),
                                              [key]: Number(event.target.value),
                                            },
                                          }
                                        : expression,
                                    ),
                                  }),
                                )
                              }
                            />
                          </label>
                        ))}
                      </fieldset>
                      <label className="galgame-field">
                        <span>对白头像来源</span>
                        <select
                          value={
                            selectedExpression.dialogueAvatar?.source ??
                            "portrait"
                          }
                          onChange={(event) =>
                            updateCharacter(
                              selectedCharacter.id,
                              (character) => ({
                                ...character,
                                expressions: (character.expressions ?? []).map(
                                  (expression) =>
                                    expression.id === selectedExpression.id
                                      ? {
                                          ...expression,
                                          dialogueAvatar: {
                                            source: event.target.value as
                                              "portrait" | "independent",
                                            assetId:
                                              event.target.value ===
                                              "independent"
                                                ? (expression.dialogueAvatar
                                                    ?.assetId ?? null)
                                                : null,
                                            crop: expression.dialogueAvatar
                                              ?.crop ?? {
                                              x: 50,
                                              y: 25,
                                              scale: 1.8,
                                            },
                                          },
                                        }
                                      : expression,
                                ),
                              }),
                            )
                          }
                        >
                          <option value="portrait">跟随当前皮肤立绘</option>
                          <option value="independent">独立头像</option>
                        </select>
                      </label>
                      {selectedExpression.dialogueAvatar?.source ===
                      "independent" ? (
                        <label className="galgame-field">
                          <span>独立头像素材</span>
                          <select
                            value={
                              selectedExpression.dialogueAvatar.assetId ?? ""
                            }
                            onChange={(event) => {
                              const source = (document.assets ?? []).find(
                                (asset) => asset.id === event.target.value,
                              );
                              if (!source || source.type !== "image") return;
                              const avatarAssetId = stableId();
                              onDocument({
                                ...document,
                                assets: [
                                  ...(document.assets ?? []),
                                  {
                                    id: avatarAssetId,
                                    type: "image",
                                    role: "dialogueAvatar",
                                    fileId: source.fileId,
                                    status: "ready",
                                  },
                                ],
                                characters: characters.map((character) =>
                                  character.id === selectedCharacter.id
                                    ? {
                                        ...character,
                                        expressions: (
                                          character.expressions ?? []
                                        ).map((expression) =>
                                          expression.id ===
                                          selectedExpression.id
                                            ? {
                                                ...expression,
                                                dialogueAvatar: {
                                                  source: "independent",
                                                  assetId: avatarAssetId,
                                                  crop: expression
                                                    .dialogueAvatar?.crop ?? {
                                                    x: 50,
                                                    y: 25,
                                                    scale: 1.8,
                                                  },
                                                },
                                              }
                                            : expression,
                                        ),
                                      }
                                    : character,
                                ),
                              });
                            }}
                          >
                            <option value="">选择已有图片</option>
                            {(document.assets ?? [])
                              .filter((asset) => asset.type === "image")
                              .map((asset) => (
                                <option key={asset.id} value={asset.id}>
                                  {asset.id}
                                </option>
                              ))}
                          </select>
                        </label>
                      ) : null}
                      <section className="galgame-expression-overlays">
                        <header>
                          <strong>图形覆盖</strong>
                          <select
                            aria-label="添加图形覆盖"
                            defaultValue=""
                            onChange={(event) => {
                              const source = (document.assets ?? []).find(
                                (asset) => asset.id === event.target.value,
                              );
                              event.target.value = "";
                              if (!source || source.type !== "image") return;
                              const overlayAssetId = stableId();
                              const overlayId = stableId();
                              onDocument({
                                ...document,
                                assets: [
                                  ...(document.assets ?? []),
                                  {
                                    id: overlayAssetId,
                                    type: "image",
                                    role: "characterOverlay",
                                    fileId: source.fileId,
                                    status: "ready",
                                  },
                                ],
                                characters: characters.map((character) =>
                                  character.id === selectedCharacter.id
                                    ? {
                                        ...character,
                                        expressions: (
                                          character.expressions ?? []
                                        ).map((expression) =>
                                          expression.id ===
                                          selectedExpression.id
                                            ? {
                                                ...expression,
                                                overlays: [
                                                  ...(expression.overlays ??
                                                    []),
                                                  {
                                                    id: overlayId,
                                                    name: `覆盖 ${source.id.slice(0, 8)}`,
                                                    assetId: overlayAssetId,
                                                    x: 50,
                                                    y: 50,
                                                    width: 100,
                                                    opacity: 1,
                                                  },
                                                ],
                                              }
                                            : expression,
                                        ),
                                      }
                                    : character,
                                ),
                              });
                            }}
                          >
                            <option value="">从已有图片添加…</option>
                            {(document.assets ?? [])
                              .filter((asset) => asset.type === "image")
                              .map((asset) => (
                                <option key={asset.id} value={asset.id}>
                                  {asset.id}
                                </option>
                              ))}
                          </select>
                        </header>
                        {(selectedExpression.overlays ?? []).map((overlay) => (
                          <div key={overlay.id}>
                            <input
                              aria-label="覆盖名称"
                              value={overlay.name}
                              onChange={(event) =>
                                updateCharacter(
                                  selectedCharacter.id,
                                  (character) => ({
                                    ...character,
                                    expressions: (
                                      character.expressions ?? []
                                    ).map((expression) =>
                                      expression.id === selectedExpression.id
                                        ? {
                                            ...expression,
                                            overlays: (
                                              expression.overlays ?? []
                                            ).map((item) =>
                                              item.id === overlay.id
                                                ? {
                                                    ...item,
                                                    name: event.target.value,
                                                  }
                                                : item,
                                            ),
                                          }
                                        : expression,
                                    ),
                                  }),
                                )
                              }
                            />
                            <button
                              type="button"
                              className="danger"
                              aria-label={`删除覆盖 ${overlay.name}`}
                              onClick={() =>
                                updateCharacter(
                                  selectedCharacter.id,
                                  (character) => ({
                                    ...character,
                                    expressions: (
                                      character.expressions ?? []
                                    ).map((expression) =>
                                      expression.id === selectedExpression.id
                                        ? {
                                            ...expression,
                                            overlays: (
                                              expression.overlays ?? []
                                            ).filter(
                                              (item) => item.id !== overlay.id,
                                            ),
                                          }
                                        : expression,
                                    ),
                                  }),
                                )
                              }
                            >
                              <Trash2 aria-hidden />
                            </button>
                          </div>
                        ))}
                      </section>
                      <div>
                        <button
                          type="button"
                          disabled={
                            selectedExpression.id ===
                            selectedCharacter.defaultExpressionId
                          }
                          onClick={() =>
                            updateCharacter(
                              selectedCharacter.id,
                              (character) => ({
                                ...character,
                                defaultExpressionId: selectedExpression.id,
                              }),
                            )
                          }
                        >
                          <Check aria-hidden /> 设为默认
                        </button>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => deleteExpression(selectedExpression)}
                        >
                          <Trash2 aria-hidden /> 删除表情
                        </button>
                      </div>
                    </div>
                  ) : null}
                  <section className="galgame-portrait-skins">
                    {(selectedCharacter.portraitSkins ?? []).length ? (
                      <>
                        <header>
                          <span>
                            <strong>立绘皮肤</strong>
                            <small>为同一组表情配置替代素材</small>
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const id = stableId();
                              updateCharacter(
                                selectedCharacter.id,
                                (character) => ({
                                  ...character,
                                  portraitSkins: [
                                    ...(character.portraitSkins ?? []),
                                    {
                                      id,
                                      name: `皮肤 ${(character.portraitSkins?.length ?? 0) + 1}`,
                                      overrides: [],
                                    },
                                  ],
                                }),
                              );
                              setSelectedSkinId(id);
                            }}
                          >
                            <Plus aria-hidden /> 添加皮肤
                          </button>
                        </header>
                        <div className="galgame-portrait-skin-layout">
                          <nav aria-label="立绘皮肤列表">
                            {(selectedCharacter.portraitSkins ?? []).map(
                              (skin) => (
                                <button
                                  key={skin.id}
                                  type="button"
                                  className={
                                    selectedSkinId === skin.id ? "active" : ""
                                  }
                                  onClick={() => setSelectedSkinId(skin.id)}
                                >
                                  <span>
                                    <strong>{skin.name}</strong>
                                    <small>
                                      {skin.overrides?.length ?? 0} 个替代素材
                                    </small>
                                  </span>
                                  {selectedCharacter.defaultPortraitSkinId ===
                                  skin.id ? (
                                    <em>默认</em>
                                  ) : null}
                                </button>
                              ),
                            )}
                          </nav>
                          {selectedSkin ? (
                            <section className="galgame-portrait-skin-editor">
                              <label className="galgame-field">
                                <span>皮肤名称</span>
                                <input
                                  aria-label="皮肤名称"
                                  value={selectedSkin.name}
                                  onChange={(event) =>
                                    updateCharacter(
                                      selectedCharacter.id,
                                      (character) => ({
                                        ...character,
                                        portraitSkins: (
                                          character.portraitSkins ?? []
                                        ).map((item) =>
                                          item.id === selectedSkin.id
                                            ? {
                                                ...item,
                                                name: event.target.value,
                                              }
                                            : item,
                                        ),
                                      }),
                                    )
                                  }
                                />
                              </label>
                              <div className="galgame-portrait-skin-overrides">
                                {(selectedCharacter.expressions ?? []).map(
                                  (expression) => (
                                    <label key={expression.id}>
                                      <span>{expression.label}</span>
                                      <select
                                        value={
                                          selectedSkin.overrides?.find(
                                            (item) =>
                                              item.expressionId ===
                                              expression.id,
                                          )?.assetId ?? ""
                                        }
                                        onChange={(event) =>
                                          updateCharacter(
                                            selectedCharacter.id,
                                            (character) => ({
                                              ...character,
                                              portraitSkins: (
                                                character.portraitSkins ?? []
                                              ).map((item) => {
                                                if (item.id !== selectedSkin.id)
                                                  return item;
                                                const overrides = (
                                                  item.overrides ?? []
                                                ).filter(
                                                  (override) =>
                                                    override.expressionId !==
                                                    expression.id,
                                                );
                                                return {
                                                  ...item,
                                                  overrides: event.target.value
                                                    ? [
                                                        ...overrides,
                                                        {
                                                          expressionId:
                                                            expression.id,
                                                          assetId:
                                                            event.target.value,
                                                        },
                                                      ]
                                                    : overrides,
                                                };
                                              }),
                                            }),
                                          )
                                        }
                                      >
                                        <option value="">跟随原始表情</option>
                                        {(
                                          selectedCharacter.expressions ?? []
                                        ).map((source) => (
                                          <option
                                            key={source.id}
                                            value={source.assetId}
                                          >
                                            使用 {source.label} 素材
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                  ),
                                )}
                              </div>
                              <footer>
                                <button
                                  type="button"
                                  disabled={
                                    selectedCharacter.defaultPortraitSkinId ===
                                    selectedSkin.id
                                  }
                                  onClick={() =>
                                    updateCharacter(
                                      selectedCharacter.id,
                                      (character) => ({
                                        ...character,
                                        defaultPortraitSkinId: selectedSkin.id,
                                      }),
                                    )
                                  }
                                >
                                  <Check aria-hidden /> 设为默认
                                </button>
                                <button
                                  type="button"
                                  className="danger"
                                  onClick={() => {
                                    const remaining = (
                                      selectedCharacter.portraitSkins ?? []
                                    ).filter(
                                      (item) => item.id !== selectedSkin.id,
                                    );
                                    updateCharacter(
                                      selectedCharacter.id,
                                      (character) => ({
                                        ...character,
                                        portraitSkins: remaining,
                                        defaultPortraitSkinId:
                                          character.defaultPortraitSkinId ===
                                          selectedSkin.id
                                            ? null
                                            : character.defaultPortraitSkinId,
                                      }),
                                    );
                                    setSelectedSkinId(remaining[0]?.id);
                                  }}
                                >
                                  <Trash2 aria-hidden /> 删除皮肤
                                </button>
                              </footer>
                            </section>
                          ) : (
                            <div className="galgame-character-tab-empty">
                              选择一个皮肤查看详情
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="galgame-portrait-skin-empty">
                        <FileImage aria-hidden />
                        <strong>让立绘在不同外观之间切换</strong>
                        <p>
                          为服装、受伤或季节等外观建立皮肤，并为需要替换的表情指定素材。
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            const id = stableId();
                            updateCharacter(
                              selectedCharacter.id,
                              (character) => ({
                                ...character,
                                portraitSkins: [
                                  {
                                    id,
                                    name: "皮肤 1",
                                    overrides: [],
                                  },
                                ],
                              }),
                            );
                            setSelectedSkinId(id);
                          }}
                        >
                          <Plus aria-hidden /> 添加皮肤
                        </button>
                      </div>
                    )}
                  </section>
                  <footer>
                    <Check aria-hidden />
                    {expressions.length
                      ? "基准立绘已绑定 · 修改将在 650ms 后自动保存"
                      : "添加第一个表情后会自动设为默认立绘"}
                  </footer>
                </div>
              </div>
            ) : (
              <div className="galgame-character-voice-form">
                <section>
                  <header>
                    <span>
                      <Mic2 aria-hidden />
                    </span>
                    <span>
                      <strong>角色声线</strong>
                      <small>记录配音选角资料和试听样本。</small>
                    </span>
                  </header>
                  <label className="galgame-field">
                    <span>声线名称</span>
                    <input
                      value={selectedCharacter.voiceProfile?.name ?? "默认声线"}
                      onChange={(event) =>
                        updateCharacter(selectedCharacter.id, (character) => ({
                          ...character,
                          voiceProfile: {
                            name: event.target.value,
                            language:
                              character.voiceProfile?.language ?? "zh-CN",
                            description:
                              character.voiceProfile?.description ?? "",
                            sampleAssetId:
                              character.voiceProfile?.sampleAssetId ?? null,
                          },
                        }))
                      }
                    />
                  </label>
                  <label className="galgame-field">
                    <span>语言</span>
                    <input
                      value={
                        selectedCharacter.voiceProfile?.language ?? "zh-CN"
                      }
                      onChange={(event) =>
                        updateCharacter(selectedCharacter.id, (character) => ({
                          ...character,
                          voiceProfile: {
                            name: character.voiceProfile?.name ?? "默认声线",
                            language: event.target.value,
                            description:
                              character.voiceProfile?.description ?? "",
                            sampleAssetId:
                              character.voiceProfile?.sampleAssetId ?? null,
                          },
                        }))
                      }
                    />
                  </label>
                  <label className="galgame-field">
                    <span>声线描述</span>
                    <textarea
                      placeholder="例如：冷静、偏低沉，句尾略带气声…"
                      value={selectedCharacter.voiceProfile?.description ?? ""}
                      onChange={(event) =>
                        updateCharacter(selectedCharacter.id, (character) => ({
                          ...character,
                          voiceProfile: {
                            name: character.voiceProfile?.name ?? "默认声线",
                            language:
                              character.voiceProfile?.language ?? "zh-CN",
                            description: event.target.value,
                            sampleAssetId:
                              character.voiceProfile?.sampleAssetId ?? null,
                          },
                        }))
                      }
                    />
                  </label>
                </section>
                <section className="galgame-character-voice-sample">
                  <header>
                    <strong>试听样本</strong>
                    <small>仅用于选角参考，不会自动绑定到对白。</small>
                  </header>
                  {voiceSampleAsset ? (
                    <StoryAudioPreview
                      fileId={voiceSampleAsset.fileId}
                      label={voiceSampleAsset.label}
                    />
                  ) : (
                    <div className="galgame-character-voice-empty">
                      <Volume2 aria-hidden />
                      <strong>尚未添加试听样本</strong>
                    </div>
                  )}
                  <div>
                    <button
                      type="button"
                      onClick={() => voiceFileInput.current?.click()}
                    >
                      <Upload aria-hidden /> 上传样本
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setVoicePickerSource("library");
                        setVoicePickerOpen(true);
                      }}
                    >
                      <FolderOpen aria-hidden /> 从文件库选择
                    </button>
                    {voiceSampleAsset ? (
                      <button
                        type="button"
                        className="danger"
                        onClick={() =>
                          updateCharacter(
                            selectedCharacter.id,
                            (character) => ({
                              ...character,
                              voiceProfile: character.voiceProfile
                                ? {
                                    ...character.voiceProfile,
                                    sampleAssetId: null,
                                  }
                                : null,
                            }),
                          )
                        }
                      >
                        <Trash2 aria-hidden /> 移除
                      </button>
                    ) : null}
                  </div>
                  <input
                    ref={voiceFileInput}
                    hidden
                    type="file"
                    accept="audio/mpeg,audio/wav,audio/mp4,audio/ogg,.mp3,.wav,.m4a,.ogg"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) voiceUpload.mutate(file);
                    }}
                  />
                </section>
              </div>
            )}
          </>
        ) : (
          <div className="galgame-entity-empty">
            <UserRound aria-hidden />
            <strong>还没有角色</strong>
            <span>从左侧创建角色后开始编辑资料与立绘。</span>
          </div>
        )}
      </main>

      <aside className="galgame-character-reference-panel">
        <nav aria-label="角色预览与资源引用">
          <button
            type="button"
            className={referenceTab === "preview" ? "active" : ""}
            onClick={() => setReferenceTab("preview")}
          >
            角色预览
          </button>
          <button
            type="button"
            className={referenceTab === "references" ? "active" : ""}
            onClick={() => setReferenceTab("references")}
          >
            资源引用 <em>{references.length}</em>
          </button>
        </nav>
        {referenceTab === "preview" ? (
          <section className="galgame-character-live-preview">
            <header>
              <button
                type="button"
                className={previewEnabled ? "active" : ""}
                onClick={() => setPreviewEnabled((current) => !current)}
              >
                {previewEnabled ? <Eye aria-hidden /> : <EyeOff aria-hidden />}
                实时预览
              </button>
              <small>
                {document.settings?.canvas?.width ?? 1920} ×{" "}
                {document.settings?.canvas?.height ?? 1080}
              </small>
            </header>
            <p>当前角色 + 默认表情 · 仅影响预览</p>
            <div
              className={`galgame-character-preview-stage is-${previewBackgroundMode}`}
            >
              {previewBackgroundMode === "scene" ? (
                <StoryAssetImage
                  fileId={previewBackgroundAsset?.fileId}
                  alt=""
                  fallback={<span />}
                />
              ) : null}
              {previewEnabled ? (
                <span
                  className="galgame-character-preview-actor"
                  style={{
                    left: `${previewPosition.x}%`,
                    top: `${previewPosition.y}%`,
                    width: `${footprintWidth}%`,
                    height: `${footprintHeight}%`,
                    transform:
                      stageSettings.anchor === "center"
                        ? "translate(-50%, -50%)"
                        : "translate(0, 0)",
                  }}
                >
                  <StoryAssetImage
                    fileId={previewExpressionAsset?.fileId}
                    alt={selectedCharacter?.name ?? "角色预览"}
                    fallback={<UserRound aria-hidden />}
                    onNaturalSize={({ width, height }) => {
                      if (!previewExpressionAsset?.fileId) return;
                      setNaturalPortraitSize({
                        fileId: previewExpressionAsset.fileId,
                        width,
                        height,
                      });
                    }}
                  />
                </span>
              ) : null}
            </div>
            <div className="galgame-character-preview-backgrounds">
              {(
                [
                  ["scene", "背景图"],
                  ["dark", "深色"],
                  ["light", "浅色"],
                  ["checkerboard", "棋盘"],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  className={previewBackgroundMode === mode ? "active" : ""}
                  onClick={() => setPreviewBackgroundMode(mode)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label>
              <span>背景</span>
              <select
                value={previewSceneId}
                onChange={(event) => setPreviewSceneId(event.target.value)}
                disabled={previewBackgroundMode !== "scene"}
              >
                <option value="">棋盘背景</option>
                {(document.scenes ?? []).map((scene) => (
                  <option key={scene.id} value={scene.id}>
                    {scene.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="galgame-character-preview-position-heading">
              <strong>位置</strong>
              <small>
                {previewPosition.name} · {previewPosition.x}，
                {previewPosition.y}
              </small>
            </div>
            <div
              className="galgame-character-position-pills"
              aria-label="预览站位"
            >
              {stageSettings.positionPresets.map((position) => (
                <button
                  key={position.id}
                  type="button"
                  className={previewPosition.id === position.id ? "active" : ""}
                  onClick={() => setPreviewPositionId(position.id)}
                >
                  {position.name}
                </button>
              ))}
            </div>
          </section>
        ) : (
          <section className="galgame-character-reference-content">
            <header>
              <strong>引用位置</strong>
              <small>{references.length} 处</small>
            </header>
            <div className="galgame-character-reference-metrics">
              <span>
                <strong>{references.length}</strong>
                <small>处引用</small>
              </span>
              <span>
                <strong>{fragmentCount}</strong>
                <small>个 Fragment</small>
              </span>
            </div>
            <div className="galgame-character-reference-list">
              {references.map((reference) => (
                <button
                  key={reference.blockId}
                  type="button"
                  onClick={() =>
                    onLocate(reference.fragmentId, reference.blockId)
                  }
                >
                  <span>
                    <strong>
                      {reference.chapterTitle} · {reference.fragmentTitle} ·
                      Block {reference.blockIndex + 1} ·{" "}
                      {reference.kind === "dialogue"
                        ? "Dialogue"
                        : reference.kind === "showCharacter"
                          ? "角色登场"
                          : "角色退场"}
                    </strong>
                    <small>{reference.text || "（空对白）"}</small>
                  </span>
                  <LocateFixed aria-hidden />
                </button>
              ))}
              {!references.length ? <p>这个角色还没有被剧本引用。</p> : null}
            </div>
          </section>
        )}
        <section className="galgame-character-danger-zone">
          <header>
            <strong>删除角色</strong>
            <span>
              {references.length
                ? "角色仍被对白引用，无法删除。"
                : "删除角色会同时解除其立绘绑定。"}
            </span>
          </header>
          <button
            type="button"
            disabled={!selectedCharacter || Boolean(references.length)}
            onClick={deleteCharacter}
          >
            <Trash2 aria-hidden /> 删除角色
          </button>
        </section>
      </aside>

      {picker ? (
        <StoryImagePicker
          projectId={projectId}
          state={picker}
          usedFileIds={usedFileIds}
          addTitle="添加角色表情"
          replaceTitle="替换角色立绘"
          searchLabel="搜索立绘素材"
          projectEmptyCopy="上传图片后即可绑定为角色立绘。"
          onState={setPicker}
          onChoose={bindFile}
          onUpload={() => fileInput.current?.click()}
          onClose={() => setPicker(undefined)}
        />
      ) : null}
      {voicePickerOpen ? (
        <StoryAudioPicker
          projectId={projectId}
          title="选择角色试听样本"
          source={voicePickerSource}
          usedFileIds={usedFileIds}
          onSource={setVoicePickerSource}
          onChoose={bindVoiceSample}
          onUpload={() => voiceFileInput.current?.click()}
          onClose={() => setVoicePickerOpen(false)}
        />
      ) : null}
    </section>
  );
}
