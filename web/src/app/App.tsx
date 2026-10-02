import { PageErrorBoundary } from "./PageErrorBoundary";
import { LIVE2D_WORKSHOP_MODULE } from "@features/live2d-workshop/module";
import { DESKTOP_PET_MODULE } from "@features/desktop-pet/module";
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
import { StudioShell } from "@app/layout/StudioSidebar";
import { WorkshopShell } from "@app/layout/WorkshopShell";
import { PublicWorkspaceShowcase } from "@app/PublicWorkspaceShowcase";
import { useStudioSession } from "@app/StudioSession";
import { galgameSpeakerImportSource } from "@app/integrations/galgameSpeakerImport";
import {
  APPLICATION_DEFINITIONS,
  AUDIO_ANNOTATION_MODULE,
  DIRECTOR_DESK_MODULE,
  PRESENTATION_WORKSHOP_MODULE,
  THOUGHT_WORKSHOP_MODULE,
  GALGAME_WORKSHOP_MODULE,
  VISUAL_WORKSHOP_MODULE,
  VIDEO_EDITOR_MODULE,
  MOTION_COMPOSITOR_MODULE,
} from "@app/applicationRegistry";
import {
  isAudioAnnotationPage,
  isDirectorDeskPage,
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
const CreativeWorkshopPage = lazy(() =>
  import("@features/creative-workshop/CreativeWorkshopPage").then((module) => ({
    default: module.CreativeWorkshopPage,
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
const CodexModelSourcePage = lazy(() =>
  import("@features/tools/CodexModelSourcePage").then((module) => ({
    default: module.CodexModelSourcePage,
  })),
);
const AudioAnnotationProjectsPage = lazy(
  AUDIO_ANNOTATION_MODULE.pages.projects,
);
const AudioAnnotationEditorPage = lazy(AUDIO_ANNOTATION_MODULE.pages.editor);
const DirectorDeskProjectsPage = lazy(DIRECTOR_DESK_MODULE.pages.projects);
const DirectorDeskEditorPage = lazy(DIRECTOR_DESK_MODULE.pages.editor);
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
const Live2DProjectsPage = lazy(() =>
  import("@features/live2d-workshop/ProjectsPage").then((m) => ({
    default: m.ProjectsPage,
  })),
);
const Live2DEditorPage = lazy(() =>
  import("@features/live2d-workshop/EditorPage").then((m) => ({
    default: m.EditorPage,
  })),
);
const DesktopPetProjectsPage = lazy(() =>
  import("@features/desktop-pet/ProjectsPage").then((m) => ({
    default: m.ProjectsPage,
  })),
);
const DesktopPetEditorPage = lazy(() =>
  import("@features/desktop-pet/EditorPage").then((m) => ({
    default: m.EditorPage,
  })),
);

const MotionCompositorProjectsPage = lazy(() =>
  import("@features/motion-compositor/ProjectsPage").then((m) => ({
    default: m.ProjectsPage,
  })),
);
const MotionCompositorEditorPage = lazy(() =>
  import("@features/motion-compositor/EditorPage").then((m) => ({
    default: m.EditorPage,
  })),
);

const ThoughtWorkshopPage = lazy(THOUGHT_WORKSHOP_MODULE.pages.notes);
const OfficialKnowledgePage = lazy(() =>
  import("@features/thought-workshop/official/OfficialKnowledgePage").then(
    (m) => ({ default: m.OfficialKnowledgePage }),
  ),
);

function PageBoundary({ children }: { children: ReactNode }) {
  return (
    <PageErrorBoundary key={window.location.pathname}>
      <Suspense fallback={<div className="page-loading">正在加载…</div>}>
        {children}
      </Suspense>
    </PageErrorBoundary>
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
    void window.futurePropsDesktop?.publishPetContext?.({
      userId: me.user.id,
      workspaceId: me.workspace.id,
    });
  }, [me.user.id, me.workspace.id]);
  useEffect(() => {
    const key = String(page);
    const applications: Record<string, string> = {
      "presentation-workshop": "演示工坊",
      "thought-workshop": "思绪工坊",
      "visual-workshop": "视觉创作工坊",
      "galgame-workshop": "Galgame 工坊",
      "video-editor": "视频剪辑工坊",
      "motion-compositor": "特效制作工坊",
      "audio-annotation": "音频标注工坊",
      "director-desk": "导演台",
      "live2d-workshop": "Live2D 工坊",
      "desktop-pet": "桌宠工坊",
      "creative-workshop": "创意工坊",
    };
    const application =
      Object.entries(applications).find(([prefix]) =>
        key.startsWith(prefix),
      )?.[1] || (page === "apps" ? "应用首页" : "研究所");
    queueMicrotask(() =>
      window.dispatchEvent(
        new CustomEvent("future-props:amadeus-context", {
          detail: {
            path: location.pathname,
            title: document.title,
            application,
            projectId: route.projectId,
            userId: me.user.id,
            workspaceId: me.workspace.id,
          },
        }),
      ),
    );
  }, [page, route.projectId, route.documentId, me.user.id, me.workspace.id]);
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
    window.addEventListener("future-props:before-workspace-switch", guard);
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
      window.removeEventListener("future-props:before-workspace-switch", guard);
      window.removeEventListener(
        "future-props:development-query-refresh",
        deferRefresh,
      );
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

  if (page === "presentation-workshop-projects")
    return (
      <WorkshopShell
        module={PRESENTATION_WORKSHOP_MODULE}
        page={page}
        navigate={(next) => navigate(next as WorkshopPage)}
        onBack={() => navigate("apps")}
      >
        <PageBoundary>
          <PresentationWorkshopPage
            readOnly={!workspaceAllows(me.workspace, "content.write")}
            onOpen={(id) => navigate("presentation-workshop-editor", id)}
            onBack={() => navigate("apps")}
            registerNavigationGuard={registerNavigationGuard}
          />
        </PageBoundary>
      </WorkshopShell>
    );

  if (page === "presentation-workshop-editor")
    return (
      <PageBoundary>
        <PresentationWorkshopPage
          projectId={route.projectId}
          readOnly={!workspaceAllows(me.workspace, "content.write")}
          onOpen={(id) => navigate("presentation-workshop-editor", id)}
          onBack={() => navigate("presentation-workshop-projects")}
          registerNavigationGuard={registerNavigationGuard}
        />
      </PageBoundary>
    );

  if (page === "live2d-workshop-editor" && route.projectId)
    return (
      <PageBoundary>
        <Live2DEditorPage
          key={route.projectId}
          projectId={route.projectId}
          onBack={() => navigate("live2d-workshop-projects")}
          registerNavigationGuard={registerNavigationGuard}
          readOnly={!workspaceAllows(me.workspace, "content.write")}
        />
      </PageBoundary>
    );

  if (page === "live2d-workshop-projects")
    return (
      <WorkshopShell
        module={LIVE2D_WORKSHOP_MODULE}
        page={page}
        navigate={(next) => navigate(next as WorkshopPage)}
        onBack={() => navigate("apps")}
      >
        <PageBoundary>
          <Live2DProjectsPage
            readOnly={!workspaceAllows(me.workspace, "content.write")}
            appearanceScope={{
              userId: me.user.id,
              workspaceId: me.workspace.id,
            }}
            onOpen={(projectId) =>
              navigate("live2d-workshop-editor", projectId)
            }
          />
        </PageBoundary>
      </WorkshopShell>
    );

  if (page === "desktop-pet-editor" && route.projectId)
    return (
      <PageBoundary>
        <DesktopPetEditorPage
          key={route.projectId}
          projectId={route.projectId}
          onBack={() => navigate("desktop-pet-projects")}
          readOnly={!workspaceAllows(me.workspace, "content.write")}
          registerNavigationGuard={registerNavigationGuard}
        />
      </PageBoundary>
    );

  if (page === "desktop-pet-projects")
    return (
      <WorkshopShell
        module={DESKTOP_PET_MODULE}
        page={page}
        navigate={(next) => navigate(next as WorkshopPage)}
        onBack={() => navigate("apps")}
      >
        <PageBoundary>
          <DesktopPetProjectsPage
            readOnly={!workspaceAllows(me.workspace, "content.write")}
            onOpen={(id) => navigate("desktop-pet-editor", id)}
          />
        </PageBoundary>
      </WorkshopShell>
    );

  if (page === "motion-compositor-editor" && route.projectId)
    return (
      <PageBoundary>
        <MotionCompositorEditorPage
          key={route.projectId}
          projectId={route.projectId}
          onBack={() => navigate("motion-compositor-projects")}
          registerNavigationGuard={registerNavigationGuard}
          readOnly={!workspaceAllows(me.workspace, "content.write")}
        />
      </PageBoundary>
    );

  if (page === "motion-compositor-projects")
    return (
      <WorkshopShell
        module={MOTION_COMPOSITOR_MODULE}
        page={page}
        navigate={(next) => navigate(next as WorkshopPage)}
        onBack={() => navigate("apps")}
      >
        <PageBoundary>
          <MotionCompositorProjectsPage
            readOnly={!workspaceAllows(me.workspace, "content.write")}
            onOpen={(projectId) =>
              navigate("motion-compositor-editor", projectId)
            }
          />
        </PageBoundary>
      </WorkshopShell>
    );

  if (page === "thought-workshop-official") {
    if (!workspaceAllows(me.workspace, "content.read"))
      return (
        <PageBoundary>
          <main className="readonly-page">
            <h1>需要内容阅读权限</h1>
            <button className="btn" onClick={() => navigate("apps")}>
              返回应用中心
            </button>
          </main>
        </PageBoundary>
      );
    return (
      <PageBoundary>
        <OfficialKnowledgePage
          key={me.workspace.id}
          canCopy={workspaceAllows(me.workspace, "content.write")}
          onOpenNote={(library, note) =>
            navigate("thought-workshop-editor", library, note)
          }
          libraryId={route.projectId}
          documentId={route.documentId}
          onOpen={(library, document) =>
            navigate("thought-workshop-official", library, document)
          }
          onBack={() => navigate("thought-workshop-notes")}
        />
      </PageBoundary>
    );
  }

  if (
    (!workspaceAllows(me.workspace, "content.write") &&
      hasReadOnlyRoute(page)) ||
    (!workspaceAllows(me.workspace, "configuration.manage") &&
      ["model-service", "model-test-tools"].includes(page)) ||
    (!workspaceAllows(me.workspace, "logs.read") && page === "model-call-logs")
  ) {
    return (
      <StudioShell
        page={isWorkshopPage(page) ? "apps" : (page as StudioPage)}
        navigate={navigate}
      >
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
      </StudioShell>
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
          onOpenOfficial={(library) =>
            navigate("thought-workshop-official", library)
          }
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
          registerNavigationGuard={registerNavigationGuard}
        />
      </PageBoundary>
    );
  }

  if (page === "audio-annotation-editor" && route.projectId)
    return (
      <PageBoundary>
        <AudioAnnotationEditorPage
          projectId={route.projectId}
          workspaceId={me.workspace.id}
          onBack={() => navigate("audio-annotation-projects")}
          registerNavigationGuard={registerNavigationGuard}
          speakerImportSource={galgameSpeakerImportSource}
        />
      </PageBoundary>
    );

  if (isAudioAnnotationPage(page))
    return (
      <WorkshopShell
        module={AUDIO_ANNOTATION_MODULE}
        page={page}
        navigate={(next) => navigate(next as WorkshopPage)}
        onBack={() => navigate("apps")}
      >
        <PageBoundary>
          <AudioAnnotationProjectsPage
            onOpen={(projectId) =>
              navigate("audio-annotation-editor", projectId)
            }
          />
        </PageBoundary>
      </WorkshopShell>
    );

  if (page === "director-desk-editor" && route.projectId)
    return (
      <PageBoundary>
        <DirectorDeskEditorPage
          projectId={route.projectId}
          onBack={() => navigate("director-desk-projects")}
        />
      </PageBoundary>
    );

  if (isDirectorDeskPage(page))
    return (
      <WorkshopShell
        module={DIRECTOR_DESK_MODULE}
        page={page}
        navigate={(next) => navigate(next as WorkshopPage)}
        onBack={() => navigate("apps")}
      >
        <PageBoundary>
          <DirectorDeskProjectsPage
            readOnly={!workspaceAllows(me.workspace, "content.write")}
            onOpen={(projectId) => navigate("director-desk-editor", projectId)}
          />
        </PageBoundary>
      </WorkshopShell>
    );

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
    <StudioShell
      page={page as StudioPage}
      navigate={(next: StudioPage) => navigate(next)}
    >
      <PageBoundary>
        {page === "home" ? (
          <HomePage onNavigate={navigatePath} />
        ) : page.startsWith("creative-workshop") ? (
          <CreativeWorkshopPage
            mode={
              page as
                | "creative-workshop"
                | "creative-workshop-mine"
                | "creative-workshop-new"
                | "creative-workshop-editor"
                | "creative-workshop-detail"
            }
            itemId={route.projectId}
            canWrite={workspaceAllows(me.workspace, "content.write")}
            canInstall={workspaceAllows(me.workspace, "configuration.manage")}
            navigate={(next, id) => navigate(next, id)}
          />
        ) : page === "apps" ? (
          <ApplicationCenterPage
            applications={APPLICATION_DEFINITIONS}
            onOpen={navigatePath}
          />
        ) : page === "files" ? (
          <FileManagementPage />
        ) : page === "tools" ? (
          <ToolNavigationPage
            onOpenInternal={navigatePath}
            canManageCodex={
              Boolean(window.futurePropsDesktop) && me.user.is_platform_admin
            }
          />
        ) : page.startsWith("integrations-") ? (
          <IntegrationCenterPage
            registerNavigationGuard={registerNavigationGuard}
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
        ) : page === "codex-model-source" ? (
          <CodexModelSourcePage onBack={() => navigate("tools")} />
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
    </StudioShell>
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
