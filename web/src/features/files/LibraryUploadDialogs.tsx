import { LoadingState } from "@shared/ui/LoadingState";
import { ResponsiveImage } from "@shared/ui/ResponsiveImage";
import type {
  LibrarySourceProject,
  LibrarySourcePickerMode,
  LibraryStagingItem,
} from "./libraryStaging";
import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Folder, LoaderCircle, Search, X } from "lucide-react";
import {
  getFiles,
  getFolders,
  type ManagedFile,
  type ManagedFolder,
} from "@features/files/api";
import {
  AssetPreview,
  FileKindIcon,
  fileDisplayName,
  kindLabel,
} from "@features/files/AssetBrowserParts";
import { fileQueryKeys } from "@features/files/queryKeys";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { useDrawerFocus } from "@shared/ui/useDrawerFocus";
import { formatFileSize } from "@shared/lib/fileSize";

function localMediaKind(file: File) {
  if (file.type.startsWith("video/")) return "video" as const;
  if (file.type.startsWith("audio/")) return "audio" as const;
  if (file.type.startsWith("image/")) return "image" as const;
  return "document" as const;
}

function LocalFilePreview({ file }: { file: File }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!file.type.startsWith("image/")) {
      setUrl(undefined);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return url ? (
    <ResponsiveImage src={url} alt="" />
  ) : (
    <span>
      <FileKindIcon kind={localMediaKind(file)} />
    </span>
  );
}

