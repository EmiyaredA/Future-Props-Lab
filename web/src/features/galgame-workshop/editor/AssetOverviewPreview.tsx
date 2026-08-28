import { useEffect, useRef, useState } from "react";
import { Film } from "lucide-react";
import { fetchApiBlob } from "@platform/api/client";
import { StoryAssetImage } from "@features/galgame-workshop/editor/StoryAssetImage";
import { StoryAudioPreview } from "@features/galgame-workshop/editor/StoryAudioPreview";
import {
  KIND_META,
  displayKind,
  type AssetItem,
} from "@features/galgame-workshop/editor/assetOverviewModel";

function VideoPreview({ fileId, label }: { fileId: string; label: string }) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    void fetchApiBlob(`/v1/files/${fileId}/content`)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (active) setUrl(objectUrl);
      })
      .catch(() => active && setUrl(""));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileId]);

  return url ? (
    <video src={url} aria-label={label} controls preload="metadata" />
  ) : (
    <Film aria-hidden />
  );
}

function ImagePreview({ item }: { item: AssetItem }) {
  const kind = displayKind(item);
  const Icon = KIND_META[kind].icon;
  return (
    <StoryAssetImage
      fileId={item.id}
      alt={item.display_name}
      fallback={<Icon aria-hidden />}
    />
  );
}

function DeferredImagePreview({ item }: { item: AssetItem }) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(
    () => typeof IntersectionObserver === "undefined",
  );
  const kind = displayKind(item);
  const Icon = KIND_META[kind].icon;

  useEffect(() => {
    const container = containerRef.current;
    if (visible || !container || typeof IntersectionObserver === "undefined")
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setVisible(true);
        observer.disconnect();
      },
      { rootMargin: "240px" },
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, [visible]);

  return (
    <span ref={containerRef} className="galgame-assets-result-preview">
      {visible ? <ImagePreview item={item} /> : <Icon aria-hidden />}
    </span>
  );
}

export function AssetOverviewPreview({
  item,
  compact = false,
}: {
  item: AssetItem;
  compact?: boolean;
}) {
  const kind = displayKind(item);
  const Icon = KIND_META[kind].icon;
  if (item.media_kind === "image")
    return compact ? (
      <DeferredImagePreview item={item} />
    ) : (
      <ImagePreview item={item} />
    );
  if (item.media_kind === "audio")
    return compact ? (
      <Icon aria-hidden />
    ) : (
      <StoryAudioPreview fileId={item.id} label={item.display_name} />
    );
  if (item.media_kind === "video" && !compact)
    return <VideoPreview fileId={item.id} label={item.display_name} />;
  return <Icon aria-hidden />;
}
