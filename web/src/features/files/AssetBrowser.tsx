import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  File,
  FileText,
  Folder,
  FolderPlus,
  Grid2X2,
  Image,
  List,
  LoaderCircle,
  Music,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  Video,
  X,
} from "lucide-react";
import { fetchApiBlob } from "@platform/api/client";
import { CustomSelect, type SelectOption } from "@shared/ui/CustomSelect";
import {
  createFolder,
  deleteFolder,
  deleteManagedFile,
  getFiles,
  getFolders,
  importFile,
  patchFolder,
  patchManagedFile,
  uploadManagedFile,
  type ManagedFile,
  type ManagedFolder,
  type MediaKind,
} from "@features/files/api";
import "@features/files/files.css";

type ViewMode = "grid" | "list";
type UploadStatus = "queued" | "uploading" | "success" | "error";
type UploadItem = {
  id: string;
  name: string;
  status: UploadStatus;
  error?: string;
};

const VIEW_KEY = "fpl_file_browser_view";
const ACCEPT =
  ".jpg,.jpeg,.png,.webp,.gif,.avif,.mp4,.webm,.mov,.mp3,.wav,.m4a,.ogg,.pdf,.txt,.md";
const KIND_OPTIONS: SelectOption[] = [
  { value: "all", label: "全部类型" },
  { value: "image", label: "图片" },
  { value: "video", label: "视频" },
  { value: "audio", label: "音频" },
  { value: "document", label: "文档" },
];
const SORT_OPTIONS: SelectOption[] = [
  { value: "updated", label: "最近更新" },
  { value: "name", label: "按名称" },
];

function uploadStatusLabel(status: UploadStatus) {
  return {
    queued: "等待上传",
    uploading: "上传中",
    success: "上传成功",
    error: "上传失败",
  }[status];
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function kindLabel(kind: MediaKind) {
  return { image: "图片", video: "视频", audio: "音频", document: "文档" }[
    kind
  ];
}

function FileKindIcon({ kind }: { kind: MediaKind }) {
  const Icon =
    kind === "image"
      ? Image
      : kind === "video"
        ? Video
        : kind === "audio"
          ? Music
          : FileText;
  return <Icon aria-hidden />;
}

function AssetPreview({ file }: { file: ManagedFile }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (file.media_kind !== "image") return;
    let active = true;
    let objectUrl = "";
    void fetchApiBlob(`/v1/files/${file.id}/content`)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (active) setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.id, file.media_kind]);
  return url ? (
    <img src={url} alt="" />
  ) : (
    <span>
      <FileKindIcon kind={file.media_kind} />
    </span>
  );
}

function pathToFolder(folderId: string | undefined, folders: ManagedFolder[]) {
  const path: ManagedFolder[] = [];
  let current = folders.find((folder) => folder.id === folderId);
  while (current) {
    path.unshift(current);
    current = folders.find((folder) => folder.id === current?.parent_id);
  }
  return path;
}

