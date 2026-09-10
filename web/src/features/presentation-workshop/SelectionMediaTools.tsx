import { useEffect, useRef, useState } from "react";
import {
  Crop,
  Replace,
  FlipHorizontal,
  FlipVertical,
  ScanSearch,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useSelectPopover } from "@shared/ui/useSelectPopover";
import { MediaAppearance } from "./MediaAppearance";
import type { SlideElement } from "./types";
export type MediaActions = {
  replace: () => void;
  crop: () => void;
  preview: () => void;
  download: () => void;
};
export function SelectionMediaTools({
  element,
  patch,
  actions,
}: {
  element: SlideElement;
  patch: (p: Partial<SlideElement>) => void;
  actions?: MediaActions;
}) {
  const [open, setOpen] = useState(false),
    trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null);
  useSelectPopover(open, trigger, menu, 360, 270);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLInputElement>("input")?.focus();
    const listener = (event: MouseEvent) => {
      if (
        !menu.current?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("mousedown", listener);
    return () => document.removeEventListener("mousedown", listener);
  }, [open]);
  return (
    <>
      <button onClick={actions?.replace} title="更换素材" aria-label="更换素材">
        <Replace size={16} />
        <span>更换</span>
      </button>
      {element.kind === "image" && (
        <button onClick={actions?.crop} aria-label="裁剪图片">
          <Crop size={16} />
          <span>裁剪</span>
        </button>
      )}
      <button
        className="selection-secondary"
        aria-label="水平翻转"
        title="水平翻转"
        aria-pressed={!!element.flip_x}
        onClick={() => patch({ flip_x: !element.flip_x })}
      >
        <FlipHorizontal size={16} />
      </button>
      <button
        className="selection-secondary"
        aria-label="垂直翻转"
        title="垂直翻转"
        aria-pressed={!!element.flip_y}
        onClick={() => patch({ flip_y: !element.flip_y })}
      >
        <FlipVertical size={16} />
      </button>
      <button aria-label="预览原图" title="预览原图" onClick={actions?.preview}>
        <ScanSearch size={16} />
      </button>
      <button
        ref={trigger}
        aria-label="素材外观"
        title="素材外观"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
      >
        <SlidersHorizontal size={16} />
      </button>
      {open && (
        <div
          ref={menu}
          className="presentation-media-popover"
          role="dialog"
          aria-label="素材外观设置"
          popover="manual"
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
              trigger.current?.focus();
            }
          }}
        >
          <button
            className="icon-btn"
            aria-label="关闭外观设置"
            onClick={() => {
              setOpen(false);
              trigger.current?.focus();
            }}
          >
            <X size={15} />
          </button>
          <MediaAppearance element={element} patch={patch} />
        </div>
      )}
    </>
  );
}
