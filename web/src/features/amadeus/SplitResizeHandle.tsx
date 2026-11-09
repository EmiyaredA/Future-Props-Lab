import { useRef, type PointerEvent } from "react";

export function SplitResizeHandle({
  panelId,
  width,
  preferredWidth,
  min,
  max,
  onResize,
}: {
  panelId: string;
  width: number;
  preferredWidth: number | null;
  min: number;
  max: number;
  onResize: (width: number | null) => void;
}) {
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
    previousWidth: number | null;
  } | null>(null);
  const clamp = (value: number) => Math.min(max, Math.max(min, value));
  const resizeFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (active?.pointerId !== event.pointerId) return;
    const delta = active.startX - event.clientX;
    if (delta !== 0 || preferredWidth !== active.previousWidth)
      onResize(clamp(active.startWidth + delta));
  };

  return (
    <div
      className="website-assistant-resize"
      role="separator"
      tabIndex={0}
      aria-label="调整 Amadeus 分屏宽度"
      aria-controls={panelId}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      aria-valuetext={`Amadeus 宽 ${width} 像素`}
      title="拖动调整分屏宽度，双击恢复默认"
      onPointerDown={(event) => {
        if (event.button !== 0 || drag.current) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startWidth: width,
          previousWidth: preferredWidth,
        };
      }}
      onPointerMove={resizeFromPointer}
      onPointerUp={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        resizeFromPointer(event);
        drag.current = null;
      }}
      onLostPointerCapture={(event) => {
        const active = drag.current;
        if (active?.pointerId !== event.pointerId) return;
        drag.current = null;
        onResize(active.previousWidth);
      }}
      onDoubleClick={() => onResize(null)}
      onKeyDown={(event) => {
        const active = drag.current;
        if (event.key === "Escape" && active) {
          event.preventDefault();
          drag.current = null;
          if (event.currentTarget.hasPointerCapture(active.pointerId))
            event.currentTarget.releasePointerCapture(active.pointerId);
          onResize(active.previousWidth);
        }
        if (active) return;
        const step = event.shiftKey ? 40 : 10;
        let next: number;
        switch (event.key) {
          case "ArrowLeft":
            next = width + step;
            break;
          case "ArrowRight":
            next = width - step;
            break;
          case "Home":
            next = min;
            break;
          case "End":
            next = max;
            break;
          default:
            return;
        }
        event.preventDefault();
        onResize(clamp(next));
      }}
    />
  );
}
