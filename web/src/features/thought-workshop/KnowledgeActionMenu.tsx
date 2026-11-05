import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { MoreHorizontal, Plus, type LucideIcon } from "lucide-react";
import { useSelectPopover } from "@shared/ui/useSelectPopover";
import "./knowledge-topbar.css";

export type TopbarAction = {
  value: string;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
  danger?: boolean;
};

export function KnowledgeActionMenu({
  ariaLabel,
  label,
  disabled,
  groups,
  onAction,
}: {
  ariaLabel: string;
  label?: string;
  disabled?: boolean;
  groups: TopbarAction[][];
  onAction: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const focusLast = useRef(false);
  const menuId = useId();
  useSelectPopover(open, trigger, menu, 360);

  const enabledItems = () =>
    Array.from(
      menu.current?.querySelectorAll<HTMLButtonElement>(
        'button[role="menuitem"]:not(:disabled)',
      ) ?? [],
    );
  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  };
  const show = (last = false) => {
    focusLast.current = last;
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const items = enabledItems();
    (focusLast.current ? items.at(-1) : items[0])?.focus();
    const closeOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !menu.current?.contains(target))
        close();
    };
    document.addEventListener("mousedown", closeOutside);
    return () => document.removeEventListener("mousedown", closeOutside);
  }, [open]);

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = enabledItems();
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | undefined;
    if (event.key === "ArrowDown") next = (current + 1) % items.length;
    if (event.key === "ArrowUp")
      next = (current - 1 + items.length) % items.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = items.length - 1;
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (next === undefined) return;
    event.preventDefault();
    items[next]?.focus();
  };

  return (
    <div className="knowledge-topbar-menu-wrap">
      <button
        ref={trigger}
        type="button"
        className={
          label
            ? "btn knowledge-topbar-menu-trigger has-label"
            : "btn knowledge-topbar-menu-trigger"
        }
        aria-label={ariaLabel}
        title={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          show(event.key === "ArrowUp");
        }}
      >
        {label ? (
          <>
            <Plus size={16} aria-hidden />
            {label}
          </>
        ) : (
          <MoreHorizontal aria-hidden="true" />
        )}
      </button>
      {open ? (
        <div
          ref={menu}
          id={menuId}
          popover="manual"
          role="menu"
          aria-label={ariaLabel}
          className="knowledge-topbar-menu"
          onKeyDown={moveFocus}
        >
          {groups.map((group, groupIndex) => (
            <div key={group[0]!.value} role="presentation">
              {groupIndex > 0 ? (
                <div
                  className="knowledge-topbar-menu-divider"
                  role="separator"
                />
              ) : null}
              {group.map((action) => (
                <button
                  key={action.value}
                  type="button"
                  role="menuitem"
                  className={action.danger ? "is-danger" : undefined}
                  disabled={action.disabled}
                  onClick={() => {
                    close(true);
                    onAction(action.value);
                  }}
                >
                  <action.icon aria-hidden="true" />
                  <span>{action.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
