export type StudioPage =
  | "home"
  | "apps"
  | "files"
  | "tools"
  | "integrations-tool-apis"
  | "integrations-mcp"
  | "integrations-skills"
  | "video-frame-exporter"
  | "audio-annotation-projects"
  | "audio-annotation-editor"
  | "model-test"
  | "model-test-tools"
  | "model-service"
  | "model-call-logs";

export type WorkshopPage =
  | "thought-workshop-notes"
  | "thought-workshop-editor"
  | "thought-workshop-legacy"
  | "visual-workshop-projects"
  | "visual-workshop-canvas"
  | "visual-workshop-assets"
  | "visual-workshop-tasks"
  | "galgame-workshop-projects"
  | "galgame-workshop-overview"
  | "galgame-workshop-editor"
  | "galgame-workshop-preview"
  | "video-editor-projects"
  | "video-editor-editor"
  | "video-editor-tasks";

export type VisualWorkshopPage = Extract<
  WorkshopPage,
  `visual-workshop-${string}`
>;
export type GalgameWorkshopPage = Extract<
  WorkshopPage,
  `galgame-workshop-${string}`
>;
export type VideoEditorPage = Extract<WorkshopPage, `video-editor-${string}`>;

export type AppPage = StudioPage | WorkshopPage;

export type AppRoute = {
  page: AppPage;
  projectId?: string;
  documentId?: string;
};

export function isWorkshopPage(page: AppPage): page is WorkshopPage {
  return (
    page.startsWith("thought-workshop-") ||
    page.startsWith("visual-workshop-") ||
    page.startsWith("galgame-workshop-") ||
    page.startsWith("video-editor-")
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

export function isVideoEditorPage(page: AppPage): page is VideoEditorPage {
  return page.startsWith("video-editor-");
}

export function parsePage(pathname = window.location.pathname): AppPage {
  return parseRoute(pathname).page;
}

export function parseRoute(pathname = window.location.pathname): AppRoute {
  const application = matchApplicationPath(pathname);
  if (application) return application as AppRoute;
  if (pathname.startsWith("/apps")) return { page: "apps" };
  if (pathname.startsWith("/files")) return { page: "files" };
  if (pathname.startsWith("/integrations/mcp"))
    return { page: "integrations-mcp" };
  if (pathname.startsWith("/integrations/skills"))
    return { page: "integrations-skills" };
  if (pathname.startsWith("/integrations"))
    return { page: "integrations-tool-apis" };
  if (pathname.startsWith("/tools/video-frame-exporter"))
    return { page: "video-frame-exporter" };
  const audioAnnotation = pathname.match(
    /^\/tools\/audio-annotation\/([^/]+)\/?$/,
  );
  if (audioAnnotation)
    return { page: "audio-annotation-editor", projectId: audioAnnotation[1] };
  if (pathname.startsWith("/tools/audio-annotation"))
    return { page: "audio-annotation-projects" };
  if (pathname.startsWith("/tools")) return { page: "tools" };
  const modelTestTool = pathname.match(/^\/model-test-tools\/([^/]+)\/?$/);
  if (modelTestTool)
    return { page: "model-test-tools", projectId: modelTestTool[1] };
  if (pathname.startsWith("/model-test-tools"))
    return { page: "model-test-tools" };
  if (pathname.startsWith("/model-test")) return { page: "model-test" };
  if (pathname.startsWith("/model-call-logs"))
    return { page: "model-call-logs" };
  if (pathname.startsWith("/model-service")) return { page: "model-service" };
  return { page: "home" };
}

export function pathFor(
  page: AppPage,
  projectId?: string,
  documentId?: string,
): string {
  const applicationPath = applicationPathFor(page, projectId, documentId);
  if (applicationPath) return applicationPath;
  if (page === "audio-annotation-editor" && projectId)
    return `/tools/audio-annotation/${encodeURIComponent(projectId)}`;
  const paths: Record<AppPage, string> = {
    "thought-workshop-notes": "/apps/thought-workshop",
    "thought-workshop-editor": "/apps/thought-workshop",
    "thought-workshop-legacy": "/apps/thought-workshop",
    home: "/home",
    apps: "/apps",
    files: "/files",
    tools: "/tools",
    "integrations-tool-apis": "/integrations/tool-apis",
    "integrations-mcp": "/integrations/mcp",
    "integrations-skills": "/integrations/skills",
    "video-frame-exporter": "/tools/video-frame-exporter",
    "audio-annotation-projects": "/tools/audio-annotation",
    "audio-annotation-editor": "/tools/audio-annotation",
    "model-test": "/model-test",
    "model-test-tools": projectId
      ? `/model-test-tools/${encodeURIComponent(projectId)}`
      : "/model-test-tools",
    "model-service": "/model-service",
    "model-call-logs": "/model-call-logs",
    "visual-workshop-projects": "/apps/visual-workshop",
    "visual-workshop-canvas": "/apps/visual-workshop",
    "visual-workshop-assets": "/apps/visual-workshop",
    "visual-workshop-tasks": "/apps/visual-workshop/tasks",
    "galgame-workshop-projects": "/apps/galgame-workshop",
    "galgame-workshop-overview": "/apps/galgame-workshop",
    "galgame-workshop-editor": "/apps/galgame-workshop",
    "galgame-workshop-preview": "/apps/galgame-workshop",
    "video-editor-projects": "/apps/video-editor",
    "video-editor-editor": "/apps/video-editor",
    "video-editor-tasks": "/apps/video-editor/tasks",
  };
  return paths[page];
}
import {
  applicationPathFor,
  matchApplicationPath,
} from "@app/applicationRegistry";

export function isThoughtWorkshopPage(
  page: AppPage,
): page is Extract<WorkshopPage, `thought-workshop-${string}`> {
  return page.startsWith("thought-workshop-");
}
