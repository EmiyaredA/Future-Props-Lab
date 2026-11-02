import { useEffect, useRef, useState } from "react";
import { Film } from "lucide-react";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
import { ImagePreview as AssetImagePreview } from "@shared/ui/ImagePreview";
import { StoryAudioPreview } from "@features/galgame-workshop/editor/StoryAudioPreview";
import {
  KIND_META,
  displayKind,
  type AssetItem,
} from "@features/galgame-workshop/editor/assetOverviewModel";

function VideoPreview({ fileId, label }: { fileId: string; label: string }) {
  const { url } = useApiBlobUrl(`/v1/files/${fileId}/content`);

  return url ? (
    <video src={url} aria-label={label} controls preload="metadata" />
  ) : (
    <Film aria-hidden />
  );
}

function ImagePreview({ item }: { item: AssetItem }) {
  return (
    <AssetImagePreview
      interactive={false}
      src={`/v1/files/${item.id}/content`}
      size={320}
      alt={item.display_name}
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
