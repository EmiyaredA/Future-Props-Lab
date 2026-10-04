import { useRef } from "react";
export function ColumnResize({
  name,
  width,
  preview,
  commit,
}: {
  name: string;
  width: number;
  preview: (width: number | null) => void;
  commit: (width: number) => void;
}) {
  const drag = useRef<{ x: number; width: number; current: number } | null>(
    null,
  );
  const clamp = (value: number) =>
    Math.max(80, Math.min(800, Math.round(value)));
  const cancel = () => {
    drag.current = null;
    preview(null);
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`调整${name}列宽`}
      aria-valuemin={80}
      aria-valuemax={800}
      aria-valuenow={width}
      tabIndex={0}
      className="multitable-column-resize"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        drag.current = { x: event.clientX, width, current: width };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.focus();
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        const next = clamp(drag.current.width + event.clientX - drag.current.x);
        drag.current.current = next;
        preview(next);
      }}
      onPointerUp={(event) => {
        if (!drag.current) return;
        const { current, width: original } = drag.current;
        drag.current = null;
        if (current !== original) commit(current);
        preview(null);
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={() => {
        if (drag.current) cancel();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && drag.current) {
          event.preventDefault();
          cancel();
          return;
        }
        if (drag.current) return;
        const next =
          event.key === "ArrowLeft"
            ? width - 20
            : event.key === "ArrowRight"
              ? width + 20
              : event.key === "Home"
                ? 80
                : event.key === "End"
                  ? 800
                  : undefined;
        if (next === undefined) return;
        event.preventDefault();
        if (clamp(next) !== width) commit(clamp(next));
      }}
    />
  );
}
