import { ResponsiveImage } from "@shared/ui/ResponsiveImage";
import { LoadingState } from "@shared/ui/LoadingState";
import { resolveSlide } from "./master/model";
import type { Deck } from "./types";
import { PaintLayer } from "./objects/paint";
import { shadowFilter } from "./objects/paintStyle";
import { lazy, Suspense } from "react";
import { NativeTable } from "./objects/NativeTable";
import { ManagedMedia } from "./objects/ManagedMedia";
const ChartSvg = lazy(() => import("./objects/ChartSvg"));
import {
  memo,
  useEffect,
  useRef,
  useState,
  useId,
  type ReactNode,
} from "react";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
import { PresentationShape } from "./PresentationShape";
import { fontFamily } from "./textAdapter";
import { coverCrop } from "./imageCrop";
import { elementStyle } from "./geometry";
import {
  defaultPageSize,
  type PageSize,
  type Slide,
  type SlideElement,
} from "./types";
import { Connections } from "./scene/Connections";
import { sceneOrder } from "./scene/stacking";
import { paragraphMarkers } from "./paragraphLists";

export function ElementImage({
  element,
  contain = false,
  assetUrl,
}: {
  element: SlideElement;
  contain?: boolean;
  assetUrl?: string;
}) {
  const loadedAsset = useApiBlobUrl(
    element.asset_id && !assetUrl
      ? `/v1/files/${encodeURIComponent(element.asset_id)}/thumbnail?size=1280`
      : null,
  );
  const url = assetUrl ?? loadedAsset.url;
  const error = assetUrl ? null : loadedAsset.error;
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
  const effects = element.image_effects;
  const tintId = useId().replace(/:/g, "");
  const filter = effects
    ? `brightness(${effects.brightness}) contrast(${effects.contrast}) saturate(${effects.saturation}) grayscale(${effects.grayscale}) blur(${effects.blur}px)${effects.tint ? ` url(#${tintId})` : ""}`
    : undefined;
  const tint = effects?.tint
    ?.slice(1)
    .match(/../g)
    ?.map((value) => (parseInt(value, 16) / 255) * 0.35);
  return (
    <div
      className="presentation-image-clip"
      style={{
        opacity: element.opacity ?? 1,
        clipPath:
          effects?.crop_shape === "ellipse"
            ? "ellipse(50% 50% at 50% 50%)"
            : effects?.crop_shape === "triangle"
              ? "polygon(50% 0,100% 100%,0 100%)"
              : effects?.crop_shape === "diamond"
                ? "polygon(50% 0,100% 50%,50% 100%,0 50%)"
                : undefined,
        borderRadius:
          element.kind === "image" ? (element.corner_radius ?? 0) : 0,
        outline: element.image_border
          ? `${element.stroke_width}px ${element.stroke_dash === "dash" ? "dashed" : element.stroke_dash === "dot" ? "dotted" : "solid"} ${element.stroke}`
          : undefined,
        transform: `scale(${element.flip_x ? -1 : 1}, ${element.flip_y ? -1 : 1})`,
      }}
    >
      {tint && (
        <svg
          width="0"
          height="0"
          aria-hidden="true"
          style={{ position: "absolute" }}
        >
          <defs>
            <filter id={tintId}>
              <feColorMatrix
                type="matrix"
                values={`.65 0 0 0 ${tint[0]} 0 .65 0 0 ${tint[1]} 0 0 .65 0 ${tint[2]} 0 0 0 1 0`}
              />
            </filter>
          </defs>
        </svg>
      )}
      {url ? (
        <ResponsiveImage
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
            filter,
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
  playing = false,
  assetUrls,
}: {
  element: SlideElement;
  playing?: boolean;
  assetUrls?: Record<string, string>;
}) {
  if (element.kind === "table") return <NativeTable element={element} />;
  if (element.kind === "chart")
    return (
      <Suspense
        fallback={<LoadingState label="正在绘制图表…" variant="inline" />}
      >
        <ChartSvg element={element} />
      </Suspense>
    );
  if (element.kind === "audio" || element.kind === "video")
    return (
      <ManagedMedia element={element} playing={playing} assetUrls={assetUrls} />
    );
  if (
    element.kind === "image" ||
    element.kind === "vector" ||
    element.kind === "formula"
  )
    return (
      <ElementImage
        assetUrl={element.asset_id ? assetUrls?.[element.asset_id] : undefined}
        element={element}
        contain={element.kind === "vector" || element.kind === "formula"}
      />
    );
  if (element.kind === "text") return <ElementText element={element} />;
  return (
    <>
      <PresentationShape element={element} assetUrls={assetUrls} />
      {element.paragraphs.length > 0 && (
        <div style={{ position: "absolute", inset: 0 }}>
          <ElementText element={element} />
        </div>
      )}
    </>
  );
});

export function ElementText({ element }: { element: SlideElement }) {
  const markers = paragraphMarkers(element.paragraphs);
  return (
    <div
      className="presentation-text"
      style={{
        padding: element.text_layout?.padding ?? 8,
        letterSpacing: element.text_layout?.letter_spacing ?? 0,
        opacity: element.opacity,
        writingMode: element.text_layout?.vertical ? "vertical-rl" : undefined,
        display: "flex",
        flexDirection: "column",
        justifyContent:
          element.text_layout?.align === "middle"
            ? "center"
            : element.text_layout?.align === "bottom"
              ? "flex-end"
              : "flex-start",
      }}
    >
      {element.paragraphs.map((p, index) => (
        <p
          key={index}
          style={{
            textAlign: p.align,
            fontSize: Math.max(0, ...p.runs.map((r) => r.size)) || 24,
            fontFamily: fontFamily(p.runs[0]?.font ?? "Arial"),
            color: p.runs[0]?.color,
            paddingLeft: p.numbered
              ? "2em"
              : p.bullet
                ? 24
                : `${(p.indent ?? 0) * 2}em`,
            textIndent: p.first_line_indent ?? 0,
            marginTop: p.space_before ?? 0,
            marginBottom: p.space_after ?? 0,
            lineHeight: `${(Math.max(0, ...p.runs.map((r) => r.size)) || 24) * p.line_height}px`,
          }}
        >
          {markers[index] ? (
            <span
              className={`presentation-bullet${p.numbered ? " is-numbered" : ""}`}
            >
              {markers[index]}
            </span>
          ) : null}
          {p.runs.map((run, i) => (
            <span
              key={i}
              style={{
                fontFamily: fontFamily(run.code ? "Consolas" : run.font),
                fontSize: run.size,
                color: run.color,
                fontWeight: run.bold ? 700 : 400,
                fontStyle: run.italic ? "italic" : "normal",
                textDecoration:
                  [
                    run.underline ? "underline" : "",
                    run.strike ? "line-through" : "",
                  ]
                    .filter(Boolean)
                    .join(" ") || "none",
                backgroundColor: run.highlight ?? undefined,
                verticalAlign:
                  run.script === "sup"
                    ? "super"
                    : run.script === "sub"
                      ? "sub"
                      : undefined,
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
}

export const SlideSurface = memo(function SlideSurface({
  slide,
  children,
  editingId,
  selectedConnection,
  onSelectConnection,
  onMoveConnection,
  onMoveConnectionKey,
  size = defaultPageSize,
  playMedia = false,
  assetUrls,
  onNavigateSlide,
}: {
  onNavigateSlide?: (id: string) => void;
  playMedia?: boolean;
  assetUrls?: Record<string, string>;
  slide: Slide;
  size?: PageSize;
  children?: ReactNode;
  editingId?: string | null;
  selectedConnection?: string | null;
  onSelectConnection?: (id: string) => void;
  onMoveConnection?: React.ComponentProps<typeof Connections>["onMoveStart"];
  onMoveConnectionKey?: React.ComponentProps<typeof Connections>["onMoveKey"];
}) {
  if ("slides" in size) slide = resolveSlide(size as Deck, slide);
  const elements = new Map(
    slide.elements.map((element) => [element.id, element]),
  );
  return (
    <div
      className="presentation-slide"
      style={{
        background: slide.background,
        width: size.width,
        height: size.height,
      }}
    >
      {slide.background_style && (
        <PaintLayer paint={slide.background_style} assetUrls={assetUrls} />
      )}
      {sceneOrder(slide).map((item) => {
        if (item.kind === "connection") {
          if (
            [item.edge.source_id, item.edge.target_id].some(
              (id) => id != null && elements.get(id)?.hidden,
            )
          )
            return null;
          return (
            <Connections
              key={item.id}
              slide={slide}
              edges={[item.edge]}
              selected={selectedConnection}
              onSelect={onSelectConnection}
              onMoveStart={onMoveConnection}
              onMoveKey={onMoveConnectionKey}
            />
          );
        }
        const element = elements.get(item.id)!;
        if (element.hidden) return null;
        return (
          <div
            key={element.id}
            data-template-role={
              element.id.startsWith("master-")
                ? element.id.split("-")[
                    ["page", "global"].includes(element.id.split("-")[2])
                      ? 3
                      : 2
                  ]
                : undefined
            }
            onPointerDown={
              element.id.startsWith("master-")
                ? (event) => event.stopPropagation()
                : undefined
            }
            onDoubleClick={(event) => {
              if (!playMedia && element.id.startsWith("master-")) {
                event.stopPropagation();
                event.currentTarget.dispatchEvent(
                  new CustomEvent("presentation-template-edit", {
                    bubbles: true,
                    detail: {
                      role: element.id.split("-")[
                        ["page", "global"].includes(element.id.split("-")[2])
                          ? 3
                          : 2
                      ],
                    },
                  }),
                );
              }
            }}
            role={playMedia && element.link ? "link" : undefined}
            tabIndex={playMedia && element.link ? 0 : undefined}
            onClick={() => {
              if (playMedia && element.link) {
                if (element.link.type === "slide")
                  onNavigateSlide?.(element.link.target);
                else
                  window.open(
                    element.link.target,
                    "_blank",
                    "noopener,noreferrer",
                  );
              }
            }}
            onKeyDown={(event) => {
              if (
                playMedia &&
                element.link &&
                ["Enter", " "].includes(event.key)
              ) {
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.click();
              }
            }}
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
              <div
                className="presentation-element-content"
                style={{
                  width: "100%",
                  height: "100%",
                  filter: shadowFilter(element.shadow),
                }}
              >
                <ElementContent
                  element={element}
                  playing={playMedia}
                  assetUrls={assetUrls}
                />
              </div>
            ) : element.kind !== "text" ? (
              <PresentationShape element={element} assetUrls={assetUrls} />
            ) : null}
          </div>
        );
      })}
      {children}
    </div>
  );
});

export function SlidePreview({
  slide,
  width,
  size = defaultPageSize,
  assetUrls,
}: {
  assetUrls?: Record<string, string>;
  size?: PageSize;
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
        aspectRatio: `${size.width} / ${size.height}`,
        background: slide.background,
      }}
    >
      {visible ? (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            transform: `scale(${previewWidth / size.width})`,
            transformOrigin: "top left",
          }}
        >
          <SlideSurface slide={slide} size={size} assetUrls={assetUrls} />
        </div>
      ) : null}
    </div>
  );
}
