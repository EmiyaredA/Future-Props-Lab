import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { DesktopDevelopmentState } from "@platform/desktop";

/** Headless host: development apply/check stay in Electron chrome, not App layout. */
export function DesktopDevelopmentHost() {
  const [state, setState] = useState<DesktopDevelopmentState | null>(null);
  const generation = useRef<number | null>(null);
  const queryClient = useQueryClient();
  const bridge = window.futurePropsDesktop;
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    let active = true;
    void bridge?.developmentStatus?.().then((value) => {
      if (active) setState(value);
    });
    const cleanup = bridge?.onDevelopmentState?.((value) => setState(value));
    return () => {
      active = false;
      cleanup?.();
    };
  }, [bridge]);
  useEffect(() => {
    if (!state) return;
    if (
      generation.current !== null &&
      generation.current !== state.generation
    ) {
      const safe = window.dispatchEvent(
        new Event("future-props:development-query-refresh", {
          cancelable: true,
        }),
      );
      // Active editors keep their draft and revision; list pages refresh immediately.
      void queryClient.invalidateQueries({
        refetchType: safe ? "active" : "none",
      });
    }
    generation.current = state.generation;
  }, [state, queryClient]);
  useEffect(() => {
    const apply = () => {
      const current = stateRef.current;
      if (!current) return;
      const commit = () => void bridge?.applyDevelopmentUpdate?.();
      if (current.pending.some((kind) => kind === "desktop" || kind === "page")) {
        const event = new CustomEvent("future-props:before-workspace-switch", {
          cancelable: true,
          detail: commit,
        });
        if (window.dispatchEvent(event)) commit();
      } else commit();
    };
    const onWindowApply = () => apply();
    window.addEventListener("future-props:development-apply", onWindowApply);
    const cleanup = bridge?.onDevelopmentMenuAction?.((action) => {
      if (action === "check") void bridge.checkDevelopmentUpdate?.();
      else apply();
    });
    return () => {
      window.removeEventListener(
        "future-props:development-apply",
        onWindowApply,
      );
      cleanup?.();
    };
  }, [bridge]);
  return null;
}
