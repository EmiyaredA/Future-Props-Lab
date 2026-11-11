import * as Dialog from "@radix-ui/react-dialog";
import { ImageIcon, Play, Video, X } from "lucide-react";
import { useState } from "react";
import { useVisibleApiBlobUrl } from "@platform/api/useVisibleApiBlobUrl";
import { conversationFileUrl } from "./attachmentImport";
import type { Reference } from "./protocol";
import { ReferenceChip } from "./ReferenceChip";

type Props = {
  reference: Reference;
  conversationId?: string;
  onOpen: (reference: Reference) => void;
  onRemove?: () => void;
};

const videoTypes: ReadonlyMap<string, string> = new Map([
  ["mp4", "video/mp4"],
  ["m4v", "video/mp4"],
  ["mov", "video/quicktime"],
  ["webm", "video/webm"],
  ["ogv", "video/ogg"],
]);

export function AttachmentReference({
  reference,
  conversationId,
  onOpen,
  onRemove,
}: Props) {
  const suffix = /\.([^.]+)$/.exec(reference.name)?.[1]?.toLowerCase() ?? "";
  const videoType = videoTypes.get(suffix);
  if (
    !conversationId ||
    reference.target ||
    reference.source !== "imports" ||
    reference.id !== `file:${reference.name}` ||
    (!videoType &&
      !/\.(avif|bmp|gif|jpe?g|png|tiff?|webp)$/i.test(reference.name))
  ) {
    return (
      <ReferenceChip
        reference={reference}
        onOpen={onOpen}
        onRemove={onRemove}
      />
    );
  }
  const path = conversationFileUrl(conversationId, "imports", reference.name);
  return (
    <MediaAttachment
      key={path}
      path={path}
      name={reference.name}
      videoType={videoType}
      onRemove={onRemove}
    />
  );
}

function MediaAttachment({
  path,
  name,
  videoType,
  onRemove,
}: {
  path: string;
  name: string;
  videoType?: string;
  onRemove?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { ref, url, error } = useVisibleApiBlobUrl(path, {
    active: open,
    fallbackMimeType: videoType,
  });
  const [readyUrl, setReadyUrl] = useState("");
  const [failedUrl, setFailedUrl] = useState("");
  const failed = Boolean(error || (url && url === failedUrl));
  const source = failed ? "" : url;
  const ready = Boolean(source && source === readyUrl);
  const onError = () => setFailedUrl(url);
  const Icon = videoType ? Video : ImageIcon;
  const mediaLabel = videoType ? "视频" : "图片";

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <div className="amadeus-ref amadeus-media-attachment" ref={ref}>
        <Dialog.Trigger asChild>
          <button
            type="button"
            className="amadeus-ref-content"
            aria-label={`${videoType ? "预览视频" : "放大图片"}：${name}`}
            title={failed ? `${name} · ${mediaLabel}暂时无法预览` : name}
          >
            <span className="amadeus-media-thumbnail" aria-hidden="true">
              {!ready && <Icon size={18} />}
              {source &&
                (videoType ? (
                  <video
                    src={source}
                    preload="auto"
                    playsInline
                    muted
                    hidden={!ready}
                    onLoadedData={() => setReadyUrl(url)}
                    onError={onError}
                  />
                ) : (
                  <img
                    src={source}
                    alt=""
                    hidden={!ready}
                    onLoad={() => setReadyUrl(url)}
                    onError={onError}
                  />
                ))}
              {videoType && ready && (
                <span className="amadeus-media-play">
                  <Play size={14} />
                </span>
              )}
            </span>
            <span>{name}</span>
          </button>
        </Dialog.Trigger>
        {onRemove && (
          <button
            type="button"
            className="amadeus-ref-remove"
            aria-label={`移除引用：${name}`}
            title="移除引用"
            onClick={onRemove}
          >
            <X size={12} aria-hidden="true" />
          </button>
        )}
      </div>
      <Dialog.Portal>
        <Dialog.Overlay className="amadeus-media-overlay" />
        <Dialog.Content
          className="amadeus-media-dialog"
          aria-describedby={undefined}
        >
          <header>
            <Dialog.Title>{name}</Dialog.Title>
            <Dialog.Close type="button" aria-label={`关闭${mediaLabel}预览`}>
              <X size={18} aria-hidden="true" />
            </Dialog.Close>
          </header>
          {source ? (
            videoType ? (
              <video
                src={source}
                aria-label={name}
                controls
                playsInline
                preload="auto"
                onError={onError}
              />
            ) : (
              <img src={source} alt={name} onError={onError} />
            )
          ) : (
            <p role="status">
              {failed
                ? `${mediaLabel}暂时无法预览。`
                : `正在读取${mediaLabel}…`}
            </p>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
