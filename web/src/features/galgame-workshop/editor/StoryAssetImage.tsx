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
}: {
  fileId?: string;
  alt: string;
  fallback: ReactNode;
  className?: string;
  style?: CSSProperties;
  onNaturalSize?: (size: { width: number; height: number }) => void;
}) {
  const [url, setUrl] = useState("");
  const activeUrlRef = useRef("");
  const activeUrlOwnedRef = useRef(false);
  const imageCache = useStoryImageCache();

  useEffect(() => {
    if (!fileId) {
      const previousUrl = activeUrlRef.current;
      const previousOwned = activeUrlOwnedRef.current;
      activeUrlRef.current = "";
      activeUrlOwnedRef.current = false;
      setUrl("");
      if (previousUrl && previousOwned) URL.revokeObjectURL(previousUrl);
      return;
    }
    let active = true;
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
          setUrl(nextUrl);
          if (previousUrl && previousOwned) URL.revokeObjectURL(previousUrl);
        };
        preloader.onerror = discard;
        preloader.src = nextUrl;
      })
      .catch(() => {
        // Keep the last decoded image visible when a replacement fails. The
        // fallback is only shown when no image has ever loaded successfully.
        if (active && !activeUrlRef.current) setUrl("");
      });
    return () => {
      active = false;
      release?.();
    };
  }, [fileId, imageCache]);

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
      onLoad={(event) =>
        onNaturalSize?.({
          width: event.currentTarget.naturalWidth,
          height: event.currentTarget.naturalHeight,
        })
      }
      onError={() => {
        const failedUrl = activeUrlRef.current;
        const failedOwned = activeUrlOwnedRef.current;
        activeUrlRef.current = "";
        activeUrlOwnedRef.current = false;
        setUrl("");
        if (failedUrl && failedOwned) URL.revokeObjectURL(failedUrl);
      }}
    />
  ) : (
    <>{fallback}</>
  );
}
