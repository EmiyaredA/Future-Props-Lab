import { useEffect, useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, LoaderCircle, Search, X } from "lucide-react";
import { getFiles, type ManagedFile } from "@features/files/api";
import {
  FileKindIcon,
  fileDisplayName,
  kindLabel,
} from "@features/files/AssetBrowserParts";
import { fileQueryKeys } from "@features/files/queryKeys";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { useDrawerFocus } from "@shared/ui/useDrawerFocus";
import { formatFileSize } from "@shared/lib/fileSize";

export type LibrarySourceProject = {
  id: string;
  title: string;
};

export type LibraryStagingLocal = {
  key: string;
  kind: "local";
  file: File;
  displayName: string;
};

export type LibraryStagingProject = {
  key: string;
  kind: "project";
  asset: ManagedFile;
  sourceProjectId: string;
  displayName: string;
};

export type LibraryStagingItem = LibraryStagingLocal | LibraryStagingProject;

export type LibrarySourcePickerMode = "project" | "cross";

function localBaseName(filename: string) {
  const index = filename.lastIndexOf(".");
  return index > 0 ? filename.slice(0, index) : filename;
}

export function stageLocalFiles(files: File[]): LibraryStagingLocal[] {
  return files.map((file, index) => ({
    key: `local-${file.name}-${file.size}-${file.lastModified}-${index}`,
    kind: "local" as const,
    file,
    displayName: localBaseName(file.name),
  }));
}

export function stageProjectFiles(
  files: ManagedFile[],
  sourceProjectId: string,
): LibraryStagingProject[] {
  return files.map((asset) => ({
    key: `project-${sourceProjectId}-${asset.id}`,
    kind: "project" as const,
    asset,
    sourceProjectId,
    displayName: fileDisplayName(asset),
  }));
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
  const [selected, setSelected] = useState<string[]>([]);
  const dialog = useDrawerFocus<HTMLDivElement>(onClose, true, false);
  const noSourceProjects =
    mode === "cross" && !sourceProjectsLoading && sourceProjects.length === 0;

  useEffect(() => {
    if (mode !== "cross") return;
    if (sourceProjects.some((project) => project.id === sourceProjectId))
      return;
    setSourceProjectId(sourceProjects[0]?.id ?? "");
    setSelected([]);
  }, [mode, sourceProjectId, sourceProjects]);

  const browseProjectId = mode === "project" ? currentProjectId : sourceProjectId;
  const filesQuery = useQuery({
    queryKey: fileQueryKeys.list({
      projectId: browseProjectId,
      query,
      sort: "updated",
      includeReferences: false,
    }),
    queryFn: () =>
      getFiles({
        projectId: browseProjectId,
        query,
        sort: "updated",
        includeReferences: false,
      }),
    enabled: Boolean(browseProjectId) && !noSourceProjects,
  });
  const files = filesQuery.data?.items ?? [];
  const selectedFiles = useMemo(
    () => files.filter((file) => selected.includes(file.id)),
    [files, selected],
  );
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
                  setSelected([]);
                }}
                options={
                  noSourceProjects
                    ? [{ value: "", label: "暂无其他项目", disabled: true }]
                    : sourceOptions
                }
              />
            </label>
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
          ) : filesQuery.isLoading ? (
            <div className="file-empty">正在读取文件…</div>
          ) : filesQuery.isError ? (
            <div className="file-empty">文件暂时无法读取，请稍后重试。</div>
          ) : files.length === 0 ? (
            <div className="file-empty">
              <strong>
                {query.trim() ? "没有找到匹配的文件" : "这个项目还没有文件"}
              </strong>
            </div>
          ) : (
            <div className="library-source-picker-list" role="listbox" aria-multiselectable>
              {files.map((file) => {
                const active = selected.includes(file.id);
                const name = fileDisplayName(file);
                return (
                  <button
                    key={file.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={active ? "active" : undefined}
                    onClick={() =>
                      setSelected((current) =>
                        current.includes(file.id)
                          ? current.filter((id) => id !== file.id)
                          : [...current, file.id],
                      )
                    }
                  >
                    <span className={`file-item-preview ${file.media_kind}`}>
                      <FileKindIcon kind={file.media_kind} />
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
              <span className="file-item-preview">
                {item.kind === "local" ? (
                  <FileKindIcon
                    kind={
                      item.file.type.startsWith("video/")
                        ? "video"
                        : item.file.type.startsWith("audio/")
                          ? "audio"
                          : item.file.type.startsWith("image/")
                            ? "image"
                            : "document"
                    }
                  />
                ) : (
                  <FileKindIcon kind={item.asset.media_kind} />
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
