export type StudioPage =
  | "thought-workshop-community"
  | "thought-workshop-favorites"
  | "thought-workshop-published"
  | "management-accounts"
  | "management-workspaces"
  | "management-audit"
  | "management-invites"
  | "management-settings"
  | "management-services"
  | "management-permissions"
  | "home"
  | "creative-workshop"
  | "creative-workshop-mine"
  | "creative-workshop-new"
  | "creative-workshop-editor"
  | "creative-workshop-detail"
  | "apps"
  | "files"
  | "tools"
  | "integrations-tool-apis"
  | "integrations-mcp"
  | "integrations-skills"
  | "integrations-external-connections"
  | "video-frame-exporter"
  | "video-downloader"
  | "codex-model-source"
  | "model-test"
  | "model-test-tools"
  | "model-service"
  | "model-call-logs";

export type WorkshopPage =
  | "presentation-workshop-projects"
  | "presentation-workshop-editor"
  | "thought-workshop-notes"
  | "thought-workshop-editor"
  | "thought-workshop-legacy"
  | "thought-workshop-official"
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
  | "video-editor-tasks"
  | "live2d-workshop-projects"
  | "live2d-workshop-editor"
  | "desktop-pet-projects"
  | "desktop-pet-editor"
  | "motion-compositor-projects"
  | "motion-compositor-editor"
  | "audio-annotation-projects"
  | "audio-annotation-editor"
  | "director-desk-projects"
  | "director-desk-editor";

export type VisualWorkshopPage = Extract<
  WorkshopPage,
  `visual-workshop-${string}`
>;
export type GalgameWorkshopPage = Extract<
  WorkshopPage,
  `galgame-workshop-${string}`
>;
export type VideoEditorPage = Extract<WorkshopPage, `video-editor-${string}`>;
export type AudioAnnotationPage = Extract<
  WorkshopPage,
  `audio-annotation-${string}`
>;
export type DirectorDeskPage = Extract<WorkshopPage, `director-desk-${string}`>;

export type AppPage = StudioPage | WorkshopPage;

export type AppRoute = {
  page: AppPage;
  projectId?: string;
  documentId?: string;
};

