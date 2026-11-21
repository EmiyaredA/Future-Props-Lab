import { useEffect, useRef, type ReactNode } from "react";
import { Pin, X, type LucideIcon } from "lucide-react";
import { useWorkspaceSidebarState } from "./useWorkspaceSidebarState";

/** Workspace-specific navigation uses the same rail and drawer geometry. */
export function WorkspaceSidebar({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  const { open, setOpen, pinned, setPinned } = useWorkspaceSidebarState();
  const root = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  useEffect(() => {
    if (!open || pinned) return;
    const pointer = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (
        !root.current?.closest("[hidden], [inert]") &&
        !root.current?.contains(target) &&
        !target.closest(
          '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
        )
      )
        setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !root.current?.closest("[hidden], [inert]") &&
        !event.defaultPrevented &&
        !(event.target as HTMLElement).closest(
          '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
        )
      ) {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", pointer);
      document.removeEventListener("keydown", key);
    };
  }, [open, pinned, setOpen]);
  return (
    <aside
      ref={root}
      className={`workspace-sidebar${open ? " is-open" : ""}${pinned ? " is-pinned" : ""}`}
      aria-label={`${label}导航`}
    >
      <nav className="workspace-sidebar-rail" aria-label={`${label}目录入口`}>
        <button
          ref={trigger}
          type="button"
          aria-label={`展开${label}侧栏`}
          aria-expanded={open}
          onClick={() => setOpen(pinned || !open)}
        >
          <Icon size={20} aria-hidden />
          <span>{label}</span>
        </button>
      </nav>
      <div className="workspace-sidebar-pane" hidden={!open}>
        <div className="workspace-sidebar-heading">
          <strong>{label}</strong>
          <button
            type="button"
            className="workspace-sidebar-pin"
            aria-label={pinned ? `取消固定${label}侧栏` : `固定${label}侧栏`}
            aria-pressed={pinned}
            onClick={() => setPinned(!pinned)}
          >
            <Pin size={18} aria-hidden />
          </button>
          <button type="button" aria-label={`收起${label}侧栏`} onClick={close}>
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </aside>
  );
}
