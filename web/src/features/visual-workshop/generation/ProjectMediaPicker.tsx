import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Check,
  Copy,
  FolderOpen,
  Image,
  LoaderCircle,
  Music,
  Upload,
  Video,
  X,
} from "lucide-react";
import {
  fileQueryKeys,
  getFiles,
  getFolders,
  invalidateFileScope,
  uploadManagedFile,
  type ManagedFile,
  type MediaKind,
} from "@features/files";
import { ApiError, fetchApiBlob } from "@platform/api/client";
import { MEDIA_ACCEPT } from "@features/visual-workshop/generation/options";
import { GenerationMediaPreview } from "@features/visual-workshop/generation/GenerationMediaPreview";
import { ProjectMediaSourceDialog } from "@features/visual-workshop/generation/ProjectMediaSourceDialog";

function uploadErrorMessage(error: unknown) {
  if (error instanceof ApiError) return error.problem.detail || error.message;
  return error instanceof Error ? error.message : "上传失败，请稍后重试。";
}

function GenerationMediaPreviewDialog({
  file,
  onClose,
}: {
  file: ManagedFile;
  onClose: () => void;
}) {
  const titleId = useId();
  const [source, setSource] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
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
  }, [file.id]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const kindLabel =
    file.media_kind === "video"
      ? "视频"
      : file.media_kind === "audio"
        ? "音频"
        : "图片";

  return (
    <div
      className="generation-media-preview-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="generation-media-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header>
          <div>
            <span>{kindLabel}预览</span>
            <h2 id={titleId}>{file.display_name}</h2>
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
        <div className={`generation-media-preview-stage ${file.media_kind}`}>
          {!source && !failed ? (
            <span className="generation-media-preview-state">
              <LoaderCircle className="spinning" aria-hidden />
              正在加载预览…
            </span>
          ) : null}
          {failed ? (
            <span className="generation-media-preview-state" role="alert">
              预览加载失败，请关闭后重试。
            </span>
          ) : null}
          {source && file.media_kind === "image" ? (
            <img src={source} alt={file.display_name} />
          ) : null}
          {source && file.media_kind === "video" ? (
            <video src={source} controls />
          ) : null}
          {source && file.media_kind === "audio" ? (
            <div className="generation-audio-preview">
              <Music aria-hidden />
              <strong>{file.display_name}</strong>
              <audio src={source} controls />
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export function ProjectMediaPicker({
  projectId,
  label,
  kind = "image",
  value,
  multiple = false,
  max = 1,
  minimal = false,
  uploadLast = false,
  onChange,
  onFilesLoaded,
  onInvalidSelection,
}: {
  projectId: string;
  label: string;
  kind?: Extract<MediaKind, "image" | "video" | "audio">;
  value: string[];
  multiple?: boolean;
  max?: number;
  minimal?: boolean;
  uploadLast?: boolean;
  onChange: (value: string[]) => void;
  onFilesLoaded?: (files: ManagedFile[]) => void;
  onInvalidSelection?: () => void;
}) {
  const client = useQueryClient();
  const uploadInput = useRef<HTMLInputElement>(null);
  const sourceTrigger = useRef<HTMLButtonElement>(null);
  const sourceMenuRef = useRef<HTMLDivElement>(null);
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [sourceMenuPosition, setSourceMenuPosition] = useState({
    top: 0,
    left: 0,
  });
  const [dialogMode, setDialogMode] = useState<"project" | "cross">();
  const [previewFile, setPreviewFile] = useState<ManagedFile>();
  const [optimisticFiles, setOptimisticFiles] = useState<ManagedFile[]>([]);
  const folders = useQuery({
    queryKey: fileQueryKeys.folders(projectId),
    queryFn: () => getFolders(projectId),
  });
  const folderIds = useMemo(
    () => [undefined, ...(folders.data?.items.map((item) => item.id) ?? [])],
    [folders.data],
  );
  const fileQueries = useQueries({
    queries: folderIds.map((folderId) => ({
      queryKey: fileQueryKeys.list({
        projectId,
        folderId,
        mediaKind: kind,
        includeReferences: true,
      }),
      queryFn: () =>
        getFiles({
          projectId,
          folderId,
          mediaKind: kind,
          includeReferences: true,
        }),
      enabled: !folders.isLoading,
    })),
  });
  const files = useMemo(() => {
    const unique = new Map<string, ManagedFile>();
    fileQueries.forEach((query) =>
      query.data?.items.forEach((file) => unique.set(file.id, file)),
    );
    optimisticFiles.forEach((file) => unique.set(file.id, file));
    return [...unique.values()].sort((left, right) =>
      left.display_name.localeCompare(right.display_name, "zh-CN"),
    );
  }, [fileQueries, optimisticFiles]);
  const loading =
    folders.isLoading || fileQueries.some((query) => query.isLoading);
  const selectionReady =
    folders.isSuccess &&
    !folders.isFetching &&
    fileQueries.every((query) => query.isSuccess && !query.isFetching);
  useEffect(() => {
    if (!selectionReady) return;
    onFilesLoaded?.(files);
    const available = new Set(files.map((file) => file.id));
    const valid = value.filter((assetId) => available.has(assetId));
    if (valid.length === value.length) return;
    onChange(valid);
    onInvalidSelection?.();
  }, [
    files,
    onChange,
    onFilesLoaded,
    onInvalidSelection,
    selectionReady,
    value,
  ]);
  const upload = useMutation({
    mutationFn: async (selected: File[]) => {
      const uploaded: ManagedFile[] = [];
      for (const file of selected)
        uploaded.push(await uploadManagedFile(file, projectId));
      return uploaded;
    },
    onSuccess: (uploaded) => {
      setOptimisticFiles((current) => [
        ...current.filter(
          (file) => !uploaded.some((item) => item.id === file.id),
        ),
        ...uploaded,
      ]);
      void invalidateFileScope(client, projectId);
      onFilesLoaded?.(uploaded);
      const ids = uploaded
        .filter((file) => file.media_kind === kind)
        .map((file) => file.id);
      onChange(
        multiple
          ? [...new Set([...value, ...ids])].slice(0, max)
          : ids.slice(-1),
      );
    },
  });
  const visibleFiles = minimal
    ? files.filter((file) => value.includes(file.id))
    : files;
  const UploadIcon =
    kind === "video" ? Video : kind === "audio" ? Music : Image;
  const remaining = Math.max(0, max - (multiple ? value.length : 0));

  useEffect(() => {
    if (!sourceMenuOpen) return;
    const trigger = sourceTrigger.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuHeight = 174;
    setSourceMenuPosition({
      top:
        rect.bottom + menuHeight + 6 <= window.innerHeight
          ? rect.bottom + 6
          : Math.max(8, rect.top - menuHeight - 6),
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 196)),
    });
    const firstItem = window.setTimeout(
      () =>
        sourceMenuRef.current
          ?.querySelector<HTMLButtonElement>("button")
          ?.focus(),
      0,
    );
    const closeOnPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !sourceMenuRef.current?.contains(target) &&
        !sourceTrigger.current?.contains(target)
      ) {
        setSourceMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSourceMenuOpen(false);
      sourceTrigger.current?.focus();
    };
    const closeOnViewportChange = () => setSourceMenuOpen(false);
    document.addEventListener("mousedown", closeOnPointer);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnViewportChange, true);
    return () => {
      window.clearTimeout(firstItem);
      document.removeEventListener("mousedown", closeOnPointer);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnViewportChange, true);
    };
  }, [sourceMenuOpen]);

  const uploadButton = (
    <button
      ref={sourceTrigger}
      type="button"
      className="generation-media-upload"
      aria-label={`上传${label}`}
      title={`上传${label}`}
      aria-haspopup="menu"
      aria-expanded={sourceMenuOpen}
      disabled={upload.isPending}
      onClick={() => setSourceMenuOpen((current) => !current)}
    >
      {upload.isPending ? (
        <LoaderCircle className="spinning" aria-hidden />
      ) : minimal ? (
        <UploadIcon aria-hidden />
      ) : (
        <Upload aria-hidden />
      )}
      <span className={minimal ? "sr-only" : undefined}>
        {upload.isPending ? "上传中" : "上传"}
      </span>
    </button>
  );
  const sourceMenu = sourceMenuOpen
    ? createPortal(
        <div
          ref={sourceMenuRef}
          className="generation-source-menu"
          role="menu"
          aria-label={`${label}来源`}
          style={sourceMenuPosition}
        >
          <button
            type="button"
            role="menuitem"
            disabled={remaining === 0}
            onClick={() => {
              setSourceMenuOpen(false);
              uploadInput.current?.click();
            }}
          >
            <Upload aria-hidden />
            <span>
              <strong>本地上传</strong>
              <small>从这台电脑选择文件</small>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setSourceMenuOpen(false);
              setDialogMode("project");
            }}
          >
            <FolderOpen aria-hidden />
            <span>
              <strong>本项目素材</strong>
              <small>选择当前项目已有素材</small>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={remaining === 0}
            onClick={() => {
              setSourceMenuOpen(false);
              setDialogMode("cross");
            }}
          >
            <Copy aria-hidden />
            <span>
              <strong>跨项目素材</strong>
              <small>从其他项目或公共库导入</small>
            </span>
          </button>
        </div>,
        document.body,
      )
    : null;

  return (
    <fieldset
      className={`generation-image-picker${minimal ? " is-minimal" : ""}`}
    >
      <legend className={minimal ? "sr-only" : undefined}>{label}</legend>
      <input
        ref={uploadInput}
        hidden
        type="file"
        multiple={multiple}
        accept={MEDIA_ACCEPT[kind]}
        onChange={(event) => {
          const remaining = Math.max(0, max - (multiple ? value.length : 0));
          const selected = [...(event.target.files ?? [])].slice(
            0,
            multiple ? remaining : 1,
          );
          if (selected.length) upload.mutate(selected);
          event.currentTarget.value = "";
        }}
      />
      {loading ? (
        <span className="generation-picker-state">
          <LoaderCircle className="spinning" aria-hidden />
          {minimal ? null : "正在读取项目素材…"}
        </span>
      ) : (
        <div className="generation-image-options">
          {minimal || uploadLast ? null : uploadButton}
          {visibleFiles.map((file) => {
            const selected = value.includes(file.id);
            if (minimal) {
              return (
                <span className="generation-media-card" key={file.id}>
                  <button
                    type="button"
                    className="generation-media-open selected"
                    aria-pressed="true"
                    aria-label={file.display_name}
                    title={`预览 ${file.display_name}`}
                    onClick={() => setPreviewFile(file)}
                  >
                    <span className="generation-media-preview">
                      <GenerationMediaPreview file={file} />
                    </span>
                  </button>
                  <button
                    type="button"
                    className="generation-media-remove"
                    aria-label={`移除参考文件 ${file.display_name}`}
                    title="移除参考文件"
                    onClick={() =>
                      onChange(value.filter((item) => item !== file.id))
                    }
                  />
                </span>
              );
            }
            return (
              <button
                type="button"
                className={selected ? "selected" : ""}
                aria-pressed={selected}
                aria-label={file.display_name}
                title={file.display_name}
                key={file.id}
                onClick={() => {
                  if (!multiple) {
                    onChange(selected ? [] : [file.id]);
                    return;
                  }
                  if (selected)
                    onChange(value.filter((item) => item !== file.id));
                  else if (value.length < max) onChange([...value, file.id]);
                }}
              >
                <span className="generation-media-preview">
                  <GenerationMediaPreview file={file} />
                </span>
                {minimal ? null : <span>{file.display_name}</span>}
                {!minimal && selected ? <Check aria-hidden /> : null}
              </button>
            );
          })}
          {minimal || uploadLast ? uploadButton : null}
        </div>
      )}
      {multiple && !minimal ? (
        <small>
          已选 {value.length}/{max}
        </small>
      ) : null}
      {upload.isError ? (
        <small className="generation-picker-error" role="alert">
          {uploadErrorMessage(upload.error)}
        </small>
      ) : null}
      {sourceMenu}
      {previewFile
        ? createPortal(
            <GenerationMediaPreviewDialog
              file={previewFile}
              onClose={() => setPreviewFile(undefined)}
            />,
            document.body,
          )
        : null}
      {dialogMode
        ? createPortal(
            <ProjectMediaSourceDialog
              mode={dialogMode}
              projectId={projectId}
              kind={kind}
              initialValue={dialogMode === "project" ? value : []}
              multiple={multiple}
              limit={dialogMode === "project" ? max : multiple ? remaining : 1}
              onClose={() => {
                setDialogMode(undefined);
                sourceTrigger.current?.focus();
              }}
              onConfirm={(ids, selectedFiles) => {
                if (dialogMode === "project") {
                  onChange(ids);
                } else {
                  setOptimisticFiles((current) => [
                    ...current.filter(
                      (file) =>
                        !selectedFiles.some((item) => item.id === file.id),
                    ),
                    ...selectedFiles,
                  ]);
                  onChange(
                    multiple
                      ? [...new Set([...value, ...ids])].slice(0, max)
                      : ids.slice(-1),
                  );
                  void invalidateFileScope(client, projectId);
                }
                onFilesLoaded?.(selectedFiles);
                setDialogMode(undefined);
                sourceTrigger.current?.focus();
              }}
            />,
            document.body,
          )
        : null}
    </fieldset>
  );
}
