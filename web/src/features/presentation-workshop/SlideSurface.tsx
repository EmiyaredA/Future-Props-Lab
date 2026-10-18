import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
import { PresentationShape } from "./PresentationShape";
import { fontFamily } from "./textAdapter";
import { coverCrop } from "./imageCrop";
import { elementStyle } from "./geometry";
import type { Slide, SlideElement } from "./types";
import { Connections } from "./scene/Connections";

export function ElementImage({
  element,
  contain = false,
}: {
  element: SlideElement;
  contain?: boolean;
}) {
  const { url, error } = useApiBlobUrl(
    element.asset_id
      ? `/v1/files/${encodeURIComponent(element.asset_id)}/content`
      : null,
  );
  const [loaded, setLoaded] = useState<{
    url: string;
    width: number;
    height: number;
  } | null>(null);
  const [failedUrl, setFailedUrl] = useState("");
  const ready = !!url && loaded?.url === url;
  const failed = !!error || (!!url && failedUrl === url);
  const { left, right, top, bottom } =
    ready && !contain
      ? coverCrop(
          loaded.width,
          loaded.height,
          element.width,
          element.height,
          element.crop,
        )
      : { left: 0, right: 0, top: 0, bottom: 0 };
  return (
    <div
      className="presentation-image-clip"
      style={{
        opacity: element.opacity ?? 1,
        borderRadius:
          element.kind === "image" ? (element.corner_radius ?? 0) : 0,
        outline: element.image_border
          ? `${element.stroke_width}px ${element.stroke_dash === "dash" ? "dashed" : element.stroke_dash === "dot" ? "dotted" : "solid"} ${element.stroke}`
          : undefined,
        transform: `scale(${element.flip_x ? -1 : 1}, ${element.flip_y ? -1 : 1})`,
      }}
    >
      {url ? (
        <img
          key={url}
          src={url}
          alt="幻灯片图片"
          onLoad={(event) => {
            const img = event.currentTarget;
            if (img.naturalWidth && img.naturalHeight)
              setLoaded({
                url,
                width: img.naturalWidth,
                height: img.naturalHeight,
              });
          }}
          onError={() => setFailedUrl(url)}
          draggable={false}
          style={{
            visibility:
              ready && !failed && !element.vector_color ? "visible" : "hidden",
            objectFit: contain ? "contain" : "fill",
            width: `${100 / (1 - left - right)}%`,
            height: `${100 / (1 - top - bottom)}%`,
            left: `${(-100 * left) / (1 - left - right)}%`,
            top: `${(-100 * top) / (1 - top - bottom)}%`,
          }}
        />
      ) : null}
      {ready && element.kind === "vector" && element.vector_color && (
        <span
          style={{
            position: "absolute",
            inset: 0,
            background: element.vector_color,
            maskImage: `url("${url}")`,
            maskSize: "contain",
            maskPosition: "center",
            maskRepeat: "no-repeat",
          }}
        />
      )}
      {!ready || failed ? (
        <span className="presentation-image-status" role="status">
          {failed ? "图片加载失败" : "加载图片…"}
        </span>
      ) : null}
    </div>
  );
}
export const ElementContent = memo(function ElementContent({
  element,
}: {
  element: SlideElement;
}) {
  if (element.kind === "image" || element.kind === "vector")
    return (
      <ElementImage element={element} contain={element.kind === "vector"} />
    );
  if (element.kind === "text")
    return (
      <div className="presentation-text">
        {element.paragraphs.map((p, index) => (
          <p
            key={index}
            style={{
              textAlign: p.align,
              fontSize: Math.max(0, ...p.runs.map((r) => r.size)) || 24,
              fontFamily: fontFamily(p.runs[0]?.font ?? "Arial"),
              color: p.runs[0]?.color,
              paddingLeft: p.bullet ? 24 : 0,
              lineHeight: `${(Math.max(0, ...p.runs.map((r) => r.size)) || 24) * p.line_height}px`,
            }}
          >
            {p.bullet ? <span className="presentation-bullet">•</span> : null}
            {p.runs.map((run, i) => (
              <span
                key={i}
                style={{
                  fontFamily: fontFamily(run.font),
                  fontSize: run.size,
                  color: run.color,
                  fontWeight: run.bold ? 700 : 400,
                  fontStyle: run.italic ? "italic" : "normal",
                  textDecoration: run.underline ? "underline" : "none",
                }}
              >
                {run.text}
              </span>
            ))}
            {p.runs.every((r) => !r.text) ? <br /> : null}
          </p>
        ))}
      </div>
    );
  return <PresentationShape element={element} />;
});

export const SlideSurface = memo(function SlideSurface({
  slide,
  children,
  editingId,
  selectedConnection,
  onSelectConnection,
}: {
  slide: Slide;
  children?: ReactNode;
  editingId?: string | null;
  selectedConnection?: string | null;
  onSelectConnection?: (id: string) => void;
}) {
  return (
    <div
      className="presentation-slide"
      style={{ background: slide.background }}
    >
      <Connections
        slide={slide}
        selected={selectedConnection}
        onSelect={onSelectConnection}
      />
      {slide.elements.map((element) => (
        <div
          key={element.id}
          data-element-id={element.id}
          data-amadeus-id={element.id}
          data-amadeus-name={element.kind}
          data-amadeus-value={`幻灯片元素 · ${element.kind}`}
          data-transparent-shape={
            element.kind !== "text" &&
            element.kind !== "image" &&
            element.kind !== "vector" &&
            element.fill_opacity === 0
              ? "true"
              : undefined
          }
          className={`presentation-element${element.locked ? " locked" : ""}`}
          style={elementStyle(element)}
        >
          {element.id !== editingId ? (
            <ElementContent element={element} />
          ) : null}
        </div>
      ))}
      {children}
    </div>
  );
});

export function SlidePreview({
  slide,
  width,
}: {
  slide: Slide;
  width?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [measuredWidth, setMeasuredWidth] = useState(224);
  useEffect(() => {
    if (
      width !== undefined ||
      !host.current ||
      typeof ResizeObserver === "undefined"
    )
      return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0)
        setMeasuredWidth(entry.contentRect.width);
    });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, [width]);
  const previewWidth = width ?? measuredWidth;
  useEffect(() => {
    if (!host.current || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries[0].isIntersecting),
      { rootMargin: "200px" },
    );
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={host}
      className="presentation-preview"
      style={{
        width: width ?? "100%",
        aspectRatio: "16 / 9",
        background: slide.background,
      }}
    >
      {visible ? (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            transform: `scale(${previewWidth / 1280})`,
            transformOrigin: "top left",
          }}
        >
          <SlideSurface slide={slide} />
        </div>
      ) : null}
    </div>
  );
}
