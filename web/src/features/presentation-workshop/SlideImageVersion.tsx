import { useTransferProgress } from "@platform/api/useTransferProgress";
import { TransferFeedback } from "@shared/ui/TransferFeedback";
import { ResponsiveImage } from "@shared/ui/ResponsiveImage";
import { Image } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
import { download, imageBlob, uploadImage } from "./api";
import { MediaPreview } from "./MediaPreview";
import { PresentationImages } from "./PresentationImages";
import { presentationKeys } from "./queryKeys";
import type { Slide } from "./types";
import "./slide-image-version.css";

export function SlideImageVersion({
  slide,
  readOnly,
  onChange,
}: {
  slide: Slide;
  readOnly: boolean;
  onChange?: (id: string | null) => void;
}) {
  const { run: runTransfer, progress: activeTransferProgress } =
    useTransferProgress();

  const cache = useQueryClient();
  const id = slide.image_asset_id;
  const { url, error: previewError } = useApiBlobUrl(
    id ? `/v1/files/${encodeURIComponent(id)}/thumbnail?size=1280` : null,
  );
  const [picking, setPicking] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const token = useRef(0);
  const permission = useRef(readOnly);
  permission.current = readOnly;
  useEffect(() => {
    const counter = token;
    return () => {
      counter.current++;
    };
  }, []);
  useEffect(() => {
    if (readOnly) {
      token.current++;
      setPicking(false);
      setBusy(false);
    }
  }, [readOnly]);
  const close = () => {
    token.current++;
    setPicking(false);
    setBusy(false);
  };
  const choose = (assetId: string) => {
    if (permission.current || !onChange) return;
    onChange(assetId);
    close();
  };
  const upload = async (file: File) => {
    if (busy || permission.current) return;
    const version = ++token.current;
    setBusy(true);
    setError("");
    try {
      const asset = await runTransfer((onProgress) =>
        uploadImage(file, { onProgress }),
      );
      await cache.invalidateQueries({ queryKey: presentationKeys.images });
      if (version === token.current && !permission.current) choose(asset.id);
    } catch (e) {
      if (version === token.current)
        setError(e instanceof Error ? e.message : "图像版本上传失败");
    } finally {
      if (version === token.current) setBusy(false);
    }
  };
  const downloadImage = async () => {
    if (!id) return;
    setError("");
    try {
      const blob = await runTransfer((onProgress) =>
        imageBlob(id, { onProgress }),
      );
      const extension =
        (
          {
            "image/png": "png",
            "image/jpeg": "jpg",
            "image/webp": "webp",
            "image/gif": "gif",
            "image/avif": "avif",
            "image/svg+xml": "svg",
          } as Record<string, string>
        )[blob.type] ?? "img";
      download(blob, `幻灯片图像-${slide.id}.${extension}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "图像版本下载失败");
    }
  };
  return (
    <section className="presentation-image-version" aria-label="页面图像版本">
      <TransferFeedback progress={activeTransferProgress} />

      <h4>图像版本</h4>
      {id ? (
        <>
          <button
            className="presentation-image-version-preview"
            aria-label="预览图像版本"
            onClick={() => setPreviewing(true)}
          >
            {url ? (
              <ResponsiveImage src={url} alt="本页归档图像" />
            ) : (
              <span role="status">
                {previewError ? "图像加载失败" : "加载图像…"}
              </span>
            )}
          </button>
          <div className="presentation-image-version-actions">
            <button className="btn" onClick={() => void downloadImage()}>
              下载图像
            </button>
            {!readOnly && onChange && (
              <>
                <button
                  className="btn"
                  onClick={() => {
                    setError("");
                    setPicking(true);
                  }}
                >
                  更换图像版本
                </button>
                <button className="btn" onClick={() => onChange(null)}>
                  移除图像版本
                </button>
              </>
            )}
          </div>
        </>
      ) : (
        <div className="presentation-image-version-empty">
          <Image size={28} strokeWidth={1.5} aria-hidden="true" />
          <p className="muted">未添加图像版本</p>
          {!readOnly && onChange && (
            <button
              className="btn"
              onClick={() => {
                setError("");
                setPicking(true);
              }}
            >
              添加图像版本
            </button>
          )}
        </div>
      )}
      <p className="muted">仅作归档，不进入放映或 PPTX。移除后源文件仍保留。</p>
      {error && <p role="alert">{error}</p>}
      {picking && !readOnly && (
        <PresentationImages
          title="选择本页图像版本"
          chooseLabel="归档"
          uploadHint="上传本页的原始生成图，仅作归档。"
          busy={busy}
          error={error}
          onClose={close}
          onChoose={choose}
          onUpload={upload}
        />
      )}
      {previewing && id && (
        <MediaPreview
          id={id}
          onClose={() => setPreviewing(false)}
          onDownload={() => void downloadImage()}
        />
      )}
    </section>
  );
}
