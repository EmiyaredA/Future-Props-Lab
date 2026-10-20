import { useEffect, useRef, useState } from "react";
import { Play, Pause, Volume2 } from "lucide-react";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
import type { SlideElement } from "../types";
import "./objects.css";

export function ManagedMedia({
  element,
  playing,
  assetUrls,
}: {
  element: SlideElement;
  playing: boolean;
  assetUrls?: Record<string, string>;
}) {
  const media = element.media;
  const ref = useRef<HTMLMediaElement | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState("");
  const { url, error: loadError } = useApiBlobUrl(
    playing && element.asset_id
      ? `/v1/files/${encodeURIComponent(element.asset_id)}/content`
      : null,
  );
  const posterOverride = media?.poster_asset_id
    ? assetUrls?.[media.poster_asset_id]
    : undefined;
  const poster = useApiBlobUrl(
    media?.poster_asset_id && !posterOverride
      ? `/v1/files/${encodeURIComponent(media.poster_asset_id)}/content`
      : null,
  );
  useEffect(() => {
    const player = ref.current;
    if (playing && url && media?.autoplay)
      void player?.play().catch(() => setError("点击播放以开始媒体"));
    return () => {
      player?.pause();
    };
  }, [playing, url, media?.autoplay]);
  const toggle = () => {
    if (!ref.current) return;
    setError("");
    if (ref.current.paused)
      void ref.current
        .play()
        .catch(() => setError("媒体播放失败，请检查格式或重试"));
    else ref.current.pause();
  };
  const props = {
    src: url ?? undefined,
    loop: media?.loop,
    preload: "metadata" as const,
    onPlay: () => setActive(true),
    onPause: () => setActive(false),
    onEnded: () => setActive(false),
    onError: () => setError("媒体格式无法播放"),
  };
  return (
    <div
      className="presentation-managed-media"
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        background: element.kind === "video" ? "#101827" : "transparent",
        opacity: element.opacity,
      }}
    >
      {element.kind === "video" ? (
        <video
          ref={(node) => {
            ref.current = node;
          }}
          {...props}
          poster={posterOverride ?? poster.url ?? undefined}
          playsInline
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
        />
      ) : (
        <>
          <audio
            ref={(node) => {
              ref.current = node;
            }}
            {...props}
          />
          <Volume2
            aria-hidden="true"
            size={64}
            style={{
              color: media?.icon_color,
              position: "absolute",
              left: "50%",
              top: "50%",
              transform: "translate(-50%,-50%)",
            }}
          />
        </>
      )}
      {playing && (
        <button
          className="presentation-media-play"
          aria-label={active ? "暂停媒体" : "播放媒体"}
          disabled={!url || !!loadError}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            toggle();
          }}
        >
          {active ? <Pause size={20} /> : <Play size={20} />}
        </button>
      )}
      {media?.poster_asset_id && !posterOverride && !poster.url && (
        <span role="status" className="presentation-image-status">
          {poster.error ? "封面加载失败" : "加载封面…"}
        </span>
      )}
      {(error || loadError) && (
        <span role="status" className="presentation-image-status">
          {error || "媒体加载失败"}
        </span>
      )}
    </div>
  );
}
