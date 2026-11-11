import { LoadingScene } from "@shared/ui/LoadingScene";
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { Check, ChevronRight, Folder, Search, X } from "lucide-react";
import { LoadingState } from "@shared/ui/LoadingState";
import {
  fileQueryKeys,
  getFiles,
  getFolders,
  importManagedFiles,
  type ManagedFile,
  type MediaKind,
} from "@features/files";
import { pathToFolder } from "@features/files/AssetBrowserParts";
import { getVisualWorkshopProjects } from "@features/visual-workshop/api";
import { visualWorkshopQueryKeys } from "@features/visual-workshop/queryKeys";
import { GenerationMediaPreview } from "@features/visual-workshop/generation/GenerationMediaPreview";
import { apiErrorMessage } from "@platform/api/errors";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { isCanvasMediaKind } from "../canvas/canvasAssetDrag";

type PickerMode = "project" | "cross" | "board";
type SourceScope = "current" | "project" | "library";

function errorMessage(error: unknown) {
  return apiErrorMessage(error, "素材导入失败，请稍后重试。");
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
  initialValue = [],
  multiple,
  limit,
  excludedAssetIds = [],
  onClose,
  onConfirm,
}: {
  mode: PickerMode;
  projectId: string;
  kind?: Extract<MediaKind, "image" | "video" | "audio">;
  initialValue?: string[];
  multiple: boolean;
  limit: number;
  excludedAssetIds?: string[];
  onClose: () => void;
  onConfirm: (ids: string[], files: ManagedFile[]) => void | Promise<void>;
}) {
  const searchInput = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const location = useRef<HTMLElement>(null);
  const [query, setQuery] = useState("");
  const [libraryFolderId, setLibraryFolderId] = useState<string>();
  const [source, setSource] = useState<SourceScope>(
    mode === "project" ? "current" : mode === "board" ? "library" : "project",
  );
  const resolved = useRef<ManagedFile[] | undefined>(undefined);
  const [sourceProjectId, setSourceProjectId] = useState("");
  const [selected, setSelected] = useState<string[]>(
    mode === "project"
      ? initialValue
          .filter((id) => !excludedAssetIds.includes(id))
          .slice(0, limit)
      : [],
  );
  const projects = useQuery({
    queryKey: visualWorkshopQueryKeys.projectsForMediaSource,
    queryFn: getVisualWorkshopProjects,
    enabled: mode !== "project",
  });
  const sourceProjects = useMemo(
    () =>
      projects.data?.items.filter((project) => project.id !== projectId) ?? [],
    [projectId, projects.data],
  );

  useEffect(() => {
    if (source !== "project") return;
    if (sourceProjects.some((project) => project.id === sourceProjectId))
      return;
    setSourceProjectId(sourceProjects[0]?.id ?? "");
    resolved.current = undefined;
    setSelected([]);
  }, [source, sourceProjectId, sourceProjects]);

  const sourceReady = source !== "project" || Boolean(sourceProjectId);
  const effectiveProjectId =
    source === "current"
      ? projectId
      : source === "project"
        ? sourceProjectId || undefined
        : undefined;
  const folders = useQuery({
    queryKey: fileQueryKeys.folders(effectiveProjectId),
    queryFn: () => getFolders(effectiveProjectId),
    enabled: sourceReady,
  });
  const libraryFolders = folders.data?.items ?? [];
  const libraryPath =
    source === "library" ? pathToFolder(libraryFolderId, libraryFolders) : [];
  const activeFolderId = libraryPath.at(-1)?.id;
  const folderIds = useMemo(
    () =>
      folders.isSuccess
        ? source === "library"
          ? [activeFolderId]
          : [undefined, ...folders.data.items.map((folder) => folder.id)]
        : [],
    [activeFolderId, folders.data, folders.isSuccess, source],
  );
  const fileQueries = useQueries({
    queries: folderIds.map((folderId) => ({
      queryKey: fileQueryKeys.list({
        projectId: effectiveProjectId,
        folderId,
        mediaKind: kind,
        sort: "name",
        includeReferences: source === "current",
      }),
      queryFn: () =>
        getFiles({
          projectId: effectiveProjectId,
          folderId,
          mediaKind: kind,
          sort: "name",
          includeReferences: source === "current",
        }),
    })),
  });
  const available = useMemo(() => {
    const unique = new Map<string, ManagedFile>();
    fileQueries.forEach((fileQuery) =>
      fileQuery.data?.items.forEach((file) => unique.set(file.id, file)),
    );
    return [...unique.values()]
      .filter(
        (file) =>
          !excludedAssetIds.includes(file.id) &&
          (mode !== "board" || isCanvasMediaKind(file.media_kind)),
      )
      .sort((left, right) =>
        left.display_name.localeCompare(right.display_name, "zh-CN"),
      );
  }, [fileQueries, excludedAssetIds, mode]);
  const normalized = query.trim().toLocaleLowerCase("zh-CN");
  const files = available.filter((file) =>
    file.display_name.toLocaleLowerCase("zh-CN").includes(normalized),
  );
  const childFolders =
    source === "library"
      ? libraryFolders
          .filter(
            (folder) =>
              folder.parent_id === (activeFolderId ?? null) &&
              folder.name.toLocaleLowerCase("zh-CN").includes(normalized),
          )
          .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))
      : [];
  const openFolder = (id?: string) => {
    setLibraryFolderId(id);
    setQuery("");
    if (results.current) results.current.scrollTop = 0;
    location.current?.focus();
  };
  const loading =
    !sourceReady ||
    folders.isLoading ||
    fileQueries.some((fileQuery) => fileQuery.isLoading);
  const failed =
    folders.isError || fileQueries.some((fileQuery) => fileQuery.isError);
  const importMutation = useMutation({
    mutationFn: async () => {
      const items =
        resolved.current ??
        (source === "current"
          ? available.filter((file) => selected.includes(file.id))
          : (
              await importManagedFiles(
                projectId,
                source === "library"
                  ? { sourceScope: "library", assetIds: selected }
                  : {
                      sourceScope: "project",
                      sourceProjectId,
                      assetIds: selected,
                    },
              )
            ).items);
      if (mode === "board") {
        if (items.length !== selected.length)
          throw new Error("部分素材已不可用，请重新选择。");
        resolved.current = items;
      }
      await onConfirm(
        items.map((file) => file.id),
        items,
      );
    },
  });
  const title =
    mode === "board"
      ? "从应用选择素材"
      : mode === "project"
        ? "选择本项目素材"
        : "选择跨项目素材";
  const changeSelection = (next: string[]) => {
    resolved.current = undefined;
    importMutation.reset();
    setSelected(next);
  };
  const toggle = (assetId: string) => {
    if (selected.includes(assetId)) {
      changeSelection(selected.filter((item) => item !== assetId));
      return;
    }
    if (!multiple) {
      changeSelection([assetId]);
      return;
    }
    if (selected.length < limit) changeSelection([...selected, assetId]);
  };
  const confirm = () => {
    if (mode !== "project") {
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
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !importMutation.isPending) onClose();
      }}
    >
      <Dialog.Overlay className="generation-source-backdrop">
        <Dialog.Content
          className="generation-source-dialog"
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            searchInput.current?.focus();
          }}
        >
          <header>
            <div>
              <span>
                {kind ? `${mediaLabel(kind)}素材` : "图片、视频和音频"}
              </span>
              <Dialog.Title>{title}</Dialog.Title>
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

          {mode !== "project" ? (
            <div className="generation-source-cross-controls">
              <div
                role="tablist"
                aria-label={mode === "board" ? "素材来源" : "跨项目素材来源"}
              >
                {(
                  [
                    ...(mode === "board" ? [["current", "本项目"]] : []),
                    ["project", "其他项目"],
                    ["library", mode === "board" ? "总文件" : "公共库"],
                  ] as [SourceScope, string][]
                ).map(([scope, label]) => (
                  <button
                    key={scope}
                    type="button"
                    role="tab"
                    aria-selected={source === scope}
                    className={source === scope ? "active" : ""}
                    disabled={importMutation.isPending}
                    onClick={() => {
                      if (scope === source) return;
                      setSource(scope);
                      setLibraryFolderId(undefined);
                      changeSelection([]);
                      setQuery("");
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {source === "project" ? (
                <label>
                  <span>来源项目</span>
                  <CustomSelect
                    ariaLabel="来源项目"
                    value={sourceProjectId}
                    disabled={
                      importMutation.isPending ||
                      projects.isLoading ||
                      sourceProjects.length === 0
                    }
                    onChange={(value) => {
                      setSourceProjectId(value);
                      changeSelection([]);
                      setQuery("");
                    }}
                    options={
                      sourceProjects.length === 0
                        ? [{ value: "", label: "暂无其他项目", disabled: true }]
                        : sourceProjects.map((project) => ({
                            value: project.id,
                            label: project.title,
                          }))
                    }
                  />
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
              placeholder={source === "library" ? "搜索当前文件夹" : "搜索素材"}
              aria-label="搜索素材"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          <div className="generation-source-results" ref={results}>
            {source === "library" && (
              <nav
                ref={location}
                tabIndex={-1}
                className="generation-source-location"
                aria-label="文件路径"
              >
                <button
                  type="button"
                  disabled={importMutation.isPending}
                  aria-current={!activeFolderId ? "location" : undefined}
                  onClick={() => openFolder()}
                >
                  总文件
                </button>
                {libraryPath.map((folder) => (
                  <span key={folder.id}>
                    <ChevronRight size={13} aria-hidden />
                    <button
                      type="button"
                      disabled={importMutation.isPending}
                      aria-current={
                        folder.id === activeFolderId ? "location" : undefined
                      }
                      onClick={() => openFolder(folder.id)}
                    >
                      {folder.name}
                    </button>
                  </span>
                ))}
              </nav>
            )}
            {childFolders.length > 0 && (
              <div
                className="generation-source-grid generation-source-folders"
                role="group"
                aria-label="文件夹"
              >
                {childFolders.map((folder) => (
                  <button
                    type="button"
                    key={folder.id}
                    disabled={importMutation.isPending}
                    onClick={() => openFolder(folder.id)}
                  >
                    <span className="generation-source-preview">
                      <Folder aria-hidden />
                    </span>
                    <span title={folder.name}>{folder.name}</span>
                    <ChevronRight aria-hidden />
                  </button>
                ))}
              </div>
            )}
            {source === "project" &&
            projects.isSuccess &&
            sourceProjects.length === 0 ? (
              <div className="generation-source-state">暂无其他项目</div>
            ) : source === "project" && projects.isError ? (
              <div className="generation-source-state is-error" role="alert">
                项目读取失败，请关闭后重试。
              </div>
            ) : loading ? (
              <div className="generation-source-state">
                <LoadingState label="正在读取素材…" />
              </div>
            ) : failed ? (
              <div className="generation-source-state is-error" role="alert">
                素材读取失败，请关闭后重试。
              </div>
            ) : files.length === 0 && childFolders.length === 0 ? (
              <div className="generation-source-state">
                {query.trim()
                  ? "没有匹配的素材"
                  : source === "library"
                    ? "当前文件夹暂无可用素材"
                    : "当前来源暂无可用素材"}
              </div>
            ) : files.length > 0 ? (
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
                        <GenerationMediaPreview
                          file={file}
                          thumbnailOnly={mode === "board"}
                        />
                      </span>
                      <span title={file.display_name}>{file.display_name}</span>
                      {checked ? <Check aria-hidden /> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
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
                  (mode !== "project" && selected.length === 0)
                }
                onClick={confirm}
              >
                {importMutation.isPending ? <LoadingScene /> : null}
                {mode === "board"
                  ? "添加到看板"
                  : mode === "cross"
                    ? "导入并选择"
                    : "确认选择"}
              </button>
            </div>
          </footer>
        </Dialog.Content>
      </Dialog.Overlay>
    </Dialog.Root>
  );
}
