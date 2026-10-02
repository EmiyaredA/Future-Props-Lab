import { useId } from "react";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
import {
  edgePath,
  anchorPoint,
  canvasLines,
  sceneBounds,
  type CanvasElement,
  type CanvasScene,
} from "./model";

const iconPaths = {
  server: "M3 3h18v7H3z M3 14h18v7H3z M6 6h2 M6 17h2",
  database:
    "M3 5c0-4 18-4 18 0s-18 4-18 0v14c0 4 18 4 18 0V5 M3 12c0 4 18 4 18 0",
  user: "M16 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 22v-3a8 8 0 0 1 16 0v3",
  file: "M4 2h10l6 6v14H4z M14 2v6h6 M8 13h8 M8 17h8",
  cloud: "M6 19a5 5 0 0 1-1-10 7 7 0 0 1 13-2 6 6 0 0 1 0 12z",
  network: "M12 2v8 M3 22v-8h18v8 M3 18h18 M12 10v12",
  lock: "M5 10h14v12H5z M8 10V6a4 4 0 0 1 8 0v4",
  mail: "M2 4h20v16H2z M2 4l10 8 10-8",
  clock: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20 M12 6v6l4 2",
  globe:
    "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20 M2 12h20 M12 2c-6 6-6 14 0 20 6-6 6-14 0-20",
  code: "M8 5l-6 7 6 7 M16 5l6 7-6 7 M14 3l-4 18",
  cpu: "M6 6h12v12H6z M9 1v5 M15 1v5 M9 18v5 M15 18v5 M1 9h5 M1 15h5 M18 9h5 M18 15h5",
};
function ManagedSvgImage({
  id,
  width,
  height,
}: {
  id: string;
  width: number;
  height: number;
}) {
  const { url, error } = useApiBlobUrl(
    `/v1/files/${encodeURIComponent(id)}/content`,
  );
  return url ? (
    <image
      href={url}
      width={width}
      height={height}
      preserveAspectRatio="xMidYMid meet"
    />
  ) : (
    <text x={10} y={30} fill="#8a3e2a">
      {error ? "图片读取失败" : "加载图片…"}
    </text>
  );
}
export function CanvasShape({
  element: e,
  images,
}: {
  element: CanvasElement;
  images?: Record<string, string>;
}) {
  const { width: w, height: h } = e;
  const common = { fill: e.fill, stroke: e.stroke, strokeWidth: 2 };
  const size = e.fontSize ?? 15,
    lineHeight = (size * 4) / 3;
  const lines = canvasLines(e).slice(
    0,
    Math.max(1, Math.floor((h - (e.kind === "icon" ? 42 : 12)) / lineHeight)),
  );
  const align = e.textAlign ?? (e.kind === "frame" ? "left" : "center");
  const rgb = [1, 3, 5].map((start) =>
    parseInt(e.fill.slice(start, start + 2), 16),
  );
  const textColor =
    e.kind !== "frame" &&
    e.kind !== "text" &&
    rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114 < 128
      ? "#ffffff"
      : "#20383d";
  return (
    <g>
      {e.kind === "ellipse" ? (
        <ellipse
          cx={w / 2}
          cy={h / 2}
          rx={w / 2 - 2}
          ry={h / 2 - 2}
          {...common}
        />
      ) : e.kind === "diamond" ? (
        <polygon
          points={`${w / 2},2 ${w - 2},${h / 2} ${w / 2},${h - 2} 2,${h / 2}`}
          {...common}
        />
      ) : e.kind !== "text" ? (
        <rect
          x={1}
          y={1}
          width={w - 2}
          height={h - 2}
          rx={e.kind === "rounded" ? 14 : 2}
          {...common}
          fillOpacity={e.kind === "frame" ? 0.35 : 1}
          strokeDasharray={e.kind === "frame" ? "6 4" : undefined}
        />
      ) : null}
      {e.kind === "image" &&
        e.assetId &&
        (images ? (
          <image
            href={images[e.assetId]}
            width={w}
            height={h}
            preserveAspectRatio="xMidYMid meet"
          />
        ) : (
          <ManagedSvgImage id={e.assetId} width={w} height={h} />
        ))}
      {e.kind === "icon" && (
        <g
          transform={`translate(${w / 2 - 12},12)`}
          fill="none"
          stroke={e.stroke}
          strokeWidth={1.7}
        >
          <path d={iconPaths[e.icon || "server"]} />
        </g>
      )}
      {e.kind !== "image" && (
        <text
          fontFamily="system-ui, sans-serif"
          fontSize={size}
          fill={textColor}
          textAnchor={
            align === "left" ? "start" : align === "right" ? "end" : "middle"
          }
        >
          {lines.map((line, i) => (
            <tspan
              key={i}
              x={align === "left" ? 12 : align === "right" ? w - 12 : w / 2}
              y={
                e.kind === "frame"
                  ? size + 9 + i * lineHeight
                  : (e.kind === "icon"
                      ? 55
                      : Math.max(
                          22,
                          h / 2 -
                            ((lines.length - 1) * lineHeight) / 2 +
                            size / 3,
                        )) +
                    i * lineHeight
              }
            >
              {line}
            </tspan>
          ))}
        </text>
      )}
    </g>
  );
}
export function CanvasSvg({
  scene,
  images,
}: {
  scene: CanvasScene;
  images?: Record<string, string>;
}) {
  const bounds = sceneBounds(scene),
    marker = `arrow-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
      role="img"
      aria-label={scene.title}
    >
      <title>{scene.title}</title>
      <desc>{scene.elements.map((e) => e.text).join("；")}</desc>
      <defs>
        <marker
          id={marker}
          markerWidth="10"
          markerHeight="10"
          refX="8"
          refY="4"
          orient="auto"
        >
          <path
            d="M0 0L8 4L0 8"
            fill="none"
            stroke="#365f62"
            strokeWidth="1.5"
          />
        </marker>
      </defs>
      {scene.elements
        .filter((e) => e.kind === "frame")
        .map((e) => (
          <g key={e.id} transform={`translate(${e.x},${e.y})`}>
            <CanvasShape element={e} images={images} />
          </g>
        ))}
      {scene.edges.map((e) => {
        const a = scene.elements.find((n) => n.id === e.source),
          b = scene.elements.find((n) => n.id === e.target);
        if (!a || !b) return null;
        const source = anchorPoint(a, e.sourceAnchor ?? "right"),
          target = anchorPoint(b, e.targetAnchor ?? "left");
        const x1 = source.x,
          y1 = source.y,
          x2 = target.x,
          y2 = target.y;
        return (
          <g key={e.id}>
            <path
              d={edgePath(
                x1,
                y1,
                x2,
                y2,
                e.style === "step",
                e.sourceAnchor === "top" || e.sourceAnchor === "bottom",
              )}
              fill="none"
              stroke="#365f62"
              strokeWidth="2"
              markerEnd={e.arrow ? `url(#${marker})` : undefined}
            />
            <text
              x={(x1 + x2) / 2}
              y={(y1 + y2) / 2 - 8}
              textAnchor="middle"
              fontSize="13"
              fontFamily="system-ui, sans-serif"
              fill="#20383d"
              stroke="#fff"
              strokeWidth="4"
              paintOrder="stroke"
            >
              {e.label}
            </text>
          </g>
        );
      })}
      {scene.elements
        .filter((e) => e.kind !== "frame")
        .map((e) => (
          <g key={e.id} transform={`translate(${e.x},${e.y})`}>
            <CanvasShape element={e} images={images} />
          </g>
        ))}
    </svg>
  );
}
