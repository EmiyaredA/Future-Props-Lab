import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
import { imagePreviewSource, type ImageSize } from "@shared/lib/imageSources";
import { LoadingState } from "./LoadingState";
import { ResponsiveImage } from "./ResponsiveImage";
import "./responsive-image.css";

/** Visibility gates the authenticated request itself, not just browser decoding. */
export function ImagePreview({
  src,
  originalSrc = src,
  size = 640,
  eager = false,
  interactive = true,
  className = "",
  alt = "",
  ...props
}: ImgHTMLAttributes<HTMLImageElement> & {
  originalSrc?: string;
  size?: ImageSize;
  eager?: boolean;
  interactive?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(eager);
  const [retry, setRetry] = useState(0);
  const [original, setOriginal] = useState<string>();
  const [decodeFailure, setDecodeFailure] = useState<string>();
  const source =
    src && (original === src ? originalSrc : imagePreviewSource(src, size));
  const isApi = source?.startsWith("/v1/");
  const path =
    source && visible && isApi
      ? `${source}${source.includes("?") ? "&" : "?"}preview_retry=${retry}`
      : null;
  const media = useApiBlobUrl(path);
  useEffect(() => {
    if (eager) return;
    const target = ref.current;
    if (!target) return;
    if (!globalThis.IntersectionObserver) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "120px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [eager]);
  const url = isApi ? media.url : visible ? source : undefined;
  const failed = media.error || (decodeFailure === url && url);
  return (
    <span
      ref={ref}
      className={`fpl-image-preview ${className}`}
      aria-hidden={alt === "" && !interactive ? true : undefined}
      style={{
        aspectRatio:
          props.width && props.height
            ? `${props.width}/${props.height}`
            : undefined,
      }}
    >
      {url && !failed ? (
        <ResponsiveImage
          {...props}
          src={url}
          alt={alt}
          loading="eager"
          onError={(event) => {
            setDecodeFailure(url);
            props.onError?.(event);
          }}
        />
      ) : null}
      {failed ? (
        <span className="fpl-image-failure" role="alert">
          图片暂时无法读取
          {interactive ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setDecodeFailure(undefined);
                  setRetry((value) => value + 1);
                }}
              >
                重试
              </button>
              {source !== originalSrc ? (
                <button type="button" onClick={() => setOriginal(src)}>
                  查看原图
                </button>
              ) : null}
            </>
          ) : null}
        </span>
      ) : visible && src && !url ? (
        <LoadingState
          label="正在加载图片…"
          variant="inline"
          progress={media.progress}
        />
      ) : null}
    </span>
  );
}
