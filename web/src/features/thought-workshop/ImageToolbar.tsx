import { useEffect, useId, useRef, useState, type RefObject } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Crop,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";
import { useImagePopover } from "./useImagePopover";
import "./image-toolbar.css";

export function ImageToolbar({
  frame,
  suspended,
  width,
  alt,
  caption,
  align,
  cropped,
  updateAttributes,
  onCrop,
  onReset,
}: {
  frame: RefObject<HTMLDivElement | null>;
  suspended: boolean;
  width: number;
  alt: string;
  caption: string;
  align: string;
  cropped: boolean;
  updateAttributes: (attrs: Record<string, unknown>) => void;
  onCrop: () => void;
  onReset: () => void;
}) {
  const toolbar = useRef<HTMLDivElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const settings = useRef<HTMLDivElement>(null);
  const widthInput = useRef<HTMLInputElement>(null);
  const settingsId = useId();
  const [expanded, setExpanded] = useState(false);
  const [widthDraft, setWidthDraft] = useState<string | null>(null);
  useImagePopover(!suspended, frame, toolbar, "toolbar");
  useImagePopover(expanded && !suspended, settingsButton, settings, "settings");

  const commitWidth = () => {
    if (widthDraft === null) return;
    const value = Number(widthDraft);
    if (widthDraft.trim() && Number.isFinite(value)) {
      const next = Math.max(40, Math.min(2000, Math.round(value)));
      if (next !== width) updateAttributes({ width: next });
    }
    setWidthDraft(null);
  };
  const closeSettings = (restoreFocus = false) => {
    commitWidth();
    setExpanded(false);
    if (restoreFocus) settingsButton.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (!expanded) return;
    const onOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !settings.current?.contains(event.target) &&
        !toolbar.current?.contains(event.target)
      ) {
        closeSettings();
      }
    };
    document.addEventListener("pointerdown", onOutside, true);
    return () => document.removeEventListener("pointerdown", onOutside, true);
  });
  return (
    <div
      className="thought-image-actions"
      contentEditable={false}
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          expanded &&
          !event.nativeEvent.isComposing
        ) {
          event.preventDefault();
          event.stopPropagation();
          closeSettings(true);
        }
      }}
    >
      <div
        ref={toolbar}
        popover="manual"
        className="thought-image-toolbar"
        role="toolbar"
        aria-label="图片操作"
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          event.stopPropagation();
          const buttons = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ),
          ];
          const current = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? buttons.length - 1
                : (current +
                    (event.key === "ArrowRight" ? 1 : -1) +
                    buttons.length) %
                  buttons.length;
          buttons[next]?.focus();
        }}
      >
        <button
          type="button"
          aria-label="裁剪"
          data-tooltip="裁剪"
          onClick={(event) => {
            closeSettings();
            event.currentTarget.focus({ preventScroll: true });
            onCrop();
          }}
        >
          <Crop aria-hidden />
        </button>
        <button
          ref={settingsButton}
          type="button"
          aria-label="图片设置"
          data-tooltip="图片设置"
          aria-expanded={expanded}
          aria-controls={settingsId}
          onClick={() => {
            if (expanded) closeSettings();
            else {
              setExpanded(true);
              requestAnimationFrame(() =>
                widthInput.current?.focus({ preventScroll: true }),
              );
            }
          }}
        >
          <SlidersHorizontal aria-hidden />
        </button>
        <span className="thought-image-toolbar-divider" aria-hidden />
        {(
          [
            ["left", "图片左对齐", AlignLeft],
            ["center", "图片居中", AlignCenter],
            ["right", "图片右对齐", AlignRight],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            aria-label={label}
            data-tooltip={label}
            aria-pressed={align === value}
            onClick={() => {
              closeSettings();
              updateAttributes({ align: value });
            }}
          >
            <Icon aria-hidden />
          </button>
        ))}
        <button
          type="button"
          aria-label="重置裁剪"
          data-tooltip="重置裁剪"
          disabled={!cropped}
          onClick={() => {
            closeSettings();
            onReset();
          }}
        >
          <RotateCcw aria-hidden />
        </button>
      </div>
      {expanded && (
        <div
          ref={settings}
          id={settingsId}
          popover="manual"
          className="thought-image-settings"
          role="dialog"
          aria-label="图片设置"
        >
          <label>
            <span>显示宽度</span>
            <span className="thought-image-width-input">
              <input
                ref={widthInput}
                aria-label="图片宽度"
                inputMode="numeric"
                value={widthDraft ?? String(width)}
                onChange={(event) => setWidthDraft(event.target.value)}
                onBlur={commitWidth}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    commitWidth();
                  }
                }}
              />
              <span aria-hidden>px</span>
            </span>
          </label>
          <label>
            <span>替代文字</span>
            <input
              aria-label="图片替代文字"
              value={alt}
              placeholder="简要描述图片内容"
              onChange={(event) =>
                updateAttributes({ alt: event.target.value })
              }
            />
          </label>
          <label>
            <span>图注</span>
            <input
              aria-label="图片图注"
              value={caption}
              placeholder="添加图片说明（可选）"
              onChange={(event) =>
                updateAttributes({ caption: event.target.value })
              }
            />
          </label>
        </div>
      )}
    </div>
  );
}
