import { FilePlus2, Library, Upload } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { useSelectPopover } from "@shared/ui/useSelectPopover";

export function VideoEditorAssetAddMenu({
  open,
  disabled,
  ariaLabel,
  tooltip = "添加素材",
  onToggle,
  onClose,
  onLocalUpload,
  onImport,
}: {
  open: boolean;
  disabled?: boolean;
  ariaLabel: string;
  tooltip?: string;
  onToggle: () => void;
  onClose: () => void;
  onLocalUpload: () => void;
  onImport: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  useSelectPopover(open, trigger, menu, 120, 168, "end");
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <div className="ve-asset-add-wrap" ref={root}>
      <button
        ref={trigger}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? id : undefined}
        data-tooltip={tooltip}
        onClick={onToggle}
      >
        <FilePlus2 aria-hidden />
      </button>
      {open ? (
        <div
          ref={menu}
          id={id}
          className="ve-asset-add-menu"
          role="menu"
          popover="manual"
        >
          <button type="button" role="menuitem" onClick={onLocalUpload}>
            <Upload aria-hidden /> 本地上传
          </button>
          <button type="button" role="menuitem" onClick={onImport}>
            <Library aria-hidden /> 从其他项目导入
          </button>
        </div>
      ) : null}
    </div>
  );
}
