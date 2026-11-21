import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react";

export type Guard = (resume: () => void) => boolean;
export const NAVIGATION_COMMITTED = "future-props:navigation-committed";
/** Return true when a draft owner deferred the supplied continuation. */
export function guardedNavigation(
  proceed: () => void,
  documentNavigation = false,
) {
  const event = Object.assign(
    new CustomEvent("future-props:before-navigation", {
      cancelable: true,
      detail: proceed,
    }),
    { documentNavigation },
  );
  const immediate = window.dispatchEvent(event);
  if (immediate) proceed();
  return !immediate;
}
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

/** Adapter for editors that expose an explicit guard registration port. */
export function useNavigationGuardRegistration() {
  const protection = useNavigationProtection();
  const unregister = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => unregister.current?.(), []);
  return useCallback(
    (guard: Guard | null) => {
      unregister.current?.();
      unregister.current = guard ? protection?.register(guard) : undefined;
    },
    [protection],
  );
}
