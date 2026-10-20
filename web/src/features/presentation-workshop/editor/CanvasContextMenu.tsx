import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PresentationAction } from "../PresentationMenu";

export function CanvasContextMenu({
  point,
  actions,
  onClose,
  restoreFocus,
}: {
  point: { x: number; y: number };
  actions: PresentationAction[];
  onClose: () => void;
  restoreFocus: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(point);
  useLayoutEffect(() => {
    const menu = root.current;
    if (!menu) return;
    menu.showPopover?.();
    const box = menu.getBoundingClientRect();
    setPosition({
      x: Math.max(8, Math.min(point.x, innerWidth - box.width - 8)),
      y: Math.max(8, Math.min(point.y, innerHeight - box.height - 8)),
    });
    menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [point]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);
  return createPortal(
    <div
      ref={root}
      popover="manual"
      role="menu"
      aria-label="画布操作"
      className="presentation-action-menu presentation-context-menu"
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onClose();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        const buttons = Array.from(
          root.current?.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ) ?? [],
        );
        const index = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? buttons.length - 1
                : (index +
                    (event.key === "ArrowUp" ? -1 : 1) +
                    buttons.length) %
                  buttons.length;
          buttons[next]?.focus();
        } else if (event.key === "Escape" || event.key === "Tab") {
          event.preventDefault();
          onClose();
          restoreFocus();
        }
      }}
    >
      {actions.map((action) => (
        <button
          key={action.label}
          role="menuitem"
          tabIndex={-1}
          disabled={action.disabled}
          title={action.description}
          className={action.danger ? "danger" : ""}
          onClick={() => {
            onClose();
            restoreFocus();
            action.onSelect();
          }}
        >
          <span>{action.label}</span>
          {action.shortcut && <kbd>{action.shortcut}</kbd>}
        </button>
      ))}
    </div>,
    document.body,
  );
}
