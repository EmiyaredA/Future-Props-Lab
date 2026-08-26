import {
  Check,
  ChevronRight,
  FileImage,
  FlipHorizontal2,
  ImagePlus,
  Maximize2,
  Minimize2,
  PencilLine,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  UserRound,
} from "lucide-react";
import { CharacterExpressionPresentation } from "@features/galgame-workshop/editor/CharacterExpressionPresentation";
import { stableId } from "@features/galgame-workshop/editor/model";
import { StoryAssetImage } from "@features/galgame-workshop/editor/StoryAssetImage";
import { ExpressionPortrait } from "@features/galgame-workshop/editor/ExpressionPortrait";
import { CustomSelect } from "@shared/ui/CustomSelect";
import type { CharacterWorkspaceViewModel } from "@features/galgame-workshop/editor/characterWorkspaceViewModel";
export function CharacterExpressionForm({
  model,
}: {
  model: CharacterWorkspaceViewModel;
}) {
  const {
    document,
    onDocument,
    characters,
    previewBackgroundMode,
    setNaturalPortraitSizes,
    setPicker,
    expandedExpressionPreview,
    setExpandedExpressionPreview,
    selectedCharacter,
    selectedExpression,
    selectedSkinAssetId,
    assetsById,
    updateCharacter,
    setDefaultExpression,
    updateExpression,
    deleteExpression,
    activeAsset,
    previewBackgroundAsset,
    stageSettings,
    inheritedExpressionHeight,
    inheritedExpressionHeightSource,
    previewPosition,
    canvasWidth,
    canvasHeight,
    selectedPortraitFileId,
    selectedExpressionHeight,
    selectedFootprintHeight,
    selectedFootprintWidth,
  } = model;
  if (!selectedExpression) return null;
  return (
    <div
      className="galgame-expression-form"
      aria-label={`${selectedExpression.label} 表情设置`}
    >
      <CharacterExpressionPresentation model={model} />
      <section
        className={`galgame-expression-detail-preview-section ${
          expandedExpressionPreview ? "is-expanded" : ""
        }`}
        role={expandedExpressionPreview ? "dialog" : undefined}
        aria-modal={expandedExpressionPreview ? true : undefined}
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
              {selectedExpression.renderMode === "frameSequence"
                ? "序列帧预览"
                : "舞台预览"}
            </strong>
          </span>
          <small>
            {selectedExpression.renderMode === "frameSequence"
              ? `${selectedExpression.sequence?.frames.length ?? 0} 帧 · ${selectedExpression.sequence?.fps ?? 2} FPS · `
              : ""}
            {previewPosition.name} · X {previewPosition.x}% · Y{" "}
            {previewPosition.y}% · SIZE {selectedExpressionHeight}%
          </small>
          <button
            type="button"
            aria-label={expandedExpressionPreview ? "退出全屏预览" : "全屏预览"}
            onClick={() => setExpandedExpressionPreview((current) => !current)}
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
                  : stageSettings.anchor === "topLeft"
                    ? "translate(0, 0)"
                    : "translate(-50%, -100%)",
            }}
          >
            <div
              className="galgame-portrait-stage-composite"
              data-flipped={selectedExpression.flipX || undefined}
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
                    const existing = current.get(selectedPortraitFileId);
                    if (existing?.width === width && existing.height === height)
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
              {(selectedExpression.overlays ?? []).map((overlay) => {
                const overlayAsset = assetsById.get(overlay.assetId);
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
              })}
            </div>
          </span>
        </div>
      </section>

      <section className="galgame-expression-setting-section galgame-expression-identity">
        <header>
          <span>
            <PencilLine aria-hidden />
            <strong>基本信息</strong>
          </span>
          <small>修改后自动保存</small>
        </header>
        <div className="galgame-expression-basic-fields">
          <label className="galgame-field">
            <span>表情名称</span>
            <input
              aria-label="表情名称"
              autoComplete="off"
              value={selectedExpression.label}
              onChange={(event) =>
                updateExpression(selectedExpression.id, (expression) => ({
                  ...expression,
                  label: event.target.value,
                }))
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
            <small>仅影响当前表情的舞台立绘，原图与对白头像保持不变。</small>
          </span>
          <input
            type="checkbox"
            aria-label="左右翻转"
            checked={selectedExpression.flipX ?? false}
            onChange={(event) =>
              updateExpression(selectedExpression.id, (expression) => ({
                ...expression,
                flipX: event.target.checked,
              }))
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
            aria-pressed={selectedExpression.heightPercent == null}
            onClick={() =>
              updateExpression(selectedExpression.id, (expression) => ({
                ...expression,
                heightPercent: null,
              }))
            }
          >
            跟随角色/全局
          </button>
          <button
            type="button"
            aria-pressed={selectedExpression.heightPercent != null}
            onClick={() =>
              updateExpression(selectedExpression.id, (expression) => ({
                ...expression,
                heightPercent:
                  expression.heightPercent ?? inheritedExpressionHeight,
              }))
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
                  updateExpression(selectedExpression.id, (expression) => ({
                    ...expression,
                    heightPercent: Math.min(
                      400,
                      Math.max(1, Number(event.target.value)),
                    ),
                  }))
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
                value={selectedExpression.dialogueAvatar?.source ?? "portrait"}
                onChange={(value) => {
                  if (value === "portrait") {
                    updateExpression(selectedExpression.id, (expression) => ({
                      ...expression,
                      dialogueAvatar: {
                        source: "portrait",
                        assetId: null,
                        crop: expression.dialogueAvatar?.crop ?? {
                          x: 50,
                          y: 25,
                          scale: 1.8,
                        },
                      },
                    }));
                    return;
                  }
                  if (!activeAsset || activeAsset.type !== "image") return;
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
                            expressions: (character.expressions ?? []).map(
                              (expression) =>
                                expression.id === selectedExpression.id
                                  ? {
                                      ...expression,
                                      dialogueAvatar: {
                                        source: "independent",
                                        assetId: avatarAssetId,
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
            {selectedExpression.dialogueAvatar?.source === "independent" ? (
              <label className="galgame-field">
                <span>独立头像素材</span>
                <CustomSelect
                  ariaLabel="独立头像素材"
                  value={selectedExpression.dialogueAvatar.assetId ?? ""}
                  onChange={(value) => {
                    const source = (document.assets ?? []).find(
                      (asset) => asset.id === value,
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
                              expressions: (character.expressions ?? []).map(
                                (expression) =>
                                  expression.id === selectedExpression.id
                                    ? {
                                        ...expression,
                                        dialogueAvatar: {
                                          source: "independent",
                                          assetId: avatarAssetId,
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
                    updateExpression(selectedExpression.id, (expression) => ({
                      ...expression,
                      thumbnailCrop: {
                        ...(expression.thumbnailCrop ?? {
                          x: 50,
                          y: 25,
                          scale: 1.8,
                        }),
                        [key]: Number(event.target.value),
                      },
                    }))
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
                      selectedExpression.dialogueAvatar?.crop?.[key] ??
                      { x: 50, y: 25, scale: 1.8 }[key]
                    }
                    onChange={(event) =>
                      updateExpression(selectedExpression.id, (expression) => ({
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
                            ...(expression.dialogueAvatar?.crop ?? {
                              x: 50,
                              y: 25,
                              scale: 1.8,
                            }),
                            [key]: Number(event.target.value),
                          },
                        },
                      }))
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
                            expressions: (character.expressions ?? []).map(
                              (expression) =>
                                expression.id === selectedExpression.id
                                  ? {
                                      ...expression,
                                      overlays: [
                                        ...(expression.overlays ?? []),
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
            {(selectedExpression.overlays ?? []).map((overlay) => (
              <div key={overlay.id}>
                <input
                  aria-label="覆盖名称"
                  value={overlay.name}
                  onChange={(event) =>
                    updateCharacter(selectedCharacter.id, (character) => ({
                      ...character,
                      expressions: (character.expressions ?? []).map(
                        (expression) =>
                          expression.id === selectedExpression.id
                            ? {
                                ...expression,
                                overlays: (expression.overlays ?? []).map(
                                  (item) =>
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
                    }))
                  }
                />
                <button
                  type="button"
                  className="danger"
                  aria-label={`删除覆盖 ${overlay.name}`}
                  onClick={() =>
                    updateCharacter(selectedCharacter.id, (character) => ({
                      ...character,
                      expressions: (character.expressions ?? []).map(
                        (expression) =>
                          expression.id === selectedExpression.id
                            ? {
                                ...expression,
                                overlays: (expression.overlays ?? []).filter(
                                  (item) => item.id !== overlay.id,
                                ),
                              }
                            : expression,
                      ),
                    }))
                  }
                >
                  <Trash2 aria-hidden />
                </button>
              </div>
            ))}
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
            {selectedExpression.id === selectedCharacter.defaultExpressionId
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
          {selectedExpression.id !== selectedCharacter.defaultExpressionId ? (
            <button
              type="button"
              onClick={() => setDefaultExpression(selectedExpression.id)}
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
  );
}
