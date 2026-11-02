import { ImagePreview } from "@shared/ui/ImagePreview";
import "./output-preview.css";
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
    assetId && kind !== "image" && !compact
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
  if (assetId && kind === "image")
    return (
      <ImagePreview
        interactive={!compact}
        src={visualAssetDownloadPath(assetId)}
        size={compact ? 320 : 1280}
        alt="输出预览"
      />
    );
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
