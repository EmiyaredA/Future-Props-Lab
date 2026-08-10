import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronRight,
  FileImage,
  FolderOpen,
  ImagePlus,
  Images,
  LocateFixed,
  Plus,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import {
  uploadGalgameProjectAsset,
  type GalgameStoryCg,
  type GalgameStoryCgVariant,
  type GalgameStoryProject,
} from "@features/galgame-workshop/api";
import { stableId } from "@features/galgame-workshop/editor/model";
import {
  StoryImagePicker,
  type StoryImagePickerState,
} from "@features/galgame-workshop/editor/StoryImagePicker";
import { StoryAssetImage } from "@features/galgame-workshop/editor/StoryAssetImage";

type CgReference = {
  chapterTitle: string;
  fragmentId: string;
  fragmentTitle: string;
  blockId: string;
  blockIndex: number;
  variantId?: string | null;
};

function referencesForCg(
  document: GalgameStoryProject,
  cgId: string,
): CgReference[] {
  const references: CgReference[] = [];
  for (const chapter of document.chapters ?? [])
    for (const fragment of chapter.fragments ?? [])
      for (const [blockIndex, block] of (fragment.blocks ?? []).entries()) {
        if (block.type !== "showCg" || block.cgId !== cgId) continue;
        references.push({
          chapterTitle: chapter.title,
          fragmentId: fragment.id,
          fragmentTitle: fragment.title,
          blockId: block.id,
          blockIndex,
          variantId: block.variantId,
        });
      }
  return references;
}

function displayLabel(filename: string, fallback: string) {
  const label = filename.replace(/\.[^.]+$/, "").trim();
  return label || fallback;
}

function cgAssetUsedElsewhere(
  document: GalgameStoryProject,
  cgId: string,
  variantId: string,
  assetId: string,
) {
  return (document.cgs ?? []).some((cg) =>
    (cg.variants ?? []).some(
      (variant) =>
        (cg.id !== cgId || variant.id !== variantId) &&
        variant.assetId === assetId,
    ),
  );
}

function CgThumbnail({
  cg,
  document,
}: {
  cg: GalgameStoryCg;
  document: GalgameStoryProject;
}) {
  const variant = (cg.variants ?? []).find(
    (item) => item.id === cg.defaultVariantId,
  );
  const asset = (document.assets ?? []).find(
    (item) => item.id === variant?.assetId,
  );
  return (
    <span className="galgame-scene-thumbnail">
      <StoryAssetImage
        fileId={asset?.fileId}
        alt=""
        fallback={<Images aria-hidden />}
      />
    </span>
  );
}

