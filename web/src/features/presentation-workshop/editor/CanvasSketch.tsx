import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { newElement } from "../templates";
import type { PageSize, SlideElement } from "../types";
type Point = { x: number; y: number };
export function CanvasSketch({
  mode,
  size,
  onFinish,
  onCancel,
  cancelRef,
}: {
  mode: "pen" | "polygon";
  size: PageSize;
  onFinish: (element: SlideElement) => void;
  onCancel: () => void;
  cancelRef: RefObject<(() => boolean) | null>;
}) {
  const [points, setPoints] = useState<Point[]>([]);
  const current = useRef<Point[]>([]),
    drawing = useRef(false);
  useLayoutEffect(() => {
    cancelRef.current = () => {
      onCancel();
      return true;
    };
    return () => {
      cancelRef.current = null;
    };
  }, [cancelRef, onCancel]);
  const finish = () => {
    const values = current.current;
    if (values.length < 2) {
      onCancel();
      return;
    }
    const x = Math.min(...values.map((p) => p.x)),
      y = Math.min(...values.map((p) => p.y));
    const width = Math.max(1, Math.max(...values.map((p) => p.x)) - x),
      height = Math.max(1, Math.max(...values.map((p) => p.y)) - y);
    onFinish(
      newElement("path", {
        x,
        y,
        width,
        height,
        stroke_width: 3,
        fill_opacity: mode === "polygon" ? 1 : 0,
        path: {
          points: values.map((p) => ({
            x: (p.x - x) / width,
            y: (p.y - y) / height,
          })),
          closed: mode === "polygon",
          smooth: mode === "pen",
        },
      }),
    );
  };
  const append = (point: Point) => {
    let next = [...current.current, point];
    if (next.length > 512)
      next = next.filter((_, i) => i % 2 === 0 || i === next.length - 1);
    current.current = next;
    setPoints(next);
  };
  return (
    <svg
      className="presentation-canvas-sketch"
      width="100%"
      height="100%"
      viewBox={`0 0 ${size.width} ${size.height}`}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 5,
        touchAction: "none",
        cursor: "crosshair",
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const box = event.currentTarget.getBoundingClientRect(),
          p = {
            x: ((event.clientX - box.left) / box.width) * size.width,
            y: ((event.clientY - box.top) / box.height) * size.height,
          };
        if (mode === "pen") {
          drawing.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          current.current = [];
        }
        append(p);
      }}
      onPointerMove={(event) => {
        if (!drawing.current) return;
        const box = event.currentTarget.getBoundingClientRect();
        const p = {
          x: ((event.clientX - box.left) / box.width) * size.width,
          y: ((event.clientY - box.top) / box.height) * size.height,
        };
        const last = current.current.at(-1);
        if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 2) append(p);
      }}
      onPointerUp={() => {
        if (mode === "pen" && drawing.current) {
          drawing.current = false;
          finish();
        }
      }}
      onPointerCancel={onCancel}
      onDoubleClick={(event) => {
        event.stopPropagation();
        if (mode === "polygon") finish();
      }}
    >
      <polyline
        points={points.map((p) => `${p.x},${p.y}`).join(" ")}
        fill={mode === "polygon" ? "#5474e522" : "none"}
        stroke="#5474e5"
        strokeWidth={3}
      />
      <text x={20} y={32} fontSize={18} fill="var(--text)">
        {mode === "pen"
          ? "拖动绘制，松手完成。Escape 取消。"
          : "点击添加顶点，双击完成。Escape 取消。"}
      </text>
    </svg>
  );
}
