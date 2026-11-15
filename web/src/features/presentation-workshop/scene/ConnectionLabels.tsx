import { Fragment, type KeyboardEvent, type PointerEvent } from "react";
import type { Slide } from "../types";
import type { Connection } from "./model";
import { connectionPoints } from "./connectionGeometry";
import {
  labelLayout,
  labelFontSize,
  minLabelFontSize,
  maxLabelFontSize,
} from "./connectionLabelLayout";

export type LabelActions = {
  labelControlScale?: number;
  onEditLabel?: (edge: Connection) => void;
  onLabelPointerDown?: (
    event: PointerEvent<SVGGElement>,
    edge: Connection,
  ) => void;
  onLabelKeyDown?: (
    event: KeyboardEvent<SVGGElement>,
    edge: Connection,
  ) => void;
  onLabelResizePointerDown?: (
    event: PointerEvent<SVGGElement>,
    edge: Connection,
  ) => void;
  onLabelResizeKeyDown?: (
    event: KeyboardEvent<SVGGElement>,
    edge: Connection,
  ) => void;
  editingLabel?: string | null;
};

export function ConnectionLabels({
  slide,
  edges = slide.connections ?? [],
  onSelect,
  selected,
  onEditLabel,
  onLabelPointerDown,
  onLabelKeyDown,
  onLabelResizePointerDown,
  onLabelResizeKeyDown,
  editingLabel,
  labelControlScale = 1,
}: LabelActions & {
  slide: Slide;
  edges?: Connection[];
  selected?: string | null;
  onSelect?: (id: string) => void;
}) {
  const controlScale = Math.max(0.05, labelControlScale);
  return (
    <g className="presentation-connection-labels">
      {edges.map((edge) => {
        if (
          edge.id === editingLabel ||
          [edge.source_id, edge.target_id].some(
            (id) => id && slide.elements.find((e) => e.id === id)?.hidden,
          )
        )
          return null;
        const layout = labelLayout(connectionPoints(slide, edge), edge);
        if (!layout) return null;
        return (
          <Fragment key={edge.id}>
            <g
              data-connection-label={edge.id}
              style={{
                pointerEvents: onSelect ? "all" : "none",
                cursor: onSelect ? "move" : undefined,
                touchAction: "none",
              }}
              role={onSelect ? "button" : undefined}
              tabIndex={onSelect ? 0 : undefined}
              aria-label={onSelect ? `编辑连线文字：${edge.label}` : undefined}
              onPointerDown={(event) => {
                event.stopPropagation();
                onSelect?.(edge.id);
                onLabelPointerDown?.(event, edge);
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                onEditLabel?.(edge);
              }}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onEditLabel?.(edge);
                } else onLabelKeyDown?.(event, edge);
              }}
            >
              <rect
                x={layout.x}
                y={layout.y}
                width={layout.width}
                height={layout.height}
                rx="3"
                fill={slide.background}
                stroke={
                  onSelect && selected === edge.id ? "var(--accent)" : "none"
                }
                strokeWidth=".75"
              />
              <text
                x={layout.x + layout.width / 2}
                y={layout.y + 3 + (edge.label_font_size ?? labelFontSize)}
                textAnchor="middle"
                fontFamily="Microsoft YaHei, sans-serif"
                fontSize={edge.label_font_size ?? labelFontSize}
                fill={edge.color ?? "#365F62"}
              >
                {layout.lines.map((line, i) => (
                  <tspan
                    key={i}
                    x={layout.x + layout.width / 2}
                    dy={i ? (edge.label_font_size ?? labelFontSize) * 1.25 : 0}
                  >
                    {line || "\u00a0"}
                  </tspan>
                ))}
              </text>
            </g>
            {onSelect && selected === edge.id && onLabelResizePointerDown && (
              <g
                data-connection-label-resize={edge.id}
                role="slider"
                tabIndex={0}
                aria-label={`连线文字大小：${edge.label}`}
                aria-valuemin={minLabelFontSize}
                aria-valuemax={maxLabelFontSize}
                aria-valuenow={edge.label_font_size ?? labelFontSize}
                aria-valuetext={`${edge.label_font_size ?? labelFontSize} 像素`}
                style={{
                  cursor: "nwse-resize",
                  pointerEvents: "all",
                  touchAction: "none",
                }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onSelect(edge.id);
                  onLabelResizePointerDown(event, edge);
                }}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  onLabelResizeKeyDown?.(event, edge);
                }}
                onDoubleClick={(event) => event.stopPropagation()}
              >
                <title>拖动调整文字大小，方向键微调字号</title>
                <rect
                  x={layout.x + layout.width - 12 / controlScale}
                  y={layout.y + layout.height - 12 / controlScale}
                  width={24 / controlScale}
                  height={24 / controlScale}
                  fill="transparent"
                />
                <rect
                  x={layout.x + layout.width - 4 / controlScale}
                  y={layout.y + layout.height - 4 / controlScale}
                  width={8 / controlScale}
                  height={8 / controlScale}
                  rx={1}
                  fill="var(--surface)"
                  stroke="var(--accent)"
                  strokeWidth={1.5}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            )}
          </Fragment>
        );
      })}
    </g>
  );
}
