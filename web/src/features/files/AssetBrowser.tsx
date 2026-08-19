import {
  type FormEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowDownAZ,
  CheckCircle2,
  Download,
  File,
  FileText,
  Filter,
  Folder,
  FolderOpen,
  FolderPlus,
  Grid2X2,
  Image,
  List,
  LoaderCircle,
  MoreHorizontal,
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
import { fileQueryKeys, invalidateFileScope } from "@features/files/queryKeys";
import "@features/files/files.css";

export type AssetViewMode = "grid" | "list";
type UploadStatus = "queued" | "uploading" | "success" | "error";
type UploadItem = {
  id: string;
  name: string;
  status: UploadStatus;
  error?: string;
};
type FileEditor =
  | { kind: "create-folder"; name: string }
  | { kind: "rename-folder"; folder: ManagedFolder; name: string }
  | { kind: "rename-file"; file: ManagedFile; name: string }
  | { kind: "move-folder"; folder: ManagedFolder; target: string }
  | { kind: "move-file"; file: ManagedFile; target: string }
  | { kind: "delete-folder"; folder: ManagedFolder }
  | { kind: "delete-file"; file: ManagedFile }
  | null;

const VIEW_KEY = "fpl_file_browser_view";
const ACCEPT =
  ".jpg,.jpeg,.png,.webp,.gif,.avif,.mp4,.webm,.mov,.mp3,.wav,.m4a,.ogg,.pdf,.txt,.md,.json";
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

function relativeUpdatedAt(value: string) {
  const elapsed = Date.now() - new Date(value).getTime();
  if (elapsed < 60_000) return "刚刚更新";
  if (elapsed < 3_600_000)
    return `${Math.max(1, Math.floor(elapsed / 60_000))} 分钟前更新`;
  if (elapsed < 86_400_000)
    return `${Math.floor(elapsed / 3_600_000)} 小时前更新`;
  if (elapsed < 604_800_000)
    return `${Math.floor(elapsed / 86_400_000)} 天前更新`;
  return `${new Date(value).toLocaleDateString("zh-CN")} 更新`;
}

function kindLabel(kind: MediaKind) {
  return {
    image: "图片",
    video: "视频",
    audio: "音频",
    font: "字体",
    document: "文档",
  }[kind];
}

function extensionLabel(file: ManagedFile) {
  const extension = file.original_filename.split(".").pop();
  return extension && extension !== file.original_filename
    ? extension.toUpperCase()
    : kindLabel(file.media_kind);
}

function originalExtension(file: ManagedFile) {
  const match = /(\.[^./\\]+)$/.exec(file.original_filename);
  return match?.[1] ?? "";
}

function stripOriginalExtension(name: string, file: ManagedFile) {
  const extension = originalExtension(file);
  const trimmed = name.trim();
  if (!extension || trimmed.length <= extension.length) return trimmed;
  return trimmed
    .toLocaleLowerCase("zh-CN")
    .endsWith(extension.toLocaleLowerCase("zh-CN"))
    ? trimmed.slice(0, -extension.length).trim()
    : trimmed;
}

function fileDisplayName(file: ManagedFile) {
  return stripOriginalExtension(file.display_name, file) || file.display_name;
}

function fileDownloadName(file: ManagedFile) {
  const baseName = fileDisplayName(file).replace(/[\\/]/g, "-").trim();
  const fallback = stripOriginalExtension(file.original_filename, file);
  return `${baseName || fallback || "download"}${originalExtension(file)}`;
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

function AssetPreviewDialog({
  file,
  onClose,
  onDownload,
}: {
  file: ManagedFile;
  onClose: () => void;
  onDownload: () => void;
}) {
  const titleId = useId();
  const [source, setSource] = useState("");
  const [failed, setFailed] = useState(false);
  const canInlinePreview =
    file.media_kind === "image" ||
    file.media_kind === "video" ||
    file.media_kind === "audio";

  useEffect(() => {
    if (!canInlinePreview) return;
    let active = true;
    let objectUrl = "";
    setSource("");
    setFailed(false);
    void fetchApiBlob(`/v1/files/${encodeURIComponent(file.id)}/content`)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [canInlinePreview, file.id]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div
      className="file-preview-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="file-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header>
          <div>
            <span>{kindLabel(file.media_kind)}预览</span>
            <h2 id={titleId}>{fileDisplayName(file)}</h2>
          </div>
          <button
            type="button"
            aria-label="关闭预览"
            title="关闭"
            onClick={onClose}
          >
            <X aria-hidden />
          </button>
        </header>
        <div className={`file-preview-stage ${file.media_kind}`}>
          {!canInlinePreview ? (
            <div className="file-preview-fallback">
              <FileKindIcon kind={file.media_kind} />
              <strong>{fileDisplayName(file)}</strong>
              <p>该文件类型暂不支持在线预览，可下载后查看。</p>
              <button type="button" onClick={onDownload}>
                <Download aria-hidden /> 下载文件
              </button>
            </div>
          ) : null}
          {canInlinePreview && !source && !failed ? (
            <span className="file-preview-state">
              <LoaderCircle className="spin" aria-hidden />
              正在加载预览…
            </span>
          ) : null}
          {canInlinePreview && failed ? (
            <span className="file-preview-state" role="alert">
              预览加载失败，请关闭后重试。
            </span>
          ) : null}
          {source && file.media_kind === "image" ? (
            <img src={source} alt={fileDisplayName(file)} />
          ) : null}
          {source && file.media_kind === "video" ? (
            <video src={source} controls />
          ) : null}
          {source && file.media_kind === "audio" ? (
            <div className="file-audio-preview">
              <Music aria-hidden />
              <strong>{fileDisplayName(file)}</strong>
              <audio src={source} controls />
            </div>
          ) : null}
        </div>
      </section>
    </div>
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

function folderOptionLabel(folder: ManagedFolder, folders: ManagedFolder[]) {
  return pathToFolder(folder.id, folders)
    .map((item) => item.name)
    .join(" / ");
}

function isFolderWithin(
  candidate: ManagedFolder,
  folderId: string,
  folders: ManagedFolder[],
) {
  let current: ManagedFolder | undefined = candidate;
  while (current) {
    if (current.id === folderId) return true;
    current = folders.find((folder) => folder.id === current?.parent_id);
  }
  return false;
}

function ItemActionMenu({
  id,
  label,
  open,
  deleteLabel,
  onToggle,
  onClose,
  onDownload,
  onRename,
  onMove,
  onDelete,
}: {
  id: string;
  label: string;
  open: boolean;
  deleteLabel: string;
  onToggle: () => void;
  onClose: () => void;
  onDownload?: () => void;
  onRename: () => void;
  onMove: () => void;
  onDelete: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnPointer = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", closeOnPointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnPointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose, open]);

  return (
    <div className={`file-item-menu${open ? " open" : ""}`} ref={root}>
      <button
        type="button"
        className="file-item-menu-trigger"
        aria-label={`更多操作 ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={onToggle}
      >
        <MoreHorizontal aria-hidden />
      </button>
      {open ? (
        <div className="file-item-menu-popover" id={id} role="menu">
          {onDownload ? (
            <button type="button" role="menuitem" onClick={onDownload}>
              <Download aria-hidden /> 下载
            </button>
          ) : null}
          <button type="button" role="menuitem" onClick={onRename}>
            <Pencil aria-hidden /> 重命名
          </button>
          <button type="button" role="menuitem" onClick={onMove}>
            <FolderOpen aria-hidden /> 移动到
          </button>
          <i aria-hidden />
          <button
            type="button"
            className="danger"
            role="menuitem"
            onClick={onDelete}
          >
            <Trash2 aria-hidden /> {deleteLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}

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
  const client = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const compactActions = useRef<HTMLDivElement>(null);
  const dialogTitleId = useId();
  const [folderId, setFolderId] = useState<string>();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | MediaKind>("all");
  const [sort, setSort] = useState<"updated" | "name">("updated");
  const [localView, setLocalView] = useState<AssetViewMode>(() =>
    window.localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid",
  );
  const view = viewMode ?? localView;
  const [compactFilterOpen, setCompactFilterOpen] = useState(false);
  const [compactAddOpen, setCompactAddOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [openMenu, setOpenMenu] = useState<string>();
  const [previewFile, setPreviewFile] = useState<ManagedFile>();
  const [editor, setEditor] = useState<FileEditor>(null);
  const [editorError, setEditorError] = useState("");
  const sourceProjectId = importMode ? undefined : projectId;
  const foldersQuery = useQuery({
    queryKey: fileQueryKeys.folders(sourceProjectId),
    queryFn: () => getFolders(sourceProjectId),
  });
  const filesQuery = useQuery({
    queryKey: fileQueryKeys.list({
      projectId: sourceProjectId,
      folderId,
      query,
      mediaKind: kind === "all" ? undefined : kind,
      sort,
      includeReferences: !importMode,
    }),
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
    void invalidateFileScope(client, sourceProjectId, { folders: true });
  };
  const act = useMutation({
    mutationFn: async (operation: () => Promise<unknown>) => operation(),
    onSuccess: () => {
      setEditor(null);
      setEditorError("");
      setOpenMenu(undefined);
      refresh();
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "操作失败";
      setEditorError(message);
      setNotice(message);
    },
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
        setUploads([]);
      } else if (succeeded === 0) {
        setNotice("文件上传失败，请查看下方原因");
        setUploads((current) =>
          current.filter((item) => item.status === "error"),
        );
      } else {
        setNotice(`已上传 ${succeeded} 个文件，${failed} 个失败`);
        setUploads((current) =>
          current.filter((item) => item.status === "error"),
        );
      }
    },
    onSettled: () => refresh(),
  });
  const folders = useMemo(
    () => foldersQuery.data?.items ?? [],
    [foldersQuery.data?.items],
  );
  const files = useMemo(
    () => filesQuery.data?.items ?? [],
    [filesQuery.data?.items],
  );
  const childFolders = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    return folders
      .filter((folder) =>
        folderId ? folder.parent_id === folderId : folder.parent_id === null,
      )
      .filter(
        (folder) =>
          !normalizedQuery ||
          folder.name.toLocaleLowerCase("zh-CN").includes(normalizedQuery),
      )
      .sort((left, right) =>
        sort === "name"
          ? left.name.localeCompare(right.name, "zh-CN")
          : Date.parse(right.updated_at) - Date.parse(left.updated_at),
      );
  }, [folderId, folders, query, sort]);
  const path = pathToFolder(folderId, folders);
  const completedUploads = uploads.filter(
    (item) => item.status === "success" || item.status === "error",
  ).length;
  const moveTargetOptions = useMemo<SelectOption[]>(() => {
    if (!editor || !editor.kind.startsWith("move-")) return [];
    const available =
      editor.kind === "move-folder"
        ? folders.filter(
            (folder) => !isFolderWithin(folder, editor.folder.id, folders),
          )
        : folders;
    return [
      { value: "root", label: "根目录" },
      ...available.map((folder) => ({
        value: folder.id,
        label: folderOptionLabel(folder, folders),
      })),
    ];
  }, [editor, folders]);

  useEffect(() => {
    if (!editor) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !act.isPending) {
        setEditor(null);
        setEditorError("");
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [act.isPending, editor]);

  useEffect(() => {
    window.localStorage.setItem(VIEW_KEY, view);
  }, [view]);

  useEffect(() => {
    if (!compactFilterOpen && !compactAddOpen) return;
    const closeOnPointer = (event: MouseEvent) => {
      if (!compactActions.current?.contains(event.target as Node)) {
        setCompactFilterOpen(false);
        setCompactAddOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCompactFilterOpen(false);
        setCompactAddOpen(false);
      }
    };
    document.addEventListener("mousedown", closeOnPointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnPointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [compactAddOpen, compactFilterOpen]);

  const setView = (next: AssetViewMode) => {
    setLocalView(next);
    onViewModeChange?.(next);
  };
  const openEditor = (next: Exclude<FileEditor, null>) => {
    setOpenMenu(undefined);
    setEditorError("");
    setEditor(next);
  };
  const closeEditor = () => {
    if (act.isPending) return;
    setEditor(null);
    setEditorError("");
  };
  const updateEditorName = (name: string) => {
    setEditor((current) => {
      if (
        !current ||
        !["create-folder", "rename-folder", "rename-file"].includes(
          current.kind,
        )
      )
        return current;
      return { ...current, name };
    });
  };
  const updateEditorTarget = (target: string) => {
    setEditor((current) => {
      if (
        !current ||
        (current.kind !== "move-folder" && current.kind !== "move-file")
      )
        return current;
      return { ...current, target };
    });
  };
  const submitEditor = (event?: FormEvent) => {
    event?.preventDefault();
    if (!editor || act.isPending) return;
    if (editor.kind === "create-folder") {
      const name = editor.name.trim();
      if (name) act.mutate(() => createFolder(name, sourceProjectId, folderId));
    } else if (editor.kind === "rename-folder") {
      const name = editor.name.trim();
      if (name && name !== editor.folder.name)
        act.mutate(() => patchFolder(editor.folder, { name }));
    } else if (editor.kind === "rename-file") {
      const name = stripOriginalExtension(editor.name, editor.file);
      if (
        name &&
        name !== stripOriginalExtension(editor.file.display_name, editor.file)
      )
        act.mutate(() => patchManagedFile(editor.file, { display_name: name }));
    } else if (editor.kind === "move-folder") {
      act.mutate(() =>
        patchFolder(
          editor.folder,
          editor.target === "root"
            ? { move_to_root: true }
            : { parent_id: editor.target },
        ),
      );
    } else if (editor.kind === "move-file") {
      act.mutate(() =>
        patchManagedFile(
          editor.file,
          editor.target === "root"
            ? { move_to_root: true }
            : { folder_id: editor.target },
        ),
      );
    } else if (editor.kind === "delete-folder") {
      act.mutate(() => deleteFolder(editor.folder));
    } else if (editor.kind === "delete-file") {
      act.mutate(() => deleteManagedFile(editor.file));
    }
  };
  const uploadFiles = (selectedFiles: FileList | null) => {
    if (!selectedFiles?.length || upload.isPending) return;
    const selected = Array.from(selectedFiles);
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
  const downloadFile = async (file: ManagedFile) => {
    try {
      const blob = await fetchApiBlob(`/v1/files/${file.id}/download`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileDownloadName(file);
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "下载失败");
    }
  };
  const hasItems = childFolders.length > 0 || files.length > 0;
  const showContent = hasItems || (!compact && !importMode);
  const noMatches = !hasItems && Boolean(query.trim() || kind !== "all");

  const editorTitle = editor
    ? {
        "create-folder": "新建文件夹",
        "rename-folder": "重命名文件夹",
        "rename-file": "重命名文件",
        "move-folder": "移动文件夹",
        "move-file": "移动文件",
        "delete-folder": "删除文件夹",
        "delete-file":
          editor.kind === "delete-file" && editor.file.is_reference
            ? "移除文件引用"
            : "删除文件",
      }[editor.kind]
    : "";
  const editorSubmitLabel = editor
    ? {
        "create-folder": "创建文件夹",
        "rename-folder": "保存名称",
        "rename-file": "保存名称",
        "move-folder": "确认移动",
        "move-file": "确认移动",
        "delete-folder": "确认删除",
        "delete-file":
          editor.kind === "delete-file" && editor.file.is_reference
            ? "移除引用"
            : "确认删除",
      }[editor.kind]
    : "";
  const editorSubmitDisabled = (() => {
    if (!editor) return true;
    if (editor.kind === "create-folder") return !editor.name.trim();
    if (editor.kind === "rename-folder")
      return !editor.name.trim() || editor.name.trim() === editor.folder.name;
    if (editor.kind === "rename-file")
      return (
        !stripOriginalExtension(editor.name, editor.file) ||
        stripOriginalExtension(editor.name, editor.file) ===
          stripOriginalExtension(editor.file.display_name, editor.file)
      );
    if (editor.kind === "move-folder")
      return editor.target === (editor.folder.parent_id ?? "root");
    if (editor.kind === "move-file")
      return editor.target === (editor.file.folder_id ?? "root");
    return false;
  })();

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
                  ? "支持图片、视频、音频、PDF、文本与 JSON 文件，可一次选择多个"
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
                  <small>图片、视频、音频、PDF 与文本文件</small>
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
                      {formatBytes(file.byte_size)}
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
        <div className="file-empty">
          <File aria-hidden />
          <strong>
            {importMode
              ? query.trim() || kind !== "all"
                ? "没有找到可导入的文件"
                : "文件管理中还没有可导入的文件"
              : "这个文件夹还是空的"}
          </strong>
          {!importMode ? (
            <button
              type="button"
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
