import { ImagePreview } from "./ImagePreview";
import { LoadingState } from "@shared/ui/LoadingState";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
export function ReadOnlyMedia({
  path,
  kind,
  name,
}: {
  path: string;
  kind: string;
  name: string;
}) {
  const media = useApiBlobUrl(kind === "image" ? null : path);
  if (kind === "image")
    return (
      <div>
        <ImagePreview src={path} size={1280} alt={name} />
        <p>
          <a className="btn small" href={path} download={name}>
            下载原图
          </a>
        </p>
      </div>
    );
  if (media.loading)
    return (
      <LoadingState
        label="正在加载素材…"
        variant="region"
        progress={media.progress}
      />
    );
  if (media.error) return <p role="alert">{media.error.message}</p>;
  if (!media.url) return null;
  return (
    <div>
      {kind === "video" ? (
        <video src={media.url} controls preload="metadata" aria-label={name} />
      ) : kind === "audio" ? (
        <audio src={media.url} controls preload="metadata" aria-label={name} />
      ) : (
        <p>{name}</p>
      )}
      <p>
        <a className="btn small" href={media.url} download={name}>
          下载素材
        </a>
      </p>
    </div>
  );
}
