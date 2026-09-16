import { useEffect, useState, type ReactNode } from "react";
import { useDrawerFocus } from "./useDrawerFocus";
import { Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import "./responsive-sidebar.css";

function loadCollapsed(storageKey: string, defaultCollapsed: boolean): boolean {
  try {
    const stored = localStorage.getItem(storageKey);
    return stored === null ? defaultCollapsed : stored === "true";
  } catch {
    return defaultCollapsed;
  }
}

export function ResponsiveSidebar({
  children,
  label,
  routeKey,
  collapsible = false,
  storageKey = "future-props-sidebar-collapsed",
  defaultCollapsed = false,
  onCollapseChange,
}: {
  children: ReactNode;
  label: string;
  routeKey: string;
  collapsible?: boolean;
  storageKey?: string;
  defaultCollapsed?: boolean;
  onCollapseChange?: (collapsed: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() =>
    collapsible ? loadCollapsed(storageKey, defaultCollapsed) : false,
  );
  const panel = useDrawerFocus<HTMLDivElement>(() => setOpen(false), open);
  const updateCollapsed = (next: boolean) => {
    setCollapsed(next);
    onCollapseChange?.(next);
    try {
      localStorage.setItem(storageKey, String(next));
    } catch {
      // Storage can be unavailable in privacy modes.
    }
  };
  useEffect(() => {
    setOpen(false);
  }, [routeKey]);
  useEffect(() => {
    if (!open) return;
    const media = matchMedia("(max-width: 1200px)");
    const closeOnDesktop = () => {
      if (!media.matches) setOpen(false);
    };
    media.addEventListener("change", closeOnDesktop);
    return () => {
      media.removeEventListener("change", closeOnDesktop);
    };
  }, [open]);
  return (
    <div
      className={`responsive-sidebar-track${collapsed ? " is-collapsed" : ""}`}
    >
      <button
        className="responsive-nav-trigger"
        type="button"
        aria-label={`打开${label}`}
        aria-expanded={open}
        onClick={(event) => {
          event.currentTarget.focus();
          setOpen(true);
        }}
      >
        <Menu size={18} />
        导航
      </button>
      {open && (
        <button
          className="responsive-nav-backdrop"
          type="button"
          aria-label={`关闭${label}遮罩`}
          onClick={() => setOpen(false)}
        />
      )}
      {collapsible ? (
        <button
          className="responsive-desktop-toggle"
          type="button"
          aria-label={collapsed ? `展开${label}` : `收起${label}`}
          title={collapsed ? `展开${label}` : `收起${label}`}
          aria-pressed={collapsed}
          onClick={() => updateCollapsed(!collapsed)}
        >
          {collapsed ? (
            <PanelLeftOpen size={16} />
          ) : (
            <PanelLeftClose size={16} />
          )}
        </button>
      ) : null}
      <div
        ref={panel}
        className={`responsive-sidebar-panel${open ? " is-open" : ""}`}
        role={open ? "dialog" : undefined}
        aria-modal={open || undefined}
        aria-label={open ? label : undefined}
      >
        <button
          className="responsive-nav-close"
          type="button"
          aria-label={`关闭${label}`}
          onClick={() => setOpen(false)}
        >
          <X size={18} />
        </button>
        {children}
      </div>
    </div>
  );
}