export function isWorkshopPage(page: AppPage): page is WorkshopPage {
  return (
    page.startsWith("presentation-workshop-") ||
    page.startsWith("thought-workshop-") ||
    page.startsWith("visual-workshop-") ||
    page.startsWith("galgame-workshop-") ||
    page.startsWith("video-editor-") ||
    page.startsWith("motion-compositor-") ||
    page.startsWith("live2d-workshop-") ||
    page.startsWith("desktop-pet-") ||
    page.startsWith("audio-annotation-") ||
    page.startsWith("director-desk-")
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

export function isAudioAnnotationPage(
  page: AppPage,
): page is AudioAnnotationPage {
  return page.startsWith("audio-annotation-");
}

export function isDirectorDeskPage(page: AppPage): page is DirectorDeskPage {
  return page.startsWith("director-desk-");
}

export function parsePage(pathname = window.location.pathname): AppPage {
  return parseRoute(pathname).page;
}

export function parseRoute(pathname = window.location.pathname): AppRoute {
  if (pathname.startsWith("/management/invites"))
    return { page: "management-invites" };
  if (pathname.startsWith("/management/settings"))
    return { page: "management-settings" };
  if (pathname.startsWith("/management/services"))
    return { page: "management-services" };
  if (pathname.startsWith("/management/permissions"))
    return { page: "management-permissions" };
  if (pathname.startsWith("/management/workspaces"))
    return { page: "management-workspaces" };
  if (pathname.startsWith("/management/audit"))
    return { page: "management-audit" };
  if (pathname.startsWith("/management"))
    return { page: "management-accounts" };
  const community = pathname.match(
    /^\/apps\/thought-workshop\/community(?:\/([^/]+)(?:\/documents\/([^/]+))?)?\/?$/,
  );
  if (community)
    return {
      page: "thought-workshop-community",
      projectId: community[1] ? decodeURIComponent(community[1]) : undefined,
      documentId: community[2] ? decodeURIComponent(community[2]) : undefined,
    };
  if (pathname === "/apps/thought-workshop/favorites")
    return { page: "thought-workshop-favorites" };
  if (pathname === "/apps/thought-workshop/published")
    return { page: "thought-workshop-published" };
  const application = matchApplicationPath(pathname);
  if (application) return application as AppRoute;
  // Legacy tool URLs keep resolving so bookmarks and old agent opens still land.
  const legacyAudioAnnotation = pathname.match(
    /^\/tools\/audio-annotation\/([^/]+)\/?$/,
  );
  if (legacyAudioAnnotation)
    return {
      page: "audio-annotation-editor",
      projectId: decodeURIComponent(legacyAudioAnnotation[1]),
    };
  if (pathname.startsWith("/tools/audio-annotation"))
    return { page: "audio-annotation-projects" };
  const creativeEditor = pathname.match(
    /^\/creative-workshop\/edit\/([^/]+)\/?$/,
  );
  if (creativeEditor)
    return {
      page: "creative-workshop-editor",
      projectId: decodeURIComponent(creativeEditor[1]),
    };
  const creativeDetail = pathname.match(
    /^\/creative-workshop\/item\/([^/]+)\/?$/,
  );
  if (creativeDetail)
    return {
      page: "creative-workshop-detail",
      projectId: decodeURIComponent(creativeDetail[1]),
    };
  if (pathname.startsWith("/creative-workshop/mine"))
    return { page: "creative-workshop-mine" };
  if (pathname.startsWith("/creative-workshop/new"))
    return { page: "creative-workshop-new" };
  if (pathname.startsWith("/creative-workshop"))
    return { page: "creative-workshop" };
  if (pathname.startsWith("/apps")) return { page: "apps" };
  if (pathname.startsWith("/files")) return { page: "files" };
  if (pathname.startsWith("/integrations/mcp"))
    return { page: "integrations-mcp" };
  if (pathname.startsWith("/integrations/skills"))
    return { page: "integrations-skills" };
  if (pathname.startsWith("/integrations/external-connections"))
    return { page: "integrations-external-connections" };
  if (pathname.startsWith("/integrations"))
    return { page: "integrations-tool-apis" };
  if (pathname.startsWith("/tools/video-frame-exporter"))
    return { page: "video-frame-exporter" };
  if (pathname.startsWith("/tools/video-downloader"))
    return { page: "video-downloader" };
  if (pathname.startsWith("/tools/codex-model-source"))
    return { page: "codex-model-source" };
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
  const paths: Record<AppPage, string> = {
    "presentation-workshop-projects": "/apps/presentation-workshop",
    "presentation-workshop-editor": "/apps/presentation-workshop",
    "thought-workshop-notes": "/apps/thought-workshop",
    "thought-workshop-editor": "/apps/thought-workshop",
    "thought-workshop-legacy": "/apps/thought-workshop",
    "thought-workshop-official": "/apps/thought-workshop",
    "thought-workshop-community": `/apps/thought-workshop/community${projectId ? `/${encodeURIComponent(projectId)}${documentId ? `/documents/${encodeURIComponent(documentId)}` : ""}` : ""}`,
    "thought-workshop-favorites": "/apps/thought-workshop/favorites",
    "thought-workshop-published": "/apps/thought-workshop/published",
    "management-accounts": "/management/accounts",
    "management-workspaces": "/management/workspaces",
    "management-audit": "/management/audit",
    "management-invites": "/management/invites",
    "management-settings": "/management/settings",
    "management-services": "/management/services",
    "management-permissions": "/management/permissions",
    home: "/home",
    "creative-workshop": "/creative-workshop",
    "creative-workshop-mine": "/creative-workshop/mine",
    "creative-workshop-new": "/creative-workshop/new",
    "creative-workshop-editor": projectId
      ? `/creative-workshop/edit/${encodeURIComponent(projectId)}`
      : "/creative-workshop/mine",
    "creative-workshop-detail": projectId
      ? `/creative-workshop/item/${encodeURIComponent(projectId)}`
      : "/creative-workshop",
    apps: "/apps",
    files: "/files",
    tools: "/tools",
    "integrations-tool-apis": "/integrations/tool-apis",
    "integrations-mcp": "/integrations/mcp",
    "integrations-skills": "/integrations/skills",
    "integrations-external-connections": "/integrations/external-connections",
    "video-frame-exporter": "/tools/video-frame-exporter",
    "video-downloader": "/tools/video-downloader",
    "codex-model-source": "/tools/codex-model-source",
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
    "live2d-workshop-projects": "/apps/live2d-workshop",
    "live2d-workshop-editor": "/apps/live2d-workshop",
    "desktop-pet-projects": "/apps/desktop-pet",
    "desktop-pet-editor": "/apps/desktop-pet",
    "motion-compositor-projects": "/apps/motion-compositor",
    "motion-compositor-editor": "/apps/motion-compositor",
    "audio-annotation-projects": "/apps/audio-annotation",
    "audio-annotation-editor": "/apps/audio-annotation",
    "director-desk-projects": "/apps/director-desk",
    "director-desk-editor": "/apps/director-desk",
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

export function hasReadOnlyRoute(page: AppPage) {
  return (
    page === "files" ||
    page === "model-test" ||
    /^(visual-workshop|thought-workshop|galgame-workshop|video-editor|motion-compositor|live2d-workshop|audio-annotation)-/.test(
      page,
    )
  );
}
