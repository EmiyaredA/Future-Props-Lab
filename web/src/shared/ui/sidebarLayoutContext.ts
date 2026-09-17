import { createContext, useContext } from "react";

export type SidebarLayoutContextValue = {
  /** Persisted desktop collapse preference (ignores narrow forcing). */
  collapsed: boolean;
  /** True when the icon rail should render (user collapsed or narrow viewport). */
  railCompact: boolean;
  /** True when viewport is at the narrow breakpoint. */
  narrow: boolean;
  collapsible: boolean;
  label: string;
  expand: () => void;
  toggleCollapsed: () => void;
};

export const SidebarLayoutContext =
  createContext<SidebarLayoutContextValue | null>(null);

export function useSidebarLayout() {
  return useContext(SidebarLayoutContext);
}
