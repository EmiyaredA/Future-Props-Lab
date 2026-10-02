import { useEffect, useRef, type MutableRefObject } from "react";
import {
  Clipboard,
  Copy,
  Focus,
  Image,
  Music,
  Type,
  Upload,
  Video,
} from "lucide-react";

type Point = { x: number; y: number };
export function CanvasContextMenu({
  position,
  onCreate,
  onUpload,
  onFit,
  onPaste,
  canPaste,
  onCopy,
  canCopy,
  onClose,
  skipFocusRestoreRef,
}: {
  position: { left: number; top: number; worldX: number; worldY: number };
  onCreate: (
    kind: "text" | "image" | "video" | "audio",
    point: Point,
  ) => unknown;
  onUpload: (point: Point) => void;
  onFit: () => void;
  onPaste: (point: Point) => unknown;
  canPaste: boolean;
  onCopy: () => void;
  canCopy: boolean;
  onClose: () => void;
  skipFocusRestoreRef?: MutableRefObject<boolean>;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const node = menu.current;
    if (!node) return;
    const outsidePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !node.contains(event.target)) {
        if (skipFocusRestoreRef) skipFocusRestoreRef.current = true;
        close.current();
      }
    };
    const previous = document.activeElement as HTMLElement | null;
    const buttons = [
      ...node.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
    ];
    buttons[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Tab") {
        event.preventDefault();
        close.current();
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const index = buttons.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      buttons[
        (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
          buttons.length
      ]?.focus();
    };
    node.addEventListener("keydown", key);
    document.addEventListener("pointerdown", outsidePointerDown);
    return () => {
      node.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", outsidePointerDown);
      if (skipFocusRestoreRef?.current) {
        skipFocusRestoreRef.current = false;
        return;
      }
      const active = document.activeElement;
      if (active instanceof HTMLInputElement && active.type === "file") return;
      previous?.focus();
    };
  }, [skipFocusRestoreRef]);
  const point = { x: position.worldX, y: position.worldY };
  return (
    <div
      ref={menu}
      className="canvas-context-menu"
      role="menu"
      aria-label="添加画布内容"
      style={{
        left: Math.max(12, Math.min(position.left, innerWidth - 176)),
        top: Math.max(
          12,
          Math.min(
            position.top,
            (window.visualViewport?.height ?? innerHeight) - 350,
          ),
        ),
        maxHeight: "calc(var(--visible-height, 100dvh) - 24px)",
        overflowY: "auto",
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button role="menuitem" onClick={() => onUpload(point)}>
        <Upload aria-hidden /> 上传
      </button>
      {(
        [
          ["text", "文本", Type],
          ["image", "图片", Image],
          ["video", "视频", Video],
          ["audio", "音频", Music],
        ] as const
      ).map(([kind, label, Icon]) => (
        <button
          key={kind}
          role="menuitem"
          onClick={() => {
            void onCreate(kind, point);
          }}
        >
          <Icon aria-hidden /> 添加{label}节点
        </button>
      ))}
      <button
        role="menuitem"
        onClick={() => {
          onFit();
          onClose();
        }}
      >
        <Focus aria-hidden /> 适应屏幕
      </button>
      <i aria-hidden />
      <button role="menuitem" disabled={!canCopy} onClick={onCopy}>
        <Copy aria-hidden /> 复制选中节点
      </button>
      <button
        role="menuitem"
        disabled={!canPaste}
        onClick={() => {
          void onPaste(point);
        }}
      >
        <Clipboard aria-hidden /> 粘贴
      </button>
    </div>
  );
}