export function CgWorkspace({
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
  const cgs = useMemo(() => document.cgs ?? [], [document.cgs]);
  const [query, setQuery] = useState("");
  const [selectedCgId, setSelectedCgId] = useState(cgs[0]?.id);
  const [selectedVariantId, setSelectedVariantId] = useState<string>();
  const [tab, setTab] = useState<"base" | "variants">("variants");
  const [picker, setPicker] = useState<StoryImagePickerState>();
  const [uploadError, setUploadError] = useState("");
  const selectedCg = cgs.find((cg) => cg.id === selectedCgId) ?? cgs[0];
  const variants = useMemo(
    () => selectedCg?.variants ?? [],
    [selectedCg?.variants],
  );
  const selectedVariant =
    variants.find((variant) => variant.id === selectedVariantId) ??
    variants.find((variant) => variant.id === selectedCg?.defaultVariantId) ??
    variants[0];
  const references = selectedCg ? referencesForCg(document, selectedCg.id) : [];
  const fragmentCount = new Set(
    references.map((reference) => reference.fragmentId),
  ).size;
  const filtered = cgs.filter((cg) =>
    cg.name
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
    if (!selectedCg && cgs[0]) setSelectedCgId(cgs[0].id);
  }, [cgs, selectedCg]);

  useEffect(() => {
    if (!selectedVariant && variants[0])
      setSelectedVariantId(selectedCg?.defaultVariantId ?? variants[0].id);
  }, [selectedCg, selectedVariant, variants]);

  const updateCg = (
    cgId: string,
    updater: (cg: GalgameStoryCg) => GalgameStoryCg,
  ) =>
    onDocument({
      ...document,
      cgs: cgs.map((cg) => (cg.id === cgId ? updater(cg) : cg)),
    });

  const bindFile = (fileId: string, name: string) => {
    if (!selectedCg || !picker) return;
    if (picker.mode === "replace" && selectedVariant) {
      onDocument({
        ...document,
        assets: (document.assets ?? []).map((asset) =>
          asset.id === selectedVariant.assetId ? { ...asset, fileId } : asset,
        ),
      });
      setPicker(undefined);
      return;
    }
    const assetId = stableId();
    const variantId = stableId();
    const variant: GalgameStoryCgVariant = {
      id: variantId,
      label: displayLabel(name, `差分 ${variants.length + 1}`),
      assetId,
    };
    onDocument({
      ...document,
      assets: [
        ...(document.assets ?? []),
        {
          id: assetId,
          type: "image",
          role: "storyCg",
          fileId,
          status: "ready",
        },
      ],
      cgs: cgs.map((cg) =>
        cg.id === selectedCg.id
          ? {
              ...cg,
              variants: [...(cg.variants ?? []), variant],
              defaultVariantId: cg.defaultVariantId ?? variantId,
            }
          : cg,
      ),
    });
    setSelectedVariantId(variantId);
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
      setUploadError(caught instanceof Error ? caught.message : "CG 上传失败"),
  });

  const deleteVariant = (variant: GalgameStoryCgVariant) => {
    if (!selectedCg) return;
    const effectiveReferences = references.filter(
      (reference) =>
        reference.variantId === variant.id ||
        (!reference.variantId && selectedCg.defaultVariantId === variant.id),
    );
    if (effectiveReferences.length) {
      onNotice(
        `无法删除：差分仍被 ${effectiveReferences.length} 个显示 CG Block 引用。`,
      );
      return;
    }
    if (selectedCg.defaultVariantId === variant.id && variants.length > 1) {
      onNotice("请先将其他差分设为默认，再删除当前默认差分。");
      return;
    }
    const remaining = variants.filter((item) => item.id !== variant.id);
    const assetStillUsed = cgAssetUsedElsewhere(
      document,
      selectedCg.id,
      variant.id,
      variant.assetId,
    );
    onDocument({
      ...document,
      assets: assetStillUsed
        ? document.assets
        : (document.assets ?? []).filter(
            (asset) => asset.id !== variant.assetId,
          ),
      cgs: cgs.map((cg) =>
        cg.id === selectedCg.id
          ? {
              ...cg,
              variants: remaining,
              defaultVariantId: remaining.length ? cg.defaultVariantId : null,
            }
          : cg,
      ),
    });
    setSelectedVariantId(remaining[0]?.id);
  };

  const deleteCg = () => {
    if (!selectedCg) return;
    if (references.length) {
      onNotice(`无法删除：CG 仍被 ${references.length} 个显示 CG Block 引用。`);
      return;
    }
    const removedAssetIds = new Set(variants.map((variant) => variant.assetId));
    const remainingCgs = cgs.filter((cg) => cg.id !== selectedCg.id);
    const retainedAssetIds = new Set(
      remainingCgs.flatMap((cg) =>
        (cg.variants ?? []).map((variant) => variant.assetId),
      ),
    );
    onDocument({
      ...document,
      cgs: remainingCgs,
      assets: (document.assets ?? []).filter(
        (asset) =>
          !removedAssetIds.has(asset.id) || retainedAssetIds.has(asset.id),
      ),
    });
    setSelectedCgId(remainingCgs[0]?.id);
    setSelectedVariantId(undefined);
  };

  const activeAsset = selectedVariant
    ? assetsById.get(selectedVariant.assetId)
    : undefined;
  const defaultVariant = variants.find(
    (variant) => variant.id === selectedCg?.defaultVariantId,
  );

  return (
    <section className="galgame-scene-workspace galgame-cg-workspace">
      <aside className="galgame-scene-list-panel">
        <header>
          <strong>CG 列表</strong>
          <em>{cgs.length}</em>
        </header>
        <label className="galgame-scene-search">
          <Search aria-hidden />
          <input
            aria-label="搜索剧情 CG"
            value={query}
            placeholder="搜索 CG…"
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
              cgs: [
                ...cgs,
                {
                  id,
                  name: "新剧情 CG",
                  description: "",
                  variants: [],
                  defaultVariantId: null,
                },
              ],
            });
            setSelectedCgId(id);
            setSelectedVariantId(undefined);
          }}
        >
          <Plus aria-hidden /> 新建 CG
        </button>
        <div className="galgame-scene-list">
          {filtered.map((cg) => {
            const count = referencesForCg(document, cg.id).length;
            return (
              <button
                key={cg.id}
                type="button"
                className={cg.id === selectedCg?.id ? "active" : ""}
                onClick={() => {
                  setSelectedCgId(cg.id);
                  setSelectedVariantId(cg.defaultVariantId ?? undefined);
                }}
              >
                <CgThumbnail cg={cg} document={document} />
                <span>
                  <strong>{cg.name}</strong>
                  <small>{count} 次剧情显示</small>
                </span>
                <ChevronRight aria-hidden />
              </button>
            );
          })}
        </div>
      </aside>

      <main className="galgame-scene-detail-panel">
        {selectedCg ? (
          <>
            <header>
              <div>
                <strong>剧情 CG 资料</strong>
                <span>管理分镜说明、默认画面和构图差分。</span>
              </div>
              <nav aria-label="剧情 CG 资料分类">
                <button
                  type="button"
                  className={tab === "base" ? "active" : ""}
                  onClick={() => setTab("base")}
                >
                  基础资料
                </button>
                <button
                  type="button"
                  className={tab === "variants" ? "active" : ""}
                  onClick={() => setTab("variants")}
                >
                  图片与差分
                </button>
              </nav>
            </header>
            {tab === "base" ? (
              <div className="galgame-scene-base-form">
                <label className="galgame-field">
                  <span>CG 名称</span>
                  <input
                    value={selectedCg.name}
                    onChange={(event) =>
                      updateCg(selectedCg.id, (cg) => ({
                        ...cg,
                        name: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="galgame-field">
                  <span>分镜与叙事说明</span>
                  <textarea
                    value={selectedCg.description}
                    onChange={(event) =>
                      updateCg(selectedCg.id, (cg) => ({
                        ...cg,
                        description: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="galgame-field">
                  <span>CG ID（只读）</span>
                  <input value={selectedCg.id} readOnly />
                </label>
                <small>修改将在 650ms 后自动保存。</small>
              </div>
            ) : (
              <div className="galgame-background-editor">
                <div className="galgame-background-stage-column">
                  <div className="galgame-background-stage galgame-cg-stage">
                    <StoryAssetImage
                      fileId={activeAsset?.fileId}
                      alt={`${selectedCg.name} · ${selectedVariant?.label ?? "CG"}`}
                      fallback={
                        <span>
                          <Images aria-hidden />
                          <strong>尚未绑定 CG 图片</strong>
                          <small>
                            绑定图片后即可在剧本中添加显示 CG Block。
                          </small>
                        </span>
                      }
                    />
                    {selectedVariant ? <em>{selectedVariant.label}</em> : null}
                  </div>
                  <div className="galgame-background-actions">
                    <button
                      type="button"
                      onClick={() => {
                        setPicker({
                          mode: selectedVariant ? "replace" : "add",
                          source: "project",
                        });
                        requestAnimationFrame(() => fileInput.current?.click());
                      }}
                    >
                      <Upload aria-hidden />
                      {selectedVariant ? "替换 CG" : "上传 CG"}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setPicker({
                          mode: selectedVariant ? "replace" : "add",
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
                  {upload.isPending ? <small>正在上传 CG…</small> : null}
                  {uploadError ? (
                    <small className="danger">{uploadError}</small>
                  ) : null}
                </div>
                <div className="galgame-background-state-column">
                  <header>
                    <strong>CG 差分</strong>
                    <span>{variants.length}</span>
                  </header>
                  <div className="galgame-background-grid">
                    {variants.map((variant) => {
                      const asset = assetsById.get(variant.assetId);
                      return (
                        <button
                          key={variant.id}
                          type="button"
                          className={
                            variant.id === selectedVariant?.id ? "active" : ""
                          }
                          onClick={() => setSelectedVariantId(variant.id)}
                        >
                          <span>
                            <StoryAssetImage
                              fileId={asset?.fileId}
                              alt=""
                              fallback={<FileImage aria-hidden />}
                            />
                          </span>
                          <strong>{variant.label}</strong>
                          {variant.id === selectedCg.defaultVariantId ? (
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
                      <ImagePlus aria-hidden /> 添加差分
                    </button>
                  </div>
                  {selectedVariant ? (
                    <div className="galgame-background-form">
                      <label className="galgame-field">
                        <span>差分名称</span>
                        <input
                          value={selectedVariant.label}
                          onChange={(event) =>
                            updateCg(selectedCg.id, (cg) => ({
                              ...cg,
                              variants: (cg.variants ?? []).map((variant) =>
                                variant.id === selectedVariant.id
                                  ? { ...variant, label: event.target.value }
                                  : variant,
                              ),
                            }))
                          }
                        />
                      </label>
                      <label className="galgame-field">
                        <span>差分 ID（只读）</span>
                        <input value={selectedVariant.id} readOnly />
                      </label>
                      <div>
                        <button
                          type="button"
                          disabled={
                            selectedVariant.id === selectedCg.defaultVariantId
                          }
                          onClick={() =>
                            updateCg(selectedCg.id, (cg) => ({
                              ...cg,
                              defaultVariantId: selectedVariant.id,
                            }))
                          }
                        >
                          <Check aria-hidden /> 设为默认
                        </button>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => deleteVariant(selectedVariant)}
                        >
                          <Trash2 aria-hidden /> 删除差分
                        </button>
                      </div>
                    </div>
                  ) : null}
                  <footer>
                    <Check aria-hidden />
                    {variants.length
                      ? "默认差分已绑定 · 修改将在 650ms 后自动保存"
                      : "添加第一个 CG 图片后会自动设为默认差分"}
                  </footer>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="galgame-entity-empty">
            <Images aria-hidden />
            <strong>还没有剧情 CG</strong>
            <span>从左侧创建 CG 后开始编辑分镜资料与图片差分。</span>
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
              <small>次 CG 显示</small>
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
                    {reference.variantId
                      ? (variants.find(
                          (variant) => variant.id === reference.variantId,
                        )?.label ?? "显式差分")
                      : `跟随默认 · ${defaultVariant?.label ?? "未绑定"}`}
                  </small>
                </span>
                <ChevronRight aria-hidden />
              </button>
            ))}
            {!references.length ? <p>这个 CG 还没有被剧本引用。</p> : null}
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
            <Images aria-hidden /> 试玩默认使用：
            <strong>{defaultVariant?.label ?? "尚未绑定"}</strong>
          </p>
        </section>
        <section className="galgame-scene-danger-zone">
          <header>
            <strong>删除剧情 CG</strong>
            <span>
              {references.length
                ? "CG 仍被显示 CG Block 引用，无法删除。"
                : "删除 CG 会同时解除其图片差分绑定。"}
            </span>
          </header>
          <button
            type="button"
            disabled={!selectedCg || Boolean(references.length)}
            onClick={deleteCg}
          >
            <Trash2 aria-hidden /> 删除 CG
          </button>
        </section>
      </aside>

      {picker ? (
        <StoryImagePicker
          projectId={projectId}
          state={picker}
          usedFileIds={usedFileIds}
          addTitle="添加 CG 差分"
          replaceTitle="替换 CG 差分"
          searchLabel="搜索 CG 素材"
          projectEmptyCopy="上传图片后即可绑定为剧情 CG。"
          onState={setPicker}
          onChoose={bindFile}
          onUpload={() => fileInput.current?.click()}
          onClose={() => setPicker(undefined)}
        />
      ) : null}
    </section>
  );
}
