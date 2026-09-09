import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";

export type CatalogMenuItem = {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
};
export function CatalogMenu({
  label,
  items,
}: {
  label: string;
  items: CatalogMenuItem[];
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    root.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
      ?.focus();
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  if (!items.length) return null;
  return (
    <div
      className="mc-menu"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
        if (
          open &&
          ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
        ) {
          event.preventDefault();
          const buttons = Array.from(
            root.current?.querySelectorAll<HTMLButtonElement>(
              '[role="menuitem"]:not(:disabled)',
            ) ?? [],
          );
          const current = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const index =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? buttons.length - 1
                : (current +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    buttons.length) %
                  buttons.length;
          buttons[index]?.focus();
        }
      }}
    >
      <button
        type="button"
        className="mc-icon"
        ref={trigger}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <MoreHorizontal size={19} />
      </button>
      {open && (
        <div className="mc-menu-panel" role="menu" aria-label={label}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={item.danger ? "mc-danger" : ""}
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
                item.onClick();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
