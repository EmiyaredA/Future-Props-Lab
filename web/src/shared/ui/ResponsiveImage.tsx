import { useState, type ComponentPropsWithRef } from "react";
import { publicImageSources } from "@shared/lib/imageSources";
import "./responsive-image.css";

/** Native lazy loading with explicit sizes: automatic size containment can
 * enlarge percentage-height images inside fixed grid cells to 150px. */
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
        (sources.srcSet ? (width ? sources.sizes : "100vw") : undefined)
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
