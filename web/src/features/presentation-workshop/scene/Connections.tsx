import { useId, type PointerEvent, type KeyboardEvent } from "react";
import type { Slide } from "../types";
import { connectionPoints } from "./model";
import type { Connection } from "./model";

export function Connections({
  slide,
  selected,
  onSelect,
  onMoveStart,
  onMoveKey,
  edges = slide.connections ?? [],
}: {
  slide: Slide;
  selected?: string | null;
  onSelect?: (id: string) => void;
  edges?: Connection[];
  onMoveStart?: (event: PointerEvent, edge: Connection) => void;
  onMoveKey?: (event: KeyboardEvent, edge: Connection) => void;
}) {
  const prefix = useId().replace(/:/g, "");
  return (
    <svg
      className="presentation-connections"
      width="100%"
      height="100%"
      aria-label="信息图连接"
    >
      {edges.map((edge) => {
        const points = connectionPoints(slide, edge);
        if (!points.length) return null;
        const d = points
          .map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`)
          .join(" ");
        const lengths = points
          .slice(1)
          .map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
        let remaining = lengths.reduce((a, b) => a + b, 0) / 2;
        let middle = points[0];
        for (let i = 0; i < lengths.length; i++) {
          if (remaining <= lengths[i]) {
            const ratio = lengths[i] ? remaining / lengths[i] : 0;
            middle = {
              x: points[i].x + (points[i + 1].x - points[i].x) * ratio,
              y: points[i].y + (points[i + 1].y - points[i].y) * ratio,
            };
            break;
          }
          remaining -= lengths[i];
        }
        const marker = `${prefix}-${edge.id}`;
        return (
          <g key={edge.id} data-connection-id={edge.id}>
            <defs>
              <marker
                id={marker}
                markerWidth="8"
                markerHeight="8"
                refX="7"
                refY="4"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 Z" fill={edge.color ?? "#365F62"} />
              </marker>
            </defs>
            {selected === edge.id && (
              <path
                d={d}
                fill="none"
                stroke="var(--accent)"
                strokeOpacity="0.3"
                strokeWidth={(edge.width ?? 2) + 8}
              />
            )}
            <path
              d={d}
              fill="none"
              stroke={edge.color ?? "#365F62"}
              strokeWidth={edge.width ?? 2}
              markerEnd={edge.arrow !== false ? `url(#${marker})` : undefined}
            />
            {edge.label && (
              <text
                x={middle.x}
                y={middle.y - 10}
                textAnchor="middle"
                fill={edge.color ?? "#365F62"}
                fontSize="16"
                paintOrder="stroke"
                stroke={slide.background}
                strokeWidth="5"
              >
                {edge.label}
              </text>
            )}
            {onSelect && (
              <path
                d={d}
                fill="none"
                stroke="transparent"
                strokeWidth="16"
                style={{ pointerEvents: "stroke", cursor: "move" }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onSelect(edge.id);
                  onMoveStart?.(e, edge);
                }}
                role="button"
                tabIndex={0}
                aria-label={`编辑连接${edge.label || edge.id}`}
                onKeyDown={(e) => {
                  onMoveKey?.(e, edge);
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(edge.id);
                  }
                }}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}
