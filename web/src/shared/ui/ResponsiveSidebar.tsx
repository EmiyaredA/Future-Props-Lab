import { useEffect, useMemo, useState, type ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { SidebarLayoutContext, useSidebarLayout } from "./sidebarLayoutContext";
import "./responsive-sidebar.css";

function loadCollapsed(storageKey: string, defaultCollapsed: boolean): boolean {
  try {
    const stored = localStorage.getItem(storageKey);
    return stored === null ? defaultCollapsed : stored === "true";
  } catch {
    return defaultCollapsed;
  }
}

export function SidebarCollapseToggle() {
  const layout = useSidebarLayout();
  if (!layout?.collapsible) return null;
  const disabled = layout.narrow;
  const label = disabled
    ? "窄屏下保持图标栏"
    : layout.collapsed
      ? `展开${layout.label}`
      : `收起${layout.label}`;
  return (
    <button
      className="responsive-desktop-toggle"
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={layout.collapsed || disabled}
      disabled={disabled}
      onClick={disabled ? undefined : layout.toggleCollapsed}
    >
      {layout.collapsed || disabled ? (
        <PanelLeftOpen size={16} />
      ) : (
        <PanelLeftClose size={16} />
      )}
    </button>
  );
}

export function ResponsiveSidebarProvider({
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
  const [collapsed, setCollapsed] = useState(() =>
    collapsible ? loadCollapsed(storageKey, defaultCollapsed) : false,
  );
  const [narrow, setNarrow] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(max-width: 1200px)").matches
      : false,
  );
  const updateCollapsed = (next: boolean) => {
    if (narrow) return;
    setCollapsed(next);
    onCollapseChange?.(next);
    try {
      localStorage.setItem(storageKey, String(next));
    } catch {
      // Storage can be unavailable in privacy modes.
    }
  };
  useEffect(() => {
    const media = matchMedia("(max-width: 1200px)");
    const sync = () => setNarrow(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  // Callers pass routeKey so the shell can remount with key={routeKey} when needed.
  void routeKey;
  const railCompact = Boolean(collapsible && (collapsed || narrow));
  const layout = useMemo(
    () => ({
      collapsed,
      railCompact,
      narrow,
      collapsible,
      label,
      expand: () => updateCollapsed(false),
      toggleCollapsed: () => updateCollapsed(!collapsed),
    }),
    // updateCollapsed closes over the latest collapsed/narrow; listing it would
    // recreate the layout object on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
    [collapsed, railCompact, narrow, collapsible, label],
  );
  return (
    <SidebarLayoutContext.Provider value={layout}>
      {children}
    </SidebarLayoutContext.Provider>
  );
}

export function ResponsiveSidebarPanel({ children }: { children: ReactNode }) {
  const layout = useSidebarLayout();
  return (
    <div
      className={`responsive-sidebar-track${layout?.railCompact ? " is-collapsed" : ""}`}
    >
      <div className="responsive-sidebar-panel">{children}</div>
    </div>
  );
}

/** @deprecated Prefer ResponsiveSidebarProvider + ResponsiveSidebarPanel. */
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
  return (
    <ResponsiveSidebarProvider
      label={label}
      routeKey={routeKey}
      collapsible={collapsible}
      storageKey={storageKey}
      defaultCollapsed={defaultCollapsed}
      onCollapseChange={onCollapseChange}
    >
      <ResponsiveSidebarPanel>{children}</ResponsiveSidebarPanel>
    </ResponsiveSidebarProvider>
  );
}
