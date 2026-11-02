import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";

import { ProtectionContext, type Guard } from "./navigationGuards";

export function NavigationProtection({ children }: { children: ReactNode }) {
  const guards = useRef(new Map<symbol, Guard>());
  const approvedUnload = useRef(false);
  const register = useCallback((guard: Guard) => {
    const key = Symbol();
    guards.current.set(key, guard);
    return () => {
      guards.current.delete(key);
    };
  }, []);
  const protect = useCallback(
    (proceed: () => void, documentNavigation = false) => {
      const pending = [...guards.current.entries()];
      let deferred = false;
      const step = (index: number) => {
        if (index === pending.length) {
          if (deferred) {
            if (documentNavigation) approvedUnload.current = true;
            proceed();
          }
          return;
        }
        const [key, guard] = pending[index];
        if (!guards.current.has(key)) {
          step(index + 1);
          return;
        }
        if (guard(() => step(index + 1))) deferred = true;
        else step(index + 1);
      };
      step(0);
      return deferred;
    },
    [],
  );
  const value = useMemo(
    () => ({ register, protect, allowsUnload: () => approvedUnload.current }),
    [register, protect],
  );
  useEffect(() => {
    const before = (event: Event) => {
      if (event.defaultPrevented) return;
      const resume = (event as CustomEvent<() => void>).detail;
      if (
        typeof resume === "function" &&
        protect(
          resume,
          (event as Event & { documentNavigation?: boolean })
            .documentNavigation ?? true,
        )
      )
        event.preventDefault();
    };
    const unload = () =>
      setTimeout(() => {
        approvedUnload.current = false;
      });
    window.addEventListener("beforeunload", unload);
    window.addEventListener("future-props:before-navigation", before);
    return () => {
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("future-props:before-navigation", before);
    };
  }, [protect]);
  return <ProtectionContext value={value}>{children}</ProtectionContext>;
}
