import { FileEmptyState } from "./FileEmptyState";
import { useDrawerFocus } from "@shared/ui/useDrawerFocus";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  ArrowDownAZ,
  CheckCircle2,
  Download,
  Filter,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Grid2X2,
  List,
  LoaderCircle,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { importFile } from "@features/files/api";
import { invalidateFileScope } from "@features/files/queryKeys";
import {
  ACCEPT,
  AssetPreview,
  AssetPreviewDialog,
  type AssetViewMode,
  ItemActionMenu,
  KIND_OPTIONS,
  SORT_OPTIONS,
  extensionLabel,
  fileDisplayName,
  kindLabel,
  relativeUpdatedAt,
  uploadStatusLabel,
} from "@features/files/AssetBrowserParts";
import { formatFileSize } from "@shared/lib/fileSize";
import { useAssetBrowserController } from "@features/files/useAssetBrowserController";
import "@features/files/files.css";

export type { AssetViewMode } from "@features/files/AssetBrowserParts";

export function AssetBrowser({
  projectId,
  compact = false,
  importMode = false,
  viewMode,
  onViewModeChange,
  onImported,
}: {
  projectId?: string;
  compact?: boolean;
  importMode?: boolean;
  viewMode?: AssetViewMode;
  onViewModeChange?: (view: AssetViewMode) => void;
  onImported?: () => void;
}) {
  const {
    client,
    fileInput,
    zipInput,
    folderInput,
    compactActions,
    dialogTitleId,
    folderId,
    setFolderId,
    query,
    setQuery,
    kind,
    setKind,
    sort,
    setSort,
    view,
    compactFilterOpen,
    setCompactFilterOpen,
    compactAddOpen,
    setCompactAddOpen,
    notice,
    setNotice,
    uploads,
    setUploads,
    openMenu,
    setOpenMenu,
    previewFile,
    setPreviewFile,
    editor,
    editorError,
    foldersQuery,
    filesQuery,
    act,
    upload,
    archiveTransfer,
    libraryMode,
    files,
    childFolders,
    path,
    completedUploads,
    moveTargetOptions,
    setView,
    openEditor,
    closeEditor,
    updateEditorName,
    updateEditorTarget,
    submitEditor,
    uploadFiles,
    downloadFile,
    exportFolderArchive,
    importZipArchive,
    importFolderEntries,
    showContent,
    noMatches,
    editorTitle,
    editorSubmitLabel,
    editorSubmitDisabled,
  } = useAssetBrowserController({
    projectId,
    compact,
    importMode,
    viewMode,
    onViewModeChange,
  });
  const fileDialog = useDrawerFocus<HTMLDivElement>(
    closeEditor,
    !!editor,
    false,
  );

  return (
    <section className={`file-browser${compact ? " is-compact" : ""}`}>
      <div className="file-browser-controls">
        {compact ? (
          <>
            <div className="file-compact-search-row">
              <label>
                <Search aria-hidden />
                <input
                  aria-label="搜索文件或文件夹"
                  placeholder="搜索素材"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <div className="file-compact-actions" ref={compactActions}>
                <div className="file-compact-menu">
                  <button
                    type="button"
                    className={kind !== "all" ? "active" : ""}
                    aria-label="筛选素材"
                    aria-haspopup="dialog"
                    aria-expanded={compactFilterOpen}
                    onClick={() => {
                      setCompactFilterOpen((current) => !current);
                      setCompactAddOpen(false);
                    }}
                  >
                    <Filter aria-hidden />
                  </button>
                  {compactFilterOpen ? (
                    <div
                      className="file-compact-filter-popover"
                      role="dialog"
                      aria-label="素材筛选"
                    >
                      <span>文件类型</span>
                      <CustomSelect
                        ariaLabel="文件类型"
                        className="file-filter-select"
                        value={kind}
                        options={KIND_OPTIONS}
                        onChange={(value) => setKind(value as typeof kind)}
                      />
                      <span>排序方式</span>
                      <CustomSelect
                        ariaLabel="文件排序"
                        className="file-filter-select file-sort-select"
                        value={sort}
                        options={SORT_OPTIONS}
                        onChange={(value) => setSort(value as typeof sort)}
                      />
                    </div>
                  ) : null}
                </div>
                {!importMode ? (
                  <div className="file-compact-menu">
                    <button
                      type="button"
                      aria-label="添加素材"
                      aria-haspopup="menu"
                      aria-expanded={compactAddOpen}
                      onClick={() => {
                        setCompactAddOpen((current) => !current);
                        setCompactFilterOpen(false);
                      }}
                    >
                      <Plus aria-hidden />
                    </button>
                    {compactAddOpen ? (
                      <div className="file-compact-add-popover" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setCompactAddOpen(false);
                            openEditor({ kind: "create-folder", name: "" });
                          }}
                        >
                          <FolderPlus aria-hidden /> 新建文件夹
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          disabled={upload.isPending}
                          onClick={() => {
                            setCompactAddOpen(false);
                            fileInput.current?.click();
                          }}
                        >
                          {upload.isPending ? (
                            <LoaderCircle className="spin" aria-hidden />
                          ) : (
                            <Upload aria-hidden />
                          )}
                          上传文件
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="file-compact-location">
              <div className="file-breadcrumb" aria-label="文件路径">
                <button type="button" onClick={() => setFolderId(undefined)}>
                  全部
                </button>
                {path.map((folder) => (
                  <span key={folder.id}>
                    <i aria-hidden>/</i>
                    <button
                      type="button"
                      onClick={() => setFolderId(folder.id)}
                    >
                      {folder.name}
                    </button>
                  </span>
                ))}
              </div>
              <button
                type="button"
                className="file-compact-sort"
                aria-label={
                  sort === "updated" ? "切换为按名称排序" : "切换为最近更新"
                }
                title={sort === "updated" ? "最近更新" : "按名称"}
                onClick={() =>
                  setSort((current) =>
                    current === "updated" ? "name" : "updated",
                  )
                }
              >
                <ArrowDownAZ aria-hidden />
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="file-browser-toolbar">
              <div className="file-location">
                <div className="file-breadcrumb" aria-label="文件路径">
                  <button type="button" onClick={() => setFolderId(undefined)}>
                    {importMode
                      ? "文件管理"
                      : projectId
                        ? "项目素材"
                        : "全部文件"}
                  </button>
                  {path.map((folder) => (
                    <span key={folder.id}>
                      <i aria-hidden>/</i>
                      <button
                        type="button"
                        onClick={() => setFolderId(folder.id)}
                      >
                        {folder.name}
                      </button>
                    </span>
                  ))}
                </div>
                {!foldersQuery.isLoading && !filesQuery.isLoading ? (
                  <small>
                    {childFolders.length} 个文件夹 · {files.length} 个文件
                  </small>
                ) : null}
              </div>
              {!importMode ? (
                <div className="file-primary-actions">
                  {libraryMode ? (
                    <>
                      <button
                        type="button"
                        disabled={archiveTransfer.isPending}
                        onClick={() => exportFolderArchive(folderId)}
                      >
                        {archiveTransfer.isPending ? (
                          <LoaderCircle className="spin" aria-hidden />
                        ) : (
                          <Download aria-hidden />
                        )}
                        导出当前目录
                      </button>
                      <button
                        type="button"
                        disabled={archiveTransfer.isPending}
                        onClick={() => zipInput.current?.click()}
                      >
                        <Upload aria-hidden /> 导入 ZIP
                      </button>
                      <button
                        type="button"
                        disabled={archiveTransfer.isPending}
                        onClick={() => folderInput.current?.click()}
                      >
                        <FolderInput aria-hidden /> 导入文件夹
                      </button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    onClick={() =>
                      openEditor({ kind: "create-folder", name: "" })
                    }
                  >
                    <FolderPlus aria-hidden /> 新建文件夹
                  </button>
                </div>
              ) : null}
            </div>
            <div className="file-browser-filters">
              <label>
                <Search aria-hidden />
                <input
                  aria-label="搜索文件或文件夹"
                  placeholder="搜索文件或文件夹"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <CustomSelect
                ariaLabel="文件类型"
                className="file-filter-select"
                value={kind}
                options={KIND_OPTIONS}
                onChange={(value) => setKind(value as typeof kind)}
              />
              <CustomSelect
                ariaLabel="文件排序"
                className="file-filter-select file-sort-select"
                value={sort}
                options={SORT_OPTIONS}
                onChange={(value) => setSort(value as typeof sort)}
              />
              <div
                className="file-view-toggle"
                role="group"
                aria-label="文件视图"
              >
                <button
                  type="button"
                  aria-label="卡片视图"
                  aria-pressed={view === "grid"}
                  className={view === "grid" ? "active" : ""}
                  onClick={() => setView("grid")}
                >
                  <Grid2X2 aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label="列表视图"
                  aria-pressed={view === "list"}
                  className={view === "list" ? "active" : ""}
                  onClick={() => setView("list")}
                >
                  <List aria-hidden />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
      {!importMode ? (
        <input
          ref={fileInput}
          hidden
          multiple
          type="file"
          accept={ACCEPT}
          aria-label="选择要上传的文件"
          disabled={upload.isPending}
          onChange={(event) => {
            uploadFiles(event.target.files);
            event.target.value = "";
          }}
        />
      ) : null}
      {libraryMode ? (
        <>
          <input
            ref={zipInput}
            hidden
            type="file"
            accept=".zip,application/zip"
            aria-label="选择要导入的 ZIP 归档"
            disabled={archiveTransfer.isPending}
            onChange={(event) => {
              importZipArchive(event.target.files);
              event.target.value = "";
            }}
          />
          <input
            ref={folderInput}
            hidden
            multiple
            type="file"
            // @ts-expect-error webkitdirectory is widely supported for folder import
            webkitdirectory=""
            aria-label="选择要导入的本地文件夹"
            disabled={archiveTransfer.isPending}
            onChange={(event) => {
              importFolderEntries(event.target.files);
              event.target.value = "";
            }}
          />
        </>
      ) : null}
      {notice ? (
        <div className="file-notice" role="status">
          <span>{notice}</span>
          <button
            type="button"
            aria-label="关闭提示"
            onClick={() => setNotice("")}
          >
            <X aria-hidden />
          </button>
        </div>
      ) : null}
      {uploads.length ? (
        <section
          className="file-upload-feedback"
          aria-label="上传状态"
          aria-live="polite"
        >
          <header>
            <div>
              <strong>
                {upload.isPending
                  ? `正在上传 ${Math.min(completedUploads + 1, uploads.length)}/${uploads.length}`
                  : "失败详情"}
              </strong>
              <span>
                {upload.isPending
                  ? "支持图片、视频、音频、PDF、Office、文本、CSV、JSON 与 ZIP，可一次选择多个"
                  : "请检查失败原因后重新上传"}
              </span>
            </div>
            {!upload.isPending ? (
              <button
                type="button"
                aria-label="关闭上传状态"
                onClick={() => setUploads([])}
              >
                <X aria-hidden />
              </button>
            ) : null}
          </header>
          <div className="file-upload-list">
            {uploads.map((item) => (
              <div
                className={`file-upload-item ${item.status}`}
                key={item.id}
                role={item.status === "error" ? "alert" : undefined}
              >
                {item.status === "uploading" || item.status === "queued" ? (
                  <LoaderCircle className="spin" aria-hidden />
                ) : item.status === "success" ? (
                  <CheckCircle2 aria-hidden />
                ) : (
                  <AlertCircle aria-hidden />
                )}
                <span>
                  <strong title={item.name}>{item.name}</strong>
                  <small>{item.error ?? uploadStatusLabel(item.status)}</small>
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {foldersQuery.isLoading || filesQuery.isLoading ? (
        <div className="file-empty">正在读取文件…</div>
      ) : foldersQuery.isError || filesQuery.isError ? (
        <div className="file-empty">文件暂时无法读取，请稍后重试。</div>
      ) : showContent ? (
        <div className={`file-items ${view}`}>
          {!compact && !importMode ? (
            <article className="file-upload-card">
              <button
                type="button"
                className="file-upload-card-main"
                disabled={upload.isPending}
                onClick={() => fileInput.current?.click()}
              >
                <span className="file-upload-card-icon">
                  {upload.isPending ? (
                    <LoaderCircle className="spin" aria-hidden />
                  ) : (
                    <Upload aria-hidden />
                  )}
                </span>
                <span className="file-upload-card-copy">
                  <strong>
                    {upload.isPending
                      ? `正在上传 ${completedUploads}/${uploads.length}`
                      : "上传文件"}
                  </strong>
                  <small>
                    图片、视频、音频、PDF、Office、文本、CSV、JSON 与 ZIP
                  </small>
                </span>
                <span className="file-upload-card-action">
                  <Plus aria-hidden /> 可多选
                </span>
              </button>
            </article>
          ) : null}
          {childFolders.map((folder) => {
            const menuKey = `folder-${folder.id}`;
            return (
              <article className="file-folder-item" key={folder.id}>
                <button
                  type="button"
                  className="file-item-main"
                  onClick={() => setFolderId(folder.id)}
                >
                  <span className="file-item-preview folder">
                    <Folder aria-hidden />
                  </span>
                  <span className="file-item-copy">
                    <strong title={folder.name}>{folder.name}</strong>
                    <small>文件夹</small>
                  </span>
                </button>
                <div className="file-item-footer">
                  <time dateTime={folder.updated_at}>
                    {relativeUpdatedAt(folder.updated_at)}
                  </time>
                  <span className="file-open-label">
                    打开 <FolderOpen aria-hidden />
                  </span>
                </div>
                {!importMode ? (
                  <ItemActionMenu
                    id={`file-menu-${menuKey}`}
                    label={folder.name}
                    open={openMenu === menuKey}
                    deleteLabel="删除"
                    onToggle={() =>
                      setOpenMenu((current) =>
                        current === menuKey ? undefined : menuKey,
                      )
                    }
                    onClose={() => setOpenMenu(undefined)}
                    onExport={
                      libraryMode
                        ? () => exportFolderArchive(folder.id)
                        : undefined
                    }
                    onRename={() =>
                      openEditor({
                        kind: "rename-folder",
                        folder,
                        name: folder.name,
                      })
                    }
                    onMove={() =>
                      openEditor({
                        kind: "move-folder",
                        folder,
                        target: folder.parent_id ?? "root",
                      })
                    }
                    onDelete={() =>
                      openEditor({ kind: "delete-folder", folder })
                    }
                  />
                ) : null}
              </article>
            );
          })}
          {files.map((file) => {
            const itemKey = `${file.reference_id ?? "asset"}-${file.id}`;
            const menuKey = `file-${itemKey}`;
            const displayName = fileDisplayName(file);
            return (
              <article className="file-asset-item" key={itemKey}>
                <button
                  type="button"
                  className="file-item-main"
                  aria-label={`预览 ${displayName}`}
                  title={`预览 ${displayName}`}
                  onClick={() => setPreviewFile(file)}
                >
                  <span className={`file-item-preview ${file.media_kind}`}>
                    <AssetPreview file={file} />
                  </span>
                  <span className="file-item-copy">
                    <strong title={displayName}>{displayName}</strong>
                    <span className="file-item-tags">
                      <small>{kindLabel(file.media_kind)}</small>
                      <small>{extensionLabel(file)}</small>
                      {file.is_reference ? <small>来自文件管理</small> : null}
                    </span>
                    <small className="file-item-size">
                      {formatFileSize(file.byte_size)}
                    </small>
                  </span>
                </button>
                <div className="file-item-footer">
                  <time dateTime={file.updated_at}>
                    {relativeUpdatedAt(file.updated_at)}
                  </time>
                  {importMode && projectId ? (
                    <button
                      type="button"
                      className="file-item-primary-action"
                      onClick={() =>
                        act.mutate(async () => {
                          await importFile(projectId, file.id);
                          await invalidateFileScope(client, projectId);
                          onImported?.();
                          setNotice("已导入当前项目");
                        })
                      }
                    >
                      <Plus aria-hidden /> 导入
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="file-item-primary-action"
                      onClick={() => void downloadFile(file)}
                    >
                      <Download aria-hidden /> 下载
                    </button>
                  )}
                </div>
                {!importMode ? (
                  <ItemActionMenu
                    id={`file-menu-${menuKey}`}
                    label={fileDisplayName(file)}
                    open={openMenu === menuKey}
                    deleteLabel={file.is_reference ? "移除引用" : "删除"}
                    onToggle={() =>
                      setOpenMenu((current) =>
                        current === menuKey ? undefined : menuKey,
                      )
                    }
                    onClose={() => setOpenMenu(undefined)}
                    onDownload={() => {
                      setOpenMenu(undefined);
                      void downloadFile(file);
                    }}
                    onRename={() =>
                      openEditor({
                        kind: "rename-file",
                        file,
                        name: fileDisplayName(file),
                      })
                    }
                    onMove={() =>
                      openEditor({
                        kind: "move-file",
                        file,
                        target: file.folder_id ?? "root",
                      })
                    }
                    onDelete={() => openEditor({ kind: "delete-file", file })}
                  />
                ) : null}
              </article>
            );
          })}
          {noMatches ? (
            <div className="file-results-empty">
              <Search aria-hidden />
              <strong>没有找到匹配的内容</strong>
              <span>换个关键词或文件类型试试。</span>
            </div>
          ) : null}
        </div>
      ) : (
        <FileEmptyState
          importing={importMode}
          filtered={!!query.trim() || kind !== "all"}
          busy={upload.isPending}
          onUpload={() => fileInput.current?.click()}
        />
      )}
      {act.isPending ? (
        <div className="file-busy" role="status">
          正在处理…
        </div>
      ) : null}
      {previewFile
        ? createPortal(
            <AssetPreviewDialog
              file={previewFile}
              onClose={() => setPreviewFile(undefined)}
              onDownload={() => {
                void downloadFile(previewFile);
              }}
            />,
            document.body,
          )
        : null}
      {editor ? (
        <div
          className="file-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeEditor();
          }}
        >
          <div
            ref={fileDialog}
            className="file-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
          >
            <header>
              <div>
                <span>文件操作</span>
                <h2 id={dialogTitleId}>{editorTitle}</h2>
              </div>
              <button
                type="button"
                aria-label={`关闭${editorTitle}`}
                disabled={act.isPending}
                onClick={closeEditor}
              >
                <X aria-hidden />
              </button>
            </header>
            {editor.kind === "create-folder" ||
            editor.kind === "rename-folder" ||
            editor.kind === "rename-file" ? (
              <form onSubmit={submitEditor}>
                <label>
                  <span>
                    {editor.kind === "create-folder" ? "文件夹名称" : "新名称"}
                  </span>
                  <input
                    autoFocus
                    required
                    maxLength={120}
                    value={editor.name}
                    onChange={(event) => updateEditorName(event.target.value)}
                    placeholder="请输入名称"
                  />
                </label>
                {editorError ? (
                  <p className="file-dialog-error">{editorError}</p>
                ) : null}
                <div className="file-dialog-actions">
                  <button
                    type="button"
                    disabled={act.isPending}
                    onClick={closeEditor}
                  >
                    取消
                  </button>
                  <button
                    className="primary"
                    disabled={act.isPending || editorSubmitDisabled}
                  >
                    {act.isPending ? "处理中…" : editorSubmitLabel}
                  </button>
                </div>
              </form>
            ) : editor.kind === "move-folder" || editor.kind === "move-file" ? (
              <form onSubmit={submitEditor}>
                <label>
                  <span>目标文件夹</span>
                  <CustomSelect
                    ariaLabel="目标文件夹"
                    className="file-move-select"
                    value={editor.target}
                    options={moveTargetOptions}
                    disabled={act.isPending}
                    onChange={updateEditorTarget}
                  />
                </label>
                <small>移动后可通过上方路径继续访问该内容。</small>
                {editorError ? (
                  <p className="file-dialog-error">{editorError}</p>
                ) : null}
                <div className="file-dialog-actions">
                  <button
                    type="button"
                    disabled={act.isPending}
                    onClick={closeEditor}
                  >
                    取消
                  </button>
                  <button
                    className="primary"
                    disabled={act.isPending || editorSubmitDisabled}
                  >
                    {act.isPending ? "处理中…" : editorSubmitLabel}
                  </button>
                </div>
              </form>
            ) : (
              <div className="file-delete-dialog">
                <div className="file-delete-icon">
                  <Trash2 aria-hidden />
                </div>
                <p>
                  {editor.kind === "delete-folder"
                    ? `删除“${editor.folder.name}”及其中全部文件和子文件夹后将无法恢复。`
                    : editor.file.is_reference
                      ? "只会从当前项目移除引用，文件管理中的源文件不会受到影响。"
                      : `删除“${fileDisplayName(editor.file)}”后将无法恢复。`}
                </p>
                {editorError ? (
                  <p className="file-dialog-error">{editorError}</p>
                ) : null}
                <div className="file-dialog-actions">
                  <button
                    type="button"
                    disabled={act.isPending}
                    onClick={closeEditor}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={act.isPending}
                    onClick={() => submitEditor()}
                  >
                    {act.isPending ? "处理中…" : editorSubmitLabel}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
