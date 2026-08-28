import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { fetchApiBlob } from "@platform/api/client";
import { useStoryImageCache } from "@features/galgame-workshop/editor/StoryImageCache";

export function StoryAssetImage({
  fileId,
  alt,
  fallback,
  className,
  style,
  onNaturalSize,
  onImageLoad,
}: {
  fileId?: string;
  alt: string;
  fallback: ReactNode;
  className?: string;
  style?: CSSProperties;
  onNaturalSize?: (size: { width: number; height: number }) => void;
  onImageLoad?: (image: HTMLImageElement) => void;
}) {
  const [url, setUrl] = useState("");
  const [displayedFileId, setDisplayedFileId] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const activeUrlRef = useRef("");
  const activeUrlOwnedRef = useRef(false);
  const retryCountRef = useRef(0);
  const imageCache = useStoryImageCache();

  useEffect(() => {
    retryCountRef.current = 0;
    setLoadAttempt(0);
  }, [fileId]);

  useEffect(() => {
    if (!fileId) {
      const previousUrl = activeUrlRef.current;
      const previousOwned = activeUrlOwnedRef.current;
      activeUrlRef.current = "";
      activeUrlOwnedRef.current = false;
      setUrl("");
      setDisplayedFileId("");
      if (previousUrl && previousOwned) URL.revokeObjectURL(previousUrl);
      return;
    }
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleRetry = () => {
      if (!active || activeUrlRef.current || retryCountRef.current >= 2) return;
      retryCountRef.current += 1;
      retryTimer = globalThis.setTimeout(
        () => setLoadAttempt((current) => current + 1),
        retryCountRef.current * 180,
      );
    };
    const release = imageCache?.retain(fileId);
    const request = imageCache
      ? imageCache.load(fileId).then((nextUrl) => ({ nextUrl, owned: false }))
      : fetchApiBlob(`/v1/files/${fileId}/content`).then((blob) => ({
          nextUrl: URL.createObjectURL(blob),
          owned: true,
        }));
    void request
      .then(({ nextUrl, owned }) => {
        const preloader = new Image();
        let settled = false;
        const discard = () => {
          if (settled) return;
          settled = true;
          if (owned) URL.revokeObjectURL(nextUrl);
        };
        preloader.onload = () => {
          if (settled) return;
          settled = true;
          if (!active) {
            if (owned) URL.revokeObjectURL(nextUrl);
            return;
          }
          const previousUrl = activeUrlRef.current;
          const previousOwned = activeUrlOwnedRef.current;
          activeUrlRef.current = nextUrl;
          activeUrlOwnedRef.current = owned;
          retryCountRef.current = 0;
          setUrl(nextUrl);
          setDisplayedFileId(fileId);
          if (previousUrl && previousOwned) URL.revokeObjectURL(previousUrl);
        };
        preloader.onerror = () => {
          discard();
          scheduleRetry();
        };
        preloader.src = nextUrl;
      })
      .catch(() => {
        // Keep the last decoded image visible when a replacement fails. The
        // fallback is only shown when no image has ever loaded successfully.
        if (!active || activeUrlRef.current) return;
        setUrl("");
        scheduleRetry();
      });
    return () => {
      active = false;
      if (retryTimer != null) globalThis.clearTimeout(retryTimer);
      release?.();
    };
  }, [fileId, imageCache, loadAttempt]);

  useEffect(
    () =>
      displayedFileId && imageCache
        ? imageCache.retain(displayedFileId)
        : undefined,
    [displayedFileId, imageCache],
  );

  useEffect(
    () => () => {
      if (activeUrlRef.current && activeUrlOwnedRef.current)
        URL.revokeObjectURL(activeUrlRef.current);
    },
    [],
  );

  return url ? (
    <img
      className={className}
      style={style}
      src={url}
      alt={alt}
      data-file-id={displayedFileId}
      onLoad={(event) => {
        onNaturalSize?.({
          width: event.currentTarget.naturalWidth,
          height: event.currentTarget.naturalHeight,
        });
        onImageLoad?.(event.currentTarget);
      }}
      onError={() => {
        const failedUrl = activeUrlRef.current;
        const failedOwned = activeUrlOwnedRef.current;
        activeUrlRef.current = "";
        activeUrlOwnedRef.current = false;
        setUrl("");
        setDisplayedFileId("");
        if (failedUrl && failedOwned) URL.revokeObjectURL(failedUrl);
      }}
    />
  ) : (
    <>{fallback}</>
  );
}
