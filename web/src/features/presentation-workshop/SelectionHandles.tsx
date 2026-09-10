import { RotateCw } from "lucide-react";
import { resizeHandles, type Rect } from "./selectionGeometry";

export function SelectionHandles({
  box,
  rotation,
  scale,
}: {
  box: Rect;
  rotation: number;
  scale: number;
}) {
  return (
    <div
      className="presentation-selection"
      style={{
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
        borderWidth: 1.5 / scale,
        transform: `rotate(${rotation}deg)`,
      }}
    >
      {resizeHandles.map((handle) => (
        <button
          key={handle}
          data-handle="resize"
          data-resize={handle}
          className={`presentation-resize-handle handle-${handle}`}
          style={{ transform: `translate(-50%, -50%) scale(${1 / scale})` }}
          aria-label={`拖动缩放所选元素${handle === "se" ? "" : `（${handle}）`}`}
        />
      ))}
      <button
        data-handle="rotate"
        className="presentation-rotate-handle"
        style={{
          transform: `translate(-50%, 0) scale(${1 / scale})`,
          top: `calc(100% + ${18 / scale}px)`,
        }}
        aria-label="拖动旋转所选元素"
      >
        <RotateCw size={12} />
      </button>
    </div>
  );
}
