import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  FolderOpen,
  ImagePlus,
  LocateFixed,
  MapPinned,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import {
  uploadGalgameProjectAsset,
  type GalgameStoryProject,
  type GalgameStoryScene,
  type GalgameStorySceneLayer,
} from "@features/galgame-workshop/api";
import { stableId } from "@features/galgame-workshop/editor/model";
import {
  StoryImagePicker,
  type StoryImagePickerState,
} from "@features/galgame-workshop/editor/StoryImagePicker";
import { StoryAssetImage } from "@features/galgame-workshop/editor/StoryAssetImage";

function sceneReferences(document: GalgameStoryProject, sceneId: string) {
  return (document.chapters ?? []).flatMap((chapter) =>
    (chapter.fragments ?? []).flatMap((fragment) =>
      (fragment.blocks ?? []).flatMap((block, index) =>
        block.type === "scene" && block.sceneId === sceneId
          ? [
              {
                chapter: chapter.title,
                fragmentId: fragment.id,
                fragment: fragment.title,
                blockId: block.id,
                index,
              },
            ]
          : [],
      ),
    ),
  );
}

function cleanLabel(filename: string, fallback: string) {
  return filename.replace(/\.[^.]+$/, "").trim() || fallback;
}

export function SceneWorkspace({
  projectId,
  document,
  onDocument,
  onLocate,
  onNotice,
}: {
  projectId: string;
  document: GalgameStoryProject;
  onDocument: (document: GalgameStoryProject) => void;
  onLocate: (fragmentId: string, blockId: string) => void;
  onNotice: (message: string) => void;
}) {
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const scenes = document.scenes ?? [];
  const groups = document.sceneGroups ?? [];
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(scenes[0] ? [scenes[0].id] : []),
  );
  const [selectedSceneId, setSelectedSceneId] = useState(scenes[0]?.id);
  const [selectedLayerId, setSelectedLayerId] = useState<string>();
  const [picker, setPicker] = useState<StoryImagePickerState>();
  const [pickerMode, setPickerMode] = useState<"add" | "replace">("add");
  const [narrow, setNarrow] = useState(false);
  const [isolatedLayerId, setIsolatedLayerId] = useState<string>();
  const [cameraZoom, setCameraZoom] = useState(1);
  const [parallax, setParallax] = useState(0);
  const selectedScene =
    scenes.find((scene) => scene.id === selectedSceneId) ?? scenes[0];
  const layers = selectedScene?.layers ?? [];
  const selectedLayer =
    layers.find((layer) => layer.id === selectedLayerId) ?? layers[0];
  const assets = new Map(
    (document.assets ?? []).map((asset) => [asset.id, asset]),
  );
  const usedFileIds = useMemo(
    () => new Set((document.assets ?? []).map((asset) => asset.fileId)),
    [document.assets],
  );
  const references = selectedScene
    ? sceneReferences(document, selectedScene.id)
    : [];
  const visibleScenes = scenes.filter((scene) =>
    `${scene.name} ${scene.description}`
      .toLocaleLowerCase("zh-CN")
      .includes(query.toLocaleLowerCase("zh-CN")),
  );

  const updateScene = (
    sceneId: string,
    updater: (scene: GalgameStoryScene) => GalgameStoryScene,
  ) =>
    onDocument({
      ...document,
      scenes: scenes.map((scene) =>
        scene.id === sceneId ? updater(scene) : scene,
      ),
    });

  const ensureStoryAsset = (fileId: string, name: string) => {
    const existing = (document.assets ?? []).find(
      (asset) => asset.type === "image" && asset.fileId === fileId,
    );
    if (existing)
      return { storyAssetId: existing.id, nextAssets: document.assets ?? [] };
    const storyAssetId = stableId();
    return {
      storyAssetId,
      nextAssets: [
        ...(document.assets ?? []),
        {
          id: storyAssetId,
          type: "image" as const,
          role: "sceneLayer" as const,
          fileId,
          status: "ready" as const,
        },
      ],
      name,
    };
  };

  const bindFile = (fileId: string, name: string) => {
    if (!selectedScene) return;
    const { storyAssetId, nextAssets } = ensureStoryAsset(fileId, name);
    const layerName = cleanLabel(name, `图层 ${layers.length + 1}`);
    onDocument({
      ...document,
      assets: nextAssets,
      scenes: scenes.map((scene) => {
        if (scene.id !== selectedScene.id) return scene;
        if (pickerMode === "replace" && selectedLayer)
          return {
            ...scene,
            layers: (scene.layers ?? []).map((layer) =>
              layer.id === selectedLayer.id
                ? { ...layer, assetId: storyAssetId, name: layerName }
                : layer,
            ),
          };
        const layer: GalgameStorySceneLayer = {
          id: stableId(),
          name: layerName,
          assetId: storyAssetId,
          distance: 1,
          offsetX: 0,
          offsetY: 0,
        };
        setSelectedLayerId(layer.id);
        return { ...scene, layers: [...(scene.layers ?? []), layer] };
      }),
    });
    setPicker(undefined);
  };

  const upload = useMutation({
    mutationFn: (file: File) =>
      uploadGalgameProjectAsset(projectId, file, "scene"),
    onSuccess: (file) => {
      bindFile(file.id, file.display_name);
      void client.invalidateQueries({
        queryKey: ["galgame-project-assets", projectId],
      });
      onNotice("场景图层已导入 backgrounds/ 并加入当前场景。");
    },
    onError: () => onNotice("场景图片上传失败，请检查格式和文件大小。"),
  });

  const chooseScene = (sceneId: string, additive: boolean) => {
    setSelectedSceneId(sceneId);
    setSelectedLayerId(undefined);
    setSelectedIds((current) => {
      if (!additive) return new Set([sceneId]);
      const next = new Set(current);
      if (next.has(sceneId)) next.delete(sceneId);
      else next.add(sceneId);
      return next;
    });
  };

  const duplicateSelected = () => {
    const source = scenes.filter((scene) => selectedIds.has(scene.id));
    if (!source.length) return;
    const copies = source.map((scene) => ({
      ...scene,
      id: stableId(),
      name: `${scene.name} 副本`,
      layers: (scene.layers ?? []).map((layer) => ({
        ...layer,
        id: stableId(),
      })),
    }));
    onDocument({ ...document, scenes: [...scenes, ...copies] });
    setSelectedSceneId(copies[0].id);
    setSelectedIds(new Set(copies.map((scene) => scene.id)));
  };

  const moveLayer = (layerId: string, direction: -1 | 1) => {
    if (!selectedScene) return;
    const index = layers.findIndex((layer) => layer.id === layerId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= layers.length) return;
    const next = [...layers];
    [next[index], next[target]] = [next[target], next[index]];
    updateScene(selectedScene.id, (scene) => ({ ...scene, layers: next }));
  };

  return (
    <div className={`galgame-scene-workspace${narrow ? " is-narrow" : ""}`}>
      <aside className="galgame-scene-browser">
        <header>
          <div>
            <small>SCENES</small>
            {!narrow ? <strong>场景与分组</strong> : null}
          </div>
          <button
            type="button"
            aria-label="切换窄栏"
            onClick={() => setNarrow(!narrow)}
          >
            {narrow ? (
              <PanelLeftOpen aria-hidden />
            ) : (
              <PanelLeftClose aria-hidden />
            )}
          </button>
        </header>
        {!narrow ? (
          <>
            <label className="galgame-asset-search">
              <Search aria-hidden />
              <input
                value={query}
                placeholder="搜索场景…"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="galgame-scene-browser-actions">
              <button
                type="button"
                aria-label="新建场景"
                onClick={() => {
                  const scene: GalgameStoryScene = {
                    id: stableId(),
                    name: `新场景 ${scenes.length + 1}`,
                    description: "",
                    layers: [],
                  };
                  onDocument({ ...document, scenes: [...scenes, scene] });
                  setSelectedSceneId(scene.id);
                  setSelectedIds(new Set([scene.id]));
                }}
              >
                <Plus aria-hidden /> 新建
              </button>
              <button
                type="button"
                disabled={!selectedIds.size}
                onClick={duplicateSelected}
              >
                <Copy aria-hidden /> 复制
              </button>
            </div>
          </>
        ) : null}
        <div className="galgame-scene-list">
          {[undefined, ...groups].map((group) => {
            const groupScenes = visibleScenes.filter(
              (scene) =>
                scene.groupId === group?.id || (!group && !scene.groupId),
            );
            if (!groupScenes.length && !group) return null;
            return (
              <section key={group?.id ?? "ungrouped"}>
                {!narrow && group ? (
                  <button
                    type="button"
                    className="galgame-scene-group"
                    onClick={() =>
                      onDocument({
                        ...document,
                        sceneGroups: groups.map((item) =>
                          item.id === group.id
                            ? { ...item, collapsed: !item.collapsed }
                            : item,
                        ),
                      })
                    }
                  >
                    <i style={{ background: group.color }} />
                    <span>{group.name}</span>
                    {group.collapsed ? (
                      <ChevronDown aria-hidden />
                    ) : (
                      <ChevronUp aria-hidden />
                    )}
                  </button>
                ) : null}
                {!group?.collapsed
                  ? groupScenes.map((scene) => {
                      const firstLayer = scene.layers?.[0];
                      const asset = assets.get(firstLayer?.assetId ?? "");
                      return (
                        <button
                          key={scene.id}
                          type="button"
                          className={selectedIds.has(scene.id) ? "active" : ""}
                          draggable
                          onClick={(event) =>
                            chooseScene(
                              scene.id,
                              event.metaKey || event.ctrlKey,
                            )
                          }
                          onDragStart={(event) =>
                            event.dataTransfer.setData(
                              "text/scene-id",
                              scene.id,
                            )
                          }
                        >
                          <span>
                            <StoryAssetImage
                              fileId={asset?.fileId}
                              alt=""
                              fallback={<MapPinned aria-hidden />}
                            />
                          </span>
                          {!narrow ? (
                            <em>
                              <strong>{scene.name}</strong>
                              <small>{scene.layers?.length ?? 0} 层</small>
                            </em>
                          ) : null}
                        </button>
                      );
                    })
                  : null}
              </section>
            );
          })}
        </div>
        {!narrow ? (
          <button
            type="button"
            className="galgame-scene-add-group"
            onClick={() => {
              const id = stableId();
              onDocument({
                ...document,
                sceneGroups: [
                  ...groups,
                  {
                    id,
                    name: `分组 ${groups.length + 1}`,
                    color: "#7586E5",
                    collapsed: false,
                  },
                ],
              });
            }}
          >
            <Plus aria-hidden /> 添加分组
          </button>
        ) : null}
      </aside>

      <main className="galgame-scene-stage-panel">
        <header>
          <div>
            <strong>{selectedScene?.name ?? "尚未创建场景"}</strong>
            <span>{layers.length} 个图层 · 预览镜头不写入 Camera Block</span>
          </div>
          <label>
            镜头缩放
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.05"
              value={cameraZoom}
              onChange={(event) => setCameraZoom(Number(event.target.value))}
            />
          </label>
          <label>
            视差
            <input
              type="range"
              min="-30"
              max="30"
              step="1"
              value={parallax}
              onChange={(event) => setParallax(Number(event.target.value))}
            />
          </label>
        </header>
        <div
          className="galgame-scene-stage"
          data-empty={!layers.length || undefined}
        >
          {layers.map((layer, index) => {
            if (isolatedLayerId && isolatedLayerId !== layer.id) return null;
            const asset = assets.get(layer.assetId);
            return (
              <StoryAssetImage
                key={layer.id}
                fileId={asset?.fileId}
                alt=""
                className="galgame-scene-stage-layer"
                style={{
                  zIndex: index,
                  transform: `translate(${layer.offsetX + parallax / layer.distance}%, ${layer.offsetY}%) scale(${cameraZoom})`,
                }}
                fallback={null}
              />
            );
          })}
          {!layers.length ? (
            <div>
              <ImagePlus aria-hidden />
              <strong>添加第一张图片即可创建单层场景</strong>
              <span>继续添加会自动成为多层场景。</span>
            </div>
          ) : null}
        </div>
        {selectedScene ? (
          <footer>
            <input
              value={selectedScene.name}
              aria-label="场景名称"
              onChange={(event) =>
                updateScene(selectedScene.id, (scene) => ({
                  ...scene,
                  name: event.target.value,
                }))
              }
            />
            <select
              value={selectedScene.groupId ?? ""}
              onChange={(event) =>
                updateScene(selectedScene.id, (scene) => ({
                  ...scene,
                  groupId: event.target.value || null,
                }))
              }
            >
              <option value="">未分组</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
            <span>{references.length} 处引用</span>
            {references.length ? (
              <small>场景仍被 Scene Block 引用，无法删除。</small>
            ) : null}
            <button
              type="button"
              className="danger"
              aria-label="删除场景"
              disabled={Boolean(references.length)}
              onClick={() => {
                if (references.length) {
                  onNotice("场景仍被 Scene Block 引用，无法删除。");
                  return;
                }
                const remaining = scenes.filter(
                  (scene) => scene.id !== selectedScene.id,
                );
                onDocument({ ...document, scenes: remaining });
                setSelectedSceneId(remaining[0]?.id);
                setSelectedIds(new Set(remaining[0] ? [remaining[0].id] : []));
              }}
            >
              <Trash2 aria-hidden /> 删除场景
            </button>
            {references.map((reference) => (
              <button
                key={reference.blockId}
                type="button"
                onClick={() =>
                  onLocate(reference.fragmentId, reference.blockId)
                }
              >
                <LocateFixed aria-hidden /> {reference.chapter} ·{" "}
                {reference.fragment} · Block {reference.index + 1}
              </button>
            ))}
          </footer>
        ) : null}
      </main>

      <aside className="galgame-scene-layers-panel">
        <header>
          <div>
            <small>RENDER ORDER</small>
            <strong>图层</strong>
          </div>
          <span>{layers.length}</span>
        </header>
        <div className="galgame-scene-layer-list">
          {[...layers].reverse().map((layer) => {
            const asset = assets.get(layer.assetId);
            return (
              <article
                key={layer.id}
                className={layer.id === selectedLayer?.id ? "active" : ""}
                onClick={() => setSelectedLayerId(layer.id)}
              >
                <span>
                  <StoryAssetImage
                    fileId={asset?.fileId}
                    alt=""
                    fallback={<MapPinned aria-hidden />}
                  />
                </span>
                <div>
                  <input
                    value={layer.name}
                    aria-label="图层名称"
                    onChange={(event) =>
                      updateScene(selectedScene!.id, (scene) => ({
                        ...scene,
                        layers: (scene.layers ?? []).map((item) =>
                          item.id === layer.id
                            ? { ...item, name: event.target.value }
                            : item,
                        ),
                      }))
                    }
                  />
                  <small>
                    距离 {layer.distance.toFixed(1)} · {layer.offsetX},{" "}
                    {layer.offsetY}
                  </small>
                </div>
                <button
                  type="button"
                  aria-label="隔离图层"
                  onClick={(event) => {
                    event.stopPropagation();
                    setIsolatedLayerId(
                      isolatedLayerId === layer.id ? undefined : layer.id,
                    );
                  }}
                >
                  {isolatedLayerId === layer.id ? (
                    <Eye aria-hidden />
                  ) : (
                    <EyeOff aria-hidden />
                  )}
                </button>
              </article>
            );
          })}
        </div>
        {selectedLayer && selectedScene ? (
          <section className="galgame-scene-layer-detail">
            <label>
              距离
              <input
                type="number"
                min="0.1"
                max="100"
                step="0.1"
                value={selectedLayer.distance}
                onChange={(event) =>
                  updateScene(selectedScene.id, (scene) => ({
                    ...scene,
                    layers: (scene.layers ?? []).map((layer) =>
                      layer.id === selectedLayer.id
                        ? { ...layer, distance: Number(event.target.value) }
                        : layer,
                    ),
                  }))
                }
              />
            </label>
            <label>
              偏移 X
              <input
                type="number"
                min="-200"
                max="200"
                value={selectedLayer.offsetX}
                onChange={(event) =>
                  updateScene(selectedScene.id, (scene) => ({
                    ...scene,
                    layers: (scene.layers ?? []).map((layer) =>
                      layer.id === selectedLayer.id
                        ? { ...layer, offsetX: Number(event.target.value) }
                        : layer,
                    ),
                  }))
                }
              />
            </label>
            <label>
              偏移 Y
              <input
                type="number"
                min="-200"
                max="200"
                value={selectedLayer.offsetY}
                onChange={(event) =>
                  updateScene(selectedScene.id, (scene) => ({
                    ...scene,
                    layers: (scene.layers ?? []).map((layer) =>
                      layer.id === selectedLayer.id
                        ? { ...layer, offsetY: Number(event.target.value) }
                        : layer,
                    ),
                  }))
                }
              />
            </label>
            <div>
              <button
                type="button"
                onClick={() => moveLayer(selectedLayer.id, 1)}
              >
                <ChevronUp aria-hidden /> 上移
              </button>
              <button
                type="button"
                onClick={() => moveLayer(selectedLayer.id, -1)}
              >
                <ChevronDown aria-hidden /> 下移
              </button>
              <button
                type="button"
                onClick={() => {
                  setPickerMode("replace");
                  setPicker({ mode: "replace", source: "project" });
                }}
              >
                <FolderOpen aria-hidden /> 替换
              </button>
              <button
                type="button"
                className="danger"
                onClick={() =>
                  updateScene(selectedScene.id, (scene) => ({
                    ...scene,
                    layers: (scene.layers ?? []).filter(
                      (layer) => layer.id !== selectedLayer.id,
                    ),
                  }))
                }
              >
                <Trash2 aria-hidden /> 删除
              </button>
            </div>
          </section>
        ) : null}
        <div className="galgame-scene-layer-add">
          <button
            type="button"
            disabled={!selectedScene}
            onClick={() => {
              setPickerMode("add");
              setPicker({ mode: "add", source: "project" });
            }}
          >
            <FolderOpen aria-hidden /> 素材库添加
          </button>
          <button
            type="button"
            disabled={!selectedScene || upload.isPending}
            onClick={() => input.current?.click()}
          >
            <Upload aria-hidden /> 导入图片
          </button>
          <input
            ref={input}
            hidden
            type="file"
            accept=".jpg,.jpeg,.png,.webp,.avif"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) upload.mutate(file);
            }}
          />
        </div>
      </aside>

      {picker ? (
        <StoryImagePicker
          projectId={projectId}
          state={picker}
          usedFileIds={usedFileIds}
          addTitle="添加场景图层"
          replaceTitle="替换场景图层"
          searchLabel="搜索场景图片"
          projectEmptyCopy="工程中还没有可用的场景图片。"
          onState={setPicker}
          onChoose={bindFile}
          onUpload={() => input.current?.click()}
          onClose={() => setPicker(undefined)}
        />
      ) : null}
    </div>
  );
}
