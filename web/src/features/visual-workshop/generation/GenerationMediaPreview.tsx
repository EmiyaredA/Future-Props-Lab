import { useEffect, useState } from "react";
import { Image, Music, Video } from "lucide-react";
import type { ManagedFile } from "@features/files";
import { fetchApiBlob } from "@platform/api/client";

export function GenerationMediaPreview({ file }: { file: ManagedFile }) {
  const [source, setSource] = useState("");
  useEffect(() => {
    if (file.media_kind === "audio") return;
    let active = true;
    let objectUrl = "";
    void fetchApiBlob(`/v1/files/${file.id}/content`)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.id, file.media_kind]);
  if (file.media_kind === "image" && source) return <img src={source} alt="" />;
  if (file.media_kind === "video" && source)
    return <video src={source} muted preload="metadata" aria-hidden />;
  const Icon =
    file.media_kind === "video"
      ? Video
      : file.media_kind === "audio"
        ? Music
        : Image;
  return <Icon aria-hidden />;
}
