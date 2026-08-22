import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  LocateFixed,
  LockKeyhole,
  Plus,
  RotateCcw,
  Star,
  Trash2,
  UserRound,
  UserRoundPlus,
  Wrench,
} from "lucide-react";
import type {
  GalgameProjectAsset,
  GalgameStoryPositionPreset,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import { ExpressionPortrait } from "@features/galgame-workshop/editor/ExpressionPortrait";
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
import { StoryAssetImage } from "@features/galgame-workshop/editor/StoryAssetImage";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { CustomSelect } from "@shared/ui/CustomSelect";

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

export function CharacterStageSettingsWorkspace({
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
}: {
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

  return (
    <div className="galgame-stage-settings-workspace">
      <header className="galgame-stage-settings-header">
        <span className="galgame-stage-settings-title">
          <LocateFixed aria-hidden />
          <span>
            <strong>位置与尺寸</strong>
            <small>统一调整站位、全局基准尺寸与坐标锚点。</small>
          </span>
        </span>
        <div className="galgame-stage-scope-control" ref={scopeMenuRef}>
          <small>配置对象</small>
          <button
            type="button"
            className="galgame-stage-scope-trigger"
            aria-haspopup="listbox"
            aria-expanded={scopeMenuOpen}
            onClick={() => setScopeMenuOpen((current) => !current)}
          >
            <strong>{scopeLabel}</strong>
            <em>
              {scopeId === "global"
                ? "固定"
                : activeOverride
                  ? "独立"
                  : "跟随全局"}
            </em>
            <ChevronDown aria-hidden />
          </button>
          {scopeMenuOpen ? (
            <div
              className="galgame-stage-scope-menu"
              role="listbox"
              aria-label="位置与尺寸配置对象"
            >
              <button
                type="button"
                role="option"
                aria-selected={scopeId === "global"}
                onClick={() => {
                  onScopeId("global");
                  setScopeMenuOpen(false);
                }}
              >
                <strong>全局</strong>
                <span>
                  <LockKeyhole aria-hidden /> 固定
                </span>
              </button>
              {characters.map((character) => {
                const independent = Boolean(overrides[character.id]);
                return (
                  <button
                    key={character.id}
                    type="button"
                    role="option"
                    aria-selected={scopeId === character.id}
                    onClick={() => {
                      onScopeId(character.id);
                      setScopeMenuOpen(false);
                    }}
                  >
                    <strong>{character.name}</strong>
                    <span className={independent ? "is-independent" : ""}>
                      {independent ? "独立" : "跟随全局"}
                    </span>
                  </button>
                );
              })}
              {!characters.length ? <p>创建角色后可添加独立方案。</p> : null}
            </div>
          ) : null}
        </div>
        {inheritsGlobal ? (
          <button
            type="button"
            className="galgame-stage-create-scheme"
            onClick={createIndependentScheme}
          >
            <UserRoundPlus aria-hidden /> 创建独立方案
          </button>
        ) : (
          <button
            type="button"
            className="galgame-stage-reset"
            onClick={requestReset}
          >
            <RotateCcw aria-hidden /> 恢复默认
          </button>
        )}
        {scopeId !== "global" && activeOverride ? (
          <button
            type="button"
            className="galgame-stage-delete-scheme"
            aria-label="删除角色独立方案"
            onClick={() => setConfirmAction("delete-override")}
          >
            <Trash2 aria-hidden />
          </button>
        ) : null}
      </header>

      {inheritsGlobal ? (
        <div className="galgame-stage-inherited-notice">
          <span>
            <LockKeyhole aria-hidden /> 当前角色正在跟随全局方案。
          </span>
          <button type="button" onClick={createIndependentScheme}>
            为 {scopeLabel} 创建独立方案
          </button>
        </div>
      ) : null}

      <section className="galgame-stage-preview-shell">
        <header className="galgame-stage-preview-toolbar">
          <span className="galgame-stage-active-position">
            <small>ACTIVE</small>
            <strong>{selectedPosition.name}</strong>
            {stageSettings.defaultPositionId === selectedPosition.id ? (
              <em>
                <Star aria-hidden /> 默认
              </em>
            ) : null}
          </span>
          <div className="galgame-stage-background-controls">
            <small>背景</small>
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
                className={backgroundMode === mode ? "active" : ""}
                onClick={() => setBackgroundMode(mode)}
              >
                {label}
              </button>
            ))}
            <CustomSelect
              ariaLabel="位置与尺寸预览背景"
              value={sceneId}
              onChange={setSceneId}
              disabled={backgroundMode !== "scene"}
              options={[
                { value: "", label: "无背景图" },
                ...(document.scenes ?? []).map((scene) => ({
                  value: scene.id,
                  label: scene.name,
                })),
              ]}
            />
          </div>
          <span className="galgame-stage-preview-metrics">
            <b>X {selectedPosition.x}%</b>
            <b>Y {selectedPosition.y}%</b>
            <b>SIZE {stageSettings.defaultHeightPercent}%</b>
          </span>
        </header>
        <div
          className={`galgame-stage-preview-canvas is-${backgroundMode} ${inheritsGlobal ? "is-readonly" : ""}`}
          style={{ aspectRatio: `${canvasWidth} / ${canvasHeight}` }}
          role="application"
          tabIndex={inheritsGlobal ? -1 : 0}
          aria-label="位置与尺寸舞台预览"
          onPointerDown={(event) => {
            if (inheritsGlobal) return;
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
          onKeyDown={(event) => {
            if (inheritsGlobal) return;
            const step = event.shiftKey ? 2.5 : 0.5;
            const delta = {
              ArrowLeft: [-step, 0],
              ArrowRight: [step, 0],
              ArrowUp: [0, -step],
              ArrowDown: [0, step],
            }[event.key];
            if (!delta) return;
            event.preventDefault();
            updateCoordinates(
              selectedPosition.x + delta[0],
              selectedPosition.y + delta[1],
            );
          }}
        >
          {backgroundMode === "scene" ? (
            <StoryAssetImage
              fileId={previewBackgroundAsset?.fileId}
              alt=""
              className="galgame-stage-preview-background"
              fallback={<span />}
            />
          ) : null}
          <span
            className={`galgame-stage-preview-actor is-${stageSettings.anchor}`}
            title={
              hasPortraitDimensions
                ? `原图 ${portraitWidth} × ${portraitHeight}px · 方案基准 ${stageSettings.defaultHeightPercent}%`
                : "当前素材缺少可用的图片尺寸元数据"
            }
            style={{
              left: `${selectedPosition.x}%`,
              top: `${selectedPosition.y}%`,
              width: `${footprintWidth}%`,
              height: `${footprintHeight}%`,
              transform: `${
                stageSettings.anchor === "center"
                  ? "translate(-50%, -50%)"
                  : stageSettings.anchor === "bottomCenter"
                    ? "translate(-50%, -100%)"
                    : "translate(0, 0)"
              } scaleX(${previewExpression?.flipX ? -1 : 1})`,
            }}
          >
            <ExpressionPortrait
              expression={previewExpression}
              assets={document.assets ?? []}
              skinAssetId={previewSkinAssetId}
              alt={previewCharacter?.name ?? "角色预览"}
              fallback={<UserRound aria-hidden />}
              onNaturalSize={({ width, height }) => {
                if (!portraitFileId) return;
                setNaturalPortraitSizes((current) => {
                  const existing = current.get(portraitFileId);
                  if (existing?.width === width && existing.height === height)
                    return current;
                  const next = new Map(current);
                  next.set(portraitFileId, { width, height });
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
                  className="galgame-stage-preview-overlay"
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
          <span
            className="galgame-stage-preview-guide"
            style={{
              left: `${selectedPosition.x}%`,
              top: `${selectedPosition.y}%`,
            }}
          >
            <i />
          </span>
          <small className="galgame-stage-preview-scope-note">
            {previewCharacter
              ? `${previewCharacter.name} · 仅按当前方案基准尺寸预览`
              : "创建角色并绑定立绘后可查看实际边界"}
          </small>
        </div>
      </section>

      <fieldset
        className="galgame-stage-parameter-grid"
        disabled={inheritsGlobal}
      >
        <section className="galgame-stage-parameter-panel is-presets">
          <header>
            <span>
              <b>01</b>
              <strong>位置预设</strong>
            </span>
            <small>{stageSettings.positionPresets.length} 个</small>
          </header>
          <div className="galgame-stage-preset-grid">
            {stageSettings.positionPresets.map((preset) => (
              <div
                key={preset.id}
                className={selectedPosition.id === preset.id ? "active" : ""}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (draggedPresetId) movePreset(draggedPresetId, preset.id);
                  setDraggedPresetId(undefined);
                }}
              >
                <button
                  type="button"
                  className="galgame-stage-preset-grip"
                  aria-label={`移动位置预设 ${preset.name}`}
                  draggable
                  onDragStart={() => setDraggedPresetId(preset.id)}
                  onDragEnd={() => setDraggedPresetId(undefined)}
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
                    movePreset(preset.id, target.id);
                  }}
                >
                  <GripVertical aria-hidden />
                </button>
                {editingPresetId === preset.id ? (
                  <input
                    aria-label="位置预设名称"
                    autoFocus
                    value={presetNameDraft}
                    maxLength={40}
                    onChange={(event) => setPresetNameDraft(event.target.value)}
                    onBlur={() => submitPresetName(preset.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") submitPresetName(preset.id);
                      if (event.key === "Escape") {
                        setEditingPresetId(undefined);
                        setPresetNameDraft("");
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="galgame-stage-preset-select"
                    onClick={() => setSelectedPositionId(preset.id)}
                    onDoubleClick={() => {
                      if (preset.builtinKey) return;
                      setEditingPresetId(preset.id);
                      setPresetNameDraft(preset.name);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "F2" || preset.builtinKey) return;
                      event.preventDefault();
                      setEditingPresetId(preset.id);
                      setPresetNameDraft(preset.name);
                    }}
                  >
                    <span aria-hidden className="galgame-stage-preset-map">
                      <i
                        style={{ left: `${preset.x}%`, top: `${preset.y}%` }}
                      />
                    </span>
                    <span>
                      <strong>{preset.name}</strong>
                      <small>
                        {preset.x}，{preset.y}
                      </small>
                    </span>
                  </button>
                )}
                {stageSettings.defaultPositionId === preset.id ? (
                  <Star aria-label="默认位置" />
                ) : null}
              </div>
            ))}
            {addingPreset ? (
              <form
                className="galgame-stage-preset-new"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitPresetName();
                }}
              >
                <input
                  aria-label="新增位置预设名称"
                  autoFocus
                  maxLength={40}
                  value={presetNameDraft}
                  placeholder="位置名称"
                  onChange={(event) => setPresetNameDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setAddingPreset(false);
                      setPresetNameDraft("");
                    }
                  }}
                />
              </form>
            ) : null}
          </div>
          <footer>
            <button
              type="button"
              onClick={() => {
                setAddingPreset(true);
                setEditingPresetId(undefined);
                setPresetNameDraft("");
              }}
              disabled={stageSettings.positionPresets.length >= 20}
            >
              <Plus aria-hidden /> 新增位置
            </button>
            <button
              type="button"
              aria-label="删除位置预设"
              onClick={deleteSelectedPreset}
              disabled={Boolean(selectedPosition.builtinKey)}
            >
              <Trash2 aria-hidden />
            </button>
          </footer>
        </section>

        <section className="galgame-stage-parameter-panel is-position">
          <header>
            <span>
              <b>02</b>
              <strong>精确位置</strong>
            </span>
            <small>{selectedPosition.name}</small>
          </header>
          {(
            [
              ["X", selectedPosition.x],
              ["Y", selectedPosition.y],
            ] as const
          ).map(([axis, value]) => (
            <label key={axis} className="galgame-stage-precision-field">
              <span>
                <strong>{axis} 坐标</strong>
                <em>{value}%</em>
              </span>
              <span>
                <input
                  aria-label={`${selectedPosition.name}站位 ${axis}`}
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={value}
                  onChange={(event) =>
                    updateCoordinates(
                      axis === "X"
                        ? Number(event.target.value)
                        : selectedPosition.x,
                      axis === "Y"
                        ? Number(event.target.value)
                        : selectedPosition.y,
                    )
                  }
                />
                <small>%</small>
                <input
                  aria-label={`${selectedPosition.name}站位 ${axis} 滑杆`}
                  type="range"
                  min="0"
                  max="100"
                  step="0.5"
                  value={value}
                  style={rangeStyle(value, 0, 100)}
                  onChange={(event) =>
                    updateCoordinates(
                      axis === "X"
                        ? Number(event.target.value)
                        : selectedPosition.x,
                      axis === "Y"
                        ? Number(event.target.value)
                        : selectedPosition.y,
                    )
                  }
                />
              </span>
            </label>
          ))}
          <button
            type="button"
            className="galgame-stage-default-position"
            disabled={stageSettings.defaultPositionId === selectedPosition.id}
            onClick={() =>
              replaceSettings({
                ...stageSettings,
                defaultPositionId: selectedPosition.id,
              })
            }
          >
            <Star aria-hidden /> 设为默认位置
          </button>
        </section>

        <section className="galgame-stage-parameter-panel is-size">
          <header>
            <span>
              <b>03</b>
              <strong>尺寸与锚点</strong>
            </span>
            <small>{stageSettings.defaultHeightPercent}%</small>
          </header>
          <label className="galgame-stage-precision-field">
            <span>
              <strong>方案基准尺寸</strong>
              <em>{stageSettings.defaultHeightPercent}%</em>
            </span>
            <span>
              <input
                aria-label="默认画面高度"
                type="number"
                min="1"
                max="400"
                step="1"
                value={stageSettings.defaultHeightPercent}
                onChange={(event) =>
                  replaceSettings({
                    ...stageSettings,
                    defaultHeightPercent: clamp(
                      Number(event.target.value),
                      1,
                      400,
                      0,
                    ),
                  })
                }
              />
              <small>%</small>
              <input
                aria-label="默认画面高度滑杆"
                type="range"
                min="1"
                max="400"
                step="1"
                value={stageSettings.defaultHeightPercent}
                style={rangeStyle(stageSettings.defaultHeightPercent, 1, 400)}
                onChange={(event) =>
                  replaceSettings({
                    ...stageSettings,
                    defaultHeightPercent: Number(event.target.value),
                  })
                }
              />
            </span>
          </label>
          <div className="galgame-stage-anchor-control">
            <strong>坐标锚点</strong>
            <span>
              <button
                type="button"
                className={stageSettings.anchor === "center" ? "active" : ""}
                onClick={() =>
                  replaceSettings({ ...stageSettings, anchor: "center" })
                }
              >
                中心点
              </button>
              <button
                type="button"
                className={stageSettings.anchor === "topLeft" ? "active" : ""}
                onClick={() =>
                  replaceSettings({ ...stageSettings, anchor: "topLeft" })
                }
              >
                左上角
              </button>
              <button
                type="button"
                className={
                  stageSettings.anchor === "bottomCenter" ? "active" : ""
                }
                onClick={() =>
                  replaceSettings({ ...stageSettings, anchor: "bottomCenter" })
                }
              >
                底部居中
              </button>
            </span>
          </div>
          <p>宽度按素材原始比例换算；角色和表情尺寸仍可覆盖方案基准。</p>
        </section>
      </fieldset>

      <section className="galgame-stage-maintenance">
        <button
          type="button"
          aria-expanded={maintenanceOpen}
          onClick={() => setMaintenanceOpen((current) => !current)}
        >
          <span>
            <Wrench aria-hidden />
            <strong>旧立绘尺寸维护</strong>
            <small>扫描并升级旧版立绘尺寸数据</small>
          </span>
          {maintenanceOpen ? (
            <ChevronUp aria-hidden />
          ) : (
            <ChevronDown aria-hidden />
          )}
        </button>
        {maintenanceOpen ? (
          <div>
            <button
              type="button"
              onClick={onPreviewPortraitUpgrade}
              disabled={portraitUpgradePending}
            >
              {portraitUpgradePending ? "正在扫描…" : "预览旧立绘尺寸升级"}
            </button>
            {portraitUpgradePreview ? (
              <div className="galgame-stage-maintenance-result">
                <small>
                  可升级{" "}
                  {
                    portraitUpgradePreview.items.filter(
                      (item) => item.status === "ready",
                    ).length
                  }{" "}
                  项，缺少尺寸{" "}
                  {
                    portraitUpgradePreview.items.filter(
                      (item) => item.status === "missing_metadata",
                    ).length
                  }{" "}
                  项。
                </small>
                <ul>
                  {portraitUpgradePreview.items.slice(0, 6).map((item) => (
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
                    !portraitUpgradePreview.items.some(
                      (item) => item.status === "ready",
                    )
                  }
                  onClick={onApplyPortraitUpgrade}
                >
                  确认应用并保存快照
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <ConfirmDialog
        open={confirmAction === "reset"}
        title={`恢复${scopeId === "global" ? "全局默认" : "全局方案副本"}？`}
        description="当前自定义位置预设会被删除，位置、尺寸与锚点也会一并恢复。"
        confirmLabel="恢复默认"
        onCancel={() => setConfirmAction(null)}
        onConfirm={resetScheme}
      />
      <ConfirmDialog
        open={confirmAction === "delete-override"}
        title={`删除“${scopeLabel}”的独立方案？`}
        description="删除后该角色将立即改为跟随全局位置、尺寸与锚点设置。"
        confirmLabel="删除独立方案"
        onCancel={() => setConfirmAction(null)}
        onConfirm={deleteIndependentScheme}
      />
    </div>
  );
}
