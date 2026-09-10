import { polygonFor } from "./shapeCatalog";
import { useId } from "react";
import type { SlideElement } from "./types";

export function PresentationShape({ element }: { element: SlideElement }) {
  const { width: w, height: h, stroke_width: s } = element;
  const inset = s / 2;
  const polygon = polygonFor(element.kind, w, h);
  const markerId = useId().replace(/:/g, "");
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
      <g
        fill={element.fill}
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
