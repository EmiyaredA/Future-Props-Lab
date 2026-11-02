import { useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  LoaderCircle,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
import { fetchApiBlob } from "@platform/api/client";
import { ResponsiveImage } from "@shared/ui/ResponsiveImage";
import { getFilePreview, type ManagedFile } from "./api";
import { fileQueryKeys } from "./queryKeys";
import { FileMediaPlayer } from "./FileMediaPlayer";
import { filePreviewKind } from "./filePreview";
import "./styles/file-content-preview.css";
import { fileDisplayName, fileDownloadName } from "./fileNames";

function PreviewContent({
  file,
  attempt,
  onRetry,
  onDownload,
}: {
  file: ManagedFile;
  attempt: number;
  onRetry: () => void;
  onDownload: () => void;
}) {
  const kind = filePreviewKind(file);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [decodeFailed, setDecodeFailed] = useState(false);
  const metadata = useQuery({
    queryKey: fileQueryKeys.preview(file.id, file.revision),
    queryFn: ({ signal }) => getFilePreview(file.id, signal),
    enabled: ["pdf", "text"].includes(kind),
    retry: false,
  });
  const id = encodeURIComponent(file.id);
  const path =
    kind === "pdf"
      ? `/v1/files/${id}/thumbnail?size=1280&page=${page}`
      : kind === "image"
        ? `/v1/files/${id}/${file.mime_type === "image/svg+xml" ? "content" : "thumbnail?size=1280"}`
        : ["video", "audio"].includes(kind)
          ? `/v1/files/${id}/content`
          : null;
  const blob = useApiBlobUrl(
    path
      ? `${path}${path.includes("?") ? "&" : "?"}revision=${file.revision}&attempt=${attempt}`
      : null,
  );
  const failed =
    blob.error ||
    decodeFailed ||
    (["text", "pdf"].includes(kind) && metadata.error);
  const loading =
    !failed &&
    (blob.loading || (["text", "pdf"].includes(kind) && metadata.isPending));
  return (
    <div className={`file-content-stage is-${kind}`}>
      {failed ? (
        <div className="file-content-state" role="alert">
          <p>预览失败，文件可能损坏、已加密或格式无法播放。</p>
          <button
            type="button"
            onClick={() => {
              if (kind === "text" || kind === "pdf") void metadata.refetch();
              onRetry();
            }}
          >
            重新加载预览
          </button>
          <button type="button" onClick={onDownload}>
            下载文件
          </button>
        </div>
      ) : loading ? (
        <div className="file-content-state" role="status">
          <LoaderCircle className="spin" aria-hidden />
          正在加载预览…
          {blob.progress && (
            <small>{Math.ceil(blob.progress.loaded / 1024)} KB 已加载</small>
          )}
        </div>
      ) : kind === "unsupported" ? (
        <div className="file-content-state">
          <strong>{file.original_filename}</strong>
          <p>
            {Math.ceil(file.byte_size / 1024)} KB ·
            该格式暂不支持在线预览，可下载后查看。
          </p>
          <button type="button" onClick={onDownload}>
            下载文件
          </button>
        </div>
      ) : kind === "text" ? (
        <>
          <pre className="file-document-text" tabIndex={0}>
            {metadata.data?.text || "空白文档"}
          </pre>
          {metadata.data?.truncated && (
            <p className="file-preview-note">
              仅展示前 64 KiB 内容，下载可查看完整文件。
            </p>
          )}
        </>
      ) : kind === "pdf" && blob.url ? (
        <>
          <div className="file-pdf-toolbar">
            <button
              type="button"
              aria-label="上一页"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft aria-hidden />
            </button>
            <span>
              第 {page} / {metadata.data?.page_count ?? 1} 页
            </span>
            <button
              type="button"
              aria-label="下一页"
              disabled={page >= (metadata.data?.page_count ?? 1)}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight aria-hidden />
            </button>
            <button
              type="button"
              aria-label="缩小"
              disabled={zoom <= 0.5}
              onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}
            >
              <ZoomOut aria-hidden />
            </button>
            <output>{Math.round(zoom * 100)}%</output>
            <button
              type="button"
              aria-label="放大"
              disabled={zoom >= 2}
              onClick={() => setZoom(Math.min(2, zoom + 0.25))}
            >
              <ZoomIn aria-hidden />
            </button>
          </div>
          <div
            className="file-pdf-page"
            tabIndex={0}
            aria-label={`PDF 第 ${page} 页`}
          >
            <img
              src={blob.url}
              alt={`第 ${page} 页`}
              style={{ width: `${zoom * 100}%`, maxWidth: "none" }}
              onError={() => setDecodeFailed(true)}
            />
          </div>
        </>
      ) : blob.url && kind === "image" ? (
        <ResponsiveImage src={blob.url} alt={fileDisplayName(file)} />
      ) : blob.url && ["video", "audio"].includes(kind) ? (
        <FileMediaPlayer
          file={file}
          source={blob.url}
          onError={() => setDecodeFailed(true)}
        />
      ) : null}
    </div>
  );
}

export function FilePreviewDialog({
  file,
  onClose,
  onDownload,
}: {
  file: ManagedFile;
  onClose: () => void;
  onDownload?: () => void | Promise<void>;
}) {
  const returnFocus = useRef(document.activeElement as HTMLElement | null);
  const [attempt, setAttempt] = useState(0);
  const [downloadState, setDownloadState] = useState("");
  const download = async () => {
    if (downloadState === "正在下载…") return;
    setDownloadState("正在下载…");
    try {
      if (onDownload) await onDownload();
      else {
        const blob = await fetchApiBlob(
          `/v1/files/${encodeURIComponent(file.id)}/download`,
        );
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = fileDownloadName(file);
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setDownloadState("");
    } catch {
      setDownloadState("下载失败，请重试。");
    }
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="file-content-overlay" />
        <Dialog.Content
          className="file-content-dialog"
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (returnFocus.current?.isConnected) returnFocus.current.focus();
          }}
        >
          <header>
            <Dialog.Title>{fileDisplayName(file)}</Dialog.Title>
            <button
              type="button"
              onClick={() => void download()}
              aria-label="下载文件"
              disabled={downloadState === "正在下载…"}
            >
              <Download aria-hidden />
            </button>
            <Dialog.Close aria-label="关闭预览">
              <X aria-hidden />
            </Dialog.Close>
          </header>
          <PreviewContent
            key={`${file.id}:${attempt}`}
            file={file}
            attempt={attempt}
            onRetry={() => setAttempt(attempt + 1)}
            onDownload={() => void download()}
          />
          {downloadState && (
            <p className="file-preview-note" role="status">
              {downloadState}
            </p>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
