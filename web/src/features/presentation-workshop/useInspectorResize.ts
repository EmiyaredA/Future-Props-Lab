import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

const MIN_WIDTH = 240;
const DEFAULT_WIDTH = 280;
export function useInspectorResize() {
  const ref = useRef<HTMLElement>(null);
  const gesture = useRef<{ x: number; width: number } | null>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [maximum, setMaximum] = useState(480);
  const [dragging, setDragging] = useState(false);
  const effectiveWidth = Math.min(width, maximum);
  const clamp = (value: number) =>
    Math.max(MIN_WIDTH, Math.min(maximum, value));
  useEffect(() => {
    const workspace = ref.current?.parentElement;
    if (!workspace) return;
    const measure = () => {
      const size = workspace.getBoundingClientRect().width;
      if (size > 0)
        setMaximum(Math.max(MIN_WIDTH, Math.min(480, Math.floor(size * 0.42))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(workspace);
    return () => observer.disconnect();
  }, []);
  const reset = () => setWidth(DEFAULT_WIDTH);
  const finish = (event: PointerEvent<HTMLElement>, cancel = false) => {
    if (cancel && gesture.current) setWidth(gesture.current.width);
    gesture.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return {
    ref,
    width: effectiveWidth,
    dragging,
    reset,
    separator: {
      role: "separator" as const,
      tabIndex: 0,
      "aria-label": "调整格式面板宽度",
      "aria-orientation": "vertical" as const,
      "aria-valuemin": MIN_WIDTH,
      "aria-valuemax": maximum,
      "aria-valuenow": effectiveWidth,
      "aria-valuetext": `${effectiveWidth} 像素`,
      title: "拖动调整宽度，双击恢复默认；方向键微调",
      onDoubleClick: reset,
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        gesture.current = { x: event.clientX, width: effectiveWidth };
        setDragging(true);
      },
      onPointerMove: (event: PointerEvent<HTMLElement>) => {
        if (gesture.current)
          setWidth(
            clamp(
              Math.round(
                gesture.current.width + gesture.current.x - event.clientX,
              ),
            ),
          );
      },
      onPointerUp: (event: PointerEvent<HTMLElement>) => finish(event),
      onPointerCancel: (event: PointerEvent<HTMLElement>) =>
        finish(event, true),
      onLostPointerCapture: () => {
        gesture.current = null;
        setDragging(false);
      },
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        event.stopPropagation();
        if (
          ![
            "ArrowLeft",
            "ArrowRight",
            "Home",
            "End",
            "Enter",
            "Escape",
          ].includes(event.key)
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        const step = event.shiftKey ? 50 : 10;
        if (event.key === "Escape" && gesture.current) {
          setWidth(gesture.current.width);
          gesture.current = null;
          setDragging(false);
        } else if (event.key === "Enter") reset();
        else if (event.key === "Home") setWidth(MIN_WIDTH);
        else if (event.key === "End") setWidth(maximum);
        else if (event.key === "ArrowLeft")
          setWidth(clamp(effectiveWidth + step));
        else if (event.key === "ArrowRight")
          setWidth(clamp(effectiveWidth - step));
      },
    },
  };
}
