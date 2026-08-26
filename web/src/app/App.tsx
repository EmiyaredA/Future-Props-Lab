import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { StudioSidebar } from "@app/layout/StudioSidebar";
import { WorkshopShell } from "@app/layout/WorkshopShell";
import { PublicWorkspaceShowcase } from "@app/PublicWorkspaceShowcase";
import { useStudioSession } from "@app/StudioSession";
import { galgameSpeakerImportSource } from "@app/integrations/galgameSpeakerImport";
import {
  APPLICATION_DEFINITIONS,
  GALGAME_WORKSHOP_MODULE,
  VISUAL_WORKSHOP_MODULE,
  VIDEO_EDITOR_MODULE,
} from "@app/applicationRegistry";
import {
  isGalgameWorkshopPage,
  isVisualWorkshopPage,
  isVideoEditorPage,
  parseRoute,
  pathFor,
  type AppRoute,
  type AppPage,
  type StudioPage,
  type WorkshopPage,
} from "@app/routes";

const HomePage = lazy(() =>
  import("@features/home/HomePage").then((module) => ({
    default: module.HomePage,
  })),
);
const ApplicationCenterPage = lazy(() =>
  import("@features/applications/ApplicationCenterPage").then((module) => ({
    default: module.ApplicationCenterPage,
  })),
);
const FileManagementPage = lazy(() =>
  import("@features/files").then((module) => ({
    default: module.FileManagementPage,
  })),
);
const ToolNavigationPage = lazy(() =>
  import("@features/tools/ToolNavigationPage").then((module) => ({
    default: module.ToolNavigationPage,
  })),
);
const IntegrationCenterPage = lazy(() =>
  import("@features/integrations/IntegrationCenterPage").then((module) => ({
    default: module.IntegrationCenterPage,
  })),
);
const VideoFrameExporterPage = lazy(() =>
  import("@features/tools/VideoFrameExporterPage").then((module) => ({
    default: module.VideoFrameExporterPage,
  })),
);
const AudioAnnotationProjectsPage = lazy(() =>
  import("@features/audio-annotation/AudioAnnotationProjectsPage").then(
    (module) => ({
      default: module.AudioAnnotationProjectsPage,
    }),
  ),
);
const AudioAnnotationEditorPage = lazy(() =>
  import("@features/audio-annotation/AudioAnnotationEditorPage").then(
    (module) => ({
      default: module.AudioAnnotationEditorPage,
    }),
  ),
);
const ModelTestPage = lazy(() =>
  import("@features/models/conversation").then((module) => ({
    default: module.ModelTestPage,
  })),
);
const ModelTestToolsPage = lazy(() =>
  import("@features/models/tools").then((module) => ({
    default: module.ModelTestToolsPage,
  })),
);
const ModelServicePage = lazy(() =>
  import("@features/models/catalog").then((module) => ({
    default: module.ModelServicePage,
  })),
);
const ModelCallLogsPage = lazy(() =>
  import("@features/models/logs").then((module) => ({
    default: module.ModelCallLogsPage,
  })),
);
const VisualWorkshopCanvasPage = lazy(VISUAL_WORKSHOP_MODULE.pages.canvas);
const VisualWorkshopProjectsPage = lazy(VISUAL_WORKSHOP_MODULE.pages.projects);
const VisualWorkshopAssetsPage = lazy(VISUAL_WORKSHOP_MODULE.pages.assets);
const VisualWorkshopTasksPage = lazy(VISUAL_WORKSHOP_MODULE.pages.tasks);
const VisualWorkshopEmptyPage = lazy(VISUAL_WORKSHOP_MODULE.pages.empty);
const GalgameWorkshopProjectsPage = lazy(
  GALGAME_WORKSHOP_MODULE.pages.projects,
);
const GalgameWorkshopOverviewPage = lazy(
  GALGAME_WORKSHOP_MODULE.pages.overview,
);
const GalgameWorkshopEditorPage = lazy(GALGAME_WORKSHOP_MODULE.pages.editor);
const GalgameFastPreviewPage = lazy(GALGAME_WORKSHOP_MODULE.pages.preview);
const VideoEditorProjectsPage = lazy(VIDEO_EDITOR_MODULE.pages.projects);
const VideoEditorPage = lazy(VIDEO_EDITOR_MODULE.pages.editor);
const VideoEditorTasksPage = lazy(VIDEO_EDITOR_MODULE.pages.tasks);

