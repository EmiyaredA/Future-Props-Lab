import { useEffect, useId, useRef, useState } from "react";
import type { PageSize } from "../types";
export type ShowTool =
  "none" | "pen" | "marker" | "arrow" | "rect" | "eraser" | "laser";
export type Point = { x: number; y: number };
export type Mark = { id: string; tool: ShowTool; points: Point[] };

export type AnnotationState = {
  marks: Mark[];
  draft: Mark | null;
  laser: Point | null;
};
export function ShowAnnotations({
  size,
  tool,
  blackboard,
  value,
  onChange,
}: {
  size: PageSize;
  tool: ShowTool;
  blackboard: boolean;
  value?: AnnotationState;
  onChange?: (state: AnnotationState) => void;
}) {
  const [marks, setMarks] = useState<Mark[]>([]),
    [draft, setDraft] = useState<Mark | null>(null),
    [laser, setLaser] = useState<Point | null>(null);
  const pending = useRef<Mark | null>(null),
    arrow = useId().replace(/:/g, "");
  useEffect(() => {
    onChange?.({ marks, draft, laser });
  }, [marks, draft, laser, onChange]);
  const displayed = value ?? { marks, draft, laser };
  return (
    <svg
      className="presentation-show-annotations"
      viewBox={`0 0 ${size.width} ${size.height}`}
      width="100%"
      height="100%"
      style={{
        pointerEvents: tool === "none" ? "none" : "auto",
        background: blackboard ? "#14251f" : undefined,
        touchAction: "none",
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        if (tool === "eraser") {
          const id = (event.target as Element).closest<SVGElement>(
            "[data-mark]",
          )?.dataset.mark;
          setMarks((all) => all.filter((m) => m.id !== id));
          return;
        }
        const box = event.currentTarget.getBoundingClientRect(),
          point = {
            x: ((event.clientX - box.left) / box.width) * size.width,
            y: ((event.clientY - box.top) / box.height) * size.height,
          };
        if (tool === "laser") {
          setLaser(point);
          return;
        }
        if (tool === "none") return;
        const next = { id: crypto.randomUUID(), tool, points: [point] };
        pending.current = next;
        setDraft(next);
      }}
      onPointerMove={(event) => {
        const box = event.currentTarget.getBoundingClientRect(),
          point = {
            x: ((event.clientX - box.left) / box.width) * size.width,
            y: ((event.clientY - box.top) / box.height) * size.height,
          };
        if (tool === "laser") {
          setLaser(point);
          return;
        }
        const mark = pending.current;
        if (!mark) return;
        const next = {
          ...mark,
          points:
            mark.tool === "rect" || mark.tool === "arrow"
              ? [mark.points[0], point]
              : [...mark.points, point],
        };
        if (next.points.length > 1000)
          next.points = next.points.filter(
            (_, i) => i % 2 === 0 || i === next.points.length - 1,
          );
        pending.current = next;
        setDraft(next);
      }}
      onPointerUp={() => {
        const completed = pending.current;
        if (completed)
          setMarks((all) => {
            let count = 0;
            return [...all, completed]
              .slice(-500)
              .reverse()
              .filter((mark) => {
                count += mark.points.length;
                return count <= 10000;
              })
              .reverse();
          });
        pending.current = null;
        setDraft(null);
      }}
      onPointerCancel={() => {
        pending.current = null;
        setDraft(null);
        setLaser(null);
      }}
      onPointerLeave={() => setLaser(null)}
    >
      <defs>
        <marker
          id={arrow}
          markerWidth="8"
          markerHeight="8"
          refX="7"
          refY="4"
          orient="auto"
        >
          <path d="M0,0L8,4L0,8Z" fill="#ff5757" />
        </marker>
      </defs>
      {[...displayed.marks, ...(displayed.draft ? [displayed.draft] : [])].map(
        (mark) => {
          const a = mark.points[0],
            b = mark.points.at(-1)!;
          const common = {
            key: mark.id,
            "data-mark": mark.id,
            fill: "none",
            stroke: mark.tool === "marker" ? "#fff23e" : "#ff5757",
            strokeWidth: mark.tool === "marker" ? 18 : 4,
            opacity: mark.tool === "marker" ? 0.4 : 1,
          };
          return mark.tool === "rect" ? (
            <rect
              {...common}
              x={Math.min(a.x, b.x)}
              y={Math.min(a.y, b.y)}
              width={Math.abs(a.x - b.x)}
              height={Math.abs(a.y - b.y)}
            />
          ) : (
            <path
              {...common}
              d={mark.points
                .map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`)
                .join(" ")}
              strokeLinecap="round"
              strokeLinejoin="round"
              markerEnd={mark.tool === "arrow" ? `url(#${arrow})` : undefined}
            />
          );
        },
      )}
      {displayed.laser && (
        <circle
          cx={displayed.laser.x}
          cy={displayed.laser.y}
          r={7}
          fill="#ff3131"
          stroke="#fff"
          strokeWidth={2}
        />
      )}
    </svg>
  );
}
