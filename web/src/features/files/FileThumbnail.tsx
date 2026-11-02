import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, LoaderCircle } from "lucide-react";
import { useVisibleApiBlobUrl } from "@platform/api/useVisibleApiBlobUrl";
import { ResponsiveImage } from "@shared/ui/ResponsiveImage";
import { getFilePreview, type ManagedFile } from "./api";
import { fileQueryKeys } from "./queryKeys";
import "./styles/file-content-preview.css";
import { filePreviewKind, previewTime } from "./filePreview";

export function FileThumbnail({ file }: { file: ManagedFile }) {
  const [failedSource, setFailedSource] = useState("");
  const kind = filePreviewKind(file);
  const visual = ["image", "video", "audio", "pdf"].includes(kind);
  const { ref, visible, url, loading, error } = useVisibleApiBlobUrl(
    visual
      ? `/v1/files/${encodeURIComponent(file.id)}/thumbnail?size=320&revision=${file.revision}`
      : null,
  );
  const metadata = useQuery({
    queryKey: fileQueryKeys.preview(file.id, file.revision),
    queryFn: ({ signal }) => getFilePreview(file.id, signal),
    enabled: visible && ["text", "audio", "video"].includes(kind),
    staleTime: 60_000,
    retry: false,
  });
  const failed =
    error ||
    (url && failedSource === url) ||
    (kind === "text" && metadata.error);
  return (
    <div ref={ref} className={`file-content-thumbnail is-${kind}`}>
      {failed ? (
        <span className="file-thumbnail-message">预览失败，点击重试</span>
      ) : visual ? (
        url ? (
          <ResponsiveImage
            src={url}
            alt=""
            decoding="async"
            onError={() => setFailedSource(url)}
          />
        ) : (
          <span className="file-thumbnail-message">
            <LoaderCircle className="spin" aria-hidden />
            {loading ? "加载预览…" : "等待预览"}
          </span>
        )
      ) : kind === "text" ? (
        metadata.isPending ? (
          <span className="file-thumbnail-message">加载正文…</span>
        ) : (
          <pre>{metadata.data?.text || "空白文档"}</pre>
        )
      ) : (
        <span className="file-thumbnail-information">
          <FileText aria-hidden />
          <strong>
            {file.original_filename?.split(".").pop()?.toUpperCase() || "文件"}
          </strong>
          <small>{Math.ceil((file.byte_size || 0) / 1024)} KB · 下载查看</small>
        </span>
      )}
      {url && kind === "video" && (
        <span className="file-thumbnail-caption">
          视频 ·{" "}
          {metadata.data?.duration_seconds != null
            ? previewTime(metadata.data.duration_seconds)
            : "点击播放"}
        </span>
      )}
      {url && kind === "audio" && (
        <span className="file-thumbnail-caption">
          {metadata.data?.waveform_seconds != null
            ? `前 ${Math.ceil(metadata.data.waveform_seconds)} 秒波形`
            : "前 60 秒波形"}
          {metadata.data?.duration_seconds != null
            ? ` · 全长 ${previewTime(metadata.data.duration_seconds)}`
            : ""}
        </span>
      )}
      {url && kind === "pdf" && (
        <span className="file-thumbnail-caption">PDF · 第 1 页</span>
      )}
    </div>
  );
}