function PageBoundary({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="page-loading">正在加载…</div>}>
      {children}
    </Suspense>
  );
}

export default function App() {
  const { me } = useStudioSession();
  const [route, setRoute] = useState<AppRoute>(parseRoute);
  const navigationGuard = useRef<
    ((continueNavigation: () => void) => boolean) | null
  >(null);
  const page = route.page;
  useEffect(() => {
    if (window.location.pathname === "/")
      window.history.replaceState({}, "", "/home");
    const pop = () => setRoute(parseRoute());
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const commitNavigation = (next: AppPage, projectId?: string) => {
    const path = pathFor(next, projectId);
    if (path !== window.location.pathname)
      window.history.pushState({}, "", path);
    setRoute({ page: next, projectId });
  };
  const navigate = (next: AppPage, projectId?: string) => {
    const commit = () => commitNavigation(next, projectId);
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
    navigate(next.page, next.projectId);
  };

  if (me.workspace.access_kind === "public_viewer") {
    return <PublicWorkspaceShowcase />;
  }

  if (page === "visual-workshop-canvas" && route.projectId) {
    return (
      <PageBoundary>
        <VisualWorkshopCanvasPage
          projectId={route.projectId}
          onBack={() => navigate("visual-workshop-projects")}
          onAssets={() => navigate("visual-workshop-assets", route.projectId)}
        />
      </PageBoundary>
    );
  }

  if (page === "galgame-workshop-editor" && route.projectId) {
    return (
      <PageBoundary>
        <GalgameWorkshopEditorPage
          projectId={route.projectId}
          onOverview={() =>
            navigate("galgame-workshop-overview", route.projectId)
          }
        />
      </PageBoundary>
    );
  }

  if (page === "galgame-workshop-preview" && route.projectId) {
    return (
      <PageBoundary>
        <GalgameFastPreviewPage projectId={route.projectId} />
      </PageBoundary>
    );
  }

  if (page === "video-editor-editor" && route.projectId) {
    return (
      <PageBoundary>
        <VideoEditorPage
          projectId={route.projectId}
          onBack={() => navigate("video-editor-projects")}
        />
      </PageBoundary>
    );
  }

  if (isVideoEditorPage(page)) {
    return (
      <WorkshopShell
        module={VIDEO_EDITOR_MODULE}
        page={page}
        navigate={(next) => navigate(next as WorkshopPage)}
        onBack={() => navigate("apps")}
      >
        <PageBoundary>
          {page === "video-editor-tasks" ? (
            <VideoEditorTasksPage
              onOpenProject={(projectId) =>
                navigate("video-editor-editor", projectId)
              }
            />
          ) : (
            <VideoEditorProjectsPage
              onOpenProject={(projectId) =>
                navigate("video-editor-editor", projectId)
              }
            />
          )}
        </PageBoundary>
      </WorkshopShell>
    );
  }

  if (isGalgameWorkshopPage(page)) {
    return (
      <WorkshopShell
        module={GALGAME_WORKSHOP_MODULE}
        page={page}
        navigate={(next) => navigate(next as WorkshopPage)}
        onBack={() => navigate("apps")}
      >
        <PageBoundary>
          {page === "galgame-workshop-overview" && route.projectId ? (
            <GalgameWorkshopOverviewPage
              projectId={route.projectId}
              onProjects={() => navigate("galgame-workshop-projects")}
              onOpenEditor={() =>
                navigate("galgame-workshop-editor", route.projectId)
              }
            />
          ) : (
            <GalgameWorkshopProjectsPage
              onOpenProject={(projectId) =>
                navigate("galgame-workshop-overview", projectId)
              }
            />
          )}
        </PageBoundary>
      </WorkshopShell>
    );
  }

  if (isVisualWorkshopPage(page)) {
    return (
      <WorkshopShell
        module={VISUAL_WORKSHOP_MODULE}
        page={page}
        navigate={(next) => navigate(next as WorkshopPage)}
        onBack={() => navigate("apps")}
      >
        <PageBoundary>
          {page === "visual-workshop-projects" ? (
            <VisualWorkshopProjectsPage
              onOpenProject={(projectId) =>
                navigate("visual-workshop-canvas", projectId)
              }
              onOpenAssets={(projectId) =>
                navigate("visual-workshop-assets", projectId)
              }
            />
          ) : page === "visual-workshop-assets" && route.projectId ? (
            <VisualWorkshopAssetsPage
              projectId={route.projectId}
              onCanvas={() =>
                navigate("visual-workshop-canvas", route.projectId)
              }
              onProjects={() => navigate("visual-workshop-projects")}
            />
          ) : page === "visual-workshop-tasks" ? (
            <VisualWorkshopTasksPage
              onOpenProject={(projectId) =>
                navigate("visual-workshop-canvas", projectId)
              }
              onOpenAssets={(projectId) =>
                navigate("visual-workshop-assets", projectId)
              }
            />
          ) : (
            <VisualWorkshopEmptyPage
              page={page === "visual-workshop-assets" ? "assets" : "tasks"}
              onProjects={() => navigate("visual-workshop-projects")}
            />
          )}
        </PageBoundary>
      </WorkshopShell>
    );
  }

  return (
    <div className="studio-shell">
      <StudioSidebar
        page={page}
        navigate={(next: StudioPage) => navigate(next)}
      />
      <main className="studio-main">
        <PageBoundary>
          {page === "home" ? (
            <HomePage onNavigate={navigatePath} />
          ) : page === "apps" ? (
            <ApplicationCenterPage
              applications={APPLICATION_DEFINITIONS}
              onOpen={navigatePath}
            />
          ) : page === "files" ? (
            <FileManagementPage />
          ) : page === "tools" ? (
            <ToolNavigationPage onOpenInternal={navigatePath} />
          ) : page.startsWith("integrations-") ? (
            <IntegrationCenterPage
              canManage={["owner", "platform_admin"].includes(
                me.workspace.access_kind,
              )}
              kind={
                page === "integrations-mcp"
                  ? "mcp"
                  : page === "integrations-skills"
                    ? "skills"
                    : "tool-apis"
              }
              onKindChange={(kind) =>
                navigate(
                  kind === "mcp"
                    ? "integrations-mcp"
                    : kind === "skills"
                      ? "integrations-skills"
                      : "integrations-tool-apis",
                )
              }
            />
          ) : page === "video-frame-exporter" ? (
            <VideoFrameExporterPage onBack={() => navigate("tools")} />
          ) : page === "audio-annotation-projects" ? (
            <AudioAnnotationProjectsPage
              onBack={() => navigate("tools")}
              onOpen={(projectId) =>
                navigate("audio-annotation-editor", projectId)
              }
            />
          ) : page === "audio-annotation-editor" && route.projectId ? (
            <AudioAnnotationEditorPage
              projectId={route.projectId}
              workspaceId={me.workspace.id}
              onBack={() => navigate("audio-annotation-projects")}
              registerNavigationGuard={registerNavigationGuard}
              speakerImportSource={galgameSpeakerImportSource}
            />
          ) : page === "model-test" ? (
            <ModelTestPage
              onOpenAudioAnnotation={(projectId) =>
                navigate("audio-annotation-editor", projectId)
              }
            />
          ) : page === "model-test-tools" ? (
            <ModelTestToolsPage
              toolId={route.projectId}
              onOpenTool={(toolId) => navigate("model-test-tools", toolId)}
              onBack={() => navigate("model-test-tools")}
            />
          ) : page === "model-service" ? (
            <ModelServicePage />
          ) : (
            <ModelCallLogsPage />
          )}
        </PageBoundary>
      </main>
    </div>
  );
}
