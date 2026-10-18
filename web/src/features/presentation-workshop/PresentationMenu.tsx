import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useSelectPopover } from "@shared/ui/useSelectPopover";

export type PresentationAction = {
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  description?: string;
  danger?: boolean;
  onSelect: () => void;
};

export function PresentationMenu({
  label,
  children,
  actions,
  disabled = false,
  className = "",
}: {
  label: string;
  children: ReactNode;
  actions: PresentationAction[];
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const last = useRef(false);
  const id = useId();
  useSelectPopover(open, trigger, menu, 360);
  const items = () =>
    Array.from(
      menu.current?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ) ?? [],
    );
  const close = (restore = true) => {
    setOpen(false);
    if (restore) trigger.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const buttons = items();
    (last.current ? buttons.at(-1) : buttons[0])?.focus();
    const outside = (event: MouseEvent) => {
      if (
        !menu.current?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);
  return (
    <div className={`presentation-menu ${className}`}>
      <button
        type="button"
        ref={trigger}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={() => {
          last.current = false;
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            last.current = event.key === "ArrowUp";
            setOpen(true);
          }
        }}
      >
        {children}
      </button>
      {open && (
        <div
          ref={menu}
          id={id}
          popover="manual"
          role="menu"
          aria-label={label}
          className="presentation-action-menu"
          onBlur={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget) &&
              event.relatedTarget !== trigger.current
            )
              close(false);
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            const buttons = items(),
              index = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
              );
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? buttons.length - 1
                    : (index +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        buttons.length) %
                      buttons.length;
              buttons[next]?.focus();
            } else if (event.key === "Escape") {
              event.preventDefault();
              close();
            }
          }}
        >
          {actions.map((action) => (
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              key={action.label}
              disabled={action.disabled}
              title={action.description}
              className={action.danger ? "danger" : ""}
              onClick={() => {
                close();
                action.onSelect();
              }}
            >
              {action.icon}
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
