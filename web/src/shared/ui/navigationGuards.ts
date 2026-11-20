import { createContext, useContext, useEffect, useRef } from "react";

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

/** Register an owner's current save/leave rule for the mounted application. */
export function useNavigationGuard(guard: Guard) {
  const protection = useNavigationProtection();
  const current = useRef(guard);
  current.current = guard;
  useEffect(
    () => protection?.register((resume) => current.current(resume)),
    [protection],
  );
}
