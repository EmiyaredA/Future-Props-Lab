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
  const media = useApiBlobUrl(path);
  if (media.loading) return <p role="status">正在加载素材…</p>;
  if (media.error) return <p role="alert">{media.error.message}</p>;
  if (!media.url) return null;
  return (
    <div>
      {kind === "image" ? (
        <img src={media.url} alt={name} />
      ) : kind === "video" ? (
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
