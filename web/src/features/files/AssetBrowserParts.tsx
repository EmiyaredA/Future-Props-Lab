/* eslint-disable react-refresh/only-export-components */
import { useEffect, useId, useRef } from "react";
import {
  Download,
  FileText,
  FolderOpen,
  Image,
  LoaderCircle,
  MoreHorizontal,
  Music,
  Pencil,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
import type { SelectOption } from "@shared/ui/CustomSelect";
import type {
  ManagedFile,
  ManagedFolder,
  MediaKind,
} from "@features/files/api";

export type AssetViewMode = "grid" | "list";
export type UploadStatus = "queued" | "uploading" | "success" | "error";
export type UploadItem = {
  id: string;
  name: string;
  status: UploadStatus;
  error?: string;
};
export type FileEditor =
  | { kind: "create-folder"; name: string }
  | { kind: "rename-folder"; folder: ManagedFolder; name: string }
  | { kind: "rename-file"; file: ManagedFile; name: string }
  | { kind: "move-folder"; folder: ManagedFolder; target: string }
  | { kind: "move-file"; file: ManagedFile; target: string }
  | { kind: "delete-folder"; folder: ManagedFolder }
  | { kind: "delete-file"; file: ManagedFile }
  | null;

export const VIEW_KEY = "fpl_file_browser_view";
export const ACCEPT =
  ".jpg,.jpeg,.png,.webp,.gif,.avif,.mp4,.webm,.mov,.mp3,.wav,.m4a,.ogg,.pdf,.txt,.md,.json,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.zip";
export const KIND_OPTIONS: SelectOption[] = [
  { value: "all", label: "全部类型" },
  { value: "image", label: "图片" },
  { value: "video", label: "视频" },
  { value: "audio", label: "音频" },
  { value: "document", label: "文档" },
];
export const SORT_OPTIONS: SelectOption[] = [
  { value: "updated", label: "最近更新" },
  { value: "name", label: "按名称" },
];

export function uploadStatusLabel(status: UploadStatus) {
  return {
    queued: "等待上传",
    uploading: "上传中",
    success: "上传成功",
    error: "上传失败",
  }[status];
}

export function relativeUpdatedAt(value: string) {
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

export function kindLabel(kind: MediaKind) {
  return {
    image: "图片",
    video: "视频",
    audio: "音频",
    font: "字体",
    document: "文档",
  }[kind];
}

export function extensionLabel(file: ManagedFile) {
  const extension = file.original_filename.split(".").pop();
  return extension && extension !== file.original_filename
    ? extension.toUpperCase()
    : kindLabel(file.media_kind);
}

export function originalExtension(file: ManagedFile) {
  const match = /(\.[^./\\]+)$/.exec(file.original_filename);
  return match?.[1] ?? "";
}

export function stripOriginalExtension(name: string, file: ManagedFile) {
  const extension = originalExtension(file);
  const trimmed = name.trim();
  if (!extension || trimmed.length <= extension.length) return trimmed;
  return trimmed
    .toLocaleLowerCase("zh-CN")
    .endsWith(extension.toLocaleLowerCase("zh-CN"))
    ? trimmed.slice(0, -extension.length).trim()
    : trimmed;
}

export function fileDisplayName(file: ManagedFile) {
  return stripOriginalExtension(file.display_name, file) || file.display_name;
}

export function fileDownloadName(file: ManagedFile) {
  const baseName = fileDisplayName(file).replace(/[\\/]/g, "-").trim();
  const fallback = stripOriginalExtension(file.original_filename, file);
  return `${baseName || fallback || "download"}${originalExtension(file)}`;
}

export function FileKindIcon({ kind }: { kind: MediaKind }) {
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

export function AssetPreview({ file }: { file: ManagedFile }) {
  const { url } = useApiBlobUrl(
    file.media_kind === "image" ? `/v1/files/${file.id}/content` : null,
  );
  return url ? (
    <img src={url} alt="" />
  ) : (
    <span>
      <FileKindIcon kind={file.media_kind} />
    </span>
  );
}

export function AssetPreviewDialog({
  file,
  onClose,
  onDownload,
}: {
  file: ManagedFile;
  onClose: () => void;
  onDownload: () => void;
}) {
  const titleId = useId();
  const canInlinePreview =
    file.media_kind === "image" ||
    file.media_kind === "video" ||
    file.media_kind === "audio";
  const { url: source, error } = useApiBlobUrl(
    canInlinePreview
      ? `/v1/files/${encodeURIComponent(file.id)}/content`
      : null,
  );
  const failed = Boolean(error);

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

export function pathToFolder(
  folderId: string | undefined,
  folders: ManagedFolder[],
) {
  const path: ManagedFolder[] = [];
  let current = folders.find((folder) => folder.id === folderId);
  while (current) {
    path.unshift(current);
    current = folders.find((folder) => folder.id === current?.parent_id);
  }
  return path;
}

export function folderOptionLabel(
  folder: ManagedFolder,
  folders: ManagedFolder[],
) {
  return pathToFolder(folder.id, folders)
    .map((item) => item.name)
    .join(" / ");
}

export function isFolderWithin(
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

export function ItemActionMenu({
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
