import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";

export function BoardMenu({
  label,
  items,
}: {
  label: string;
  items: {
    label: string;
    onSelect: () => void;
    danger?: boolean;
    icon?: ReactNode;
    disabled?: boolean;
  }[];
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useLayoutEffect(() => {
    if (!open) return;
    const rect = trigger.current!.getBoundingClientRect();
    setPosition({
      top: Math.max(
        8,
        Math.min(rect.bottom + 6, window.innerHeight - items.length * 40 - 16),
      ),
      left: Math.max(8, Math.min(rect.right - 184, window.innerWidth - 192)),
    });
    menu.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
  }, [open, items.length]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (
        !menu.current?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    const reposition = () => setOpen(false);
    document.addEventListener("pointerdown", dismiss);
    window.addEventListener("resize", reposition);
    document.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("resize", reposition);
      document.removeEventListener("scroll", reposition, true);
    };
  }, [open]);
  return (
    <>
      <button
        ref={trigger}
        className="board-icon-button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <MoreHorizontal size={18} />
      </button>
      {open &&
        createPortal(
          <div
            id={id}
            ref={menu}
            role="menu"
            aria-label={label}
            className="board-action-menu"
            style={position}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                close();
                return;
              }
              if (event.key === "Tab") {
                event.preventDefault();
                const focusable = [
                  ...document.querySelectorAll<HTMLElement>(
                    'button:not(:disabled), input:not(:disabled):not([type="hidden"]), textarea:not(:disabled), summary, [tabindex="0"]',
                  ),
                ].filter(
                  (element) =>
                    !menu.current?.contains(element) &&
                    element.getClientRects().length > 0,
                );
                const index = focusable.indexOf(trigger.current!);
                close();
                focusable[index + (event.shiftKey ? -1 : 1)]?.focus();
                return;
              }
              const buttons = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  "button:not(:disabled)",
                ),
              ];
              const index = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? buttons.length - 1
                    : event.key === "ArrowDown"
                      ? (index + 1) % buttons.length
                      : event.key === "ArrowUp"
                        ? (index + buttons.length - 1) % buttons.length
                        : -1;
              if (next >= 0) {
                event.preventDefault();
                buttons[next]?.focus();
              }
            }}
          >
            {items.map((item) => (
              <button
                key={item.label}
                role="menuitem"
                disabled={item.disabled}
                className={item.danger ? "is-danger" : ""}
                onClick={() => {
                  close();
                  item.onSelect();
                }}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
