export type StudioPage =
  | "home"
  | "apps"
  | "files"
  | "tools"
  | "video-frame-exporter"
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
  const application = matchApplicationPath(pathname);
  if (application) return application as AppRoute;
  if (pathname.startsWith("/apps")) return { page: "apps" };
  if (pathname.startsWith("/files")) return { page: "files" };
  if (pathname.startsWith("/tools/video-frame-exporter"))
    return { page: "video-frame-exporter" };
  if (pathname.startsWith("/tools")) return { page: "tools" };
  if (pathname.startsWith("/model-test")) return { page: "model-test" };
  if (pathname.startsWith("/model-call-logs"))
    return { page: "model-call-logs" };
  if (pathname.startsWith("/model-service")) return { page: "model-service" };
  return { page: "home" };
}

export function pathFor(page: AppPage, projectId?: string): string {
  const applicationPath = applicationPathFor(page, projectId);
  if (applicationPath) return applicationPath;
  const paths: Record<AppPage, string> = {
    home: "/home",
    apps: "/apps",
    files: "/files",
    tools: "/tools",
    "video-frame-exporter": "/tools/video-frame-exporter",
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
import {
  applicationPathFor,
  matchApplicationPath,
} from "@app/applicationRegistry";
