import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
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

  useEffect(() => {
    if (!fileId) {
      setUrl("");
      return;
    }
    let active = true;
    let objectUrl = "";
    void fetchApiBlob(`/v1/files/${fileId}/content`)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (active) setUrl(objectUrl);
      })
      .catch(() => {
        if (active) setUrl("");
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileId]);

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
      onError={() => setUrl("")}
    />
  ) : (
    <>{fallback}</>
  );
}
