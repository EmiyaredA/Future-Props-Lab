import { createContext, useContext } from "react";

export type Guard = (resume: () => void) => boolean;
export const NAVIGATION_COMMITTED = "future-props:navigation-committed";
export type Protection = {
  register: (guard: Guard) => () => void;
  protect: (proceed: () => void, documentNavigation?: boolean) => boolean;
  allowsUnload: () => boolean;
};
export const ProtectionContext = createContext<Protection | null>(null);

export function useNavigationProtection() {
  return useContext(ProtectionContext);
}
