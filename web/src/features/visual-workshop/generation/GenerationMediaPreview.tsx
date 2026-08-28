import { Image, Music, Video } from "lucide-react";
import type { ManagedFile } from "@features/files";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";

export function GenerationMediaPreview({ file }: { file: ManagedFile }) {
  const { url: source } = useApiBlobUrl(
    file.media_kind === "audio" ? null : `/v1/files/${file.id}/content`,
  );
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
