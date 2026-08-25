import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { fetchApiBlob } from "@platform/api/client";

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

  useEffect(() => {
    if (!fileId) {
      const previousUrl = activeUrlRef.current;
      activeUrlRef.current = "";
      setUrl("");
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      return;
    }
    let active = true;
    void fetchApiBlob(`/v1/files/${fileId}/content`)
      .then((blob) => {
        const nextUrl = URL.createObjectURL(blob);
        const preloader = new Image();
        let settled = false;
        const discard = () => {
          if (settled) return;
          settled = true;
          URL.revokeObjectURL(nextUrl);
        };
        preloader.onload = () => {
          if (settled) return;
          settled = true;
          if (!active) {
            URL.revokeObjectURL(nextUrl);
            return;
          }
          const previousUrl = activeUrlRef.current;
          activeUrlRef.current = nextUrl;
          setUrl(nextUrl);
          if (previousUrl) URL.revokeObjectURL(previousUrl);
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
    };
  }, [fileId]);

  useEffect(
    () => () => {
      if (activeUrlRef.current) URL.revokeObjectURL(activeUrlRef.current);
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
        activeUrlRef.current = "";
        setUrl("");
        if (failedUrl) URL.revokeObjectURL(failedUrl);
      }}
    />
  ) : (
    <>{fallback}</>
  );
}
