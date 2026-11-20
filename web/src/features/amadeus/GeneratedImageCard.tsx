import * as Dialog from "@radix-ui/react-dialog";
import { Download, ImageIcon, X } from "lucide-react";
import { useState } from "react";
import { useVisibleApiBlobUrl } from "@platform/api/useVisibleApiBlobUrl";
import { conversationFileUrl } from "./attachmentImport";
import type { GeneratedImage, ImageGeneration } from "./protocol";

export function GeneratedImageCard({
  generation,
  conversationId,
}: {
  generation: ImageGeneration;
  conversationId: string;
}) {
  if (generation.status === "completed" && generation.image)
    return (
      <SavedImage
        key={generation.image.name}
        image={generation.image}
        conversationId={conversationId}
      />
    );
  return (
    <div className="amadeus-generated-status" role="status">
      <ImageIcon size={18} aria-hidden />
      {generation.status === "started"
        ? "Codex 正在生成图片…"
        : generation.message || "图片生成已中断；已保存的图片仍可查看。"}
    </div>
  );
}

function SavedImage({
  image,
  conversationId,
}: {
  image: GeneratedImage;
  conversationId: string;
}) {
  const [open, setOpen] = useState(false);
  const [failedUrl, setFailedUrl] = useState("");
  const { ref, url, error } = useVisibleApiBlobUrl(
    conversationFileUrl(conversationId, "outputs", image.name),
    { active: open, fallbackMimeType: image.mime_type },
  );
  const failed = Boolean(error || (url && url === failedUrl));
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <div
        ref={ref}
        className="amadeus-generated-image"
        aria-label="Codex 生成图片"
      >
        <Dialog.Trigger asChild>
          <button
            type="button"
            className="amadeus-generated-preview"
            aria-label={`放大图片：${image.name}`}
          >
            {url && !failed ? (
              <img
                src={url}
                alt="Codex 生成的图片"
                width={image.width}
                height={image.height}
                onError={() => setFailedUrl(url)}
              />
            ) : (
              <span role="status">
                {failed ? "图片暂时无法预览" : "正在读取图片…"}
              </span>
            )}
          </button>
        </Dialog.Trigger>
        <footer>
          <span>
            已保存 · {image.width} × {image.height}
          </span>
          {url && (
            <a href={url} download={image.name}>
              <Download size={14} aria-hidden />
              下载原图
            </a>
          )}
        </footer>
      </div>
      <Dialog.Portal>
        <Dialog.Overlay className="amadeus-media-overlay" />
        <Dialog.Content
          className="amadeus-media-dialog"
          aria-describedby={undefined}
        >
          <header>
            <Dialog.Title>生成图片</Dialog.Title>
            <Dialog.Close type="button" aria-label="关闭图片预览">
              <X size={18} aria-hidden />
            </Dialog.Close>
          </header>
          {url && !failed ? (
            <img src={url} alt="Codex 生成的图片原图" />
          ) : (
            <p role="status">图片暂时无法预览</p>
          )}
          {url && (
            <a href={url} download={image.name}>
              下载原图
            </a>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
