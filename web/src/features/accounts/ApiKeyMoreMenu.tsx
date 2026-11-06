import { useEffect, useId, useRef, useState } from "react";
import { Ban, MoreHorizontal, RefreshCw, Trash2 } from "lucide-react";
import { useSelectPopover } from "@shared/ui/useSelectPopover";

export function ApiKeyMoreMenu({
  name,
  disabled,
  revoked,
  onRenew,
  onRevoke,
  onDelete,
}: {
  name: string;
  disabled: boolean;
  revoked: boolean;
  onRenew: () => void;
  onRevoke: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  useSelectPopover(open, trigger, menu, 160, 144);
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
              return;
            }
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
              return;
            event.preventDefault();
            const items = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
            );
            const current = items.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            const step = event.key === "ArrowDown" ? 1 : -1;
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? items.length - 1
                  : (current + step + items.length) % items.length;
            items[next]?.focus({ preventScroll: true });
          }}
        >
          {!revoked ? (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  close();
                  onRenew();
                }}
              >
                <RefreshCw aria-hidden />
                续期
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  close();
                  onRevoke();
                }}
              >
                <Ban aria-hidden />
                撤销密钥
              </button>
            </>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className="api-key-menu-danger"
            onClick={() => {
              close();
              onDelete();
            }}
          >
            <Trash2 aria-hidden />
            删除
          </button>
        </div>
      ) : null}
    </div>
  );
}
