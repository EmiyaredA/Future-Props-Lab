import { LoadingState } from "@shared/ui/LoadingState";
import type { CSSProperties } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  FileText,
  FolderOpen,
  Grid2X2,
  List,
  LocateFixed,
  PanelLeftOpen,
  Plus,
  RefreshCcw,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { CustomSelect } from "@shared/ui/CustomSelect";
import type { GalgameAssetCategory } from "@features/galgame-workshop/api";
import { AssetOverviewPreview } from "@features/galgame-workshop/editor/AssetOverviewPreview";
import {
  CATEGORY_OPTIONS,
  KIND_META,
  MIN_SUMMARY_HEIGHT,
  STATUS_OPTIONS,
  bytes,
  displayKind,
  duration,
  type AssetDisplayKind,
} from "@features/galgame-workshop/editor/assetOverviewModel";
import { DirectoryBranch } from "@features/galgame-workshop/editor/assets/DirectoryBranch";

import { useAssetOverviewController } from "@features/galgame-workshop/editor/assets/useAssetOverviewController";
import { AssetOverviewSummary } from "@features/galgame-workshop/editor/assets/AssetOverviewSummary";

export function AssetOverviewView({
  controller,
}: {
  controller: ReturnType<typeof useAssetOverviewController>;
}) {
  const {
    onLocate,
    onRepairMissingAsset,
    fileInput,
    workbenchRef,
    search,
    setSearch,
    status,
    setStatus,
    kind,
    setKind,
    directory,
    setDirectory,
    view,
    setView,
    summaryOpen,
    setSummaryOpen,
    summaryHeight,
    setSummaryHeight,
    filtersOpen,
    setFiltersOpen,
    selection,
    setSelection,
    expandedDirectories,
    setExpandedDirectories,
    deleteCandidate,
    setDeleteCandidate,
    importOpen,
    setImportOpen,
    importFiles,
    setImportFiles,
    importCategory,
    setImportCategory,
    repairReplacement,
    setRepairReplacement,
    repairPending,
    setRepairPending,
    editDraft,
    setEditDraft,
    maximumSummaryHeight,
    startSummaryResize,
    resizeSummaryWithKeyboard,
    overview,
    items,
    invalidateAssets,
    tree,
    kindCounts,
    statusCounts,
    filtered,
    selected,
    selectedMissing,
    packageBytes,
    refresh,
    patch,
    remove,
    importPreview,
    importUpload,
    replacementFiles,
  } = controller;
  if (overview.isLoading)
    return (
      <div className="galgame-assets-empty">正在扫描素材、引用与打包状态…</div>
    );
  if (overview.isError)
    return (
      <div className="galgame-assets-empty">
        <AlertTriangle aria-hidden />
        <strong>资源总览暂时无法读取</strong>
        <button type="button" onClick={() => void overview.refetch()}>
          重新加载
        </button>
      </div>
    );

  return (
    <div
      className={`galgame-assets-dashboard ${filtersOpen ? "filters-open" : ""}`}
    >
      <aside className="galgame-assets-filter-panel" aria-label="资源筛选">
        <header>
          <strong>资源</strong>
          <div>
            <button
              type="button"
              aria-label="导入资源"
              onClick={() => setImportOpen(true)}
            >
              <Plus aria-hidden />
            </button>
            <button
              type="button"
              aria-label="刷新资源"
              disabled={refresh.isPending}
              onClick={() => refresh.mutate()}
            >
              <RefreshCcw
                className={refresh.isPending ? "spinning" : ""}
                aria-hidden
              />
            </button>
            <button
              type="button"
              className="galgame-assets-filter-close"
              aria-label="关闭资源筛选"
              onClick={() => setFiltersOpen(false)}
            >
              <X aria-hidden />
            </button>
          </div>
        </header>
        <label className="galgame-assets-search">
          <Search aria-hidden />
          <input
            type="search"
            aria-label="搜索资源"
            placeholder="搜索资源"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {search ? (
            <button
              type="button"
              aria-label="清除资源搜索"
              onClick={() => setSearch("")}
            >
              <X aria-hidden />
            </button>
          ) : null}
        </label>
        <nav aria-label="资源状态">
          {STATUS_OPTIONS.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                className={status === option.value ? "active" : ""}
                onClick={() => setStatus(option.value)}
              >
                <Icon aria-hidden />
                <span>{option.label}</span>
                <em>{statusCounts[option.value]}</em>
              </button>
            );
          })}
        </nav>
        <section>
          <small>按类型</small>
          <button
            type="button"
            className={kind === "all" ? "active" : ""}
            onClick={() => setKind("all")}
          >
            <Grid2X2 aria-hidden /> <span>不限类型</span>{" "}
            <em>{items.length}</em>
          </button>
          {(Object.keys(KIND_META) as AssetDisplayKind[]).map((itemKind) => {
            const meta = KIND_META[itemKind];
            const Icon = meta.icon;
            return (
              <button
                key={itemKind}
                type="button"
                className={`${kind === itemKind ? "active" : ""} ${meta.className}`}
                onClick={() => setKind(itemKind)}
              >
                <Icon aria-hidden /> <span>{meta.label}</span>
                <em>{kindCounts[itemKind]}</em>
              </button>
            );
          })}
        </section>
        <section className="galgame-assets-directory-tree">
          <small>目录</small>
          <ul>
            <DirectoryBranch
              node={tree}
              selected={directory}
              expanded={expandedDirectories}
              depth={0}
              onSelect={setDirectory}
              onToggle={(path) =>
                setExpandedDirectories((current) => {
                  const next = new Set(current);
                  if (next.has(path)) next.delete(path);
                  else next.add(path);
                  return next;
                })
              }
            />
          </ul>
        </section>
      </aside>

      <main
        ref={workbenchRef}
        className={`galgame-assets-workbench ${summaryOpen ? "summary-open" : ""} ${summaryHeight !== null ? "summary-sized" : ""}`}
        style={
          summaryHeight === null
            ? undefined
            : ({
                "--asset-summary-height": `${summaryHeight}px`,
              } as CSSProperties)
        }
      >
        <header className="galgame-assets-toolbar">
          <div>
            <button
              type="button"
              className="galgame-assets-filter-open"
              aria-label="打开资源筛选"
              onClick={() => setFiltersOpen(true)}
            >
              <PanelLeftOpen aria-hidden />
            </button>
            <strong>资源</strong>
            <span>
              共 {items.length} 项 · {statusCounts.orphaned} 项游离 · 预计打包{" "}
              {bytes(packageBytes)}
            </span>
          </div>
          <div className="galgame-assets-toolbar-actions">
            <div
              className="galgame-assets-view-switch"
              role="group"
              aria-label="资源视图"
            >
              <button
                type="button"
                className={view === "grid" ? "active" : ""}
                aria-label="网格视图"
                onClick={() => setView("grid")}
              >
                <Grid2X2 aria-hidden />
              </button>
              <button
                type="button"
                className={view === "list" ? "active" : ""}
                aria-label="列表视图"
                onClick={() => setView("list")}
              >
                <List aria-hidden />
              </button>
            </div>
            <button
              type="button"
              aria-label="刷新元数据"
              disabled={refresh.isPending}
              onClick={() => refresh.mutate()}
            >
              <RefreshCcw
                className={refresh.isPending ? "spinning" : ""}
                aria-hidden
              />
            </button>
            <button
              type="button"
              aria-label="批量导入资源"
              onClick={() => setImportOpen(true)}
            >
              <Upload aria-hidden />
            </button>
            <button
              type="button"
              aria-label={summaryOpen ? "收起资源统计" : "展开资源统计"}
              onClick={() => setSummaryOpen((current) => !current)}
            >
              {summaryOpen ? (
                <ChevronUp aria-hidden />
              ) : (
                <ChevronDown aria-hidden />
              )}
            </button>
          </div>
        </header>

        <AssetOverviewSummary controller={controller} />

        {summaryOpen ? (
          <div
            className="galgame-assets-summary-resizer"
            role="separator"
            tabIndex={0}
            aria-label="调整资源统计与资源列表高度"
            aria-orientation="horizontal"
            aria-valuemin={MIN_SUMMARY_HEIGHT}
            aria-valuemax={maximumSummaryHeight()}
            aria-valuenow={summaryHeight ?? undefined}
            aria-valuetext={
              summaryHeight === null ? "自动高度" : `${summaryHeight} 像素`
            }
            title="拖动调整统计区高度，双击恢复自动高度"
            onPointerDown={startSummaryResize}
            onKeyDown={resizeSummaryWithKeyboard}
            onDoubleClick={() => setSummaryHeight(null)}
          />
        ) : null}

        <section className="galgame-assets-browser">
          <header>
            <div>
              <FolderOpen aria-hidden />
              <strong>assets{directory ? ` / ${directory}` : ""}</strong>
              <span>· {filtered.length} 项</span>
            </div>
            {search || status !== "all" || kind !== "all" || directory ? (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setStatus("all");
                  setKind("all");
                  setDirectory("");
                }}
              >
                清除筛选
              </button>
            ) : null}
          </header>
          {filtered.length ? (
            <div className={`galgame-assets-results is-${view}`}>
              {filtered.map((item) => {
                const itemKind = displayKind(item);
                const meta = KIND_META[itemKind];
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`${item.orphaned ? "orphaned" : ""} ${selection?.kind === "asset" && selection.id === item.id ? "selected" : ""}`}
                    aria-label={`${item.display_name}，${item.reference_count ? `${item.reference_count} 处引用` : "游离"}`}
                    onClick={() => setSelection({ kind: "asset", id: item.id })}
                  >
                    <span className="galgame-assets-result-preview">
                      <AssetOverviewPreview item={item} compact />
                      <small className={meta.className}>
                        {meta.label.toUpperCase()}
                      </small>
                      {item.reference_count ? (
                        <em>引用 {item.reference_count}</em>
                      ) : null}
                    </span>
                    <span className="galgame-assets-result-copy">
                      <strong>{item.display_name}</strong>
                      <small>{item.virtualPath}</small>
                    </span>
                    <span className="galgame-assets-result-type">
                      {meta.label}
                    </span>
                    <span className="galgame-assets-result-size">
                      {bytes(item.byte_size)}
                    </span>
                    <span
                      className={`galgame-assets-result-status ${item.orphaned ? "orphaned" : ""}`}
                    >
                      {item.packagingPolicy === "include"
                        ? "强制打包"
                        : item.packagingPolicy === "exclude"
                          ? "强制排除"
                          : item.reference_count
                            ? `引用 ${item.reference_count}`
                            : "游离"}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="galgame-assets-results-empty">
              <Search aria-hidden />
              <strong>没有匹配的资源</strong>
              <span>调整搜索词、类型、状态或目录后再试。</span>
            </div>
          )}
        </section>
      </main>

      <aside
        className={`galgame-assets-inspector ${selection ? "has-selection" : ""}`}
        aria-label="资源详情"
      >
        <button
          type="button"
          className="galgame-assets-inspector-close"
          aria-label="关闭资源详情"
          onClick={() => setSelection(undefined)}
        >
          <X aria-hidden />
        </button>
        {selected ? (
          <>
            <header>
              <small>资源详情</small>
              <strong>{selected.display_name}</strong>
              <span>{selected.virtualPath}</span>
            </header>
            <div className="galgame-assets-inspector-preview">
              <AssetOverviewPreview item={selected} />
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                patch.mutate({ asset: selected });
              }}
            >
              <label>
                <span>文件名</span>
                <input
                  value={editDraft.display_name}
                  onChange={(event) =>
                    setEditDraft((current) => ({
                      ...current,
                      display_name: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                <span>虚拟路径</span>
                <input
                  value={editDraft.virtualPath}
                  onChange={(event) =>
                    setEditDraft((current) => ({
                      ...current,
                      virtualPath: event.target.value,
                    }))
                  }
                />
              </label>
              <div className="galgame-assets-inspector-fields">
                <label>
                  <span>业务分类</span>
                  <CustomSelect
                    value={editDraft.category}
                    ariaLabel="业务分类"
                    options={CATEGORY_OPTIONS}
                    onChange={(value) =>
                      setEditDraft((current) => ({
                        ...current,
                        category: value as GalgameAssetCategory,
                      }))
                    }
                  />
                </label>
                <label>
                  <span>打包策略</span>
                  <CustomSelect
                    value={editDraft.packagingPolicy}
                    ariaLabel="打包策略"
                    options={[
                      { value: "auto", label: "自动" },
                      { value: "include", label: "强制打包" },
                      { value: "exclude", label: "强制排除" },
                    ]}
                    onChange={(value) =>
                      setEditDraft((current) => ({
                        ...current,
                        packagingPolicy: value as
                          "auto" | "include" | "exclude",
                      }))
                    }
                  />
                </label>
              </div>
              <button
                type="submit"
                disabled={
                  patch.isPending ||
                  !editDraft.display_name.trim() ||
                  !editDraft.virtualPath.trim()
                }
              >
                {patch.isPending ? (
                  <LoadingState variant="inline" label="保存中…" />
                ) : (
                  "保存资源信息"
                )}
              </button>
            </form>
            <dl>
              <div>
                <dt>类型</dt>
                <dd>{selected.mime_type}</dd>
              </div>
              <div>
                <dt>大小</dt>
                <dd>{bytes(selected.byte_size)}</dd>
              </div>
              <div>
                <dt>元数据</dt>
                <dd>
                  {selected.width && selected.height
                    ? `${selected.width} × ${selected.height}`
                    : selected.durationMs
                      ? duration(selected.durationMs)
                      : "—"}
                </dd>
              </div>
              <div>
                <dt>SHA-256</dt>
                <dd title={selected.checksumSha256 ?? ""}>
                  {selected.checksumSha256 ?? "等待扫描"}
                </dd>
              </div>
            </dl>
            <section className="galgame-assets-references">
              <header>
                <strong>引用位置</strong>
                <span>{selected.reference_count}</span>
              </header>
              {(selected.references ?? []).length ? (
                (selected.references ?? []).map((reference, index) => (
                  <button
                    key={`${reference.kind}-${index}`}
                    type="button"
                    disabled={!reference.fragmentId || !reference.blockId}
                    onClick={() =>
                      reference.fragmentId &&
                      reference.blockId &&
                      onLocate(
                        reference.chapterId ?? undefined,
                        reference.fragmentId,
                        reference.blockId,
                      )
                    }
                  >
                    <LocateFixed aria-hidden /> {reference.label}
                  </button>
                ))
              ) : (
                <span>当前没有 Story 引用。</span>
              )}
            </section>
            {selected.orphaned ? (
              <button
                type="button"
                className="danger"
                onClick={() => setDeleteCandidate(selected)}
              >
                <Trash2 aria-hidden /> 删除游离文件
              </button>
            ) : null}
          </>
        ) : selectedMissing ? (
          <div className="galgame-assets-missing-inspector">
            <FileText aria-hidden />
            <small>缺失素材</small>
            <strong>{selectedMissing.story_role}</strong>
            <p>
              原文件记录 {selectedMissing.file_id}{" "}
              已不存在，请选择同媒体类型的现有资源重新绑定。
            </p>
            <label>
              <span>替换文件</span>
              <CustomSelect
                value={repairReplacement}
                ariaLabel="替换文件"
                options={[
                  { value: "", label: "选择现有文件…" },
                  ...replacementFiles.map((file) => ({
                    value: file.id,
                    label: file.virtualPath ?? file.display_name,
                  })),
                ]}
                onChange={setRepairReplacement}
              />
            </label>
            <button
              type="button"
              disabled={!repairReplacement || repairPending}
              onClick={async () => {
                if (!repairReplacement) return;
                setRepairPending(true);
                try {
                  const saved = await onRepairMissingAsset(
                    selectedMissing.story_asset_id,
                    repairReplacement,
                  );
                  if (saved) {
                    await invalidateAssets();
                    setSelection(undefined);
                  }
                } finally {
                  setRepairPending(false);
                }
              }}
            >
              {repairPending ? "正在重新绑定…" : "重新绑定并保存 Story"}
            </button>
            <section className="galgame-assets-references">
              <strong>受影响位置</strong>
              {(selectedMissing.references ?? []).map((reference, index) => (
                <button
                  key={`${reference.kind}-${index}`}
                  type="button"
                  disabled={!reference.fragmentId || !reference.blockId}
                  onClick={() =>
                    reference.fragmentId &&
                    reference.blockId &&
                    onLocate(
                      reference.chapterId ?? undefined,
                      reference.fragmentId,
                      reference.blockId,
                    )
                  }
                >
                  <LocateFixed aria-hidden /> {reference.label}
                </button>
              ))}
            </section>
          </div>
        ) : (
          <div className="galgame-assets-inspector-empty">
            <FileText aria-hidden />
            <strong>选中一个文件查看详情</strong>
            <span>查看素材引用、元数据和打包策略。</span>
          </div>
        )}
      </aside>

      {filtersOpen ? (
        <button
          type="button"
          className="galgame-assets-filter-backdrop"
          aria-label="关闭资源筛选"
          onClick={() => setFiltersOpen(false)}
        />
      ) : null}

      {importOpen ? (
        <div className="galgame-assets-import-backdrop" role="presentation">
          <section
            className="galgame-assets-import-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="asset-import-title"
          >
            <header>
              <div>
                <small>BATCH IMPORT</small>
                <h2 id="asset-import-title">批量导入资源</h2>
              </div>
              <button
                type="button"
                aria-label="关闭批量导入"
                onClick={() => setImportOpen(false)}
              >
                <X aria-hidden />
              </button>
            </header>
            <label className="galgame-assets-import-drop">
              <Upload aria-hidden />
              <strong>
                {importFiles.length
                  ? `已选择 ${importFiles.length} 个文件`
                  : "选择要导入的资源"}
              </strong>
              <span>支持一次选择多个图片、音频、视频、字体或文档文件。</span>
              <input
                ref={fileInput}
                type="file"
                multiple
                onChange={(event) => {
                  setImportFiles(Array.from(event.target.files ?? []));
                  importPreview.reset();
                }}
              />
            </label>
            <label>
              <span>业务分类</span>
              <CustomSelect
                value={importCategory}
                ariaLabel="业务分类"
                options={CATEGORY_OPTIONS}
                onChange={(value) => {
                  setImportCategory(value as GalgameAssetCategory);
                  importPreview.reset();
                }}
              />
            </label>
            {importPreview.data ? (
              <div className="galgame-assets-import-preview">
                <header>
                  <strong>导入预览</strong>
                  <span>{importPreview.data.items.length} 项</span>
                </header>
                {importPreview.data.items.map((item) => (
                  <div key={`${item.originalName}-${item.virtualPath}`}>
                    <span>
                      <strong>{item.finalName}</strong>
                      <small>{item.virtualPath}</small>
                    </span>
                    <em>{item.reasons?.join("、") || "路径可用"}</em>
                  </div>
                ))}
              </div>
            ) : null}
            <footer>
              <button type="button" onClick={() => setImportOpen(false)}>
                取消
              </button>
              <button
                type="button"
                disabled={!importFiles.length || importPreview.isPending}
                onClick={() => importPreview.mutate()}
              >
                {importPreview.isPending ? "预览中…" : "预览目标路径"}
              </button>
              <button
                type="button"
                className="primary"
                disabled={!importPreview.data || importUpload.isPending}
                onClick={() => importUpload.mutate()}
              >
                {importUpload.isPending ? "导入中…" : "确认导入"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(deleteCandidate)}
        title="删除游离资源？"
        description="删除后文件无法从工程恢复。若扩展或自定义路径直接读取它，也会同时失效。"
        confirmLabel="删除资源"
        pending={remove.isPending}
        onCancel={() => setDeleteCandidate(undefined)}
        onConfirm={() => deleteCandidate && remove.mutate(deleteCandidate)}
      />
    </div>
  );
}
