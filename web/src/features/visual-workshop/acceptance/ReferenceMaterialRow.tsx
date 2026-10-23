import { useEffect, useRef, useState, type ReactNode } from "react";
import { FileImage, FileText, Music, Video } from "lucide-react";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
import { visualAssetDownloadPath } from "../api";

function ThumbnailMedia({
  url,
  error,
  kind,
  alt,
}: {
  url: string;
  error: boolean;
  kind?: string;
  alt: string;
}) {
  const [broken, setBroken] = useState("");
  const [videoFallback, setVideoFallback] = useState("");
  return (
    <span className="acceptance-thumbnail">
      {url && broken !== url ? (
        kind === "video" || videoFallback === url ? (
          <video
            src={url}
            muted
            playsInline
            preload="metadata"
            aria-label={alt}
            onError={() => setBroken(url)}
          />
        ) : (
          <img
            src={url}
            alt={alt}
            onError={() => (kind ? setBroken(url) : setVideoFallback(url))}
          />
        )
      ) : (
        <span>
          <FileImage size={18} />
          <small>{error ? "不可读取" : broken ? "无预览" : "加载中"}</small>
        </span>
      )}
    </span>
  );
}

export function AcceptanceThumbnail({
  assetId,
  kind,
  alt = "参考素材",
}: {
  assetId: string;
  kind?: string;
  alt?: string;
}) {
  const blob = useApiBlobUrl(visualAssetDownloadPath(assetId));
  return (
    <ThumbnailMedia
      url={blob.url}
      error={Boolean(blob.error)}
      kind={kind}
      alt={alt}
    />
  );
}

function materialMediaLabel(kind?: string, mimeType?: string) {
  const mime = mimeType?.split(";")[0].toLowerCase();
  const category =
    kind === "video" || mime?.startsWith("video/")
      ? "视频"
      : kind === "image" || mime?.startsWith("image/")
        ? "图片"
        : kind === "audio" || mime?.startsWith("audio/")
          ? "音频"
          : kind === "text" || mime?.startsWith("text/")
            ? "文本"
            : "素材";
  const aliases: Record<string, string> = {
    "image/jpeg": "JPEG",
    "image/svg+xml": "SVG",
    "video/quicktime": "MOV",
    "video/x-matroska": "MKV",
    "video/x-msvideo": "AVI",
    "video/x-m4v": "M4V",
  };
  const format =
    mime?.startsWith("image/") || mime?.startsWith("video/")
      ? aliases[mime] || mime.split("/")[1].toUpperCase()
      : "";
  return format ? `${category} · ${format}` : category;
}

export function ReferenceMaterialRow({
  assetId,
  kind,
  title,
  description,
  status,
  selection,
  children,
}: {
  assetId?: string | null;
  kind?: string;
  title: string;
  description: string;
  status?: string;
  selection?: {
    label: string;
    disabled?: boolean;
    selected?: boolean;
    onSelect: () => void;
  };
  children?: ReactNode;
}) {
  const row = useRef<HTMLLIElement>(null);
  const [visible, setVisible] = useState(
    typeof IntersectionObserver === "undefined",
  );
  useEffect(() => {
    if (!row.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(entry.isIntersecting),
    );
    observer.observe(row.current);
    return () => observer.disconnect();
  }, []);
  const visual = kind !== "audio" && kind !== "text";
  const blob = useApiBlobUrl(
    visible && assetId && visual ? visualAssetDownloadPath(assetId) : null,
  );
  const label = materialMediaLabel(kind, blob.mimeType);
  const Icon =
    kind === "video"
      ? Video
      : kind === "audio"
        ? Music
        : kind === "text"
          ? FileText
          : FileImage;
  const content = (
    <>
      {assetId && visual ? (
        <ThumbnailMedia
          url={blob.url}
          error={Boolean(blob.error)}
          kind={kind}
          alt=""
        />
      ) : (
        <span className="acceptance-thumbnail" aria-hidden="true">
          <Icon size={20} />
        </span>
      )}
      <span className="acceptance-reference-copy">
        <strong title={title}>{title}</strong>
        <small>
          {label}
          {status ? ` · ${status}` : ""}
        </small>
        {description && <small>{description}</small>}
      </span>
    </>
  );
  return (
    <li ref={row} className="acceptance-reference-row" aria-label={title}>
      {selection ? (
        <button
          type="button"
          className="acceptance-reference-select"
          aria-label={selection.label}
          aria-pressed={selection.selected}
          disabled={selection.disabled}
          onClick={selection.onSelect}
        >
          {content}
        </button>
      ) : (
        <div className="acceptance-reference-summary">{content}</div>
      )}
      {children}
    </li>
  );
}
