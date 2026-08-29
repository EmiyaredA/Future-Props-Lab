import {
  Check,
  Eye,
  EyeOff,
  FolderOpen,
  GripVertical,
  Images,
  MapPinned,
  Plus,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { StoryAssetImage } from "@features/galgame-workshop/editor/StoryAssetImage";
import type { useVisualWorkspaceController } from "@features/galgame-workshop/editor/useVisualWorkspaceController";

type VisualWorkspaceViewModel = ReturnType<typeof useVisualWorkspaceController>;

export function VisualStackPanel({
  model,
}: {
  model: VisualWorkspaceViewModel;
}) {
  const {
    fileInput,
    draggedItem,
    selection,
    layerQuery,
    setLayerQuery,
    setSelectedLayerId,
    setSelectedVariantId,
    setPickerTarget,
    isolatedLayerId,
    setIsolatedLayerId,
    selectedScene,
    selectedCg,
    layers,
    variants,
    selectedLayer,
    selectedVariant,
    assetsById,
    filteredLayers,
    updateScene,
    updateCg,
    upload,
    openPicker,
    reorderLayer,
    reorderVariant,
    removeVariant,
    setLayerDistance,
    detailCount,
  } = model;
  return (
    <>
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
                const index = layers.findIndex((item) => item.id === layer.id);
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
                          setLayerDistance(layer.id, Number(event.target.value))
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
                  const isDefault = variant.id === selectedCg?.defaultVariantId;
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
                        const variantId = dragged?.id.replace(/^variant:/, "");
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
                              variants: (cg.variants ?? []).map((candidate) =>
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
                        <small>{isDefault ? "默认差分" : asset?.fileId}</small>
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
    </>
  );
}
