import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { clampLayoutValue } from "./editorLayout";

export type VideoEditorSeparatorProps = {
  label: string;
  orientation: "horizontal" | "vertical";
  value: number;
  restoreValue?: number;
  min: number;
  max: number;
  reverse?: boolean;
  onChange: (value: number) => void;
  onReset: () => void;
  className?: string;
};

export function VideoEditorSeparator({
  label,
  orientation,
  value,
  restoreValue = value,
  min,
  max,
  reverse = false,
  onChange,
  onReset,
  className = "",
}: VideoEditorSeparatorProps) {
  const cleanupRef = useRef<() => void>(undefined);
  useEffect(() => () => cleanupRef.current?.(), []);
  const direction = reverse ? -1 : 1;
  const start = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    cleanupRef.current?.();
    event.currentTarget.focus();
    const pointerId = event.pointerId;
    const coordinate = (pointer: PointerEvent | ReactPointerEvent) =>
      orientation === "vertical" ? pointer.clientX : pointer.clientY;
    const origin = coordinate(event);
    let next = value;
    let frame: number | undefined;
    const cursor = document.body.style.cursor;
    const userSelect = document.body.style.userSelect;
    document.body.style.cursor =
      orientation === "vertical" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    const calculate = (pointer: PointerEvent) =>
      clampLayoutValue(
        value + direction * (coordinate(pointer) - origin),
        min,
        max,
      );
    const move = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      pointer.preventDefault();
      next = calculate(pointer);
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        onChange(next);
      });
    };
    const cleanup = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancelPointer);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", keydown);
      document.body.style.cursor = cursor;
      document.body.style.userSelect = userSelect;
      cleanupRef.current = undefined;
    };
    const finish = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      cleanup();
      onChange(calculate(pointer));
    };
    const cancel = () => {
      cleanup();
      onChange(restoreValue);
    };
    const cancelPointer = (pointer: PointerEvent) => {
      if (pointer.pointerId === pointerId) cancel();
    };
    const keydown = (key: KeyboardEvent) => {
      if (key.key === "Escape") {
        key.preventDefault();
        key.stopPropagation();
        cancel();
      }
    };
    cleanupRef.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancelPointer);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", keydown);
  };
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(value)}
      aria-valuetext={`${Math.round(value)} 像素`}
      className={`ve-panel-separator ${orientation} ${className}`}
      title={`${label}，双击恢复默认`}
      onPointerDown={start}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        const keys =
          orientation === "vertical"
            ? ["ArrowLeft", "ArrowRight"]
            : ["ArrowUp", "ArrowDown"];
        const index = keys.indexOf(event.key);
        if (index < 0) return;
        event.preventDefault();
        event.stopPropagation();
        onChange(
          clampLayoutValue(
            value +
              (index === 0 ? -1 : 1) * direction * (event.shiftKey ? 40 : 10),
            min,
            max,
          ),
        );
      }}
    />
  );
}
