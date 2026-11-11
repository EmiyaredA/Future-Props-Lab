import { ImagePreview } from "@shared/ui/ImagePreview";
import { Image, Music, Video } from "lucide-react";
import type { ManagedFile } from "@features/files";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";

export function GenerationMediaPreview({
  file,
  thumbnailOnly = false,
}: {
  file: ManagedFile;
  thumbnailOnly?: boolean;
}) {
  const { url: source } = useApiBlobUrl(
    file.media_kind === "video" && !thumbnailOnly
      ? `/v1/files/${file.id}/content`
      : null,
  );
  if (
    file.media_kind === "image" ||
    (file.media_kind === "video" && thumbnailOnly)
  )
    return (
      <ImagePreview
        interactive={false}
        src={`/v1/files/${file.id}/${thumbnailOnly ? "thumbnail" : "content"}`}
        size={320}
        alt=""
      />
    );
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
