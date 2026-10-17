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
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
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
import { apiErrorMessage } from "@platform/api/errors";
import { fetchApiDownload } from "@platform/api/client";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
import { visualAssetDownloadPath } from "@features/visual-workshop/api";
import { MEDIA_ACCEPT } from "@features/visual-workshop/generation/options";
import { GenerationMediaPreview } from "@features/visual-workshop/generation/GenerationMediaPreview";
import { ProjectMediaSourceDialog } from "@features/visual-workshop/generation/ProjectMediaSourceDialog";
import {
  moveReference,
  orderedReferenceIds,
} from "@features/visual-workshop/generation/referenceOrder";
import { ReferenceDropNotice } from "./ReferenceDropNotice";
import {
  useProjectReferenceDrop,
  type ReferenceDropNotice as ReferenceDropNoticeState,
} from "./useProjectReferenceDrop";

function uploadErrorMessage(error: unknown) {
  return apiErrorMessage(error, "上传失败，请稍后重试。");
}

function GenerationMediaPreviewDialog({
  file,
  onClose,
}: {
  file: ManagedFile;
  onClose: () => void;
}) {
  const titleId = useId();
  const { url: source, error } = useApiBlobUrl(
    `/v1/files/${encodeURIComponent(file.id)}/content`,
  );
  const failed = Boolean(error);
  const download = useMutation({
    mutationFn: async () => {
      const result = await fetchApiDownload(visualAssetDownloadPath(file.id));
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      try {
        anchor.href = url;
        anchor.download = result.filename || file.original_filename;
        document.body.append(anchor);
        anchor.click();
      } finally {
        anchor.remove();
        URL.revokeObjectURL(url);
      }
    },
    retry: false,
  });

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
          <div className="generation-media-preview-actions">
            <button
              type="button"
              className="generation-media-preview-download"
              aria-label="下载当前预览素材"
              title="下载当前预览素材"
              disabled={download.isPending}
              onClick={() => download.mutate()}
            >
              {download.isPending ? (
                <LoaderCircle className="spinning" aria-hidden />
              ) : (
                <Download aria-hidden />
              )}
              {download.isPending ? "下载中…" : "下载"}
            </button>
            <button
              type="button"
              aria-label="关闭预览"
              title="关闭"
              onClick={onClose}
            >
              <X aria-hidden />
            </button>
          </div>
        </header>
        {download.isError ? (
          <p className="generation-picker-error" role="alert">
            {apiErrorMessage(download.error, "下载失败，请重试。")}
          </p>
        ) : null}
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
  linkedValue = [],
  multiple = false,
  max = 1,
  minimal = false,
  showLabel = false,
  uploadLast = false,
  disabled = false,
  excludedAssetIds = [],
  onChange,
  onReorder,
  onFilesLoaded,
  onInvalidSelection,
  onDropResult,
}: {
  projectId: string;
  label: string;
  kind?: Extract<MediaKind, "image" | "video" | "audio">;
  value: string[];
  linkedValue?: string[];
  multiple?: boolean;
  max?: number;
  minimal?: boolean;
  showLabel?: boolean;
  uploadLast?: boolean;
  disabled?: boolean;
  excludedAssetIds?: string[];
  onChange: (value: string[]) => void;
  onReorder?: (value: string[]) => void;
  onFilesLoaded?: (files: ManagedFile[]) => void;
  onInvalidSelection?: () => void;
  onDropResult?: (notice: ReferenceDropNoticeState) => void;
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
  const draggedId = useRef<string | undefined>(undefined);
  const [dropTarget, setDropTarget] = useState<string>();
  const [orderNotice, setOrderNotice] = useState("");
  const linkedIds = useMemo(() => [...new Set(linkedValue)], [linkedValue]);
  const linkedSet = useMemo(() => new Set(linkedIds), [linkedIds]);
  const manualIds = useMemo(() => [...new Set(value)], [value]);
  const combinedValue = useMemo(
    () => orderedReferenceIds(manualIds, linkedIds),
    [linkedIds, manualIds],
  );
  const reorder = (from: string, to: string) => {
    if (disabled || !onReorder) return;
    const next = moveReference(combinedValue, from, to);
    if (next === combinedValue) return;
    onReorder(next);
    setOrderNotice(
      `图片已移至第 ${next.indexOf(from) + 1} 位，提示词图片编号已同步。`,
    );
  };
  const manualLimit = Math.max(0, max - linkedIds.length);
  const remaining = Math.max(0, max - combinedValue.length);
  const canReplaceManual = !multiple && linkedIds.length === 0;
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
    const valid = value.filter(
      (assetId) =>
        available.has(assetId) && !excludedAssetIds.includes(assetId),
    );
    if (valid.length === value.length) return;
    onChange(valid);
    if (value.some((id) => !available.has(id))) onInvalidSelection?.();
  }, [
    files,
    excludedAssetIds,
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
      if (!multiple) {
        onChange(linkedIds.length ? value : ids.slice(-1));
        return;
      }
      const next = [...manualIds];
      const occupied = new Set(combinedValue);
      ids.forEach((id) => {
        if (occupied.has(id) || occupied.size >= max) return;
        occupied.add(id);
        next.push(id);
      });
      onChange(next);
    },
  });
  const referenceDrop = useProjectReferenceDrop({
    projectId,
    files,
    excludedAssetIds,
    onResult: onDropResult,
    selections: [
      {
        kind,
        value,
        linkedValue,
        multiple,
        max,
        disabled: disabled || upload.isPending,
        onChange,
      },
    ],
  });
  const visibleFiles = useMemo(() => {
    if (!minimal)
      return files.filter((file) => !excludedAssetIds.includes(file.id));
    const byId = new Map(files.map((file) => [file.id, file]));
    return combinedValue.flatMap((id) => {
      const file = byId.get(id);
      return file ? [file] : [];
    });
  }, [combinedValue, files, minimal, excludedAssetIds]);
  const UploadIcon =
    kind === "video" ? Video : kind === "audio" ? Music : Image;

  useEffect(() => {
    if (disabled) setSourceMenuOpen(false);
  }, [disabled]);

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
      disabled={
        disabled || upload.isPending || (remaining === 0 && !canReplaceManual)
      }
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
            disabled={remaining === 0 && !canReplaceManual}
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
            disabled={manualLimit === 0}
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
            disabled={remaining === 0 && !canReplaceManual}
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
      className={`generation-image-picker${minimal ? " is-minimal" : ""}${disabled ? " is-disabled" : ""}${referenceDrop.active ? " is-reference-dragover" : ""}`}
      {...referenceDrop.handlers}
      disabled={disabled}
      aria-disabled={disabled}
    >
      <legend className={minimal && !showLabel ? "sr-only" : undefined}>
        {label}
      </legend>
      <input
        ref={uploadInput}
        hidden
        type="file"
        disabled={disabled}
        multiple={multiple}
        accept={MEDIA_ACCEPT[kind]}
        onChange={(event) => {
          const selected = [...(event.target.files ?? [])].slice(
            0,
            multiple ? remaining : canReplaceManual ? 1 : remaining,
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
        <div
          className={`generation-image-options${onReorder ? " has-reference-order" : ""}`}
        >
          {minimal || uploadLast ? null : uploadButton}
          {visibleFiles.map((file) => {
            const linked = linkedSet.has(file.id);
            const selected = combinedValue.includes(file.id);
            const index = combinedValue.indexOf(file.id);
            if (minimal) {
              return (
                <span
                  className={`generation-media-card${linked ? " is-linked" : ""}`}
                  key={file.id}
                  data-linked-reference={linked || undefined}
                  data-reference-position={onReorder ? index + 1 : undefined}
                  data-drop-target={dropTarget === file.id || undefined}
                  draggable={Boolean(onReorder && !disabled)}
                  onDragStart={
                    onReorder
                      ? (event) => {
                          event.stopPropagation();
                          draggedId.current = file.id;
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", file.id);
                        }
                      : undefined
                  }
                  onDragOver={
                    onReorder
                      ? (event) => {
                          if (disabled || !draggedId.current) return;
                          event.preventDefault();
                          event.stopPropagation();
                          event.dataTransfer.dropEffect = "move";
                          setDropTarget(file.id);
                        }
                      : undefined
                  }
                  onDrop={
                    onReorder
                      ? (event) => {
                          if (!draggedId.current) return;
                          event.preventDefault();
                          event.stopPropagation();
                          reorder(draggedId.current, file.id);
                          draggedId.current = undefined;
                          setDropTarget(undefined);
                        }
                      : undefined
                  }
                  onDragEnd={() => {
                    draggedId.current = undefined;
                    setDropTarget(undefined);
                  }}
                >
                  {onReorder ? (
                    <span
                      className="reference-order-number"
                      aria-label={`图片 ${index + 1}`}
                    >
                      {index + 1}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="generation-media-open selected"
                    aria-pressed="true"
                    aria-label={file.display_name}
                    disabled={disabled && !linked}
                    title={
                      linked
                        ? `预览 ${file.display_name}（由画布连线引用）`
                        : `预览 ${file.display_name}`
                    }
                    onClick={() => setPreviewFile(file)}
                  >
                    <span className="generation-media-preview">
                      <GenerationMediaPreview file={file} />
                    </span>
                  </button>
                  {linked ? null : (
                    <button
                      type="button"
                      className="generation-media-remove"
                      aria-label={`移除参考文件 ${file.display_name}`}
                      title="移除参考文件"
                      disabled={disabled}
                      onClick={() =>
                        onChange(value.filter((item) => item !== file.id))
                      }
                    />
                  )}
                  {onReorder ? (
                    <span className="reference-order-actions">
                      <button
                        type="button"
                        aria-label={`前移 ${file.display_name}`}
                        title="前移（自动更新图片编号）"
                        disabled={disabled || index === 0}
                        onClick={() =>
                          reorder(file.id, combinedValue[index - 1])
                        }
                      >
                        <ChevronLeft aria-hidden />
                      </button>
                      <button
                        type="button"
                        aria-label={`后移 ${file.display_name}`}
                        title="后移（自动更新图片编号）"
                        disabled={
                          disabled || index === combinedValue.length - 1
                        }
                        onClick={() =>
                          reorder(file.id, combinedValue[index + 1])
                        }
                      >
                        <ChevronRight aria-hidden />
                      </button>
                    </span>
                  ) : null}
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
                disabled={disabled && !linked}
                key={file.id}
                onClick={() => {
                  if (linked) {
                    setPreviewFile(file);
                    return;
                  }
                  if (!multiple) {
                    onChange(selected ? [] : [file.id]);
                    return;
                  }
                  if (selected)
                    onChange(value.filter((item) => item !== file.id));
                  else if (combinedValue.length < max)
                    onChange([...value, file.id]);
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
          已选 {combinedValue.length}/{max}
        </small>
      ) : null}
      {onReorder ? (
        <span className="sr-only" role="status">
          {orderNotice}
        </span>
      ) : null}
      {upload.isError ? (
        <small className="generation-picker-error" role="alert">
          {uploadErrorMessage(upload.error)}
        </small>
      ) : null}
      {onDropResult ? null : (
        <ReferenceDropNotice notice={referenceDrop.notice} />
      )}
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
              excludedAssetIds={excludedAssetIds}
              initialValue={
                dialogMode === "project"
                  ? manualIds.filter((id) => !linkedSet.has(id))
                  : []
              }
              multiple={multiple}
              limit={
                dialogMode === "project"
                  ? manualLimit
                  : multiple
                    ? remaining
                    : 1
              }
              onClose={() => {
                setDialogMode(undefined);
                sourceTrigger.current?.focus();
              }}
              onConfirm={(ids, selectedFiles) => {
                if (dialogMode === "project") {
                  onChange(
                    orderedReferenceIds(
                      combinedValue.filter(
                        (id) => linkedSet.has(id) || ids.includes(id),
                      ),
                      ids,
                    ),
                  );
                } else {
                  setOptimisticFiles((current) => [
                    ...current.filter(
                      (file) =>
                        !selectedFiles.some((item) => item.id === file.id),
                    ),
                    ...selectedFiles,
                  ]);
                  if (!multiple) {
                    onChange(linkedIds.length ? value : ids.slice(-1));
                  } else {
                    const next = [...manualIds];
                    const occupied = new Set(combinedValue);
                    ids.forEach((id) => {
                      if (occupied.has(id) || occupied.size >= max) return;
                      occupied.add(id);
                      next.push(id);
                    });
                    onChange(next);
                  }
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
