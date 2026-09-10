import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
import { coverCrop } from "./imageCrop";
import { elementStyle } from "./geometry";
import type { Slide, SlideElement } from "./types";

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
    <div className="presentation-image-clip">
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
            visibility: ready && !failed ? "visible" : "hidden",
            objectFit: contain ? "contain" : "fill",
            width: `${100 / (1 - left - right)}%`,
            height: `${100 / (1 - top - bottom)}%`,
            left: `${(-100 * left) / (1 - left - right)}%`,
            top: `${(-100 * top) / (1 - top - bottom)}%`,
          }}
        />
      ) : null}
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
  if (element.kind === "image") return <ElementImage element={element} />;
  if (element.kind === "text")
    return (
      <div className="presentation-text">
        {element.paragraphs.map((p, index) => (
          <p
            key={index}
            style={{
              textAlign: p.align,
              fontSize: Math.max(0, ...p.runs.map((r) => r.size)) || 24,
              fontFamily: `"${p.runs[0]?.font ?? "Arial"}", "PingFang SC", sans-serif`,
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
                  fontFamily: `"${run.font}", "PingFang SC", sans-serif`,
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
  const { width: w, height: h, stroke_width: s } = element;
  const inset = s / 2;
  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${w} ${h}`}
      style={{ overflow: "visible" }}
      aria-hidden
    >
      <g
        fill={element.fill}
        stroke={element.stroke}
        strokeWidth={s}
        strokeLinejoin="round"
      >
        {element.kind === "rect" || element.kind === "roundRect" ? (
          <rect
            x={inset}
            y={inset}
            width={Math.max(1, w - s)}
            height={Math.max(1, h - s)}
            rx={element.kind === "roundRect" ? Math.min(w, h) * 0.166 : 0}
          />
        ) : null}
        {element.kind === "ellipse" ? (
          <ellipse
            cx={w / 2}
            cy={h / 2}
            rx={Math.max(1, (w - s) / 2)}
            ry={Math.max(1, (h - s) / 2)}
          />
        ) : null}
        {element.kind === "triangle" ? (
          <polygon points={`${w / 2},0 ${w},${h} 0,${h}`} />
        ) : null}
        {element.kind === "diamond" ? (
          <polygon
            points={`${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`}
          />
        ) : null}
        {element.kind === "arrow" ? (
          <polygon
            points={`0,${h / 4} ${w * 0.65},${h / 4} ${w * 0.65},0 ${w},${h / 2} ${w * 0.65},${h} ${w * 0.65},${h * 0.75} 0,${h * 0.75}`}
          />
        ) : null}
        {element.kind === "line" ? (
          <line x1={0} y1={0} x2={w} y2={h} fill="none" />
        ) : null}
      </g>
    </svg>
  );
});

export const SlideSurface = memo(function SlideSurface({
  slide,
  children,
  editingId,
}: {
  slide: Slide;
  children?: ReactNode;
  editingId?: string | null;
}) {
  return (
    <div
      className="presentation-slide"
      style={{ background: slide.background }}
    >
      {slide.elements.map((element) => (
        <div
          key={element.id}
          data-element-id={element.id}
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
