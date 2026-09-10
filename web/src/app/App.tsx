import { StudioGlobalHeader } from "@app/layout/StudioGlobalHeader";
import { isWorkshopPage, hasReadOnlyRoute } from "./routes";
import { ReadOnlyRoutes } from "./ReadOnlyRoutes";
import { workspaceAllows } from "@features/accounts/permissions";
import type { ManagementPage } from "@features/accounts/ManagementConsole";
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
  PRESENTATION_WORKSHOP_MODULE,
  THOUGHT_WORKSHOP_MODULE,
  GALGAME_WORKSHOP_MODULE,
  VISUAL_WORKSHOP_MODULE,
  VIDEO_EDITOR_MODULE,
} from "@app/applicationRegistry";
import {
  isGalgameWorkshopPage,
  isThoughtWorkshopPage,
  isVisualWorkshopPage,
  isVideoEditorPage,
  parseRoute,
  pathFor,
  type AppRoute,
  type AppPage,
  type StudioPage,
  type WorkshopPage,
} from "@app/routes";

const PresentationWorkshopPage = lazy(
  PRESENTATION_WORKSHOP_MODULE.pages.workspace,
);

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

const ThoughtWorkshopPage = lazy(THOUGHT_WORKSHOP_MODULE.pages.notes);

function PageBoundary({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="page-loading">正在加载…</div>}>
      {children}
    </Suspense>
  );
}

export default function App() {
  const session = useStudioSession();
  const { me } = session;
  const [route, setRoute] = useState<AppRoute>(parseRoute);
  const [catalogTestModel, setCatalogTestModel] = useState<string | null>(null);
  const navigationGuard = useRef<
    ((continueNavigation: () => void) => boolean) | null
  >(null);
  const routeRef = useRef(route);
  routeRef.current = route;
  const page = route.page;
  useEffect(() => {
    if (window.location.pathname === "/")
      window.history.replaceState({}, "", "/home");
    const pop = () => {
      const next = parseRoute();
      if (
        navigationGuard.current?.(() => {
          window.history.pushState(
            {},
            "",
            pathFor(next.page, next.projectId, next.documentId),
          );
          setRoute(next);
        })
      ) {
        const previous = routeRef.current;
        window.history.pushState(
          {},
          "",
          pathFor(previous.page, previous.projectId, previous.documentId),
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
  ) => {
    const path = pathFor(next, projectId, documentId);
    if (path !== window.location.pathname)
      window.history.pushState({}, "", path);
    setRoute({ page: next, projectId, documentId });
  };
  const navigate = (next: AppPage, projectId?: string, documentId?: string) => {
    const commit = () => commitNavigation(next, projectId, documentId);
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
    navigate(next.page, next.projectId, next.documentId);
  };

  useEffect(() => {
    const handle = (event: Event) =>
      navigatePath((event as CustomEvent<string>).detail);
    const guard = (event: Event) => {
      const e = event as CustomEvent<() => void>;
      if (navigationGuard.current?.(e.detail)) e.preventDefault();
    };
    window.addEventListener("future-props:navigate", handle);
    window.addEventListener("future-props:before-workspace-switch", guard);
    return () => {
      window.removeEventListener("future-props:navigate", handle);
      window.removeEventListener("future-props:before-workspace-switch", guard);
    };
  });

  if (page.startsWith("management-"))
    return (
      <PageBoundary>
        <ManagementConsole
          page={page as ManagementPage}
          session={session}
          navigate={navigate}
          onBack={() => navigate("home")}
        />
      </PageBoundary>
    );

  if (me.workspace.access_kind === "public_viewer") {
    return <PublicWorkspaceShowcase />;
  }

  if (
    page === "presentation-workshop-projects" ||
    page === "presentation-workshop-editor"
  )
    return (
      <PageBoundary>
        <PresentationWorkshopPage
          projectId={route.projectId}
          readOnly={!workspaceAllows(me.workspace, "content.write")}
          onOpen={(id) => navigate("presentation-workshop-editor", id)}
          onBack={() =>
            navigate(
              route.projectId ? "presentation-workshop-projects" : "apps",
            )
          }
          registerNavigationGuard={registerNavigationGuard}
        />
      </PageBoundary>
    );

  if (
    (!workspaceAllows(me.workspace, "content.write") &&
      hasReadOnlyRoute(page)) ||
    (!workspaceAllows(me.workspace, "configuration.manage") &&
      ["model-service", "model-test-tools"].includes(page)) ||
    (!workspaceAllows(me.workspace, "logs.read") && page === "model-call-logs")
  ) {
    return (
      <div className="studio-shell">
        <StudioSidebar
          page={isWorkshopPage(page) ? "apps" : (page as StudioPage)}
          navigate={navigate}
        />
        <main className="studio-main">
          <StudioGlobalHeader />
          <PageBoundary>
            {page === "model-call-logs" ? (
              <section className="readonly-page">
                <h1>需要管理员权限</h1>
                <p>完整模型调用日志与诊断包仅向工作区管理员开放。</p>
              </section>
            ) : page === "model-service" ? (
              <ModelServicePage
                key={me.workspace.id}
                canWrite={false}
                canTest={
                  workspaceAllows(me.workspace, "content.write") &&
                  workspaceAllows(me.workspace, "models.use")
                }
                onTestModel={(model) => {
                  setCatalogTestModel(model.id);
                  navigate("model-test");
                }}
              />
            ) : page === "model-test-tools" ? (
              <ReadOnlyConfiguration tools />
            ) : (
              <ReadOnlyRoutes route={route} navigate={navigate} />
            )}
          </PageBoundary>
        </main>
      </div>
    );
  }

  if (isThoughtWorkshopPage(page)) {
    return (
      <PageBoundary>
        <ThoughtWorkshopPage
          key={me.workspace.id}
          page={page}
          projectId={route.projectId}
          noteId={route.documentId}
          onNavigate={(project, document, replace) => {
            const next = project
              ? "thought-workshop-editor"
              : "thought-workshop-notes";
            if (replace) {
              window.history.replaceState(
                {},
                "",
                pathFor(next, project, document),
              );
              setRoute({
                page: next,
                projectId: project,
                documentId: document,
              });
            } else navigate(next, project, document);
          }}
          onBack={() => navigate("apps")}
          onModels={() => navigate("model-service")}
          registerNavigationGuard={registerNavigationGuard}
        />
      </PageBoundary>
    );
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
          key={route.projectId}
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
        <StudioGlobalHeader />
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
              canManage={workspaceAllows(me.workspace, "configuration.manage")}
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
              initialModelId={catalogTestModel}
              onInitialModelHandled={() => setCatalogTestModel(null)}
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
            <ModelServicePage
              key={me.workspace.id}
              canWrite={workspaceAllows(me.workspace, "configuration.manage")}
              canTest={
                workspaceAllows(me.workspace, "content.write") &&
                workspaceAllows(me.workspace, "models.use")
              }
              onTestModel={(model) => {
                setCatalogTestModel(model.id);
                navigate("model-test");
              }}
            />
          ) : (
            <ModelCallLogsPage
              key={me.workspace.id}
              currentWorkspace={me.workspace}
            />
          )}
        </PageBoundary>
      </main>
    </div>
  );
}

const ManagementConsole = lazy(() =>
  import("@features/accounts/ManagementConsole").then((m) => ({
    default: m.ManagementConsole,
  })),
);

const ReadOnlyConfiguration = lazy(() =>
  import("@features/models/ReadOnlyConfiguration").then((m) => ({
    default: m.ReadOnlyConfiguration,
  })),
);
