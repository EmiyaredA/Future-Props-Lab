import { pathData } from "./objects/pathGeometry";
import { polygonFor } from "./shapeCatalog";
import { useId } from "react";
import type { SlideElement } from "./types";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";

export function PresentationShape({
  element,
  assetUrls,
}: {
  element: SlideElement;
  assetUrls?: Record<string, string>;
}) {
  const { width: w, height: h, stroke_width: s } = element;
  const inset = s / 2;
  const polygon = polygonFor(element.kind, w, h);
  const markerId = useId().replace(/:/g, "");
  const paint = element.paint;
  const override = paint?.asset_id ? assetUrls?.[paint.asset_id] : undefined;
  const asset = useApiBlobUrl(
    paint?.asset_id && !override
      ? `/v1/files/${encodeURIComponent(paint.asset_id)}/content`
      : null,
  );
  const paintId = `${markerId}-paint`;
  const radians = ((paint?.angle ?? 90) * Math.PI) / 180;
  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${w} ${h}`}
      style={{
        overflow: "visible",
        display: "block",
        opacity: element.opacity ?? 1,
        transform: `scale(${element.flip_x ? -1 : 1}, ${element.flip_y ? -1 : 1})`,
      }}
      aria-hidden
    >
      <defs>
        {paint?.type === "linear" && (
          <linearGradient
            id={paintId}
            x1={0.5 - Math.sin(radians) / 2}
            y1={0.5 + Math.cos(radians) / 2}
            x2={0.5 + Math.sin(radians) / 2}
            y2={0.5 - Math.cos(radians) / 2}
          >
            <stop stopColor={paint.color} />
            <stop offset="1" stopColor={paint.end_color} />
          </linearGradient>
        )}
        {paint?.type === "radial" && (
          <radialGradient id={paintId}>
            <stop stopColor={paint.color} />
            <stop offset="1" stopColor={paint.end_color} />
          </radialGradient>
        )}
        {paint?.type === "image" && (
          <pattern
            id={paintId}
            patternUnits="userSpaceOnUse"
            width={paint.fit === "repeat" ? 256 : w}
            height={paint.fit === "repeat" ? 256 : h}
          >
            <rect width="100%" height="100%" fill={paint.color} />
            <image
              href={override ?? asset.url ?? undefined}
              width={paint.fit === "repeat" ? 256 : w}
              height={paint.fit === "repeat" ? 256 : h}
              preserveAspectRatio={
                paint.fit === "contain" ? "xMidYMid meet" : "xMidYMid slice"
              }
            />
          </pattern>
        )}
        {(["triangle", "open", "circle"] as const).map((type) => (
          <marker
            key={type}
            id={`${markerId}-${type}`}
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="4"
            markerHeight="4"
            orient="auto-start-reverse"
          >
            {type === "circle" ? (
              <circle cx="4" cy="4" r="3" fill={element.stroke} />
            ) : (
              <path
                d="M1 1 L7 4 L1 7"
                fill={type === "open" ? "none" : element.stroke}
                stroke={element.stroke}
                strokeWidth="1.5"
              />
            )}
          </marker>
        ))}
      </defs>
      {paint?.type === "image" && !override && !asset.url && (
        <text role="status" x={4} y={20}>
          {asset.error ? "图片加载失败" : "加载图片…"}
        </text>
      )}
      <g
        fill={
          !paint
            ? element.fill
            : paint.type === "solid"
              ? paint.color
              : `url(#${paintId})`
        }
        fillOpacity={element.fill_opacity ?? 1}
        strokeDasharray={
          element.stroke_dash === "dash"
            ? `${4 * s} ${3 * s}`
            : element.stroke_dash === "dot"
              ? `${s} ${s}`
              : undefined
        }
        stroke={element.stroke}
        strokeWidth={s}
        strokeLinejoin="round"
      >
        {element.kind === "path" && element.path && (
          <path d={pathData(element.path, w, h)} />
        )}
        {element.kind === "rect" || element.kind === "roundRect" ? (
          <rect
            x={inset}
            y={inset}
            width={Math.max(1, w - s)}
            height={Math.max(1, h - s)}
            rx={
              element.kind === "roundRect"
                ? Math.min(
                    element.corner_radius ?? Math.min(w, h) * 0.166,
                    Math.min(w, h) / 2,
                  )
                : 0
            }
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
        {polygon && <polygon points={polygon} />}
        {element.kind === "line" ? (
          <line
            x1={0}
            y1={0}
            x2={w}
            y2={h}
            fill="none"
            markerStart={
              element.start_arrow && element.start_arrow !== "none"
                ? `url(#${markerId}-${element.start_arrow})`
                : undefined
            }
            markerEnd={
              element.end_arrow && element.end_arrow !== "none"
                ? `url(#${markerId}-${element.end_arrow})`
                : undefined
            }
          />
        ) : null}
      </g>
      {(element.fill_opacity ?? 1) === 0 &&
        (element.kind === "rect" || element.kind === "roundRect") && (
          <path
            className="presentation-shape-hit-edge"
            d={`M ${inset} ${inset} H ${w - inset} V ${h - inset} H ${inset} Z`}
            fill="none"
            stroke="transparent"
            strokeWidth="8"
            vectorEffect="non-scaling-stroke"
          />
        )}
    </svg>
  );
}
