import { useId, type PointerEvent, type KeyboardEvent } from "react";
import type { Slide } from "../types";
import { connectionPoints } from "./model";
import type { Connection } from "./model";
import { ConnectionLabels } from "./ConnectionLabels";

export function Connections({
  slide,
  selected,
  onSelect,
  onMoveStart,
  onMoveKey,
  onEditLabel,
  labels = true,
  edges = slide.connections ?? [],
}: {
  slide: Slide;
  selected?: string | null;
  onSelect?: (id: string) => void;
  edges?: Connection[];
  onMoveStart?: (event: PointerEvent, edge: Connection) => void;
  onMoveKey?: (event: KeyboardEvent, edge: Connection) => void;
  onEditLabel?: (edge: Connection) => void;
  labels?: boolean;
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
        const marker = `${prefix}-${edge.id}`;
        const markerSize = { small: 4, medium: 8, large: 12 }[
          edge.arrow_size ?? "medium"
        ];
        return (
          <g key={edge.id} data-connection-id={edge.id}>
            <defs>
              <marker
                id={marker}
                markerWidth={markerSize}
                markerHeight={markerSize}
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 Z" fill={edge.color ?? "#365F62"} />
              </marker>
            </defs>
            {(onSelect || selected === edge.id) && (
              <path
                className="presentation-connection-highlight"
                data-selected={selected === edge.id}
                d={d}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={(edge.width ?? 2) + 4}
                strokeLinejoin="round"
                aria-hidden="true"
              />
            )}
            <path
              d={d}
              fill="none"
              stroke={edge.color ?? "#365F62"}
              strokeWidth={edge.width ?? 2}
              markerEnd={edge.arrow !== false ? `url(#${marker})` : undefined}
            />
            {onSelect && (
              <path
                className="presentation-connection-hit"
                d={d}
                fill="none"
                stroke="transparent"
                strokeWidth="16"
                style={{ pointerEvents: "stroke", cursor: "move" }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onSelect(edge.id);
                  onMoveStart?.(e, edge);
                  // Dragging can focus the SVG hit area programmatically.
                  const hit = e.currentTarget;
                  hit.toggleAttribute(
                    "data-pointer-focus",
                    hit === hit.ownerDocument.activeElement,
                  );
                }}
                onBlur={(e) =>
                  e.currentTarget.removeAttribute("data-pointer-focus")
                }
                role="button"
                tabIndex={0}
                aria-label={`编辑连接${edge.label || edge.id}`}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  onEditLabel?.(edge);
                }}
                onKeyDown={(e) => {
                  e.currentTarget.removeAttribute("data-pointer-focus");
                  onMoveKey?.(e, edge);
                  if (e.key === "F2" && onEditLabel) {
                    e.preventDefault();
                    onEditLabel(edge);
                  } else if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(edge.id);
                  }
                }}
              />
            )}
          </g>
        );
      })}
      {labels && <ConnectionLabels slide={slide} edges={edges} />}
    </svg>
  );
}
