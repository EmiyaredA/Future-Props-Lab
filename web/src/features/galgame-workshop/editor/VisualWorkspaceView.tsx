import {
  ExternalLink,
  Eye,
  Image as ImageIcon,
  ImagePlus,
  Images,
  MapPinned,
  Minus,
  MousePointer2,
  Move,
  PanelLeftClose,
  PanelRightClose,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { StoryImagePicker } from "@features/galgame-workshop/editor/StoryImagePicker";
import { StoryAssetImage } from "@features/galgame-workshop/editor/StoryAssetImage";
import { InlineEditableName } from "@features/galgame-workshop/editor/EditorShared";
import type { useVisualWorkspaceController } from "@features/galgame-workshop/editor/useVisualWorkspaceController";
import { VisualBrowserPanel } from "@features/galgame-workshop/editor/visuals/VisualBrowserPanel";
import { VisualStackPanel } from "@features/galgame-workshop/editor/visuals/VisualStackPanel";
import { VisualItemMenu } from "@features/galgame-workshop/editor/visuals/VisualItemMenu";

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
    onLocate,
    onNotice,
    fileInput,
    stageRef,
    distanceAxisRef,
    scenes,
    cgs,
    selection,
    browserOpen,
    setBrowserOpen,
    stackOpen,
    setStackOpen,
    setSelectedLayerId,
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
    selectedScene,
    selectedCg,
    layers,
    selectedLayer,
    defaultVariant,
    selectedVariant,
    assetsById,
    usedFileIds,
    sceneRefs,
    cgRefs,
    updateScene,
    updateCg,
    bindFile,
    upload,
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
        <VisualBrowserPanel model={model} />

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

        <VisualStackPanel model={model} />

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

      <VisualItemMenu model={model} />
    </section>
  );
}
