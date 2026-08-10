import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { fetchApiBlob } from "@platform/api/client";

export function StoryAssetImage({
  fileId,
  alt,
  fallback,
  className,
  style,
}: {
  fileId?: string;
  alt: string;
  fallback: ReactNode;
  className?: string;
  style?: CSSProperties;
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
      onError={() => setUrl("")}
    />
  ) : (
    <>{fallback}</>
  );
}
