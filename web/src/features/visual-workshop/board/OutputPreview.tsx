import { FileText, Image, Music, Video } from "lucide-react";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
import { visualAssetDownloadPath } from "../api";

export function OutputPreview({
  kind,
  assetId,
  text,
  compact = false,
}: {
  kind: "text" | "image" | "audio" | "video";
  assetId?: string | null;
  text?: string | null;
  compact?: boolean;
}) {
  const blob = useApiBlobUrl(
    assetId && (!compact || kind === "image")
      ? visualAssetDownloadPath(assetId)
      : undefined,
  );
  const Icon = { text: FileText, image: Image, audio: Music, video: Video }[
    kind
  ];
  if (kind === "text" && text)
    return compact ? (
      <FileText aria-hidden />
    ) : (
      <pre className="board-text-preview">{text}</pre>
    );
  if (blob.url && kind === "image")
    return <img src={blob.url} alt="输出预览" loading="lazy" />;
  if (blob.url && kind === "video")
    return <video src={blob.url} controls={!compact} preload="metadata" />;
  if (blob.url && kind === "audio" && !compact)
    return <audio src={blob.url} controls />;
  return (
    <div className="board-preview-placeholder">
      <Icon aria-hidden />
      {!compact && (
        <span>
          {blob.error ? "素材不可用" : assetId ? "加载素材…" : "暂无输出"}
        </span>
      )}
    </div>
  );
}
