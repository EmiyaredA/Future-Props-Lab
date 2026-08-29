import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {
  GalgameProjectAsset,
  GalgameStoryPositionPreset,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import {
  portraitFootprintWidth,
  type PortraitNaturalSize,
} from "@features/galgame-workshop/editor/portraitSizing";
import {
  DEFAULT_STORY_SETTINGS,
  normalizeCharacterStageSettings,
  stableId,
  type ResolvedCharacterStageSettings,
} from "@features/galgame-workshop/editor/model";

type StageScopeId = "global" | string;
type BackgroundMode = "scene" | "dark" | "light" | "checkerboard";
type ConfirmAction = "reset" | "delete-override" | null;

type PortraitUpgradePreview = {
  items: Array<{
    characterId: string;
    expressionId: string;
    status: string;
    currentHeightPercent?: number | null;
    targetHeightPercent?: number | null;
  }>;
};

function clamp(value: number, min: number, max: number, decimals = 1) {
  const finite = Number.isFinite(value) ? value : min;
  return Number(Math.min(max, Math.max(min, finite)).toFixed(decimals));
}

function cloneStageSettings(
  settings: ResolvedCharacterStageSettings,
): ResolvedCharacterStageSettings {
  return {
    ...settings,
    positionPresets: settings.positionPresets.map((preset) => ({ ...preset })),
  };
}

export function useCharacterStageController(props: {
  document: GalgameStoryProject;
  selectedCharacterId?: string;
  scopeId: StageScopeId;
  projectAssets: GalgameProjectAsset[];
  portraitUpgradePreview?: PortraitUpgradePreview;
  portraitUpgradePending: boolean;
  onScopeId: (scopeId: StageScopeId) => void;
  onDocument: (document: GalgameStoryProject) => void;
  onCommitDocument: (document: GalgameStoryProject) => Promise<boolean>;
  onNotice: (message: string) => void;
  onPreviewPortraitUpgrade: () => void;
  onApplyPortraitUpgrade: () => void;
}) {
  const {
    document,
    selectedCharacterId,
    scopeId,
    projectAssets,
    portraitUpgradePreview,
    portraitUpgradePending,
    onScopeId,
    onDocument,
    onCommitDocument,
    onNotice,
    onPreviewPortraitUpgrade,
    onApplyPortraitUpgrade,
  } = props;
  const characters = document.characters ?? [];
  const [scopeMenuOpen, setScopeMenuOpen] = useState(false);
  const [selectedPositionId, setSelectedPositionId] =
    useState("position-center");
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>("scene");
  const [sceneId, setSceneId] = useState(document.scenes?.[0]?.id ?? "");
  const [addingPreset, setAddingPreset] = useState(false);
  const [editingPresetId, setEditingPresetId] = useState<string>();
  const [presetNameDraft, setPresetNameDraft] = useState("");
  const [draggedPresetId, setDraggedPresetId] = useState<string>();
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [naturalPortraitSizes, setNaturalPortraitSizes] = useState<
    Map<string, PortraitNaturalSize>
  >(new Map());
  const scopeMenuRef = useRef<HTMLDivElement>(null);
  const stageDragPointerId = useRef<number | null>(null);

  const globalSettings = normalizeCharacterStageSettings(
    document.settings?.characterStage,
  );
  const overrides = document.settings?.characterStageOverrides ?? {};
  const scopedCharacter =
    scopeId === "global"
      ? undefined
      : characters.find((character) => character.id === scopeId);
  const activeOverride = scopeId === "global" ? undefined : overrides[scopeId];
  const inheritsGlobal = scopeId !== "global" && !activeOverride;
  const stageSettings =
    scopeId === "global"
      ? globalSettings
      : normalizeCharacterStageSettings(activeOverride ?? globalSettings);
  const previewCharacter =
    scopedCharacter ??
    characters.find((character) => character.id === selectedCharacterId) ??
    characters[0];
  const previewExpression =
    previewCharacter?.expressions?.find(
      (expression) => expression.id === previewCharacter.defaultExpressionId,
    ) ?? previewCharacter?.expressions?.[0];
  const previewSkinAssetId = previewCharacter?.portraitSkins
    ?.find((skin) => skin.id === previewCharacter.defaultPortraitSkinId)
    ?.overrides?.find(
      (override) => override.expressionId === previewExpression?.id,
    )?.assetId;
  const assetsById = useMemo(
    () => new Map((document.assets ?? []).map((asset) => [asset.id, asset])),
    [document.assets],
  );
  const previewExpressionAsset = previewExpression
    ? assetsById.get(previewExpression.assetId)
    : undefined;
  const previewResolvedAsset = previewSkinAssetId
    ? assetsById.get(previewSkinAssetId)
    : previewExpressionAsset;
  const portraitFileId = previewResolvedAsset?.fileId;
  const portraitMetadata = projectAssets.find(
    (asset) => asset.id === portraitFileId,
  );
  const matchingNaturalSize = portraitFileId
    ? naturalPortraitSizes.get(portraitFileId)
    : undefined;
  const portraitWidth = portraitMetadata?.width ?? matchingNaturalSize?.width;
  const portraitHeight =
    portraitMetadata?.height ?? matchingNaturalSize?.height;
  const canvasWidth = document.settings?.canvas?.width ?? 1920;
  const canvasHeight = document.settings?.canvas?.height ?? 1080;
  const hasPortraitDimensions = Boolean(portraitWidth && portraitHeight);
  const footprintHeight = stageSettings.defaultHeightPercent;
  const portraitSize =
    portraitWidth && portraitHeight
      ? { width: portraitWidth, height: portraitHeight }
      : undefined;
  const cachedCharacterPortraitSize = (previewCharacter?.expressions ?? [])
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
  const footprintWidth = portraitFootprintWidth(
    footprintHeight,
    canvasWidth,
    canvasHeight,
    portraitSize,
    cachedCharacterPortraitSize,
  );
  const selectedPosition =
    stageSettings.positionPresets.find(
      (preset) => preset.id === selectedPositionId,
    ) ?? stageSettings.positionPresets[0];
  const previewScene = (document.scenes ?? []).find(
    (scene) => scene.id === sceneId,
  );
  const previewBackgroundAsset = assetsById.get(
    previewScene?.layers?.[0]?.assetId ?? "",
  );
  const scopeLabel =
    scopeId === "global" ? "全局" : (scopedCharacter?.name ?? "角色方案");

  useEffect(() => {
    if (scopeId === "global" || scopedCharacter) return;
    onScopeId("global");
  }, [onScopeId, scopeId, scopedCharacter]);

  useEffect(() => {
    if (!selectedPosition) return;
    if (selectedPosition.id !== selectedPositionId)
      setSelectedPositionId(selectedPosition.id);
  }, [selectedPosition, selectedPositionId]);

  useEffect(() => {
    if (!scopeMenuOpen) return;
    const close = (event: MouseEvent) => {
      if (!scopeMenuRef.current?.contains(event.target as Node))
        setScopeMenuOpen(false);
    };
    const closeWithKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") setScopeMenuOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", closeWithKeyboard);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", closeWithKeyboard);
    };
  }, [scopeMenuOpen]);

  const replaceSettings = (
    next: ResolvedCharacterStageSettings,
    targetScopeId: StageScopeId = scopeId,
    commit = false,
  ) => {
    const settings = {
      ...(document.settings ?? {}),
      characterStage: globalSettings,
      characterStageOverrides: { ...overrides },
    };
    if (targetScopeId === "global") settings.characterStage = next;
    else settings.characterStageOverrides[targetScopeId] = next;
    const nextDocument = { ...document, settings };
    if (commit) void onCommitDocument(nextDocument);
    else onDocument(nextDocument);
  };

  const updatePosition = (
    presetId: string,
    patch: Partial<Pick<GalgameStoryPositionPreset, "name" | "x" | "y">>,
  ) => {
    if (inheritsGlobal) return;
    replaceSettings({
      ...stageSettings,
      positionPresets: stageSettings.positionPresets.map((preset) =>
        preset.id === presetId ? { ...preset, ...patch } : preset,
      ),
    });
  };

  const updateCoordinates = (requestedX: number, requestedY: number) => {
    if (!selectedPosition || inheritsGlobal) return;
    updatePosition(selectedPosition.id, {
      x: clamp(requestedX, 0, 100),
      y: clamp(requestedY, 0, 100),
    });
  };

  const updateStagePoint = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    updateCoordinates(
      ((event.clientX - rect.left) / rect.width) * 100,
      ((event.clientY - rect.top) / rect.height) * 100,
    );
  };

  const movePreset = (sourceId: string, targetId: string) => {
    if (sourceId === targetId || inheritsGlobal) return;
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
    replaceSettings({ ...stageSettings, positionPresets });
  };

  const submitPresetName = (presetId?: string) => {
    const name = presetNameDraft.trim();
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
      updatePosition(presetId, { name });
      setEditingPresetId(undefined);
    } else {
      if (stageSettings.positionPresets.length >= 20) {
        onNotice("位置预设最多可创建 20 个。");
        return;
      }
      const id = stableId();
      replaceSettings({
        ...stageSettings,
        positionPresets: [
          ...stageSettings.positionPresets,
          { id, name, x: 50, y: 50 },
        ],
      });
      setSelectedPositionId(id);
      setAddingPreset(false);
    }
    setPresetNameDraft("");
  };

  const deleteSelectedPreset = () => {
    if (!selectedPosition || selectedPosition.builtinKey || inheritsGlobal)
      return;
    const positionPresets = stageSettings.positionPresets.filter(
      (preset) => preset.id !== selectedPosition.id,
    );
    const fallback =
      positionPresets.find(
        (preset) => preset.id === stageSettings.defaultPositionId,
      ) ?? positionPresets[0];
    replaceSettings({
      ...stageSettings,
      positionPresets,
      defaultPositionId:
        stageSettings.defaultPositionId === selectedPosition.id
          ? fallback.id
          : stageSettings.defaultPositionId,
    });
    setSelectedPositionId(fallback.id);
  };

  const createIndependentScheme = () => {
    if (scopeId === "global" || activeOverride) return;
    replaceSettings(cloneStageSettings(globalSettings), scopeId, true);
    onNotice(`已为“${scopedCharacter?.name ?? "角色"}”创建独立方案。`);
  };

  const resetScheme = () => {
    const target =
      scopeId === "global"
        ? normalizeCharacterStageSettings(DEFAULT_STORY_SETTINGS.characterStage)
        : cloneStageSettings(globalSettings);
    replaceSettings(target);
    setSelectedPositionId(target.defaultPositionId);
    setAddingPreset(false);
    setEditingPresetId(undefined);
    setConfirmAction(null);
  };

  const requestReset = () => {
    const hasCustom = stageSettings.positionPresets.some(
      (preset) => !preset.builtinKey,
    );
    if (hasCustom) setConfirmAction("reset");
    else resetScheme();
  };

  const deleteIndependentScheme = () => {
    if (scopeId === "global") return;
    const nextOverrides = { ...overrides };
    delete nextOverrides[scopeId];
    void onCommitDocument({
      ...document,
      settings: {
        ...(document.settings ?? {}),
        characterStage: globalSettings,
        characterStageOverrides: nextOverrides,
      },
    });
    setSelectedPositionId(globalSettings.defaultPositionId);
    setConfirmAction(null);
    onNotice(`已删除“${scopedCharacter?.name ?? "角色"}”的独立方案。`);
  };

  const rangeStyle = (value: number, min: number, max: number) =>
    ({
      "--stage-range-progress": `${((value - min) / (max - min)) * 100}%`,
    }) as CSSProperties;

  return {
    document,
    selectedCharacterId,
    scopeId,
    projectAssets,
    portraitUpgradePreview,
    portraitUpgradePending,
    onScopeId,
    onDocument,
    onCommitDocument,
    onNotice,
    onPreviewPortraitUpgrade,
    onApplyPortraitUpgrade,
    characters,
    scopeMenuOpen,
    setScopeMenuOpen,
    selectedPositionId,
    setSelectedPositionId,
    backgroundMode,
    setBackgroundMode,
    sceneId,
    setSceneId,
    addingPreset,
    setAddingPreset,
    editingPresetId,
    setEditingPresetId,
    presetNameDraft,
    setPresetNameDraft,
    draggedPresetId,
    setDraggedPresetId,
    maintenanceOpen,
    setMaintenanceOpen,
    naturalPortraitSizes,
    setNaturalPortraitSizes,
    confirmAction,
    setConfirmAction,
    scopeMenuRef,
    stageDragPointerId,
    globalSettings,
    overrides,
    scopedCharacter,
    activeOverride,
    inheritsGlobal,
    stageSettings,
    previewCharacter,
    previewExpression,
    previewSkinAssetId,
    assetsById,
    previewExpressionAsset,
    previewResolvedAsset,
    portraitFileId,
    portraitMetadata,
    matchingNaturalSize,
    portraitWidth,
    portraitHeight,
    canvasWidth,
    canvasHeight,
    hasPortraitDimensions,
    footprintHeight,
    portraitSize,
    cachedCharacterPortraitSize,
    footprintWidth,
    selectedPosition,
    previewScene,
    previewBackgroundAsset,
    scopeLabel,
    replaceSettings,
    updatePosition,
    updateCoordinates,
    updateStagePoint,
    movePreset,
    submitPresetName,
    deleteSelectedPreset,
    createIndependentScheme,
    resetScheme,
    requestReset,
    deleteIndependentScheme,
    rangeStyle,
  };
}
