import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Eye,
  EyeOff,
  FileImage,
  Film,
  FlipHorizontal2,
  FolderOpen,
  ImagePlus,
  LocateFixed,
  Maximize2,
  Minimize2,
  Mic2,
  PanelRight,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  UserRound,
  Volume2,
  X,
} from "lucide-react";
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
import { characterExpressionAssetId } from "@features/galgame-workshop/editor/richText";
import {
  characterStageSettings,
  stableId,
} from "@features/galgame-workshop/editor/model";
import {
  StoryImagePicker,
  type StoryImagePickerState,
} from "@features/galgame-workshop/editor/StoryImagePicker";
import { StoryAssetImage } from "@features/galgame-workshop/editor/StoryAssetImage";
import { ExpressionPortrait } from "@features/galgame-workshop/editor/ExpressionPortrait";
import {
  portraitFootprintWidth,
  type PortraitNaturalSize,
} from "@features/galgame-workshop/editor/portraitSizing";
import { CharacterStageSettingsWorkspace } from "@features/galgame-workshop/editor/CharacterStageSettingsWorkspace";
import {
  StoryAudioPicker,
  type StoryAudioPickerSource,
} from "@features/galgame-workshop/editor/StoryAudioPicker";
import { StoryAudioPreview } from "@features/galgame-workshop/editor/StoryAudioPreview";
import { CustomColorPicker } from "@shared/ui/CustomColorPicker";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { InlineEditableName } from "@features/galgame-workshop/editor/EditorShared";

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

