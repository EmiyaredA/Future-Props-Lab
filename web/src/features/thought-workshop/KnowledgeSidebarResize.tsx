import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  clampKnowledgeSidebarWidth,
  DEFAULT_KNOWLEDGE_SIDEBAR_WIDTH,
  MAX_KNOWLEDGE_SIDEBAR_WIDTH,
  MIN_KNOWLEDGE_SIDEBAR_WIDTH,
} from "./knowledgeSidebarWidth";

export function KnowledgeSidebarResize({
  width,
  onChange,
  onCommit,
}: {
  width: number;
  onChange: (width: number) => void;
  onCommit: (width: number) => void;
}) {
  const cleanupRef = useRef<() => void>(undefined);
  useEffect(() => () => cleanupRef.current?.(), []);

  const start = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    cleanupRef.current?.();
    event.currentTarget.focus();
    const pointerId = event.pointerId;
    const origin = event.clientX;
    const startWidth = width;
    let next = width;
    let frame: number | undefined;
    const cursor = document.body.style.cursor;
    const userSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.body.classList.add("knowledge-sidebar-resizing");

    const calculate = (pointer: PointerEvent) =>
      clampKnowledgeSidebarWidth(startWidth + (pointer.clientX - origin));

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
      document.body.classList.remove("knowledge-sidebar-resizing");
      cleanupRef.current = undefined;
    };

    const finish = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      cleanup();
      const committed = calculate(pointer);
      onChange(committed);
      onCommit(committed);
    };

    const cancel = () => {
      cleanup();
      onChange(startWidth);
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
      aria-label="调整知识库导航宽度"
      aria-orientation="vertical"
      aria-valuemin={MIN_KNOWLEDGE_SIDEBAR_WIDTH}
      aria-valuemax={MAX_KNOWLEDGE_SIDEBAR_WIDTH}
      aria-valuenow={width}
      aria-valuetext={`${width} 像素`}
      className="knowledge-sidebar-resize"
      title="拖动调整宽度，双击恢复默认"
      onPointerDown={start}
      onDoubleClick={() => {
        onChange(DEFAULT_KNOWLEDGE_SIDEBAR_WIDTH);
        onCommit(DEFAULT_KNOWLEDGE_SIDEBAR_WIDTH);
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        event.stopPropagation();
        const step = event.shiftKey ? 40 : 10;
        const next = clampKnowledgeSidebarWidth(
          width + (event.key === "ArrowRight" ? step : -step),
        );
        onChange(next);
        onCommit(next);
      }}
    />
  );
}
