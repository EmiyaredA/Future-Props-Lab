import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  FileImage,
  Folder,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  fileQueryKeys,
  getFiles,
  getFolders,
  type ManagedFile,
} from "@features/files";
import {
  deleteGalgameProjectAsset,
  getGalgameProjectAssets,
  type GalgameProjectAsset,
} from "@features/galgame-workshop/api";
import { StoryAssetImage } from "@features/galgame-workshop/editor/StoryAssetImage";
import {
  galgameQueryKeys,
  invalidateGalgameAssetQueries,
} from "@features/galgame-workshop/queryKeys";

export type StoryImagePickerState = {
  mode: "add" | "replace" | "sequence";
  source: "project" | "library";
};

export function StoryImagePicker({
  projectId,
  state,
  usedFileIds,
  addTitle,
  replaceTitle,
  sequenceTitle,
  searchLabel,
  projectEmptyCopy,
  onState,
  onChoose,
  onChooseMany,
  onUpload,
  onClose,
}: {
  projectId: string;
  state: StoryImagePickerState;
  usedFileIds: Set<string>;
  addTitle: string;
  replaceTitle: string;
  sequenceTitle?: string;
  searchLabel: string;
  projectEmptyCopy: string;
  onState: (state: StoryImagePickerState) => void;
  onChoose: (fileId: string, name: string) => void;
  onChooseMany?: (files: Array<{ fileId: string; name: string }>) => void;
  onUpload: () => void;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [libraryFolderId, setLibraryFolderId] = useState<string>();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const projectQuery = useQuery({
    queryKey: galgameQueryKeys.projectAssets(projectId, query),
    queryFn: () => getGalgameProjectAssets(projectId, query),
    enabled: state.source === "project",
  });
  const libraryQuery = useQuery({
    queryKey: fileQueryKeys.list({
      folderId: libraryFolderId,
      query,
      mediaKind: "image",
      sort: "updated",
      includeReferences: false,
    }),
    queryFn: () =>
      getFiles({
        folderId: libraryFolderId,
        query,
        mediaKind: "image",
        sort: "updated",
        includeReferences: false,
      }),
    enabled: state.source === "library",
  });
  const foldersQuery = useQuery({
    queryKey: fileQueryKeys.folders(),
    queryFn: () => getFolders(),
    enabled: state.source === "library",
  });
  const remove = useMutation({
    mutationFn: (asset: GalgameProjectAsset) =>
      deleteGalgameProjectAsset(projectId, asset),
    onSuccess: () => {
      setError("");
      void invalidateGalgameAssetQueries(client, projectId);
    },
    onError: (caught) =>
      setError(caught instanceof Error ? caught.message : "素材删除失败"),
  });
  const projectAssets = projectQuery.data?.items ?? [];
  const libraryAssets = (libraryQuery.data?.items ?? []).filter(
    (asset) => asset.mime_type !== "image/gif" && asset.source === "library",
  );
  const folders = foldersQuery.data?.items ?? [];
  const currentFolder = folders.find((folder) => folder.id === libraryFolderId);
  const visibleFolders = folders.filter(
    (folder) =>
      (libraryFolderId
        ? folder.parent_id === libraryFolderId
        : folder.parent_id === null) &&
      (!query ||
        folder.name
          .toLocaleLowerCase("zh-CN")
          .includes(query.toLocaleLowerCase("zh-CN"))),
  );
  const assets = state.source === "project" ? projectAssets : libraryAssets;
  const loading =
    state.source === "project"
      ? projectQuery.isLoading
      : libraryQuery.isLoading;
  const loadError =
    state.source === "project" ? projectQuery.error : libraryQuery.error;
  const title =
    state.mode === "add"
      ? addTitle
      : state.mode === "sequence"
        ? (sequenceTitle ?? "添加序列帧")
        : replaceTitle;
  const multiSelect = state.mode === "sequence";

  return (
    <div className="galgame-asset-picker-backdrop" role="presentation">
      <section
        className="galgame-asset-picker"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <div>
            <strong>{title}</strong>
            <span>选择工程图片或复用全局文件库素材。</span>
          </div>
          <button type="button" aria-label="关闭素材选择器" onClick={onClose}>
            <X aria-hidden />
          </button>
        </header>
        <nav aria-label="素材来源">
          <button
            type="button"
            className={state.source === "project" ? "active" : ""}
            onClick={() => onState({ ...state, source: "project" })}
          >
            工程素材
          </button>
          <button
            type="button"
            className={state.source === "library" ? "active" : ""}
            onClick={() => onState({ ...state, source: "library" })}
          >
            全局文件库
          </button>
        </nav>
        <div className="galgame-asset-picker-toolbar">
          <label>
            <Search aria-hidden />
            <input
              aria-label={searchLabel}
              value={query}
              placeholder="搜索图片…"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {state.source === "library" && currentFolder ? (
            <button
              type="button"
              onClick={() =>
                setLibraryFolderId(currentFolder.parent_id ?? undefined)
              }
            >
              <ArrowLeft aria-hidden /> 返回上层
            </button>
          ) : null}
          <button type="button" onClick={onUpload}>
            <Upload aria-hidden /> 上传新图片
          </button>
          {multiSelect ? (
            <button
              type="button"
              disabled={!selectedIds.size}
              onClick={() => {
                const selected = assets.flatMap((asset) =>
                  selectedIds.has(asset.id)
                    ? [{ fileId: asset.id, name: asset.display_name }]
                    : [],
                );
                onChooseMany?.(selected);
              }}
            >
              添加所选（{selectedIds.size}）
            </button>
          ) : null}
        </div>
        {error || loadError ? (
          <p className="galgame-asset-picker-error">
            {error ||
              (loadError instanceof Error
                ? loadError.message
                : "素材读取失败，请稍后重试")}
          </p>
        ) : null}
        <div className="galgame-asset-picker-grid">
          {loading ? <span>正在读取素材…</span> : null}
          {state.source === "library"
            ? visibleFolders.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  className="galgame-asset-picker-folder"
                  onClick={() => setLibraryFolderId(folder.id)}
                >
                  <span>
                    <Folder aria-hidden />
                  </span>
                  <strong>{folder.name}</strong>
                  <small>打开文件夹</small>
                </button>
              ))
            : null}
          {assets.map((asset) => {
            const file = asset as GalgameProjectAsset | ManagedFile;
            const used = usedFileIds.has(file.id);
            return (
              <article key={file.id}>
                <button
                  type="button"
                  className="galgame-asset-picker-choice"
                  aria-pressed={
                    multiSelect ? selectedIds.has(file.id) : undefined
                  }
                  onClick={() => {
                    if (!multiSelect) {
                      onChoose(file.id, file.display_name);
                      return;
                    }
                    setSelectedIds((current) => {
                      const next = new Set(current);
                      if (next.has(file.id)) next.delete(file.id);
                      else next.add(file.id);
                      return next;
                    });
                  }}
                >
                  <span>
                    <StoryAssetImage
                      fileId={file.id}
                      alt=""
                      fallback={<FileImage aria-hidden />}
                    />
                  </span>
                  <strong>{file.display_name}</strong>
                  <small>{used ? "已在故事中使用" : "点击选择"}</small>
                </button>
                {state.source === "project" ? (
                  <button
                    type="button"
                    className="galgame-asset-picker-delete"
                    aria-label={`删除素材 ${file.display_name}`}
                    disabled={used || remove.isPending}
                    onClick={() => remove.mutate(file as GalgameProjectAsset)}
                  >
                    <Trash2 aria-hidden />
                  </button>
                ) : null}
              </article>
            );
          })}
          {!loading && !assets.length && !visibleFolders.length ? (
            <div className="galgame-asset-picker-empty">
              <FileImage aria-hidden />
              <strong>没有可用图片</strong>
              <span>
                {state.source === "project"
                  ? projectEmptyCopy
                  : "当前目录中暂时没有静态图片。"}
              </span>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