export function AssetBrowser({
  projectId,
  compact = false,
  importMode = false,
  onImported,
}: {
  projectId?: string;
  compact?: boolean;
  importMode?: boolean;
  onImported?: () => void;
}) {
  const client = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [folderId, setFolderId] = useState<string>();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | MediaKind>("all");
  const [sort, setSort] = useState<"updated" | "name">("updated");
  const [view, setViewState] = useState<ViewMode>(() =>
    window.localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid",
  );
  const [notice, setNotice] = useState("");
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const sourceProjectId = importMode ? undefined : projectId;
  const key = [
    "managed-files",
    sourceProjectId ?? "library",
    folderId ?? "root",
  ];
  const foldersQuery = useQuery({
    queryKey: ["managed-folders", sourceProjectId ?? "library"],
    queryFn: () => getFolders(sourceProjectId),
  });
  const filesQuery = useQuery({
    queryKey: [...key, query, kind, sort],
    queryFn: () =>
      getFiles({
        projectId: sourceProjectId,
        folderId,
        query,
        mediaKind: kind === "all" ? undefined : kind,
        sort,
        includeReferences: !importMode,
      }),
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["managed-files"] });
    void client.invalidateQueries({ queryKey: ["managed-folders"] });
  };
  const act = useMutation({
    mutationFn: async (operation: () => Promise<unknown>) => operation(),
    onSuccess: () => refresh(),
    onError: (error) =>
      setNotice(error instanceof Error ? error.message : "操作失败"),
  });
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      let succeeded = 0;
      let failed = 0;
      for (const [index, file] of files.entries()) {
        setUploads((current) =>
          current.map((item, itemIndex) =>
            itemIndex === index ? { ...item, status: "uploading" } : item,
          ),
        );
        try {
          await uploadManagedFile(file, sourceProjectId, folderId);
          succeeded += 1;
          setUploads((current) =>
            current.map((item, itemIndex) =>
              itemIndex === index
                ? { ...item, status: "success", error: undefined }
                : item,
            ),
          );
        } catch (error) {
          failed += 1;
          setUploads((current) =>
            current.map((item, itemIndex) =>
              itemIndex === index
                ? {
                    ...item,
                    status: "error",
                    error: error instanceof Error ? error.message : "上传失败",
                  }
                : item,
            ),
          );
        }
      }
      return { succeeded, failed };
    },
    onSuccess: ({ succeeded, failed }) => {
      if (failed === 0) {
        setNotice(`已成功上传 ${succeeded} 个文件`);
      } else if (succeeded === 0) {
        setNotice("文件上传失败，请查看下方原因");
      } else {
        setNotice(`已上传 ${succeeded} 个文件，${failed} 个失败`);
      }
    },
    onSettled: () => refresh(),
  });
  const folders = useMemo(
    () => foldersQuery.data?.items ?? [],
    [foldersQuery.data?.items],
  );
  const childFolders = useMemo(
    () =>
      folders.filter((folder) =>
        folderId ? folder.parent_id === folderId : folder.parent_id === null,
      ),
    [folderId, folders],
  );
  const path = pathToFolder(folderId, folders);
  const setView = (next: ViewMode) => {
    setViewState(next);
    window.localStorage.setItem(VIEW_KEY, next);
  };
  const createNewFolder = () => {
    const name = window.prompt("文件夹名称");
    if (name?.trim())
      act.mutate(() => createFolder(name.trim(), sourceProjectId, folderId));
  };
  const renameFolder = (folder: ManagedFolder) => {
    const name = window.prompt("重命名文件夹", folder.name);
    if (name?.trim() && name.trim() !== folder.name)
      act.mutate(() => patchFolder(folder, { name: name.trim() }));
  };
  const renameFile = (file: ManagedFile) => {
    const name = window.prompt("重命名文件", file.display_name);
    if (name?.trim() && name.trim() !== file.display_name)
      act.mutate(() => patchManagedFile(file, { display_name: name.trim() }));
  };
  const uploadFiles = (files: FileList | null) => {
    if (!files?.length || upload.isPending) return;
    const selected = Array.from(files);
    setNotice("");
    setUploads(
      selected.map((file, index) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
        name: file.name,
        status: "queued",
      })),
    );
    upload.mutate(selected);
  };
  const completedUploads = uploads.filter(
    (item) => item.status === "success" || item.status === "error",
  ).length;
  const moveOptions = (currentFolderId: string | null) =>
    folders.filter((folder) => folder.id !== currentFolderId);
  const moveFile = (file: ManagedFile, target: string) =>
    act.mutate(() =>
      patchManagedFile(
        file,
        target === "root" ? { move_to_root: true } : { folder_id: target },
      ),
    );
  const downloadFile = async (file: ManagedFile) => {
    try {
      const blob = await fetchApiBlob(`/v1/files/${file.id}/download`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.original_filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "下载失败");
    }
  };

  return (
    <section className={`file-browser${compact ? " is-compact" : ""}`}>
      <div className="file-browser-toolbar">
        <div className="file-breadcrumb" aria-label="文件路径">
          <button type="button" onClick={() => setFolderId(undefined)}>
            {importMode ? "文件管理" : projectId ? "项目素材" : "全部文件"}
          </button>
          {path.map((folder) => (
            <span key={folder.id}>
              /{" "}
              <button onClick={() => setFolderId(folder.id)}>
                {folder.name}
              </button>
            </span>
          ))}
        </div>
        {!importMode ? (
          <div className="file-primary-actions">
            <button type="button" onClick={createNewFolder}>
              <FolderPlus aria-hidden /> 新建文件夹
            </button>
            <button
              type="button"
              className="primary"
              disabled={upload.isPending}
              onClick={() => fileInput.current?.click()}
            >
              {upload.isPending ? (
                <LoaderCircle className="spin" aria-hidden />
              ) : (
                <Upload aria-hidden />
              )}
              {upload.isPending
                ? `正在上传 ${completedUploads}/${uploads.length}`
                : "上传文件"}
            </button>
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
          </div>
        ) : null}
      </div>
      <div className="file-browser-filters">
        <label>
          <Search aria-hidden />
          <input
            aria-label="搜索文件"
            placeholder="搜索当前文件夹"
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
        <div className="file-view-toggle" role="group" aria-label="文件视图">
          <button
            aria-label="卡片视图"
            aria-pressed={view === "grid"}
            className={view === "grid" ? "active" : ""}
            onClick={() => setView("grid")}
          >
            <Grid2X2 aria-hidden />
          </button>
          <button
            aria-label="列表视图"
            aria-pressed={view === "list"}
            className={view === "list" ? "active" : ""}
            onClick={() => setView("list")}
          >
            <List aria-hidden />
          </button>
        </div>
      </div>
      {notice ? (
        <p className="file-notice" role="status">
          {notice}
        </p>
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
                  : "上传结果"}
              </strong>
              <span>支持图片、视频、音频、PDF 与文本文件，可一次选择多个</span>
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
      ) : childFolders.length || filesQuery.data?.items.length ? (
        <div className={`file-items ${view}`}>
          {childFolders.map((folder) => (
            <article
              className="file-folder-item"
              key={folder.id}
              onDoubleClick={() => setFolderId(folder.id)}
            >
              <button
                className="file-item-main"
                onClick={() => setFolderId(folder.id)}
              >
                <span className="file-item-preview">
                  <Folder aria-hidden />
                </span>
                <span className="file-item-copy">
                  <strong>{folder.name}</strong>
                  <small>文件夹</small>
                </span>
              </button>
              {!importMode ? (
                <div className="file-item-actions">
                  <select
                    aria-label={`移动文件夹 ${folder.name}`}
                    value={folder.parent_id ?? "root"}
                    onChange={(event) =>
                      act.mutate(() =>
                        patchFolder(
                          folder,
                          event.target.value === "root"
                            ? { move_to_root: true }
                            : { parent_id: event.target.value },
                        ),
                      )
                    }
                  >
                    <option value="root">根目录</option>
                    {folders
                      .filter((candidate) => candidate.id !== folder.id)
                      .map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.name}
                        </option>
                      ))}
                  </select>
                  <button
                    aria-label={`重命名 ${folder.name}`}
                    onClick={() => renameFolder(folder)}
                  >
                    <Pencil aria-hidden />
                  </button>
                  <button
                    aria-label={`删除 ${folder.name}`}
                    onClick={() => {
                      if (
                        window.confirm(`删除“${folder.name}”及其中全部内容？`)
                      )
                        act.mutate(() => deleteFolder(folder));
                    }}
                  >
                    <Trash2 aria-hidden />
                  </button>
                </div>
              ) : null}
            </article>
          ))}
          {(filesQuery.data?.items ?? []).map((file) => (
            <article
              className="file-asset-item"
              key={`${file.reference_id ?? "asset"}-${file.id}`}
            >
              <div className="file-item-main">
                <span className="file-item-preview">
                  <AssetPreview file={file} />
                </span>
                <span className="file-item-copy">
                  <strong title={file.display_name}>{file.display_name}</strong>
                  <small>
                    {kindLabel(file.media_kind)} · {formatBytes(file.byte_size)}
                    {file.is_reference ? " · 来自文件管理" : ""}
                  </small>
                </span>
              </div>
              <div className="file-item-actions">
                {importMode && projectId ? (
                  <button
                    className="text-action"
                    onClick={() =>
                      act.mutate(async () => {
                        await importFile(projectId, file.id);
                        onImported?.();
                        setNotice("已导入当前项目");
                      })
                    }
                  >
                    <Plus aria-hidden /> 导入
                  </button>
                ) : (
                  <>
                    <select
                      aria-label={`移动 ${file.display_name}`}
                      value={file.folder_id ?? "root"}
                      onChange={(event) => moveFile(file, event.target.value)}
                    >
                      <option value="root">根目录</option>
                      {moveOptions(file.folder_id).map((folder) => (
                        <option key={folder.id} value={folder.id}>
                          {folder.name}
                        </option>
                      ))}
                    </select>
                    <button
                      aria-label={`重命名 ${file.display_name}`}
                      onClick={() => renameFile(file)}
                    >
                      <Pencil aria-hidden />
                    </button>
                    <button
                      aria-label={`下载 ${file.display_name}`}
                      onClick={() => void downloadFile(file)}
                    >
                      <Download aria-hidden />
                    </button>
                    <button
                      aria-label={`${file.is_reference ? "移除引用" : "删除"} ${file.display_name}`}
                      onClick={() => {
                        if (
                          window.confirm(
                            file.is_reference
                              ? "从当前项目移除此引用？"
                              : `删除“${file.display_name}”？`,
                          )
                        )
                          act.mutate(() => deleteManagedFile(file));
                      }}
                    >
                      <Trash2 aria-hidden />
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="file-empty">
          <File aria-hidden />
          <strong>
            {importMode ? "文件管理中还没有可导入的文件" : "这个文件夹还是空的"}
          </strong>
          {!importMode ? (
            <button
              disabled={upload.isPending}
              onClick={() => fileInput.current?.click()}
            >
              <Upload aria-hidden /> 上传第一个文件
            </button>
          ) : null}
        </div>
      )}
      {act.isPending ? (
        <div className="file-busy" role="status">
          正在处理…
        </div>
      ) : null}
    </section>
  );
}
