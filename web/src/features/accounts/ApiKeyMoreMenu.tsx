import { useEffect, useId, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { useSelectPopover } from "@shared/ui/useSelectPopover";

export function ApiKeyMoreMenu({
  name,
  disabled,
  onRevoke,
}: {
  name: string;
  disabled: boolean;
  onRevoke: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  useSelectPopover(open, trigger, menu, 100, 126);
  const close = () => {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector("button")?.focus({ preventScroll: true });
    const outside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);
  return (
    <div className="api-key-more" ref={root}>
      <button
        ref={trigger}
        className="api-key-more-trigger"
        type="button"
        disabled={disabled}
        aria-label={`${name}更多操作`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <MoreHorizontal aria-hidden />
      </button>
      {open ? (
        <div
          ref={menu}
          id={id}
          role="menu"
          popover="manual"
          className="api-key-more-menu"
          onKeyDown={(event) => {
            if (event.key === "Escape" || event.key === "Tab") {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              onRevoke();
            }}
          >
            撤销密钥
          </button>
        </div>
      ) : null}
    </div>
  );
}