function thumbnailCropStyle(
  expression?: GalgameStoryCharacterExpression,
): CSSProperties {
  const crop = expression?.thumbnailCrop ?? { x: 50, y: 25, scale: 1.8 };
  return {
    "--thumbnail-x": `${crop.x}%`,
    "--thumbnail-y": `${crop.y}%`,
    "--thumbnail-scale": crop.scale,
  } as CSSProperties;
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
  const portraitAssetId = characterExpressionAssetId(
    character,
    character.defaultExpressionId,
    undefined,
  );
  const asset = (document.assets ?? []).find(
    (item) => item.id === portraitAssetId,
  );
  return (
    <span
      className="galgame-character-avatar"
      style={thumbnailCropStyle(expression)}
    >
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

  return (
    <section
      className={`galgame-character-workspace ${
        expressionDetailLayout ? "is-expression-detail" : ""
      } ${workspaceMode === "stage" ? "is-stage-settings" : ""}`}
    >
      <header className="galgame-character-workspace-header">
        <span>
          <UserRound aria-hidden />
          <strong>角色</strong>
          <em>{characters.length} 项</em>
        </span>
        {expressionDetailLayout ? (
          <button
            type="button"
            className="galgame-character-reference-trigger"
            aria-expanded={referencePanelOpen}
            onClick={() => {
              setReferenceTab("references");
              setReferencePanelOpen((current) => !current);
            }}
          >
            <PanelRight aria-hidden /> 资源引用
            {references.length ? <em>{references.length}</em> : null}
          </button>
        ) : null}
      </header>
      <aside className="galgame-character-list-panel">
        <section className="galgame-character-global-navigation">
          <small>全局设置</small>
          <button
            type="button"
            className={workspaceMode === "stage" ? "active" : ""}
            onClick={() => {
              if (stageScopeId !== "global" && selectedCharacter)
                selectStageScope(selectedCharacter.id);
              setWorkspaceMode("stage");
            }}
          >
            <SlidersHorizontal aria-hidden />
            <span>位置与尺寸</span>
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
                draggable
                aria-roledescription="可排序角色卡片"
                title="拖动调整角色顺序；Alt+↑/↓ 也可移动"
                className={[
                  character.id === selectedCharacter?.id ? "active" : "",
                  draggedCharacterId === character.id ? "is-dragging" : "",
                  characterDropTarget?.id === character.id
                    ? `is-drop-${characterDropTarget.placement}`
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
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
                onKeyDown={(event) => {
                  if (!event.altKey) return;
                  if (event.key !== "ArrowUp" && event.key !== "ArrowDown")
                    return;
                  event.preventDefault();
                  moveCharacterByOffset(
                    character.id,
                    event.key === "ArrowUp" ? -1 : 1,
                  );
                }}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData(
                    "application/x-galgame-character",
                    character.id,
                  );
                  event.dataTransfer.setData("text/plain", character.id);
                  setDraggedCharacterId(character.id);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  const bounds = event.currentTarget.getBoundingClientRect();
                  setCharacterDropTarget({
                    id: character.id,
                    placement:
                      event.clientY > bounds.top + bounds.height / 2
                        ? "after"
                        : "before",
                  });
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const bounds = event.currentTarget.getBoundingClientRect();
                  const sourceId =
                    event.dataTransfer.getData(
                      "application/x-galgame-character",
                    ) || draggedCharacterId;
                  if (sourceId) {
                    moveCharacter(
                      sourceId,
                      character.id,
                      event.clientY > bounds.top + bounds.height / 2
                        ? "after"
                        : "before",
                    );
                  }
                  setDraggedCharacterId(undefined);
                  setCharacterDropTarget(undefined);
                }}
                onDragEnd={() => {
                  setDraggedCharacterId(undefined);
                  setCharacterDropTarget(undefined);
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
        {workspaceMode === "stage" ? (
          stageWorkspace
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
                  <InlineEditableName
                    key={selectedCharacter.id}
                    value={selectedCharacter.name}
                    label="角色名称"
                    onCommit={(name) =>
                      updateCharacter(selectedCharacter.id, (character) => ({
                        ...character,
                        name,
                      }))
                    }
                    onEmpty={() => onNotice("角色名称不能为空。")}
                  />
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
                  <CustomColorPicker
                    ariaLabel="角色主题色"
                    value={selectedCharacter.themeColor ?? "#E75B55"}
                    colors={CHARACTER_PALETTE}
                    onChange={(value) =>
                      updateCharacter(selectedCharacter.id, (character) => ({
                        ...character,
                        themeColor: value,
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
                        <CustomSelect
                          ariaLabel="显示名来源"
                          value={scheme.source}
                          onChange={(value) =>
                            updateCharacter(
                              selectedCharacter.id,
                              (character) => ({
                                ...character,
                                displayNames: (
                                  character.displayNames ?? []
                                ).map((item) =>
                                  item.id === scheme.id
                                    ? value === "variable"
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
                                      : value === "attribute"
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
                          options={[
                            { value: "literal", label: "固定名称" },
                            { value: "variable", label: "字符串变量" },
                            { value: "attribute", label: "角色属性" },
                          ]}
                        />
                        {scheme.source === "variable" ? (
                          <CustomSelect
                            ariaLabel="显示名变量"
                            value={scheme.variableId ?? ""}
                            onChange={(value) =>
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
                                          variableId: value || null,
                                        }
                                      : item,
                                  ),
                                }),
                              )
                            }
                            options={[
                              { value: "", label: "选择变量" },
                              ...(document.variables ?? [])
                                .filter(
                                  (variable) => variable.type === "string",
                                )
                                .map((variable) => ({
                                  value: variable.id,
                                  label: variable.name,
                                })),
                            ]}
                          />
                        ) : scheme.source === "attribute" ? (
                          <CustomSelect
                            ariaLabel="显示名角色属性"
                            value={scheme.attributeId ?? ""}
                            onChange={(value) =>
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
                                          attributeId: value || null,
                                        }
                                      : item,
                                  ),
                                }),
                              )
                            }
                            options={[
                              { value: "", label: "选择属性" },
                              ...(document.characterAttributeTemplates ?? [])
                                .filter(
                                  (attribute) => attribute.type === "string",
                                )
                                .map((attribute) => ({
                                  value: attribute.id,
                                  label: attribute.name,
                                })),
                            ]}
                          />
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
              <div
                className={`galgame-portrait-editor is-${tab} ${
                  selectedExpression?.renderMode === "frameSequence"
                    ? "has-frame-sequence"
                    : "has-static-image"
                }`}
              >
                <div className="galgame-portrait-stage-column galgame-expression-upload-status">
                  {!selectedExpression ? (
                    <div className="galgame-expression-detail-empty">
                      <FileImage aria-hidden />
                      <span>选择一个表情查看详情</span>
                    </div>
                  ) : null}
                  <input
                    ref={fileInput}
                    hidden
                    type="file"
                    multiple
                    accept=".jpg,.jpeg,.png,.webp,.avif"
                    onChange={(event) => {
                      const files = [...(event.target.files ?? [])];
                      if (files.length && picker?.mode === "sequence")
                        sequenceBatchUpload.mutate(files);
                      else if (files.length === 1 && picker?.mode === "replace")
                        upload.mutate(files[0]);
                      else if (files.length) batchUpload.mutate(files);
                      event.target.value = "";
                    }}
                  />
                  {upload.isPending ||
                  batchUpload.isPending ||
                  sequenceBatchUpload.isPending ? (
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
                          aria-roledescription="可排序表情卡片"
                          title="拖动调整表情顺序；Alt+↑/↓ 也可移动"
                          className={[
                            expression.id === selectedExpression?.id ||
                            selectedExpressionIds.has(expression.id)
                              ? "active"
                              : "",
                            draggedExpressionId === expression.id
                              ? "is-dragging"
                              : "",
                            expressionDropTarget?.id === expression.id
                              ? `is-drop-${expressionDropTarget.placement}`
                              : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
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
                          onKeyDown={(event) => {
                            if (!event.altKey) return;
                            if (
                              event.key !== "ArrowUp" &&
                              event.key !== "ArrowDown"
                            )
                              return;
                            event.preventDefault();
                            moveExpressionByOffset(
                              expression.id,
                              event.key === "ArrowUp" ? -1 : 1,
                            );
                          }}
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData(
                              "application/x-galgame-expression",
                              expression.id,
                            );
                            event.dataTransfer.setData(
                              "text/plain",
                              expression.id,
                            );
                            setDraggedExpressionId(expression.id);
                          }}
                          onDragOver={(event) => {
                            event.preventDefault();
                            event.dataTransfer.dropEffect = "move";
                            const bounds =
                              event.currentTarget.getBoundingClientRect();
                            setExpressionDropTarget({
                              id: expression.id,
                              placement:
                                event.clientY > bounds.top + bounds.height / 2
                                  ? "after"
                                  : "before",
                            });
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            const bounds =
                              event.currentTarget.getBoundingClientRect();
                            const sourceId =
                              event.dataTransfer.getData(
                                "application/x-galgame-expression",
                              ) || draggedExpressionId;
                            if (sourceId) {
                              moveExpression(
                                sourceId,
                                expression.id,
                                event.clientY > bounds.top + bounds.height / 2
                                  ? "after"
                                  : "before",
                              );
                            }
                            setDraggedExpressionId(undefined);
                            setExpressionDropTarget(undefined);
                          }}
                          onDragEnd={() => {
                            setDraggedExpressionId(undefined);
                            setExpressionDropTarget(undefined);
                          }}
                        >
                          <span style={thumbnailCropStyle(expression)}>
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
                    <div
                      className="galgame-expression-form"
                      aria-label={`${selectedExpression.label} 表情设置`}
                    >
                      <section className="galgame-expression-setting-section galgame-expression-presentation">
                        <header>
                          <span>
                            <Film aria-hidden />
                            <strong>呈现方式</strong>
                          </span>
                          <small>
                            {selectedExpression.renderMode === "frameSequence"
                              ? `序列帧 · ${selectedExpression.sequence?.frames.length ?? 0} 帧`
                              : "静态图片"}
                          </small>
                        </header>
                        <div
                          className="galgame-expression-render-modes"
                          role="group"
                          aria-label="表情呈现方式"
                        >
                          <button
                            type="button"
                            aria-pressed={
                              selectedExpression.renderMode !== "frameSequence"
                            }
                            onClick={switchExpressionToStatic}
                          >
                            静态图片
                          </button>
                          <button
                            type="button"
                            aria-pressed={
                              selectedExpression.renderMode === "frameSequence"
                            }
                            onClick={switchExpressionToSequence}
                          >
                            序列帧
                          </button>
                          <button
                            type="button"
                            disabled
                            title="首期暂不支持 Spine 资源包"
                          >
                            Spine
                          </button>
                          <button
                            type="button"
                            disabled
                            title="首期暂不支持 Live2D 资源包"
                          >
                            Live2D
                          </button>
                        </div>
                        {selectedExpression.renderMode === "frameSequence" &&
                        selectedExpression.sequence ? (
                          <div className="galgame-expression-sequence-editor">
                            <div
                              className="galgame-expression-playback-modes"
                              role="group"
                              aria-label="序列播放方式"
                            >
                              <button
                                type="button"
                                aria-pressed={
                                  (selectedExpression.sequence.playbackMode ??
                                    "timed") === "timed"
                                }
                                onClick={() => setSequencePlaybackMode("timed")}
                              >
                                定时播放
                              </button>
                              <button
                                type="button"
                                aria-pressed={
                                  selectedExpression.sequence.playbackMode ===
                                  "lipSync"
                                }
                                onClick={() =>
                                  setSequencePlaybackMode("lipSync")
                                }
                              >
                                语音口型
                              </button>
                            </div>
                            <div className="galgame-expression-sequence-controls">
                              <label className="galgame-expression-fps-control">
                                <span>播放帧率</span>
                                <span>
                                  <input
                                    type="number"
                                    min={1}
                                    max={60}
                                    aria-label="播放帧率"
                                    value={selectedExpression.sequence.fps}
                                    onChange={(event) =>
                                      updateExpression(
                                        selectedExpression.id,
                                        (expression) => ({
                                          ...expression,
                                          sequence: expression.sequence
                                            ? {
                                                ...expression.sequence,
                                                fps: Math.min(
                                                  60,
                                                  Math.max(
                                                    1,
                                                    Math.round(
                                                      Number(
                                                        event.target.value,
                                                      ) || 1,
                                                    ),
                                                  ),
                                                ),
                                              }
                                            : expression.sequence,
                                        }),
                                      )
                                    }
                                  />
                                  <em>FPS</em>
                                  <span
                                    className="galgame-expression-fps-slider"
                                    style={
                                      {
                                        "--sequence-ratio":
                                          (selectedExpression.sequence.fps -
                                            1) /
                                          59,
                                      } as CSSProperties
                                    }
                                  >
                                    <input
                                      type="range"
                                      min={1}
                                      max={60}
                                      aria-label="播放帧率滑杆"
                                      value={selectedExpression.sequence.fps}
                                      onChange={(event) =>
                                        updateExpression(
                                          selectedExpression.id,
                                          (expression) => ({
                                            ...expression,
                                            sequence: expression.sequence
                                              ? {
                                                  ...expression.sequence,
                                                  fps: Number(
                                                    event.target.value,
                                                  ),
                                                }
                                              : expression.sequence,
                                          }),
                                        )
                                      }
                                    />
                                  </span>
                                </span>
                              </label>
                              {selectedExpression.sequence.playbackMode ===
                              "lipSync" ? (
                                <div className="galgame-expression-lip-sync-note">
                                  <Volume2 aria-hidden />
                                  <span>
                                    <strong>语音驱动</strong>
                                    <small>静止闭口，按音量切换三帧</small>
                                  </span>
                                </div>
                              ) : (
                                <label className="galgame-expression-setting-toggle">
                                  <span>
                                    <strong>循环播放</strong>
                                    <small>关闭后停留在最后一帧</small>
                                  </span>
                                  <input
                                    type="checkbox"
                                    aria-label="循环播放"
                                    checked={selectedExpression.sequence.loop}
                                    onChange={(event) =>
                                      updateExpression(
                                        selectedExpression.id,
                                        (expression) => ({
                                          ...expression,
                                          sequence: expression.sequence
                                            ? {
                                                ...expression.sequence,
                                                loop: event.target.checked,
                                              }
                                            : expression.sequence,
                                        }),
                                      )
                                    }
                                  />
                                  <i aria-hidden />
                                </label>
                              )}
                            </div>
                            <p className="galgame-expression-sequence-help">
                              {selectedExpression.sequence.playbackMode ===
                              "lipSync"
                                ? "按闭口、半口、张口顺序保存三帧；首帧同时用于缩略图和静止状态。"
                                : `共 ${selectedExpression.sequence.frames.length} 个帧表情。首帧用于父节点缩略图；每帧仍可单独管理资源。`}
                            </p>
                            <ol className="galgame-expression-frame-list">
                              {selectedExpression.sequence.frames.map(
                                (frame, index, frames) => {
                                  const storyAsset = assetsById.get(
                                    frame.assetId,
                                  );
                                  const projectAsset =
                                    projectAssetsQuery.data?.items.find(
                                      (asset) =>
                                        asset.id === storyAsset?.fileId,
                                    );
                                  return (
                                    <li key={frame.id}>
                                      <span>
                                        {selectedExpression.sequence
                                          ?.playbackMode === "lipSync"
                                          ? ["闭", "半", "张"][index]
                                          : index + 1}
                                      </span>
                                      <StoryAssetImage
                                        fileId={storyAsset?.fileId}
                                        alt=""
                                        fallback={<FileImage aria-hidden />}
                                      />
                                      <strong>
                                        {projectAsset?.display_name ??
                                          `帧 ${index + 1}`}
                                      </strong>
                                      <button
                                        type="button"
                                        aria-label={`上移第 ${index + 1} 帧`}
                                        disabled={index === 0}
                                        onClick={() =>
                                          updateSequenceFrames((current) => {
                                            const next = [...current];
                                            [next[index - 1], next[index]] = [
                                              next[index],
                                              next[index - 1],
                                            ];
                                            return next;
                                          })
                                        }
                                      >
                                        <ChevronUp aria-hidden />
                                      </button>
                                      <button
                                        type="button"
                                        aria-label={`下移第 ${index + 1} 帧`}
                                        disabled={index === frames.length - 1}
                                        onClick={() =>
                                          updateSequenceFrames((current) => {
                                            const next = [...current];
                                            [next[index], next[index + 1]] = [
                                              next[index + 1],
                                              next[index],
                                            ];
                                            return next;
                                          })
                                        }
                                      >
                                        <ChevronDown aria-hidden />
                                      </button>
                                      <button
                                        type="button"
                                        className="danger"
                                        aria-label={`删除第 ${index + 1} 帧`}
                                        disabled={
                                          frames.length === 1 ||
                                          selectedExpression.sequence
                                            ?.playbackMode === "lipSync"
                                        }
                                        onClick={() =>
                                          updateSequenceFrames((current) =>
                                            current.filter(
                                              (item) => item.id !== frame.id,
                                            ),
                                          )
                                        }
                                      >
                                        <Trash2 aria-hidden />
                                      </button>
                                    </li>
                                  );
                                },
                              )}
                            </ol>
                            <div className="galgame-expression-sequence-actions">
                              <CustomSelect
                                ariaLabel="从已有表情添加帧"
                                className="galgame-expression-sequence-source"
                                leadingIcon={<ImagePlus aria-hidden />}
                                showChevron={false}
                                disabled={
                                  selectedExpression.sequence.playbackMode ===
                                    "lipSync" &&
                                  selectedExpression.sequence.frames.length >= 3
                                }
                                value=""
                                onChange={appendExistingExpressionFrame}
                                options={[
                                  { value: "", label: "从已有表情添加" },
                                  ...expressions
                                    .filter(
                                      (expression) =>
                                        expression.id !== selectedExpression.id,
                                    )
                                    .map((expression) => ({
                                      value: expression.id,
                                      label: expression.label,
                                    })),
                                ]}
                              />
                              <button
                                type="button"
                                disabled={
                                  selectedExpression.sequence.playbackMode ===
                                    "lipSync" &&
                                  selectedExpression.sequence.frames.length >= 3
                                }
                                onClick={() =>
                                  setPicker({
                                    mode: "sequence",
                                    source: "project",
                                  })
                                }
                              >
                                <FolderOpen aria-hidden /> 从项目素材添加
                              </button>
                              <button
                                type="button"
                                disabled={
                                  selectedExpression.sequence.playbackMode ===
                                    "lipSync" &&
                                  selectedExpression.sequence.frames.length >= 3
                                }
                                onClick={() => {
                                  setPicker({
                                    mode: "sequence",
                                    source: "project",
                                  });
                                  requestAnimationFrame(() =>
                                    fileInput.current?.click(),
                                  );
                                }}
                              >
                                <Plus aria-hidden /> 从本地导入
                              </button>
                            </div>
                          </div>
                        ) : null}
                        <section
                          className={`galgame-expression-detail-preview-section ${
                            expandedExpressionPreview ? "is-expanded" : ""
                          }`}
                          role={
                            expandedExpressionPreview ? "dialog" : undefined
                          }
                          aria-modal={
                            expandedExpressionPreview ? true : undefined
                          }
                          aria-label={
                            selectedExpression.renderMode === "frameSequence"
                              ? "序列帧预览"
                              : "舞台表情预览"
                          }
                        >
                          <header>
                            <span>
                              <FileImage aria-hidden />
                              <strong>
                                {selectedExpression.renderMode ===
                                "frameSequence"
                                  ? "序列帧预览"
                                  : "舞台预览"}
                              </strong>
                            </span>
                            <small>
                              {selectedExpression.renderMode === "frameSequence"
                                ? `${selectedExpression.sequence?.frames.length ?? 0} 帧 · ${selectedExpression.sequence?.fps ?? 2} FPS · `
                                : ""}
                              {previewPosition.name} · X {previewPosition.x}% ·
                              Y {previewPosition.y}% · SIZE{" "}
                              {selectedExpressionHeight}%
                            </small>
                            <button
                              type="button"
                              aria-label={
                                expandedExpressionPreview
                                  ? "退出全屏预览"
                                  : "全屏预览"
                              }
                              onClick={() =>
                                setExpandedExpressionPreview(
                                  (current) => !current,
                                )
                              }
                            >
                              {expandedExpressionPreview ? (
                                <Minimize2 aria-hidden />
                              ) : (
                                <Maximize2 aria-hidden />
                              )}
                            </button>
                          </header>
                          <div
                            className={`galgame-expression-detail-preview is-${previewBackgroundMode}`}
                            style={{
                              aspectRatio: `${canvasWidth} / ${canvasHeight}`,
                            }}
                          >
                            {previewBackgroundMode === "scene" ? (
                              <StoryAssetImage
                                fileId={previewBackgroundAsset?.fileId}
                                alt=""
                                className="galgame-expression-detail-background"
                                fallback={<span />}
                              />
                            ) : null}
                            <span
                              className="galgame-stage-preview-guide"
                              style={{
                                left: `${previewPosition.x}%`,
                                top: `${previewPosition.y}%`,
                              }}
                              aria-hidden
                            >
                              <i />
                            </span>
                            <span
                              className={`galgame-expression-stage-actor is-${stageSettings.anchor}`}
                              data-position={`${previewPosition.x},${previewPosition.y}`}
                              data-size={selectedExpressionHeight}
                              style={{
                                left: `${previewPosition.x}%`,
                                top: `${previewPosition.y}%`,
                                width: `${selectedFootprintWidth}%`,
                                height: `${selectedFootprintHeight}%`,
                                transform:
                                  stageSettings.anchor === "center"
                                    ? "translate(-50%, -50%)"
                                    : "translate(0, 0)",
                              }}
                            >
                              <div
                                className="galgame-portrait-stage-composite"
                                data-flipped={
                                  selectedExpression.flipX || undefined
                                }
                                style={{
                                  transform: `scaleX(${selectedExpression.flipX ? -1 : 1})`,
                                }}
                              >
                                <ExpressionPortrait
                                  expression={selectedExpression}
                                  assets={document.assets ?? []}
                                  skinAssetId={selectedSkinAssetId}
                                  alt={`${selectedCharacter.name} · ${selectedExpression.label}`}
                                  className="galgame-portrait-stage-image"
                                  onNaturalSize={({ width, height }) => {
                                    if (!selectedPortraitFileId) return;
                                    setNaturalPortraitSizes((current) => {
                                      const existing = current.get(
                                        selectedPortraitFileId,
                                      );
                                      if (
                                        existing?.width === width &&
                                        existing.height === height
                                      )
                                        return current;
                                      const next = new Map(current);
                                      next.set(selectedPortraitFileId, {
                                        width,
                                        height,
                                      });
                                      return next;
                                    });
                                  }}
                                  fallback={
                                    <span>
                                      <UserRound aria-hidden />
                                      <strong>尚未绑定基准立绘</strong>
                                      <small>上传图片或从文件库选择。</small>
                                    </span>
                                  }
                                />
                                {(selectedExpression.overlays ?? []).map(
                                  (overlay) => {
                                    const overlayAsset = assetsById.get(
                                      overlay.assetId,
                                    );
                                    return overlayAsset?.type === "image" ? (
                                      <StoryAssetImage
                                        key={overlay.id}
                                        fileId={overlayAsset.fileId}
                                        alt=""
                                        className="galgame-portrait-stage-overlay"
                                        style={{
                                          left: `${overlay.x}%`,
                                          top: `${overlay.y}%`,
                                          width: `${overlay.width}%`,
                                          opacity: overlay.opacity,
                                        }}
                                        fallback={null}
                                      />
                                    ) : null;
                                  },
                                )}
                              </div>
                            </span>
                          </div>
                        </section>
                      </section>

                      <section className="galgame-expression-setting-section">
                        <header>
                          <span>
                            <FlipHorizontal2 aria-hidden />
                            <strong>舞台显示</strong>
                          </span>
                          <small>原始方向 · 跟随剧情块设置</small>
                        </header>
                        <label className="galgame-expression-setting-toggle">
                          <span>
                            <strong>左右翻转</strong>
                            <small>
                              仅影响当前表情的舞台立绘，原图与对白头像保持不变。
                            </small>
                          </span>
                          <input
                            type="checkbox"
                            aria-label="左右翻转"
                            checked={selectedExpression.flipX ?? false}
                            onChange={(event) =>
                              updateExpression(
                                selectedExpression.id,
                                (expression) => ({
                                  ...expression,
                                  flipX: event.target.checked,
                                }),
                              )
                            }
                          />
                          <i aria-hidden />
                        </label>
                      </section>

                      <section className="galgame-expression-setting-section">
                        <header>
                          <span>
                            <Maximize2 aria-hidden />
                            <strong>立绘尺寸</strong>
                          </span>
                          <small>
                            {selectedExpression.heightPercent != null
                              ? `自定义 · ${selectedExpression.heightPercent}%`
                              : `${inheritedExpressionHeightSource} · ${inheritedExpressionHeight}%`}
                          </small>
                        </header>
                        <div
                          className="galgame-expression-size-mode"
                          role="group"
                          aria-label="立绘尺寸模式"
                        >
                          <button
                            type="button"
                            aria-pressed={
                              selectedExpression.heightPercent == null
                            }
                            onClick={() =>
                              updateExpression(
                                selectedExpression.id,
                                (expression) => ({
                                  ...expression,
                                  heightPercent: null,
                                }),
                              )
                            }
                          >
                            跟随角色/全局
                          </button>
                          <button
                            type="button"
                            aria-pressed={
                              selectedExpression.heightPercent != null
                            }
                            onClick={() =>
                              updateExpression(
                                selectedExpression.id,
                                (expression) => ({
                                  ...expression,
                                  heightPercent:
                                    expression.heightPercent ??
                                    inheritedExpressionHeight,
                                }),
                              )
                            }
                          >
                            自定义
                          </button>
                        </div>
                        {selectedExpression.heightPercent != null ? (
                          <label className="galgame-expression-height-field">
                            <span>画面高度</span>
                            <span>
                              <input
                                type="number"
                                aria-label="自定义画面高度"
                                min={1}
                                max={400}
                                value={selectedExpression.heightPercent}
                                onChange={(event) =>
                                  updateExpression(
                                    selectedExpression.id,
                                    (expression) => ({
                                      ...expression,
                                      heightPercent: Math.min(
                                        400,
                                        Math.max(1, Number(event.target.value)),
                                      ),
                                    }),
                                  )
                                }
                              />
                              <em>%</em>
                            </span>
                          </label>
                        ) : null}
                      </section>

                      <section className="galgame-expression-setting-section">
                        <header>
                          <span>
                            <UserRound aria-hidden />
                            <strong>对白头像</strong>
                          </span>
                          <small>
                            {selectedCharacter.dialogueAvatar?.enabled
                              ? "角色统一开启"
                              : "角色统一关闭"}
                          </small>
                        </header>
                        {selectedCharacter.dialogueAvatar?.enabled ? (
                          <div className="galgame-expression-avatar-fields">
                            <label className="galgame-field">
                              <span>头像来源</span>
                              <CustomSelect
                                ariaLabel="对白头像来源"
                                value={
                                  selectedExpression.dialogueAvatar?.source ??
                                  "portrait"
                                }
                                onChange={(value) => {
                                  if (value === "portrait") {
                                    updateExpression(
                                      selectedExpression.id,
                                      (expression) => ({
                                        ...expression,
                                        dialogueAvatar: {
                                          source: "portrait",
                                          assetId: null,
                                          crop: expression.dialogueAvatar
                                            ?.crop ?? {
                                            x: 50,
                                            y: 25,
                                            scale: 1.8,
                                          },
                                        },
                                      }),
                                    );
                                    return;
                                  }
                                  if (
                                    !activeAsset ||
                                    activeAsset.type !== "image"
                                  )
                                    return;
                                  const avatarAssetId = stableId();
                                  onDocument({
                                    ...document,
                                    assets: [
                                      ...(document.assets ?? []),
                                      {
                                        id: avatarAssetId,
                                        type: "image",
                                        role: "dialogueAvatar",
                                        fileId: activeAsset.fileId,
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
                                                        .dialogueAvatar
                                                        ?.crop ?? {
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
                                options={[
                                  {
                                    value: "portrait",
                                    label: "跟随当前皮肤立绘",
                                  },
                                  { value: "independent", label: "独立头像" },
                                ]}
                              />
                            </label>
                            {selectedExpression.dialogueAvatar?.source ===
                            "independent" ? (
                              <label className="galgame-field">
                                <span>独立头像素材</span>
                                <CustomSelect
                                  ariaLabel="独立头像素材"
                                  value={
                                    selectedExpression.dialogueAvatar.assetId ??
                                    ""
                                  }
                                  onChange={(value) => {
                                    const source = (document.assets ?? []).find(
                                      (asset) => asset.id === value,
                                    );
                                    if (!source || source.type !== "image")
                                      return;
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
                                                          .dialogueAvatar
                                                          ?.crop ?? {
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
                                  options={[
                                    { value: "", label: "选择已有图片" },
                                    ...(document.assets ?? [])
                                      .filter((asset) => asset.type === "image")
                                      .map((asset) => ({
                                        value: asset.id,
                                        label: asset.id,
                                      })),
                                  ]}
                                />
                              </label>
                            ) : null}
                          </div>
                        ) : (
                          <div className="galgame-expression-avatar-disabled">
                            <span>
                              <UserRound aria-hidden />
                            </span>
                            <p>
                              <strong>对白头像已关闭</strong>
                              <small>可在左侧表情列表顶部开启。</small>
                            </p>
                          </div>
                        )}
                      </section>
                      <details className="galgame-expression-advanced-settings">
                        <summary>
                          <span>
                            <SlidersHorizontal aria-hidden />
                            <strong>高级设置</strong>
                          </span>
                          <small>裁剪与图形覆盖</small>
                          <ChevronRight aria-hidden />
                        </summary>
                        <div>
                          <section className="galgame-expression-basic-settings">
                            <header>
                              <span>
                                <FileImage aria-hidden />
                                <strong>基本信息</strong>
                              </span>
                              <small>修改后自动保存</small>
                            </header>
                            <div className="galgame-expression-basic-fields">
                              <label className="galgame-field">
                                <span>表情名称</span>
                                <input
                                  aria-label="表情名称"
                                  value={selectedExpression.label}
                                  onChange={(event) =>
                                    updateExpression(
                                      selectedExpression.id,
                                      (expression) => ({
                                        ...expression,
                                        label: event.target.value,
                                      }),
                                    )
                                  }
                                />
                              </label>
                              <label className="galgame-field">
                                <span>表情 ID（只读）</span>
                                <input
                                  aria-label="表情 ID"
                                  value={selectedExpression.id}
                                  readOnly
                                />
                              </label>
                            </div>
                          </section>
                          <fieldset className="galgame-expression-crop-settings">
                            <legend>编辑器缩略图裁剪</legend>
                            {(["x", "y", "scale"] as const).map((key) => (
                              <label key={key}>
                                <span>{key.toUpperCase()}</span>
                                <input
                                  aria-label={`缩略图裁剪 ${key.toUpperCase()}`}
                                  type="number"
                                  min={key === "scale" ? 0.5 : 0}
                                  max={key === "scale" ? 6 : 100}
                                  step={key === "scale" ? 0.1 : 1}
                                  value={
                                    selectedExpression.thumbnailCrop?.[key] ??
                                    { x: 50, y: 25, scale: 1.8 }[key]
                                  }
                                  onChange={(event) =>
                                    updateExpression(
                                      selectedExpression.id,
                                      (expression) => ({
                                        ...expression,
                                        thumbnailCrop: {
                                          ...(expression.thumbnailCrop ?? {
                                            x: 50,
                                            y: 25,
                                            scale: 1.8,
                                          }),
                                          [key]: Number(event.target.value),
                                        },
                                      }),
                                    )
                                  }
                                />
                              </label>
                            ))}
                          </fieldset>
                          {selectedCharacter.dialogueAvatar?.enabled ? (
                            <fieldset className="galgame-expression-crop-settings">
                              <legend>对白头像裁剪</legend>
                              {(["x", "y", "scale"] as const).map((key) => (
                                <label key={key}>
                                  <span>{key.toUpperCase()}</span>
                                  <input
                                    aria-label={`对白头像裁剪 ${key.toUpperCase()}`}
                                    type="number"
                                    min={key === "scale" ? 0.5 : 0}
                                    max={key === "scale" ? 6 : 100}
                                    step={key === "scale" ? 0.1 : 1}
                                    value={
                                      selectedExpression.dialogueAvatar?.crop?.[
                                        key
                                      ] ?? { x: 50, y: 25, scale: 1.8 }[key]
                                    }
                                    onChange={(event) =>
                                      updateExpression(
                                        selectedExpression.id,
                                        (expression) => ({
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
                                        }),
                                      )
                                    }
                                  />
                                </label>
                              ))}
                            </fieldset>
                          ) : null}
                          <section className="galgame-expression-overlays">
                            <header>
                              <strong>图形覆盖</strong>
                              <CustomSelect
                                ariaLabel="添加图形覆盖"
                                value=""
                                onChange={(value) => {
                                  const source = (document.assets ?? []).find(
                                    (asset) => asset.id === value,
                                  );
                                  if (!source || source.type !== "image")
                                    return;
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
                                options={[
                                  { value: "", label: "从已有图片添加…" },
                                  ...(document.assets ?? [])
                                    .filter((asset) => asset.type === "image")
                                    .map((asset) => ({
                                      value: asset.id,
                                      label: asset.id,
                                    })),
                                ]}
                              />
                            </header>
                            {(selectedExpression.overlays ?? []).map(
                              (overlay) => (
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
                                            expression.id ===
                                            selectedExpression.id
                                              ? {
                                                  ...expression,
                                                  overlays: (
                                                    expression.overlays ?? []
                                                  ).map((item) =>
                                                    item.id === overlay.id
                                                      ? {
                                                          ...item,
                                                          name: event.target
                                                            .value,
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
                                            expression.id ===
                                            selectedExpression.id
                                              ? {
                                                  ...expression,
                                                  overlays: (
                                                    expression.overlays ?? []
                                                  ).filter(
                                                    (item) =>
                                                      item.id !== overlay.id,
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
                              ),
                            )}
                          </section>
                        </div>
                      </details>
                      <section className="galgame-expression-setting-section galgame-expression-resource-actions">
                        <header>
                          <span>
                            <RotateCcw aria-hidden />
                            <strong>资源操作</strong>
                          </span>
                          <small>
                            {selectedExpression.id ===
                            selectedCharacter.defaultExpressionId
                              ? "当前默认表情"
                              : "管理当前表情"}
                          </small>
                        </header>
                        <div>
                          <button
                            type="button"
                            onClick={() =>
                              setPicker({
                                mode: "replace",
                                source: "project",
                              })
                            }
                          >
                            <ImagePlus aria-hidden /> 替换图片
                          </button>
                          {selectedExpression.id !==
                          selectedCharacter.defaultExpressionId ? (
                            <button
                              type="button"
                              onClick={() =>
                                setDefaultExpression(selectedExpression.id)
                              }
                            >
                              <Check aria-hidden /> 设为默认
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="danger"
                            onClick={() => deleteExpression(selectedExpression)}
                          >
                            <Trash2 aria-hidden /> 删除表情
                          </button>
                        </div>
                      </section>
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
                                      <CustomSelect
                                        ariaLabel={`${expression.label}皮肤素材`}
                                        value={
                                          selectedSkin.overrides?.find(
                                            (item) =>
                                              item.expressionId ===
                                              expression.id,
                                          )?.assetId ?? ""
                                        }
                                        onChange={(value) =>
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
                                                  overrides: value
                                                    ? [
                                                        ...overrides,
                                                        {
                                                          expressionId:
                                                            expression.id,
                                                          assetId: value,
                                                        },
                                                      ]
                                                    : overrides,
                                                };
                                              }),
                                            }),
                                          )
                                        }
                                        options={[
                                          {
                                            value: "",
                                            label: "跟随原始表情",
                                          },
                                          ...(
                                            selectedCharacter.expressions ?? []
                                          ).map((source) => ({
                                            value: source.assetId,
                                            label: `使用 ${source.label} 素材`,
                                          })),
                                        ]}
                                      />
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

      <aside
        className={`galgame-character-reference-panel ${
          expressionDetailLayout ? "is-drawer" : ""
        } ${referencePanelOpen ? "is-open" : ""}`}
      >
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
          {expressionDetailLayout ? (
            <button
              type="button"
              className="galgame-character-reference-close"
              aria-label="关闭资源引用"
              onClick={() => setReferencePanelOpen(false)}
            >
              <X aria-hidden />
            </button>
          ) : null}
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
                    transform: `${
                      stageSettings.anchor === "center"
                        ? "translate(-50%, -50%)"
                        : "translate(0, 0)"
                    } scaleX(${previewExpression?.flipX ? -1 : 1})`,
                  }}
                >
                  <ExpressionPortrait
                    expression={previewExpression}
                    assets={document.assets ?? []}
                    skinAssetId={previewSkinAssetId}
                    alt={selectedCharacter?.name ?? "角色预览"}
                    fallback={<UserRound aria-hidden />}
                    onNaturalSize={({ width, height }) => {
                      if (!previewResolvedAsset?.fileId) return;
                      const fileId = previewResolvedAsset.fileId;
                      setNaturalPortraitSizes((current) => {
                        const existing = current.get(fileId);
                        if (
                          existing?.width === width &&
                          existing.height === height
                        )
                          return current;
                        const next = new Map(current);
                        next.set(fileId, { width, height });
                        return next;
                      });
                    }}
                  />
                  {(previewExpression?.overlays ?? []).map((overlay) => {
                    const overlayAsset = assetsById.get(overlay.assetId);
                    return overlayAsset?.type === "image" ? (
                      <StoryAssetImage
                        key={overlay.id}
                        fileId={overlayAsset.fileId}
                        alt=""
                        className="galgame-character-preview-overlay"
                        style={{
                          left: `${overlay.x}%`,
                          top: `${overlay.y}%`,
                          width: `${overlay.width}%`,
                          opacity: overlay.opacity,
                        }}
                        fallback={null}
                      />
                    ) : null;
                  })}
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
              <CustomSelect
                ariaLabel="角色预览背景"
                value={previewSceneId}
                onChange={setPreviewSceneId}
                disabled={previewBackgroundMode !== "scene"}
                options={[
                  { value: "", label: "棋盘背景" },
                  ...(document.scenes ?? []).map((scene) => ({
                    value: scene.id,
                    label: scene.name,
                  })),
                ]}
              />
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
          sequenceTitle="从项目素材添加序列帧"
          searchLabel="搜索立绘素材"
          projectEmptyCopy="上传图片后即可绑定为角色立绘。"
          onState={setPicker}
          onChoose={bindFile}
          onChooseMany={appendSequenceFiles}
          onUpload={() => fileInput.current?.click()}
          onClose={() => setPicker(undefined)}
        />
      ) : null}
      <ConfirmDialog
        open={confirmStaticMode}
        title="切换为静态图片？"
        description="切换后只保留当前序列的首帧，其余帧配置将从这个表情中移除。"
        confirmLabel="保留首帧并切换"
        onCancel={() => setConfirmStaticMode(false)}
        onConfirm={applyExpressionStaticMode}
      />
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
