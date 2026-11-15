import { useEffect, useLayoutEffect, useRef } from "react";
import { previewMediaUrl } from "./previewRenderApi";

/** One video owns both the mixed audio and the actual playback clock. */
export function VideoEditorCachedPreview({
  url,
  playheadUs,
  seekRevision,
  durationUs,
  onTime,
  onEnded,
  onError,
}: {
  url: string;
  playheadUs: number;
  seekRevision: number;
  durationUs: number;
  onTime: (timeUs: number) => void;
  onEnded: () => void;
  onError: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const desired = useRef(playheadUs);
  const callbacks = useRef({ onTime, onEnded, onError });
  useLayoutEffect(() => {
    desired.current = playheadUs;
    callbacks.current = { onTime, onEnded, onError };
  });
  useEffect(() => {
    const node = video.current!;
    let cancelled = false;
    let frame = 0;
    const start = () => {
      if (cancelled) return;
      node.currentTime = desired.current / 1_000_000;
      void node.play().catch((error: unknown) => {
        if (
          !cancelled &&
          !(error instanceof DOMException && error.name === "AbortError")
        )
          callbacks.current.onError();
      });
    };
    if (node.readyState >= 1) start();
    else node.addEventListener("loadedmetadata", start, { once: true });
    const tick = () => {
      if (node.readyState >= 2 && !node.seeking)
        callbacks.current.onTime(
          Math.min(durationUs, Math.round(node.currentTime * 1_000_000)),
        );
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      node.removeEventListener("loadedmetadata", start);
      node.pause();
    };
  }, [url, durationUs]);
  useEffect(() => {
    const node = video.current;
    if (node && node.readyState >= 1)
      node.currentTime = desired.current / 1_000_000;
  }, [seekRevision]);
  return (
    <video
      ref={video}
      className="ve-cached-preview"
      src={previewMediaUrl(url)}
      crossOrigin="use-credentials"
      preload="auto"
      playsInline
      onError={() => callbacks.current.onError()}
      onEnded={() => {
        callbacks.current.onTime(durationUs);
        callbacks.current.onEnded();
      }}
      aria-label="预渲染节目预览"
    />
  );
}
