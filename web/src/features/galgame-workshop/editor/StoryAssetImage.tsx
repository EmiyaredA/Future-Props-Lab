import { useEffect, useState, type ReactNode } from "react";
import { fetchApiBlob } from "@platform/api/client";

export function StoryAssetImage({
  fileId,
  alt,
  fallback,
  className,
}: {
  fileId?: string;
  alt: string;
  fallback: ReactNode;
  className?: string;
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
    <img className={className} src={url} alt={alt} onError={() => setUrl("")} />
  ) : (
    <>{fallback}</>
  );
}
