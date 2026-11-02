import { useState, type ComponentPropsWithRef } from "react";
import { publicImageSources } from "@shared/lib/imageSources";
import "./responsive-image.css";

/** An img-compatible public/local image. Keeps existing layout, refs and handlers. */
export function ResponsiveImage({
  src,
  width,
  loading,
  decoding = "async",
  className = "",
  onLoad,
  onError,
  ...props
}: ComponentPropsWithRef<"img">) {
  const [result, setResult] = useState<{ src?: string; state: string }>({
    state: "loading",
  });
  const state = result.src === src ? result.state : "loading";
  const sources: { src?: string; srcSet?: string; sizes?: string } = src
    ? publicImageSources(src, Number(width) || 64)
    : { src };
  const imageLoading = loading ?? (sources.srcSet ? "lazy" : "eager");
  return (
    <img
      {...sources}
      {...props}
      src={sources.src}
      width={width}
      loading={imageLoading}
      sizes={
        props.sizes ??
        (imageLoading === "lazy" && sources.sizes
          ? `auto, ${sources.sizes}`
          : sources.sizes)
      }
      decoding={decoding}
      className={`fpl-image ${className}`}
      data-load-state={state}
      onLoad={(event) => {
        setResult({ src, state: "ready" });
        onLoad?.(event);
      }}
      onError={(event) => {
        setResult({ src, state: "error" });
        onError?.(event);
      }}
    />
  );
}
