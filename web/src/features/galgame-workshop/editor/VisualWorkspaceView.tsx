import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  FolderOpen,
  GripVertical,
  Image as ImageIcon,
  ImagePlus,
  Images,
  MapPinned,
  Minus,
  MousePointer2,
  Move,
  PanelLeftClose,
  PanelRightClose,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import { stableId } from "@features/galgame-workshop/editor/model";
import { StoryImagePicker } from "@features/galgame-workshop/editor/StoryImagePicker";
import { StoryAssetImage } from "@features/galgame-workshop/editor/StoryAssetImage";
import { InlineEditableName } from "@features/galgame-workshop/editor/EditorShared";
import type { useVisualWorkspaceController } from "@features/galgame-workshop/editor/useVisualWorkspaceController";

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function distancePercent(distance: number) {
  return (Math.log10(clamp(distance, 0.1, 100) / 0.1) / 3) * 100;
}
type VisualWorkspaceViewModel = ReturnType<typeof useVisualWorkspaceController>;

export function VisualWorkspaceView({
  model,
}: {
  model: VisualWorkspaceViewModel;
}) {
  const {
    projectId,
    document,
    onDocument,
    onLocate,
    onNotice,
    fileInput,
    stageRef,
    distanceAxisRef,
    draggedItem,
    menuRef,
    scenes,
    cgs,
    groups,
    selection,
    query,
    setQuery,
    layerQuery,
    setLayerQuery,
    rootsOpen,
    setRootsOpen,
    browserOpen,
    setBrowserOpen,
    stackOpen,
    setStackOpen,
    setSelectedLayerId,
    setSelectedVariantId,
    picker,
    setPicker,
    pickerTarget,
    setPickerTarget,
    stageMode,
    setStageMode,
    camera,
    setCamera,
    isolatedLayerId,
    setIsolatedLayerId,
    layerDraft,
    bottomTab,
    setBottomTab,
    distanceDraft,
    setDistanceDraft,
    itemMenu,
    setItemMenu,
    selectedScene,
    selectedCg,
    layers,
    variants,
    selectedLayer,
    defaultVariant,
    selectedVariant,
    assetsById,
    usedFileIds,
    sceneRefs,
    cgRefs,
    visibleScenes,
    visibleCgs,
    filteredLayers,
    selectVisual,
    updateScene,
    updateCg,
    bindFile,
    upload,
    openPicker,
    createScene,
    createCg,
    duplicateVisual,
    moveScene,
    beginRename,
    reorderLayer,
    reorderVariant,
    removeVariant,
    removeVisual,
    removeSelectedVisual,
    startStageDrag,
    moveStageDrag,
    finishStageDrag,
    zoomStage,
    wheelStage,
    setLayerDistance,
    distanceFromPointer,
    activeImage,
    canvasWidth,
    canvasHeight,
    title,
    detailCount,
    stageEmpty,
    renderBrowserItem,
    menuScene,
    menuCg,
    menuReferences,
  } = model;
  return (
    <section className="galgame-unified-visual-workspace">
      <header className="galgame-visual-page-heading">
        <div>
          <Images aria-hidden />
          <strong>场景</strong>
          <span>{scenes.length + cgs.length} 项</span>
        </div>
      </header>
      <div className="galgame-visual-page-subheading">
        <div>
          <strong>场景</strong>
          <span>管理游戏场景背景、CG 与属性</span>
        </div>
        <nav aria-label="工作台面板">
          <button
            type="button"
            aria-label={browserOpen ? "收起资源树" : "展开资源树"}
            title={browserOpen ? "收起资源树" : "展开资源树"}
            aria-pressed={!browserOpen}
            onClick={() => setBrowserOpen((current) => !current)}
          >
            <PanelLeftClose
              className={browserOpen ? "" : "is-flipped"}
              aria-hidden
            />
          </button>
          <button
            type="button"
            aria-label={
              stackOpen
                ? `收起${selectedScene ? "图层" : "差分"}`
                : `展开${selectedScene ? "图层" : "差分"}`
            }
            title={
              stackOpen
                ? `收起${selectedScene ? "图层" : "差分"}`
                : `展开${selectedScene ? "图层" : "差分"}`
            }
            aria-pressed={!stackOpen}
            onClick={() => setStackOpen((current) => !current)}
          >
            <PanelRightClose
              className={stackOpen ? "" : "is-flipped"}
              aria-hidden
            />
          </button>
        </nav>
      </div>

      <div
        className={`galgame-visual-editor-grid${browserOpen ? "" : " is-browser-collapsed"}${stackOpen ? "" : " is-stack-collapsed"}`}
      >
        <aside className="galgame-visual-browser">
          <div className="galgame-visual-browser-toolbar">
            <label>
              <Search aria-hidden />
              <input
                aria-label="搜索场景和 CG"
                value={query}
                placeholder="搜索场景或 CG…"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <button type="button" aria-label="新建场景" onClick={createScene}>
              <ImagePlus aria-hidden />
            </button>
            <button type="button" aria-label="新建 CG" onClick={createCg}>
              <Plus aria-hidden />
            </button>
            <button
              type="button"
              aria-label="添加分组"
              onClick={() => {
                const group = {
                  id: stableId(),
                  name: `新分组 ${groups.length + 1}`,
                  color: "#7586E5",
                  collapsed: false,
                };
                onDocument({
                  ...document,
                  sceneGroups: [...groups, group],
                });
              }}
            >
              <FolderOpen aria-hidden />
            </button>
          </div>

          <div className="galgame-visual-browser-tree">
            <section>
              <button
                type="button"
                className="galgame-visual-tree-root"
                aria-expanded={rootsOpen.scenes}
                onClick={() =>
                  setRootsOpen((current) => ({
                    ...current,
                    scenes: !current.scenes,
                  }))
                }
              >
                {rootsOpen.scenes ? (
                  <ChevronDown aria-hidden />
                ) : (
                  <ChevronRight aria-hidden />
                )}
                <span>场景</span>
                <em>{scenes.filter((scene) => !scene.groupId).length}</em>
              </button>
              {rootsOpen.scenes
                ? visibleScenes
                    .filter((scene) => !scene.groupId)
                    .map((scene) =>
                      renderBrowserItem({ kind: "scene", id: scene.id }),
                    )
                : null}
            </section>

            <section>
              <button
                type="button"
                className="galgame-visual-tree-root"
                aria-label="剧情 CG"
                aria-expanded={rootsOpen.cgs}
                onClick={() =>
                  setRootsOpen((current) => ({
                    ...current,
                    cgs: !current.cgs,
                  }))
                }
              >
                {rootsOpen.cgs ? (
                  <ChevronDown aria-hidden />
                ) : (
                  <ChevronRight aria-hidden />
                )}
                <span>CG</span>
                <em>{cgs.length}</em>
              </button>
              {rootsOpen.cgs
                ? visibleCgs.map((cg) =>
                    renderBrowserItem({ kind: "cg", id: cg.id }),
                  )
                : null}
            </section>

            {groups.map((group) => {
              const groupScenes = scenes.filter(
                (scene) => scene.groupId === group.id,
              );
              const groupedScenes = visibleScenes.filter(
                (scene) => scene.groupId === group.id,
              );
              return (
                <section
                  key={group.id}
                  className="galgame-visual-custom-group"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const dragged = draggedItem.current;
                    if (dragged?.kind === "scene")
                      moveScene(dragged.id, undefined, group.id);
                    draggedItem.current = undefined;
                  }}
                >
                  <div className="galgame-visual-tree-root">
                    <button
                      type="button"
                      aria-label={`${group.collapsed ? "展开" : "折叠"}${group.name}`}
                      onClick={() =>
                        onDocument({
                          ...document,
                          sceneGroups: groups.map((candidate) =>
                            candidate.id === group.id
                              ? {
                                  ...candidate,
                                  collapsed: !candidate.collapsed,
                                }
                              : candidate,
                          ),
                        })
                      }
                    >
                      {group.collapsed ? (
                        <ChevronRight aria-hidden />
                      ) : (
                        <ChevronDown aria-hidden />
                      )}
                    </button>
                    <i style={{ background: group.color }} />
                    <input
                      aria-label="分组名称"
                      value={group.name}
                      onChange={(event) =>
                        onDocument({
                          ...document,
                          sceneGroups: groups.map((candidate) =>
                            candidate.id === group.id
                              ? { ...candidate, name: event.target.value }
                              : candidate,
                          ),
                        })
                      }
                    />
                    <em>{groupScenes.length}</em>
                    <button
                      type="button"
                      aria-label={`删除分组 ${group.name}`}
                      onClick={() =>
                        onDocument({
                          ...document,
                          sceneGroups: groups.filter(
                            (candidate) => candidate.id !== group.id,
                          ),
                          scenes: scenes.map((scene) =>
                            scene.groupId === group.id
                              ? { ...scene, groupId: null }
                              : scene,
                          ),
                        })
                      }
                    >
                      <Trash2 aria-hidden />
                    </button>
                  </div>
                  {!group.collapsed
                    ? groupedScenes.map((scene) =>
                        renderBrowserItem({ kind: "scene", id: scene.id }),
                      )
                    : null}
                </section>
              );
            })}

            {!visibleScenes.length && !visibleCgs.length ? (
              <p className="galgame-visual-tree-empty">
                {query ? "没有匹配的场景或 CG。" : "创建第一个场景或 CG。"}
              </p>
            ) : null}
          </div>
        </aside>

        <main className="galgame-visual-stage-panel">
          <header>
            <div>
              {selection && (selectedScene || selectedCg) ? (
                <InlineEditableName
                  key={`${selection.kind}-${selection.id}`}
                  value={title}
                  label={selectedScene ? "场景名称" : "CG 名称"}
                  onCommit={(name) => {
                    if (selectedScene) {
                      updateScene(selectedScene.id, (scene) => ({
                        ...scene,
                        name,
                      }));
                    } else if (selectedCg) {
                      updateCg(selectedCg.id, (cg) => ({ ...cg, name }));
                    }
                  }}
                  onEmpty={() => onNotice("名称不能为空。")}
                />
              ) : (
                <strong>{title}</strong>
              )}
              <span>
                {detailCount} {selectedScene ? "层" : "个差分"} · {canvasWidth}×
                {canvasHeight}
              </span>
            </div>
            <nav aria-label="舞台操作模式">
              <button
                type="button"
                className={stageMode === "preview" ? "active" : ""}
                onClick={() => setStageMode("preview")}
              >
                <Eye aria-hidden /> 视差预览
              </button>
              {selectedScene ? (
                <button
                  type="button"
                  className={stageMode === "layer" ? "active" : ""}
                  disabled={!selectedLayer}
                  onClick={() => setStageMode("layer")}
                >
                  <Move aria-hidden /> 图层定位
                </button>
              ) : null}
            </nav>
            <div className="galgame-visual-zoom-controls">
              <button
                type="button"
                aria-label="缩小舞台"
                onClick={() => zoomStage(camera.zoom - 0.1)}
              >
                <Minus aria-hidden />
              </button>
              <strong>{Math.round(camera.zoom * 100)}%</strong>
              <button
                type="button"
                aria-label="放大舞台"
                onClick={() => zoomStage(camera.zoom + 0.1)}
              >
                <Plus aria-hidden />
              </button>
              <button
                type="button"
                aria-label="复位舞台预览"
                onClick={() => setCamera({ x: 0, y: 0, zoom: 1 })}
              >
                <RotateCcw aria-hidden />
              </button>
            </div>
          </header>

          <div className="galgame-visual-stage-shell">
            <div
              ref={stageRef}
              className={`galgame-visual-stage is-${stageMode}`}
              style={{ aspectRatio: `${canvasWidth} / ${canvasHeight}` }}
              data-empty={stageEmpty || undefined}
              onPointerDown={startStageDrag}
              onPointerMove={moveStageDrag}
              onPointerUp={finishStageDrag}
              onPointerCancel={finishStageDrag}
              onWheel={wheelStage}
            >
              {selectedScene ? (
                layers.map((layer, index) => {
                  if (isolatedLayerId && isolatedLayerId !== layer.id)
                    return null;
                  const asset = assetsById.get(layer.assetId);
                  const draft =
                    layerDraft?.layerId === layer.id ? layerDraft : layer;
                  const transform = `translate(${draft.offsetX}%, ${draft.offsetY}%) translate(${-camera.x / layer.distance}px, ${-camera.y / layer.distance}px) scale(${camera.zoom})`;
                  return (
                    <StoryAssetImage
                      key={layer.id}
                      fileId={asset?.fileId}
                      alt=""
                      className="galgame-visual-stage-layer"
                      style={{
                        zIndex: index,
                        transform,
                      }}
                      fallback={
                        <div
                          className="galgame-visual-stage-missing"
                          style={{ zIndex: index, transform }}
                        >
                          <MapPinned aria-hidden />
                          <span>{layer.name} · 素材缺失</span>
                        </div>
                      }
                    />
                  );
                })
              ) : selectedCg && selectedVariant ? (
                <StoryAssetImage
                  fileId={activeImage?.fileId}
                  alt={`${selectedCg.name} · ${selectedVariant.label}`}
                  className="galgame-visual-stage-layer is-cg"
                  style={{
                    transform: `translate(${-camera.x}px, ${-camera.y}px) scale(${camera.zoom})`,
                  }}
                  fallback={
                    <div
                      className="galgame-visual-stage-missing is-cg"
                      style={{
                        transform: `translate(${-camera.x}px, ${-camera.y}px) scale(${camera.zoom})`,
                      }}
                    >
                      <Images aria-hidden />
                      <span>{selectedVariant.label} · 素材缺失</span>
                    </div>
                  }
                />
              ) : null}
              {stageEmpty ? (
                <div className="galgame-visual-stage-empty">
                  {selectedScene ? (
                    <ImagePlus aria-hidden />
                  ) : (
                    <Images aria-hidden />
                  )}
                  <strong>
                    {selectedScene
                      ? "添加第一张图片即可创建场景图层"
                      : selectedCg
                        ? "添加第一张图片即可创建 CG 差分"
                        : "从左侧创建场景或 CG"}
                  </strong>
                  <span>支持工程素材与全局文件库中的图片。</span>
                </div>
              ) : null}
              {!stageEmpty ? (
                <span className="galgame-visual-camera-readout">
                  <MousePointer2 aria-hidden /> X {camera.x} · Y {camera.y} px ·
                  推拉 {camera.zoom.toFixed(2)}×
                </span>
              ) : null}
              {selectedScene && isolatedLayerId ? (
                <button
                  type="button"
                  className="galgame-visual-isolation"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => setIsolatedLayerId(undefined)}
                >
                  <Eye aria-hidden /> 隔离 开
                </button>
              ) : null}
            </div>
            <small>
              {stageMode === "preview"
                ? "拖动舞台平移镜头 · 滚轮前后推拉 · 近层变化更大、远层更小"
                : "拖动选中的图层调整偏移 · 松开后自动保存"}
            </small>
          </div>
        </main>

        <aside className="galgame-visual-stack-panel">
          <header>
            <strong>{selectedScene ? "图层" : "差分"}</strong>
            <span>{detailCount}</span>
            <button
              type="button"
              aria-label={selectedScene ? "添加场景图层" : "添加差分"}
              disabled={!selection}
              onClick={() =>
                openPicker(selectedScene ? "scene-layer" : "cg-variant", "add")
              }
            >
              <Plus aria-hidden />
            </button>
          </header>
          <label className="galgame-visual-stack-search">
            <Search aria-hidden />
            <input
              aria-label="搜索图层或差分"
              value={layerQuery}
              placeholder={selectedScene ? "搜索图层…" : "搜索差分…"}
              onChange={(event) => setLayerQuery(event.target.value)}
            />
          </label>

          <div className="galgame-visual-stack-list">
            {selectedScene
              ? [...filteredLayers].reverse().map((layer) => {
                  const asset = assetsById.get(layer.assetId);
                  const index = layers.findIndex(
                    (item) => item.id === layer.id,
                  );
                  return (
                    <article
                      key={layer.id}
                      className={layer.id === selectedLayer?.id ? "active" : ""}
                      draggable
                      onDragStart={() =>
                        (draggedItem.current = {
                          kind: "scene",
                          id: `layer:${layer.id}`,
                        })
                      }
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => {
                        const dragged = draggedItem.current;
                        const layerId = dragged?.id.replace(/^layer:/, "");
                        if (layerId) reorderLayer(layerId, layer.id);
                        draggedItem.current = undefined;
                      }}
                      onClick={() => setSelectedLayerId(layer.id)}
                    >
                      <GripVertical aria-hidden />
                      <em>{String(index + 1).padStart(2, "0")}</em>
                      <span>
                        <StoryAssetImage
                          fileId={asset?.fileId}
                          alt=""
                          fallback={<MapPinned aria-hidden />}
                        />
                      </span>
                      <div>
                        <input
                          aria-label="图层名称"
                          value={layer.name}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) =>
                            updateScene(selectedScene.id, (scene) => ({
                              ...scene,
                              layers: (scene.layers ?? []).map((candidate) =>
                                candidate.id === layer.id
                                  ? { ...candidate, name: event.target.value }
                                  : candidate,
                              ),
                            }))
                          }
                        />
                        <small>{asset?.fileId ?? "素材缺失"}</small>
                      </div>
                      <label onClick={(event) => event.stopPropagation()}>
                        <span>距离</span>
                        <input
                          aria-label={`图层 ${layer.name} 距离数值`}
                          type="number"
                          min="0.1"
                          max="100"
                          step="0.1"
                          value={layer.distance}
                          onChange={(event) =>
                            setLayerDistance(
                              layer.id,
                              Number(event.target.value),
                            )
                          }
                        />
                      </label>
                      <button
                        type="button"
                        aria-label={`隔离图层 ${layer.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setIsolatedLayerId((current) =>
                            current === layer.id ? undefined : layer.id,
                          );
                        }}
                      >
                        {isolatedLayerId === layer.id ? (
                          <Eye aria-hidden />
                        ) : (
                          <EyeOff aria-hidden />
                        )}
                      </button>
                      <button
                        type="button"
                        aria-label={`替换图层 ${layer.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedLayerId(layer.id);
                          openPicker("scene-layer", "replace");
                        }}
                      >
                        <FolderOpen aria-hidden />
                      </button>
                      <button
                        type="button"
                        aria-label={`删除图层 ${layer.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          updateScene(selectedScene.id, (scene) => ({
                            ...scene,
                            layers: (scene.layers ?? []).filter(
                              (candidate) => candidate.id !== layer.id,
                            ),
                          }));
                        }}
                      >
                        <Trash2 aria-hidden />
                      </button>
                    </article>
                  );
                })
              : variants
                  .filter((variant) =>
                    variant.label
                      .toLocaleLowerCase("zh-CN")
                      .includes(layerQuery.trim().toLocaleLowerCase("zh-CN")),
                  )
                  .map((variant, index) => {
                    const asset = assetsById.get(variant.assetId);
                    const isDefault =
                      variant.id === selectedCg?.defaultVariantId;
                    return (
                      <article
                        key={variant.id}
                        className={`${variant.id === selectedVariant?.id ? "active " : ""}is-cg`}
                        draggable
                        onDragStart={() =>
                          (draggedItem.current = {
                            kind: "cg",
                            id: `variant:${variant.id}`,
                          })
                        }
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => {
                          const dragged = draggedItem.current;
                          const variantId = dragged?.id.replace(
                            /^variant:/,
                            "",
                          );
                          if (variantId) reorderVariant(variantId, variant.id);
                          draggedItem.current = undefined;
                        }}
                        onClick={() => setSelectedVariantId(variant.id)}
                      >
                        <GripVertical aria-hidden />
                        <em>{String(index + 1).padStart(2, "0")}</em>
                        <span>
                          <StoryAssetImage
                            fileId={asset?.fileId}
                            alt=""
                            fallback={<Images aria-hidden />}
                          />
                        </span>
                        <div>
                          <input
                            aria-label="差分名称"
                            value={variant.label}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) =>
                              selectedCg &&
                              updateCg(selectedCg.id, (cg) => ({
                                ...cg,
                                variants: (cg.variants ?? []).map(
                                  (candidate) =>
                                    candidate.id === variant.id
                                      ? {
                                          ...candidate,
                                          label: event.target.value,
                                        }
                                      : candidate,
                                ),
                              }))
                            }
                          />
                          <small>
                            {isDefault ? "默认差分" : asset?.fileId}
                          </small>
                        </div>
                        <button
                          type="button"
                          aria-label={`设为默认差分 ${variant.label}`}
                          disabled={isDefault}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (selectedCg)
                              updateCg(selectedCg.id, (cg) => ({
                                ...cg,
                                defaultVariantId: variant.id,
                              }));
                          }}
                        >
                          <Check aria-hidden />
                        </button>
                        <button
                          type="button"
                          aria-label={`替换差分 ${variant.label}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedVariantId(variant.id);
                            openPicker("cg-variant", "replace");
                          }}
                        >
                          <FolderOpen aria-hidden />
                        </button>
                        <button
                          type="button"
                          aria-label="删除差分"
                          title={`删除差分 ${variant.label}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            removeVariant(variant);
                          }}
                        >
                          <Trash2 aria-hidden />
                        </button>
                      </article>
                    );
                  })}
          </div>

          <div className="galgame-visual-stack-actions">
            <button
              type="button"
              aria-label="素材库添加"
              disabled={!selection}
              onClick={() =>
                openPicker(selectedScene ? "scene-layer" : "cg-variant", "add")
              }
            >
              <FolderOpen aria-hidden /> 素材库添加
            </button>
            <button
              type="button"
              aria-label="导入图片"
              disabled={!selection || upload.isPending}
              onClick={() => {
                setPickerTarget({
                  kind: selectedScene ? "scene-layer" : "cg-variant",
                  mode: "add",
                });
                fileInput.current?.click();
              }}
            >
              <Upload aria-hidden />
              {upload.isPending ? "导入中…" : "导入图片"}
            </button>
          </div>
        </aside>

        <section className="galgame-visual-bottom-panel">
          <div className="galgame-visual-properties">
            <section>
              <header>
                {selectedScene ? (
                  <ImageIcon aria-hidden />
                ) : (
                  <Images aria-hidden />
                )}
                <strong>{selectedScene ? "场景属性" : "CG 属性"}</strong>
              </header>
              {selectedScene ? (
                <label>
                  <span>名称</span>
                  <input
                    aria-label="场景名称"
                    value={selectedScene.name}
                    onChange={(event) =>
                      updateScene(selectedScene.id, (scene) => ({
                        ...scene,
                        name: event.target.value,
                      }))
                    }
                  />
                </label>
              ) : selectedCg ? (
                <>
                  <label>
                    <span>名称</span>
                    <input
                      aria-label="CG 名称"
                      value={selectedCg.name}
                      onChange={(event) =>
                        updateCg(selectedCg.id, (cg) => ({
                          ...cg,
                          name: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    <span>说明</span>
                    <textarea
                      aria-label="CG 说明"
                      value={selectedCg.description}
                      onChange={(event) =>
                        updateCg(selectedCg.id, (cg) => ({
                          ...cg,
                          description: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <p>
                    默认差分：
                    <strong>{defaultVariant?.label ?? "尚未绑定"}</strong>
                  </p>
                </>
              ) : (
                <p>从左侧选择或创建资源。</p>
              )}
            </section>

            <section className="galgame-visual-references">
              <header>
                <ExternalLink aria-hidden />
                <strong>引用位置</strong>
                <span>
                  {selectedScene ? sceneRefs.length : cgRefs.length} 处
                </span>
              </header>
              <div>
                {(selectedScene ? sceneRefs : cgRefs).map((reference) => (
                  <button
                    key={reference.blockId}
                    type="button"
                    onClick={() =>
                      onLocate(reference.fragmentId, reference.blockId)
                    }
                  >
                    {reference.chapter} · {reference.fragment} · Block{" "}
                    {reference.index + 1}
                  </button>
                ))}
                {(selectedScene ? sceneRefs : cgRefs).length === 0 ? (
                  <small>尚未在剧本中引用。</small>
                ) : null}
                {selectedScene && sceneRefs.length ? (
                  <small>场景仍被 Scene Block 引用，无法删除。</small>
                ) : null}
                {selectedCg && cgRefs.length ? (
                  <small>CG 仍被显示 CG Block 引用，无法删除。</small>
                ) : null}
              </div>
              <button
                type="button"
                className="danger"
                aria-label={selectedScene ? "删除场景" : "删除 CG"}
                disabled={
                  !selection ||
                  (selectedScene
                    ? Boolean(sceneRefs.length)
                    : Boolean(cgRefs.length))
                }
                onClick={removeSelectedVisual}
              >
                <Trash2 aria-hidden /> 删除{selectedScene ? "场景" : " CG"}
              </button>
            </section>
          </div>

          {selectedScene ? (
            <div className="galgame-visual-parameters">
              <nav aria-label="场景图层参数">
                <button
                  type="button"
                  className={bottomTab === "distance" ? "active" : ""}
                  onClick={() => setBottomTab("distance")}
                >
                  距离
                </button>
                <button
                  type="button"
                  className={bottomTab === "offset" ? "active" : ""}
                  onClick={() => setBottomTab("offset")}
                >
                  偏移
                </button>
              </nav>
              {bottomTab === "distance" ? (
                <div className="galgame-distance-editor">
                  <div ref={distanceAxisRef} className="galgame-distance-axis">
                    <i />
                    {layers.map((layer, index) => {
                      const value =
                        distanceDraft?.layerId === layer.id
                          ? distanceDraft.value
                          : layer.distance;
                      return (
                        <button
                          key={layer.id}
                          type="button"
                          role="slider"
                          aria-label={`${layer.name} 距离`}
                          aria-valuemin={0.1}
                          aria-valuemax={100}
                          aria-valuenow={value}
                          className={
                            layer.id === selectedLayer?.id ? "active" : ""
                          }
                          style={{
                            left: `${distancePercent(value)}%`,
                            top: `${18 + (index % 2) * 38}px`,
                          }}
                          onClick={() => setSelectedLayerId(layer.id)}
                          onPointerDown={(event) => {
                            event.currentTarget.setPointerCapture(
                              event.pointerId,
                            );
                            setSelectedLayerId(layer.id);
                            setDistanceDraft({
                              layerId: layer.id,
                              value: distanceFromPointer(event.clientX),
                            });
                          }}
                          onPointerMove={(event) => {
                            if (
                              !event.currentTarget.hasPointerCapture(
                                event.pointerId,
                              )
                            )
                              return;
                            setDistanceDraft({
                              layerId: layer.id,
                              value: distanceFromPointer(event.clientX),
                            });
                          }}
                          onPointerUp={(event) => {
                            if (
                              event.currentTarget.hasPointerCapture(
                                event.pointerId,
                              )
                            )
                              event.currentTarget.releasePointerCapture(
                                event.pointerId,
                              );
                            const value = distanceFromPointer(event.clientX);
                            setDistanceDraft(undefined);
                            setLayerDistance(layer.id, value);
                          }}
                          onPointerCancel={(event) => {
                            if (
                              event.currentTarget.hasPointerCapture(
                                event.pointerId,
                              )
                            )
                              event.currentTarget.releasePointerCapture(
                                event.pointerId,
                              );
                            setDistanceDraft(undefined);
                          }}
                          onKeyDown={(event) => {
                            if (
                              event.key !== "ArrowLeft" &&
                              event.key !== "ArrowRight"
                            )
                              return;
                            event.preventDefault();
                            const step = layer.distance < 1 ? 0.1 : 0.5;
                            setLayerDistance(
                              layer.id,
                              layer.distance +
                                (event.key === "ArrowRight" ? step : -step),
                            );
                          }}
                        >
                          <span>
                            {index + 1} {layer.name} {value}×
                          </span>
                          <i />
                        </button>
                      );
                    })}
                    <small className="near">0.1× 近</small>
                    <small className="middle">5×</small>
                    <small className="far">100× 远</small>
                  </div>
                  <p>
                    左侧靠近镜头，右侧更远；距离越近，镜头移动造成的视差越明显。
                  </p>
                </div>
              ) : selectedLayer ? (
                <div className="galgame-offset-editor">
                  {(["offsetX", "offsetY"] as const).map((key) => (
                    <label key={key}>
                      <span>{key === "offsetX" ? "偏移 X" : "偏移 Y"}</span>
                      <input
                        aria-label={
                          key === "offsetX" ? "图层偏移 X" : "图层偏移 Y"
                        }
                        type="range"
                        min="-200"
                        max="200"
                        value={selectedLayer[key]}
                        onChange={(event) =>
                          updateScene(selectedScene.id, (scene) => ({
                            ...scene,
                            layers: (scene.layers ?? []).map((layer) =>
                              layer.id === selectedLayer.id
                                ? {
                                    ...layer,
                                    [key]: Number(event.target.value),
                                  }
                                : layer,
                            ),
                          }))
                        }
                      />
                      <input
                        aria-label={
                          key === "offsetX"
                            ? "图层偏移 X 数值"
                            : "图层偏移 Y 数值"
                        }
                        type="number"
                        min="-200"
                        max="200"
                        value={selectedLayer[key]}
                        onChange={(event) =>
                          updateScene(selectedScene.id, (scene) => ({
                            ...scene,
                            layers: (scene.layers ?? []).map((layer) =>
                              layer.id === selectedLayer.id
                                ? {
                                    ...layer,
                                    [key]: clamp(
                                      Number(event.target.value),
                                      -200,
                                      200,
                                    ),
                                  }
                                : layer,
                            ),
                          }))
                        }
                      />
                      <em>%</em>
                    </label>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      updateScene(selectedScene.id, (scene) => ({
                        ...scene,
                        layers: (scene.layers ?? []).map((layer) =>
                          layer.id === selectedLayer.id
                            ? { ...layer, offsetX: 0, offsetY: 0 }
                            : layer,
                        ),
                      }))
                    }
                  >
                    <RotateCcw aria-hidden /> 复位偏移
                  </button>
                </div>
              ) : (
                <p className="galgame-visual-parameter-empty">
                  选择一个图层后调整偏移。
                </p>
              )}
            </div>
          ) : selectedCg ? (
            <div className="galgame-visual-cg-help">
              <Images aria-hidden />
              <strong>CG 差分</strong>
              <span>
                右侧管理画面差分和默认差分；实际出现、隐藏、适配与叠放位置仍由
                Show/Hide CG Block 控制。
              </span>
            </div>
          ) : null}
        </section>
      </div>

      <input
        ref={fileInput}
        hidden
        type="file"
        accept=".jpg,.jpeg,.png,.webp,.avif"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file && pickerTarget)
            upload.mutate({ file, target: pickerTarget });
        }}
      />

      {picker && pickerTarget ? (
        <StoryImagePicker
          projectId={projectId}
          state={picker}
          usedFileIds={usedFileIds}
          addTitle={
            pickerTarget.kind === "scene-layer"
              ? "添加场景图层"
              : "添加 CG 差分"
          }
          replaceTitle={
            pickerTarget.kind === "scene-layer"
              ? "替换场景图层"
              : "替换 CG 差分"
          }
          searchLabel={
            pickerTarget.kind === "scene-layer"
              ? "搜索场景图片"
              : "搜索 CG 素材"
          }
          projectEmptyCopy="工程中还没有可用图片。"
          onState={setPicker}
          onChoose={bindFile}
          onUpload={() => fileInput.current?.click()}
          onClose={() => {
            setPicker(undefined);
            setPickerTarget(undefined);
          }}
        />
      ) : null}

      {itemMenu && (menuScene || menuCg)
        ? createPortal(
            <div
              ref={menuRef}
              id="galgame-visual-item-menu"
              className="galgame-visual-item-menu"
              role="menu"
              aria-label={`${menuScene?.name ?? menuCg?.name} 操作`}
              style={{ left: itemMenu.left, top: itemMenu.top }}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  selectVisual(itemMenu.item);
                  setItemMenu(undefined);
                }}
              >
                <Eye aria-hidden />
                打开{menuScene ? "场景" : " CG"}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => beginRename(itemMenu.item)}
              >
                <Pencil aria-hidden />
                重命名
              </button>

              {menuScene ? (
                <>
                  <i aria-hidden />
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!menuScene.groupId}
                    onClick={() => {
                      moveScene(menuScene.id, undefined, null);
                      setItemMenu(undefined);
                    }}
                  >
                    <Undo2 aria-hidden />
                    移出分组
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!menuScene.groupId}
                    onClick={() => {
                      moveScene(menuScene.id, undefined, null);
                      setItemMenu(undefined);
                    }}
                  >
                    {!menuScene.groupId ? (
                      <Check aria-hidden />
                    ) : (
                      <FolderOpen aria-hidden />
                    )}
                    移动到 场景
                  </button>
                  {groups.map((group) => (
                    <button
                      key={group.id}
                      type="button"
                      role="menuitem"
                      disabled={menuScene.groupId === group.id}
                      onClick={() => {
                        moveScene(menuScene.id, undefined, group.id);
                        setItemMenu(undefined);
                      }}
                    >
                      {menuScene.groupId === group.id ? (
                        <Check aria-hidden />
                      ) : (
                        <FolderOpen aria-hidden />
                      )}
                      移动到 {group.name}
                    </button>
                  ))}
                </>
              ) : null}

              <i aria-hidden />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  duplicateVisual(itemMenu.item);
                  setItemMenu(undefined);
                }}
              >
                <Copy aria-hidden />
                复制{menuScene ? "场景" : " CG"}
              </button>
              <i aria-hidden />
              <button
                type="button"
                className="danger"
                role="menuitem"
                disabled={menuReferences.length > 0}
                title={
                  menuReferences.length
                    ? menuScene
                      ? "场景仍被 Scene Block 引用，无法删除。"
                      : "CG 仍被显示 CG Block 引用，无法删除。"
                    : undefined
                }
                onClick={() => {
                  removeVisual(itemMenu.item);
                  setItemMenu(undefined);
                }}
              >
                <Trash2 aria-hidden />
                删除{menuScene ? "场景" : " CG"}
              </button>
            </div>,
            globalThis.document.body,
          )
        : null}
    </section>
  );
}