export function LibrarySourcePickerDialog({
  mode,
  currentProjectId,
  sourceProjects,
  sourceProjectsLoading,
  onClose,
  onConfirm,
}: {
  mode: LibrarySourcePickerMode;
  currentProjectId: string;
  sourceProjects: LibrarySourceProject[];
  sourceProjectsLoading: boolean;
  onClose: () => void;
  onConfirm: (files: ManagedFile[], sourceProjectId: string) => void;
}) {
  const titleId = useId();
  const [query, setQuery] = useState("");
  const [sourceProjectId, setSourceProjectId] = useState(
    mode === "project" ? currentProjectId : "",
  );
  const [selectedFiles, setSelectedFiles] = useState<ManagedFile[]>([]);
  const [folderId, setFolderId] = useState<string>();
  const dialog = useDrawerFocus<HTMLDivElement>(onClose, true, false);
  const noSourceProjects =
    mode === "cross" && !sourceProjectsLoading && sourceProjects.length === 0;

  useEffect(() => {
    if (mode !== "cross") return;
    if (sourceProjects.some((project) => project.id === sourceProjectId))
      return;
    setSourceProjectId(sourceProjects[0]?.id ?? "");
    setSelectedFiles([]);
    setFolderId(undefined);
    setQuery("");
  }, [mode, sourceProjectId, sourceProjects]);

  const browseProjectId =
    mode === "project" ? currentProjectId : sourceProjectId;
  const filesQuery = useQuery({
    queryKey: fileQueryKeys.list({
      projectId: browseProjectId,
      folderId,
      query,
      sort: "updated",
      includeReferences: false,
    }),
    queryFn: () =>
      getFiles({
        projectId: browseProjectId,
        folderId,
        query,
        sort: "updated",
        includeReferences: false,
      }),
    enabled: Boolean(browseProjectId) && !noSourceProjects,
  });
  const files = filesQuery.data?.items ?? [];
  const foldersQuery = useQuery({
    queryKey: fileQueryKeys.folders(browseProjectId),
    queryFn: () => getFolders(browseProjectId),
    enabled: Boolean(browseProjectId) && !noSourceProjects,
  });
  const folders = foldersQuery.data?.items ?? [];
  const children = folders.filter(
    (folder) => (folder.parent_id ?? undefined) === folderId,
  );
  const ancestors: ManagedFolder[] = [];
  let parent = folders.find((folder) => folder.id === folderId);
  const visited = new Set<string>();
  while (parent && !visited.has(parent.id)) {
    visited.add(parent.id);
    ancestors.unshift(parent);
    parent = folders.find((folder) => folder.id === parent?.parent_id);
  }
  const openFolder = (id?: string) => {
    setFolderId(id);
    setQuery("");
  };
  useEffect(() => {
    setSelectedFiles([]);
    setFolderId(undefined);
    setQuery("");
  }, [browseProjectId]);
  const title = mode === "project" ? "从本项目选取" : "从跨项目选取";
  const sourceOptions = sourceProjects.map((project) => ({
    value: project.id,
    label: project.title,
  }));

  return (
    <div
      className="file-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialog}
        className="file-dialog library-source-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header>
          <div>
            <span>添加到总文件</span>
            <h2 id={titleId}>{title}</h2>
          </div>
          <button type="button" aria-label={`关闭${title}`} onClick={onClose}>
            <X aria-hidden />
          </button>
        </header>
        <div className="library-source-picker-body">
          {mode === "cross" ? (
            <label className="library-source-picker-field">
              <span>来源项目</span>
              <CustomSelect
                ariaLabel="来源项目"
                className="file-filter-select"
                value={sourceProjectId}
                disabled={sourceProjectsLoading || noSourceProjects}
                onChange={(value) => {
                  setSourceProjectId(value);
                  setSelectedFiles([]);
                  setFolderId(undefined);
                  setQuery("");
                }}
                options={
                  noSourceProjects
                    ? [{ value: "", label: "暂无其他项目", disabled: true }]
                    : sourceOptions
                }
              />
            </label>
          ) : null}
          <nav
            aria-label="文件夹路径"
            className="library-source-picker-folders"
          >
            <button
              type="button"
              aria-current={!folderId ? "location" : undefined}
              onClick={() => openFolder()}
            >
              项目根目录
            </button>
            {ancestors.map((folder) => (
              <button
                key={folder.id}
                type="button"
                aria-current={folderId === folder.id ? "location" : undefined}
                onClick={() => openFolder(folder.id)}
              >
                {folder.name}
              </button>
            ))}
            {folderId ? (
              <button
                type="button"
                onClick={() =>
                  openFolder(ancestors.at(-1)?.parent_id ?? undefined)
                }
              >
                返回上级
              </button>
            ) : null}
          </nav>
          <div className="library-source-picker-folders">
            {children.map((folder) => (
              <button
                key={folder.id}
                type="button"
                onClick={() => openFolder(folder.id)}
              >
                <Folder aria-hidden />
                {folder.name}
              </button>
            ))}
          </div>
          {foldersQuery.isError ? (
            <div role="alert">
              文件夹暂时无法读取。
              <button type="button" onClick={() => void foldersQuery.refetch()}>
                重试文件夹
              </button>
            </div>
          ) : null}
          <label className="library-source-picker-search">
            <Search aria-hidden />
            <input
              aria-label="搜索素材"
              placeholder="搜索素材"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {noSourceProjects ? (
            <div className="file-empty">
              <strong>暂无其他可选取的项目</strong>
            </div>
          ) : filesQuery.isLoading || foldersQuery.isLoading ? (
            <LoadingState
              label="正在读取文件…"
              variant="region"
              className="file-empty"
            />
          ) : filesQuery.isError ? (
            <div className="file-empty">
              文件暂时无法读取。
              <button type="button" onClick={() => void filesQuery.refetch()}>
                重试文件
              </button>
            </div>
          ) : files.length === 0 ? (
            <div className="file-empty">
              <strong>
                {query.trim() ? "没有找到匹配的文件" : "当前文件夹没有文件"}
              </strong>
            </div>
          ) : (
            <div
              className="library-source-picker-list"
              role="listbox"
              aria-multiselectable
              aria-label="可选文件"
              onKeyDown={(event) => {
                if (
                  !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
                )
                  return;
                const options = Array.from(
                  event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    'button[role="option"]',
                  ),
                );
                const index = options.indexOf(
                  document.activeElement as HTMLButtonElement,
                );
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? options.length - 1
                      : Math.max(
                          0,
                          Math.min(
                            options.length - 1,
                            index + (event.key === "ArrowDown" ? 1 : -1),
                          ),
                        );
                options[next]?.focus();
                event.preventDefault();
              }}
            >
              {files.map((file) => {
                const active = selectedFiles.some(
                  (item) => item.id === file.id,
                );
                const name = fileDisplayName(file);
                return (
                  <button
                    key={file.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={active ? "active" : undefined}
                    onClick={() =>
                      setSelectedFiles((current) =>
                        current.some((item) => item.id === file.id)
                          ? current.filter((item) => item.id !== file.id)
                          : [...current, file],
                      )
                    }
                  >
                    <span className={`file-item-preview ${file.media_kind}`}>
                      <AssetPreview file={file} />
                    </span>
                    <span className="file-item-copy">
                      <strong title={name}>{name}</strong>
                      <small>
                        {kindLabel(file.media_kind)} ·{" "}
                        {formatFileSize(file.byte_size)}
                      </small>
                    </span>
                    {active ? <Check aria-hidden /> : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="library-source-picker-folders" aria-label="已选文件">
          {selectedFiles.map((file) => (
            <button
              key={file.id}
              type="button"
              onClick={() =>
                setSelectedFiles((items) =>
                  items.filter((item) => item.id !== file.id),
                )
              }
            >
              移除 {fileDisplayName(file)}
            </button>
          ))}
        </div>
        <div className="file-dialog-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="primary"
            disabled={!browseProjectId || selectedFiles.length === 0}
            onClick={() => onConfirm(selectedFiles, browseProjectId)}
          >
            下一步（{selectedFiles.length}）
          </button>
        </div>
      </div>
    </div>
  );
}

export function LibraryUploadStagingDialog({
  items,
  pending,
  error,
  onClose,
  onChangeName,
  onRemove,
  onConfirm,
}: {
  items: LibraryStagingItem[];
  pending: boolean;
  error: string;
  onClose: () => void;
  onChangeName: (key: string, displayName: string) => void;
  onRemove: (key: string) => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const dialog = useDrawerFocus<HTMLDivElement>(onClose, true, false);
  const canSubmit =
    items.length > 0 && items.every((item) => item.displayName.trim());

  return (
    <div
      className="file-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <div
        ref={dialog}
        className="file-dialog library-upload-staging"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header>
          <div>
            <span>添加到总文件</span>
            <h2 id={titleId}>确认上传并改名</h2>
          </div>
          <button
            type="button"
            aria-label="关闭确认上传"
            disabled={pending}
            onClick={onClose}
          >
            <X aria-hidden />
          </button>
        </header>
        <div className="library-upload-staging-list">
          {items.map((item) => (
            <label key={item.key} className="library-upload-staging-item">
              <span
                className={`file-item-preview ${
                  item.kind === "local"
                    ? localMediaKind(item.file)
                    : item.asset.media_kind
                }`}
              >
                {item.kind === "local" ? (
                  <LocalFilePreview file={item.file} />
                ) : (
                  <AssetPreview file={item.asset} />
                )}
              </span>
              <span className="library-upload-staging-fields">
                <input
                  aria-label={`显示名称 ${item.displayName || item.key}`}
                  value={item.displayName}
                  disabled={pending}
                  maxLength={255}
                  onChange={(event) =>
                    onChangeName(item.key, event.target.value)
                  }
                />
                <small>
                  {item.kind === "local"
                    ? item.file.name
                    : item.asset.original_filename}
                </small>
              </span>
              <button
                type="button"
                aria-label={`移除 ${item.displayName || "条目"}`}
                disabled={pending}
                onClick={() => onRemove(item.key)}
              >
                <X aria-hidden />
              </button>
            </label>
          ))}
        </div>
        {error ? <p className="file-dialog-error">{error}</p> : null}
        <div className="file-dialog-actions">
          <button type="button" disabled={pending} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="primary"
            disabled={pending || !canSubmit}
            onClick={onConfirm}
          >
            {pending ? (
              <>
                <LoaderCircle className="spin" aria-hidden /> 处理中…
              </>
            ) : (
              `确认添加（${items.length}）`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
