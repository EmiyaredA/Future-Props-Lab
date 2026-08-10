import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { Check, LoaderCircle, Search, X } from "lucide-react";
import {
  fileQueryKeys,
  getFiles,
  getFolders,
  importManagedFiles,
  type ManagedFile,
  type MediaKind,
} from "@features/files";
import { getVisualWorkshopProjects } from "@features/visual-workshop/api";
import { GenerationMediaPreview } from "@features/visual-workshop/generation/GenerationMediaPreview";
import { ApiError } from "@platform/api/client";

type PickerMode = "project" | "cross";
type CrossScope = "project" | "library";

function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.problem.detail || error.message;
  return error instanceof Error ? error.message : "素材导入失败，请稍后重试。";
}

function mediaLabel(kind: MediaKind) {
  return {
    image: "图片",
    video: "视频",
    audio: "音频",
    font: "字体",
    document: "文档",
  }[kind];
}

export function ProjectMediaSourceDialog({
  mode,
  projectId,
  kind,
  initialValue,
  multiple,
  limit,
  onClose,
  onConfirm,
}: {
  mode: PickerMode;
  projectId: string;
  kind: Extract<MediaKind, "image" | "video" | "audio">;
  initialValue: string[];
  multiple: boolean;
  limit: number;
  onClose: () => void;
  onConfirm: (ids: string[], files: ManagedFile[]) => void;
}) {
  const titleId = useId();
  const searchInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [crossScope, setCrossScope] = useState<CrossScope>("project");
  const [sourceProjectId, setSourceProjectId] = useState("");
  const [selected, setSelected] = useState<string[]>(
    mode === "project" ? initialValue.slice(0, limit) : [],
  );
  const projects = useQuery({
    queryKey: ["visual-workshop-projects", "media-source"],
    queryFn: getVisualWorkshopProjects,
    enabled: mode === "cross",
  });
  const sourceProjects = useMemo(
    () =>
      projects.data?.items.filter((project) => project.id !== projectId) ?? [],
    [projectId, projects.data],
  );

  useEffect(() => {
    if (mode !== "cross" || crossScope !== "project") return;
    if (sourceProjects.some((project) => project.id === sourceProjectId))
      return;
    setSourceProjectId(sourceProjects[0]?.id ?? "");
    setSelected([]);
  }, [crossScope, mode, sourceProjectId, sourceProjects]);

  useEffect(() => {
    searchInput.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const sourceReady =
    mode === "project" || crossScope === "library" || Boolean(sourceProjectId);
  const effectiveProjectId =
    mode === "project"
      ? projectId
      : crossScope === "project"
        ? sourceProjectId || undefined
        : undefined;
  const folders = useQuery({
    queryKey: fileQueryKeys.folders(effectiveProjectId),
    queryFn: () => getFolders(effectiveProjectId),
    enabled: sourceReady,
  });
  const folderIds = useMemo(
    () =>
      folders.isSuccess
        ? [undefined, ...folders.data.items.map((folder) => folder.id)]
        : [],
    [folders.data, folders.isSuccess],
  );
  const fileQueries = useQueries({
    queries: folderIds.map((folderId) => ({
      queryKey: fileQueryKeys.list({
        projectId: effectiveProjectId,
        folderId,
        mediaKind: kind,
        includeReferences: mode === "project",
      }),
      queryFn: () =>
        getFiles({
          projectId: effectiveProjectId,
          folderId,
          mediaKind: kind,
          sort: "name",
          includeReferences: mode === "project",
        }),
    })),
  });
  const files = useMemo(() => {
    const unique = new Map<string, ManagedFile>();
    fileQueries.forEach((fileQuery) =>
      fileQuery.data?.items.forEach((file) => unique.set(file.id, file)),
    );
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    return [...unique.values()]
      .filter(
        (file) =>
          !normalized ||
          file.display_name.toLocaleLowerCase("zh-CN").includes(normalized),
      )
      .sort((left, right) =>
        left.display_name.localeCompare(right.display_name, "zh-CN"),
      );
  }, [fileQueries, query]);
  const loading =
    !sourceReady ||
    folders.isLoading ||
    fileQueries.some((fileQuery) => fileQuery.isLoading);
  const failed =
    folders.isError || fileQueries.some((fileQuery) => fileQuery.isError);
  const importMutation = useMutation({
    mutationFn: () => {
      if (crossScope === "library") {
        return importManagedFiles(projectId, {
          sourceScope: "library",
          assetIds: selected,
        });
      }
      return importManagedFiles(projectId, {
        sourceScope: "project",
        sourceProjectId,
        assetIds: selected,
      });
    },
    onSuccess: (result) => {
      onConfirm(
        result.items.map((file) => file.id),
        result.items,
      );
    },
  });
  const title = mode === "project" ? "选择本项目素材" : "选择跨项目素材";
  const toggle = (assetId: string) => {
    if (selected.includes(assetId)) {
      setSelected((current) => current.filter((item) => item !== assetId));
      return;
    }
    if (!multiple) {
      setSelected([assetId]);
      return;
    }
    if (selected.length < limit)
      setSelected((current) => [...current, assetId]);
  };
  const confirm = () => {
    if (mode === "cross") {
      importMutation.mutate();
      return;
    }
    const byId = new Map(files.map((file) => [file.id, file]));
    onConfirm(
      selected,
      selected.flatMap((assetId) => {
        const file = byId.get(assetId);
        return file ? [file] : [];
      }),
    );
  };

  return (
    <div
      className="generation-source-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !importMutation.isPending)
          onClose();
      }}
    >
      <section
        className="generation-source-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header>
          <div>
            <span>{mediaLabel(kind)}素材</span>
            <h2 id={titleId}>{title}</h2>
          </div>
          <button
            type="button"
            aria-label={`关闭${title}`}
            disabled={importMutation.isPending}
            onClick={onClose}
          >
            <X aria-hidden />
          </button>
        </header>

        {mode === "cross" ? (
          <div className="generation-source-cross-controls">
            <div role="tablist" aria-label="跨项目素材来源">
              <button
                type="button"
                role="tab"
                aria-selected={crossScope === "project"}
                className={crossScope === "project" ? "active" : ""}
                onClick={() => {
                  setCrossScope("project");
                  setSelected([]);
                  setQuery("");
                }}
              >
                其他项目
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={crossScope === "library"}
                className={crossScope === "library" ? "active" : ""}
                onClick={() => {
                  setCrossScope("library");
                  setSelected([]);
                  setQuery("");
                }}
              >
                公共库
              </button>
            </div>
            {crossScope === "project" ? (
              <label>
                <span>来源项目</span>
                <select
                  aria-label="来源项目"
                  value={sourceProjectId}
                  disabled={projects.isLoading || sourceProjects.length === 0}
                  onChange={(event) => {
                    setSourceProjectId(event.target.value);
                    setSelected([]);
                    setQuery("");
                  }}
                >
                  {sourceProjects.length === 0 ? (
                    <option value="">暂无其他项目</option>
                  ) : null}
                  {sourceProjects.map((project) => (
                    <option value={project.id} key={project.id}>
                      {project.title}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        ) : null}

        <label className="generation-source-search">
          <Search aria-hidden />
          <input
            ref={searchInput}
            type="search"
            value={query}
            placeholder="搜索素材"
            aria-label="搜索素材"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <div className="generation-source-results">
          {loading ? (
            <div className="generation-source-state" role="status">
              <LoaderCircle className="spinning" aria-hidden /> 正在读取素材…
            </div>
          ) : failed ? (
            <div className="generation-source-state is-error" role="alert">
              素材读取失败，请关闭后重试。
            </div>
          ) : files.length === 0 ? (
            <div className="generation-source-state">
              {query.trim() ? "没有匹配的素材" : "当前来源暂无可用素材"}
            </div>
          ) : (
            <div
              className="generation-source-grid"
              role="listbox"
              aria-label={title}
              aria-multiselectable={multiple}
            >
              {files.map((file) => {
                const checked = selected.includes(file.id);
                const disabled =
                  !checked && multiple && selected.length >= limit;
                return (
                  <button
                    type="button"
                    role="option"
                    aria-selected={checked}
                    className={checked ? "selected" : ""}
                    disabled={disabled || importMutation.isPending}
                    key={`${file.reference_id ?? "asset"}-${file.id}`}
                    onClick={() => toggle(file.id)}
                  >
                    <span className="generation-source-preview">
                      <GenerationMediaPreview file={file} />
                    </span>
                    <span title={file.display_name}>{file.display_name}</span>
                    {checked ? <Check aria-hidden /> : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {importMutation.isError ? (
          <p className="generation-source-error" role="alert">
            {errorMessage(importMutation.error)}
          </p>
        ) : null}
        <footer>
          <span>
            {multiple
              ? `已选 ${selected.length}/${limit}`
              : selected.length
                ? "已选择"
                : "未选择"}
          </span>
          <div>
            <button
              type="button"
              disabled={importMutation.isPending}
              onClick={onClose}
            >
              取消
            </button>
            <button
              type="button"
              className="primary"
              disabled={
                importMutation.isPending ||
                (mode === "cross" && selected.length === 0)
              }
              onClick={confirm}
            >
              {importMutation.isPending ? (
                <LoaderCircle className="spinning" aria-hidden />
              ) : null}
              {mode === "cross" ? "导入并选择" : "确认选择"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
