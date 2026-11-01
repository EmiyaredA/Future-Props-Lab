import { createContext, useContext, useEffect, useRef } from "react";
import type { components } from "@generated/api";
export type IntegrationOpen = components["schemas"]["AutomationOpenIn"] & {
  id: string;
};
export type OpenDetail = {
  request: IntegrationOpen;
  active: () => boolean;
  complete: (ok: boolean) => void;
};
export type NavigationGuard = (proceed: () => void) => boolean;
export const IntegrationInteractionContext = createContext<{
  register: (guard: NavigationGuard) => () => void;
  blocked: () => boolean;
}>({ register: () => () => {}, blocked: () => false });

export const useIntegrationInteraction = () =>
  useContext(IntegrationInteractionContext);

// The app shell navigates first. The destination owns loading and the completion receipt.
export function useIntegrationOpen(
  kind: string,
  ready: boolean,
  open: (
    request: IntegrationOpen,
    active: () => boolean,
  ) => Promise<void> | void,
) {
  const handled = useRef(new Set<string>());
  const callback = useRef(open);
  callback.current = open;
  useEffect(() => {
    if (!ready) return;
    let mounted = true;
    const handle = (event: Event) => {
      const detail = (event as CustomEvent<OpenDetail>).detail;
      if (
        detail.request.kind !== kind ||
        !detail.active() ||
        handled.current.has(detail.request.id)
      )
        return;
      handled.current.add(detail.request.id);
      void Promise.resolve()
        .then(() => {
          if (mounted && detail.active())
            return callback.current(
              detail.request,
              () => mounted && detail.active(),
            );
        })
        .then(() => {
          requestAnimationFrame(() => {
            if (mounted && detail.active()) detail.complete(true);
          });
        })
        .catch(() => {
          if (mounted && detail.active()) detail.complete(false);
        });
    };
    window.addEventListener("future-props:integration-open", handle);
    const params = new URLSearchParams(window.location.search);
    const view = params.get("view");
    const resource = params.get("resource");
    const views = [
      "list",
      "details",
      "upload",
      "versions",
      "tags",
      "edit",
      "validate",
      "tools",
    ];
    if (
      ["skill", "tool-api", "mcp"].includes(kind) &&
      view &&
      views.includes(view)
    ) {
      handle(
        new CustomEvent("future-props:integration-open", {
          detail: {
            request: {
              id: `${window.location.pathname}${window.location.search}`,
              kind,
              resource_id: resource,
              view,
            },
            active: () => mounted,
            complete: () => {},
          },
        }),
      );
    }
    return () => {
      mounted = false;
      window.removeEventListener("future-props:integration-open", handle);
    };
  }, [kind, ready]);
}
