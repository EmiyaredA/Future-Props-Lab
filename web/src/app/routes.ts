export type StudioPage =
  | "home"
  | "apps"
  | "files"
  | "tools"
  | "model-test"
  | "model-service"
  | "model-call-logs";

export type WorkshopPage =
  | "visual-workshop-projects"
  | "visual-workshop-canvas"
  | "visual-workshop-assets"
  | "visual-workshop-tasks"
  | "galgame-workshop-projects"
  | "galgame-workshop-overview"
  | "galgame-workshop-editor";

export type VisualWorkshopPage = Extract<
  WorkshopPage,
  `visual-workshop-${string}`
>;
export type GalgameWorkshopPage = Extract<
  WorkshopPage,
  `galgame-workshop-${string}`
>;

export type AppPage = StudioPage | WorkshopPage;

export type AppRoute = { page: AppPage; projectId?: string };

export function isWorkshopPage(page: AppPage): page is WorkshopPage {
  return (
    page.startsWith("visual-workshop-") || page.startsWith("galgame-workshop-")
  );
}

export function isVisualWorkshopPage(
  page: AppPage,
): page is VisualWorkshopPage {
  return page.startsWith("visual-workshop-");
}

export function isGalgameWorkshopPage(
  page: AppPage,
): page is GalgameWorkshopPage {
  return page.startsWith("galgame-workshop-");
}

export function parsePage(pathname = window.location.pathname): AppPage {
  return parseRoute(pathname).page;
}

export function parseRoute(pathname = window.location.pathname): AppRoute {
  const galgameEditor = pathname.match(
    /^\/apps\/galgame-workshop\/projects\/([^/]+)\/editor/,
  );
  if (galgameEditor)
    return {
      page: "galgame-workshop-editor",
      projectId: decodeURIComponent(galgameEditor[1]),
    };
  const galgameOverview = pathname.match(
    /^\/apps\/galgame-workshop\/projects\/([^/]+)\/overview/,
  );
  if (galgameOverview)
    return {
      page: "galgame-workshop-overview",
      projectId: decodeURIComponent(galgameOverview[1]),
    };
  if (pathname.startsWith("/apps/galgame-workshop"))
    return { page: "galgame-workshop-projects" };

  const projectRoute = pathname.match(
    /^\/apps\/visual-workshop\/projects\/([^/]+)\/(canvas|assets)/,
  );
  if (projectRoute)
    return {
      page:
        projectRoute[2] === "canvas"
          ? "visual-workshop-canvas"
          : "visual-workshop-assets",
      projectId: decodeURIComponent(projectRoute[1]),
    };
  if (pathname.startsWith("/apps/visual-workshop/tasks"))
    return { page: "visual-workshop-tasks" };
  if (pathname.startsWith("/apps/visual-workshop"))
    return { page: "visual-workshop-projects" };
  if (pathname.startsWith("/apps")) return { page: "apps" };
  if (pathname.startsWith("/files")) return { page: "files" };
  if (pathname.startsWith("/tools")) return { page: "tools" };
  if (pathname.startsWith("/model-test")) return { page: "model-test" };
  if (pathname.startsWith("/model-call-logs"))
    return { page: "model-call-logs" };
  if (pathname.startsWith("/model-service")) return { page: "model-service" };
  return { page: "home" };
}

export function pathFor(page: AppPage, projectId?: string): string {
  if (page === "galgame-workshop-editor" && projectId)
    return `/apps/galgame-workshop/projects/${encodeURIComponent(projectId)}/editor`;
  if (page === "galgame-workshop-overview" && projectId)
    return `/apps/galgame-workshop/projects/${encodeURIComponent(projectId)}/overview`;
  if (page === "visual-workshop-canvas" && projectId)
    return `/apps/visual-workshop/projects/${encodeURIComponent(projectId)}/canvas`;
  if (page === "visual-workshop-assets" && projectId)
    return `/apps/visual-workshop/projects/${encodeURIComponent(projectId)}/assets`;
  const paths: Record<AppPage, string> = {
    home: "/home",
    apps: "/apps",
    files: "/files",
    tools: "/tools",
    "model-test": "/model-test",
    "model-service": "/model-service",
    "model-call-logs": "/model-call-logs",
    "visual-workshop-projects": "/apps/visual-workshop",
    "visual-workshop-canvas": "/apps/visual-workshop",
    "visual-workshop-assets": "/apps/visual-workshop",
    "visual-workshop-tasks": "/apps/visual-workshop/tasks",
    "galgame-workshop-projects": "/apps/galgame-workshop",
    "galgame-workshop-overview": "/apps/galgame-workshop",
    "galgame-workshop-editor": "/apps/galgame-workshop",
  };
  return paths[page];
}
