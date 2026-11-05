import { useCallback, useEffect, useRef, useState } from "react";
import { parseRoute, pathFor, type AppPage, type AppRoute } from "@app/routes";

/** Own browser history and unsaved-navigation continuations for one mounted website. */
export function useWebsiteNavigation() {
  const [route, setRoute] = useState<AppRoute>(parseRoute);
  const navigationGuard = useRef<
    ((continueNavigation: () => void) => boolean) | null
  >(null);
  const routeRef = useRef(route);
  routeRef.current = route;
  useEffect(() => {
    if (window.location.pathname === "/")
      window.history.replaceState({}, "", "/home");
    if (window.location.pathname.startsWith("/tools/audio-annotation")) {
      const current = parseRoute();
      window.history.replaceState(
        {},
        "",
        pathFor(current.page, current.projectId, current.documentId),
      );
    }
    if (
      window.location.pathname.startsWith("/apps/agent-workbench") ||
      /^\/tools\/(storage-usage|codex-model-source)\/?$/.test(
        window.location.pathname,
      )
    ) {
      const current = parseRoute();
      window.history.replaceState(
        {},
        "",
        pathFor(current.page, current.projectId, current.documentId) +
          window.location.search +
          window.location.hash,
      );
    }
    const pop = () => {
      const next = parseRoute();
      if (
        navigationGuard.current?.(() => {
          window.history.pushState(
            {},
            "",
            pathFor(next.page, next.projectId, next.documentId) +
              (next.search ?? ""),
          );
          setRoute(next);
        })
      ) {
        const previous = routeRef.current;
        window.history.pushState(
          {},
          "",
          pathFor(previous.page, previous.projectId, previous.documentId) +
            (previous.search ?? ""),
        );
        return;
      }
      setRoute(next);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const commitNavigation = (
    next: AppPage,
    projectId?: string,
    documentId?: string,
    search?: string,
  ) => {
    const path = pathFor(next, projectId, documentId) + (search ?? "");
    if (path !== window.location.pathname + window.location.search)
      window.history.pushState({}, "", path);
    setRoute({ page: next, projectId, documentId, search });
  };
  // A feature has already committed its resource identity; update this history entry only.
  const replaceRoute = (
    next: AppPage,
    projectId?: string,
    documentId?: string,
  ) => {
    window.history.replaceState({}, "", pathFor(next, projectId, documentId));
    setRoute({ page: next, projectId, documentId });
  };
  const navigate = (
    next: AppPage,
    projectId?: string,
    documentId?: string,
    search?: string,
  ) => {
    const commit = () => commitNavigation(next, projectId, documentId, search);
    if (navigationGuard.current?.(commit)) return;
    commit();
  };
  const registerNavigationGuard = useCallback(
    (guard: ((continueNavigation: () => void) => boolean) | null) => {
      navigationGuard.current = guard;
    },
    [],
  );
  const navigatePath = (path: string) => {
    const next = parseRoute(path);
    navigate(next.page, next.projectId, next.documentId, next.search);
  };

  useEffect(() => {
    const handle = (event: Event) =>
      navigatePath((event as CustomEvent<string>).detail);
    const guard = (event: Event) => {
      const e = event as CustomEvent<() => void>;
      if (navigationGuard.current?.(e.detail)) e.preventDefault();
    };
    window.addEventListener("future-props:navigate", handle);
    const agentOpen = (event: Event) => {
      const request = (
        event as CustomEvent<{
          path: string;
          active: () => boolean;
          opened: () => void;
        }>
      ).detail;
      const next = parseRoute(request.path);
      const commit = () => {
        if (!request.active()) return;
        commitNavigation(next.page, next.projectId, next.documentId);
        request.opened();
      };
      if (!navigationGuard.current?.(commit)) commit();
    };
    window.addEventListener("future-props:agent-open", agentOpen);
    window.addEventListener("future-props:before-navigation", guard);
    const deferRefresh = (event: Event) => {
      if (navigationGuard.current) event.preventDefault();
    };
    window.addEventListener(
      "future-props:development-query-refresh",
      deferRefresh,
    );
    return () => {
      window.removeEventListener("future-props:navigate", handle);
      window.removeEventListener("future-props:agent-open", agentOpen);
      window.removeEventListener("future-props:before-navigation", guard);
      window.removeEventListener(
        "future-props:development-query-refresh",
        deferRefresh,
      );
    };
  });

  return {
    route,
    navigate,
    navigatePath,
    replaceRoute,
    registerNavigationGuard,
  };
}
