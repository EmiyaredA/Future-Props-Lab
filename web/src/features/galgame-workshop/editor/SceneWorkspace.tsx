import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronRight,
  FileImage,
  FolderOpen,
  ImagePlus,
  LocateFixed,
  MapPinned,
  Plus,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import {
  uploadGalgameProjectAsset,
  type GalgameStoryProject,
  type GalgameStoryScene,
  type GalgameStorySceneBackground,
} from "@features/galgame-workshop/api";
import { stableId } from "@features/galgame-workshop/editor/model";
import {
  StoryImagePicker,
  type StoryImagePickerState,
} from "@features/galgame-workshop/editor/StoryImagePicker";
import { StoryAssetImage } from "@features/galgame-workshop/editor/StoryAssetImage";

type SceneReference = {
  chapterTitle: string;
  fragmentId: string;
  fragmentTitle: string;
  blockId: string;
  blockIndex: number;
  backgroundId?: string | null;
};

function referencesForScene(
  document: GalgameStoryProject,
  sceneId: string,
): SceneReference[] {
  const references: SceneReference[] = [];
  for (const chapter of document.chapters ?? []) {
    for (const fragment of chapter.fragments ?? []) {
      for (const [blockIndex, block] of (fragment.blocks ?? []).entries()) {
        if (block.type !== "scene" || block.sceneId !== sceneId) continue;
        references.push({
          chapterTitle: chapter.title,
          fragmentId: fragment.id,
          fragmentTitle: fragment.title,
          blockId: block.id,
          blockIndex,
          backgroundId: block.backgroundId,
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

function storyAssetUsedOutsideBackground(
  document: GalgameStoryProject,
  sceneId: string,
  backgroundId: string,
  assetId: string,
) {
  const usedByCharacter = (document.characters ?? []).some((character) =>
    (character.expressions ?? []).some(
      (expression) => expression.assetId === assetId,
    ),
  );
  const usedByBackground = (document.scenes ?? []).some((scene) =>
    (scene.backgrounds ?? []).some(
      (background) =>
        (scene.id !== sceneId || background.id !== backgroundId) &&
        background.assetId === assetId,
    ),
  );
  return usedByCharacter || usedByBackground;
}

function SceneThumbnail({
  scene,
  document,
}: {
  scene: GalgameStoryScene;
  document: GalgameStoryProject;
}) {
  const background = (scene.backgrounds ?? []).find(
    (item) => item.id === scene.defaultBackgroundId,
  );
  const asset = (document.assets ?? []).find(
    (item) => item.id === background?.assetId,
  );
  return (
    <span className="galgame-scene-thumbnail">
      <StoryAssetImage
        fileId={asset?.fileId}
        alt=""
        fallback={<MapPinned aria-hidden />}
      />
    </span>
  );
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
  const fileInput = useRef<HTMLInputElement>(null);
  const scenes = useMemo(() => document.scenes ?? [], [document.scenes]);
  const [query, setQuery] = useState("");
  const [selectedSceneId, setSelectedSceneId] = useState(scenes[0]?.id);
  const [selectedBackgroundId, setSelectedBackgroundId] = useState<string>();
  const [tab, setTab] = useState<"base" | "backgrounds">("backgrounds");
  const [picker, setPicker] = useState<StoryImagePickerState>();
  const [uploadError, setUploadError] = useState("");
  const selectedScene =
    scenes.find((scene) => scene.id === selectedSceneId) ?? scenes[0];
  const backgrounds = useMemo(
    () => selectedScene?.backgrounds ?? [],
    [selectedScene?.backgrounds],
  );
  const selectedBackground =
    backgrounds.find((background) => background.id === selectedBackgroundId) ??
    backgrounds.find(
      (background) => background.id === selectedScene?.defaultBackgroundId,
    ) ??
    backgrounds[0];
  const references = selectedScene
    ? referencesForScene(document, selectedScene.id)
    : [];
  const fragmentCount = new Set(
    references.map((reference) => reference.fragmentId),
  ).size;
  const filtered = scenes.filter((scene) =>
    scene.name
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
    if (!selectedScene && scenes[0]) setSelectedSceneId(scenes[0].id);
  }, [scenes, selectedScene]);

  useEffect(() => {
    if (!selectedBackground && backgrounds[0])
      setSelectedBackgroundId(
        selectedScene?.defaultBackgroundId ?? backgrounds[0].id,
      );
  }, [backgrounds, selectedBackground, selectedScene]);

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

  const bindFile = (fileId: string, name: string) => {
    if (!selectedScene || !picker) return;
    if (picker.mode === "replace" && selectedBackground) {
      onDocument({
        ...document,
        assets: (document.assets ?? []).map((asset) =>
          asset.id === selectedBackground.assetId
            ? { ...asset, fileId }
            : asset,
        ),
      });
      setPicker(undefined);
      return;
    }
    const assetId = stableId();
    const backgroundId = stableId();
    const background: GalgameStorySceneBackground = {
      id: backgroundId,
      label: displayLabel(name, `背景 ${backgrounds.length + 1}`),
      assetId,
    };
    onDocument({
      ...document,
      assets: [
        ...(document.assets ?? []),
        {
          id: assetId,
          type: "image",
          role: "sceneBackground",
          fileId,
          status: "ready",
        },
      ],
      scenes: scenes.map((scene) =>
        scene.id === selectedScene.id
          ? {
              ...scene,
              backgrounds: [...(scene.backgrounds ?? []), background],
              defaultBackgroundId: scene.defaultBackgroundId ?? backgroundId,
            }
          : scene,
      ),
    });
    setSelectedBackgroundId(backgroundId);
    setPicker(undefined);
  };

  const upload = useMutation({
    mutationFn: (file: File) => uploadGalgameProjectAsset(projectId, file),
    onSuccess: (asset) => {
      setUploadError("");
      void client.invalidateQueries({
        queryKey: ["galgame-project-assets", projectId],
      });
      bindFile(asset.id, asset.display_name);
    },
    onError: (caught) =>
      setUploadError(caught instanceof Error ? caught.message : "背景上传失败"),
  });

  const deleteBackground = (background: GalgameStorySceneBackground) => {
    if (!selectedScene) return;
    const explicit = references.filter(
      (reference) => reference.backgroundId === background.id,
    );
    if (explicit.length) {
      onNotice(`无法删除：背景仍被 ${explicit.length} 个场景 Block 显式引用。`);
      return;
    }
    if (
      selectedScene.defaultBackgroundId === background.id &&
      backgrounds.length > 1
    ) {
      onNotice("请先将其他背景设为默认，再删除当前默认背景。");
      return;
    }
    const remaining = backgrounds.filter((item) => item.id !== background.id);
    const assetStillUsed = storyAssetUsedOutsideBackground(
      document,
      selectedScene.id,
      background.id,
      background.assetId,
    );
    onDocument({
      ...document,
      assets: assetStillUsed
        ? document.assets
        : (document.assets ?? []).filter(
            (asset) => asset.id !== background.assetId,
          ),
      scenes: scenes.map((scene) =>
        scene.id === selectedScene.id
          ? {
              ...scene,
              backgrounds: remaining,
              defaultBackgroundId: remaining.length
                ? scene.defaultBackgroundId
                : null,
            }
          : scene,
      ),
    });
    setSelectedBackgroundId(remaining[0]?.id);
  };

  const deleteScene = () => {
    if (!selectedScene) return;
    if (references.length) {
      onNotice(`无法删除：场景仍被 ${references.length} 个 Scene Block 引用。`);
      return;
    }
    const removedAssetIds = new Set(
      backgrounds.map((background) => background.assetId),
    );
    const remainingScenes = scenes.filter(
      (scene) => scene.id !== selectedScene.id,
    );
    const retainedAssetIds = new Set([
      ...(document.characters ?? []).flatMap((character) =>
        (character.expressions ?? []).map((expression) => expression.assetId),
      ),
      ...remainingScenes.flatMap((scene) =>
        (scene.backgrounds ?? []).map((background) => background.assetId),
      ),
    ]);
    onDocument({
      ...document,
      scenes: remainingScenes,
      assets: (document.assets ?? []).filter(
        (asset) =>
          !removedAssetIds.has(asset.id) || retainedAssetIds.has(asset.id),
      ),
    });
    setSelectedSceneId(remainingScenes[0]?.id);
    setSelectedBackgroundId(undefined);
  };

  const activeAsset = selectedBackground
    ? assetsById.get(selectedBackground.assetId)
    : undefined;
  const defaultBackground = backgrounds.find(
    (background) => background.id === selectedScene?.defaultBackgroundId,
  );

  return (
    <section className="galgame-scene-workspace">
      <aside className="galgame-scene-list-panel">
        <header>
          <strong>场景列表</strong>
          <em>{scenes.length}</em>
        </header>
        <label className="galgame-scene-search">
          <Search aria-hidden />
          <input
            aria-label="搜索场景"
            value={query}
            placeholder="搜索场景…"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="galgame-scene-create"
          onClick={() => {
            const id = stableId();
            onDocument({
              ...document,
              scenes: [
                ...scenes,
                {
                  id,
                  name: "新场景",
                  description: "",
                  backgrounds: [],
                  defaultBackgroundId: null,
                },
              ],
            });
            setSelectedSceneId(id);
            setSelectedBackgroundId(undefined);
          }}
        >
          <Plus aria-hidden /> 新建场景
        </button>
        <div className="galgame-scene-list">
          {filtered.map((scene) => {
            const count = referencesForScene(document, scene.id).length;
            return (
              <button
                key={scene.id}
                type="button"
                className={scene.id === selectedScene?.id ? "active" : ""}
                onClick={() => {
                  setSelectedSceneId(scene.id);
                  setSelectedBackgroundId(
                    scene.defaultBackgroundId ?? undefined,
                  );
                }}
              >
                <SceneThumbnail scene={scene} document={document} />
                <span>
                  <strong>{scene.name}</strong>
                  <small>{count} 次场景切换</small>
                </span>
                <ChevronRight aria-hidden />
              </button>
            );
          })}
        </div>
      </aside>

      <main className="galgame-scene-detail-panel">
        {selectedScene ? (
          <>
            <header>
              <div>
                <strong>场景资料</strong>
                <span>编辑场景信息、默认背景和昼夜天气等状态差分。</span>
              </div>
              <nav aria-label="场景资料分类">
                <button
                  type="button"
                  className={tab === "base" ? "active" : ""}
                  onClick={() => setTab("base")}
                >
                  基础资料
                </button>
                <button
                  type="button"
                  className={tab === "backgrounds" ? "active" : ""}
                  onClick={() => setTab("backgrounds")}
                >
                  背景与状态
                </button>
              </nav>
            </header>
            {tab === "base" ? (
              <div className="galgame-scene-base-form">
                <label className="galgame-field">
                  <span>场景名称</span>
                  <input
                    value={selectedScene.name}
                    onChange={(event) =>
                      updateScene(selectedScene.id, (scene) => ({
                        ...scene,
                        name: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="galgame-field">
                  <span>设定说明</span>
                  <textarea
                    value={selectedScene.description}
                    onChange={(event) =>
                      updateScene(selectedScene.id, (scene) => ({
                        ...scene,
                        description: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="galgame-field">
                  <span>场景 ID（只读）</span>
                  <input value={selectedScene.id} readOnly />
                </label>
                <small>修改将在 650ms 后自动保存。</small>
              </div>
            ) : (
              <div className="galgame-background-editor">
                <div className="galgame-background-stage-column">
                  <div className="galgame-background-stage">
                    <StoryAssetImage
                      fileId={activeAsset?.fileId}
                      alt={`${selectedScene.name} · ${selectedBackground?.label ?? "背景"}`}
                      fallback={
                        <span>
                          <MapPinned aria-hidden />
                          <strong>尚未绑定场景背景</strong>
                          <small>无背景也可以继续编写和完成工程。</small>
                        </span>
                      }
                    />
                    {selectedBackground ? (
                      <em>{selectedBackground.label}</em>
                    ) : null}
                  </div>
                  <div className="galgame-background-actions">
                    <button
                      type="button"
                      onClick={() => {
                        setPicker({
                          mode: selectedBackground ? "replace" : "add",
                          source: "project",
                        });
                        requestAnimationFrame(() => fileInput.current?.click());
                      }}
                    >
                      <Upload aria-hidden />
                      {selectedBackground ? "替换背景" : "上传背景"}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setPicker({
                          mode: selectedBackground ? "replace" : "add",
                          source: "library",
                        })
                      }
                    >
                      <FolderOpen aria-hidden /> 从文件库选择
                    </button>
                  </div>
                  <input
                    ref={fileInput}
                    hidden
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp,.avif"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) upload.mutate(file);
                      event.target.value = "";
                    }}
                  />
                  {upload.isPending ? <small>正在上传背景…</small> : null}
                  {uploadError ? (
                    <small className="danger">{uploadError}</small>
                  ) : null}
                </div>
                <div className="galgame-background-state-column">
                  <header>
                    <strong>背景状态</strong>
                    <span>{backgrounds.length}</span>
                  </header>
                  <div className="galgame-background-grid">
                    {backgrounds.map((background) => {
                      const asset = assetsById.get(background.assetId);
                      return (
                        <button
                          key={background.id}
                          type="button"
                          className={
                            background.id === selectedBackground?.id
                              ? "active"
                              : ""
                          }
                          onClick={() => setSelectedBackgroundId(background.id)}
                        >
                          <span>
                            <StoryAssetImage
                              fileId={asset?.fileId}
                              alt=""
                              fallback={<FileImage aria-hidden />}
                            />
                          </span>
                          <strong>{background.label}</strong>
                          {background.id ===
                          selectedScene.defaultBackgroundId ? (
                            <em>默认</em>
                          ) : null}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      className="galgame-background-add"
                      onClick={() =>
                        setPicker({ mode: "add", source: "project" })
                      }
                    >
                      <ImagePlus aria-hidden /> 添加状态
                    </button>
                  </div>
                  {selectedBackground ? (
                    <div className="galgame-background-form">
                      <label className="galgame-field">
                        <span>状态名称</span>
                        <input
                          value={selectedBackground.label}
                          onChange={(event) =>
                            updateScene(selectedScene.id, (scene) => ({
                              ...scene,
                              backgrounds: (scene.backgrounds ?? []).map(
                                (background) =>
                                  background.id === selectedBackground.id
                                    ? {
                                        ...background,
                                        label: event.target.value,
                                      }
                                    : background,
                              ),
                            }))
                          }
                        />
                      </label>
                      <label className="galgame-field">
                        <span>背景 ID（只读）</span>
                        <input value={selectedBackground.id} readOnly />
                      </label>
                      <div>
                        <button
                          type="button"
                          disabled={
                            selectedBackground.id ===
                            selectedScene.defaultBackgroundId
                          }
                          onClick={() =>
                            updateScene(selectedScene.id, (scene) => ({
                              ...scene,
                              defaultBackgroundId: selectedBackground.id,
                            }))
                          }
                        >
                          <Check aria-hidden /> 设为默认
                        </button>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => deleteBackground(selectedBackground)}
                        >
                          <Trash2 aria-hidden /> 删除背景
                        </button>
                      </div>
                    </div>
                  ) : null}
                  <footer>
                    <Check aria-hidden />
                    {backgrounds.length
                      ? "默认背景已绑定 · 修改将在 650ms 后自动保存"
                      : "添加第一个背景后会自动设为默认状态"}
                  </footer>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="galgame-entity-empty">
            <MapPinned aria-hidden />
            <strong>还没有场景</strong>
            <span>从左侧创建场景后开始编辑资料与背景。</span>
          </div>
        )}
      </main>

      <aside className="galgame-scene-reference-panel">
        <section>
          <header>
            <strong>剧本引用</strong>
          </header>
          <div className="galgame-scene-reference-metrics">
            <span>
              <strong>{references.length}</strong>
              <small>次场景切换</small>
            </span>
            <span>
              <strong>{fragmentCount}</strong>
              <small>个 Fragment</small>
            </span>
          </div>
          <div className="galgame-scene-reference-list">
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
                    {reference.chapterTitle} · {reference.fragmentTitle} · Block{" "}
                    {reference.blockIndex + 1}
                  </strong>
                  <small>
                    {reference.backgroundId
                      ? (backgrounds.find(
                          (background) =>
                            background.id === reference.backgroundId,
                        )?.label ?? "显式背景")
                      : `跟随默认 · ${defaultBackground?.label ?? "主题占位"}`}
                  </small>
                </span>
                <ChevronRight aria-hidden />
              </button>
            ))}
            {!references.length ? (
              <p>这个场景还没有被 Scene Block 引用。</p>
            ) : null}
          </div>
          {references[0] ? (
            <button
              type="button"
              className="galgame-scene-locate"
              onClick={() =>
                onLocate(references[0].fragmentId, references[0].blockId)
              }
            >
              <LocateFixed aria-hidden /> 定位到剧本
            </button>
          ) : null}
          <p className="galgame-scene-preview-state">
            <MapPinned aria-hidden /> 试玩默认使用：
            <strong>{defaultBackground?.label ?? "确定性主题占位"}</strong>
          </p>
        </section>
        <section className="galgame-scene-danger-zone">
          <header>
            <strong>删除场景</strong>
            <span>
              {references.length
                ? "场景仍被 Scene Block 引用，无法删除。"
                : "删除场景会同时解除其背景绑定。"}
            </span>
          </header>
          <button
            type="button"
            disabled={!selectedScene || Boolean(references.length)}
            onClick={deleteScene}
          >
            <Trash2 aria-hidden /> 删除场景
          </button>
        </section>
      </aside>

      {picker ? (
        <StoryImagePicker
          projectId={projectId}
          state={picker}
          usedFileIds={usedFileIds}
          addTitle="添加场景背景"
          replaceTitle="替换场景背景"
          searchLabel="搜索背景素材"
          projectEmptyCopy="上传图片后即可绑定为场景背景。"
          onState={setPicker}
          onChoose={bindFile}
          onUpload={() => fileInput.current?.click()}
          onClose={() => setPicker(undefined)}
        />
      ) : null}
    </section>
  );
}
