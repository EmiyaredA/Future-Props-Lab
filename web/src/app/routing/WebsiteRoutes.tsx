import { useWebsiteNavigation } from "./useWebsiteNavigation";
import { useRuntimeAccess } from "@features/accounts";
import { LoadingState } from "@shared/ui/LoadingState";
import { PresentationWorkshopRoute } from "./PresentationWorkshopRoute";
import { CodeAgentsRoute } from "./CodeAgentsRoute";
import { ModelServiceRoute } from "./ModelServiceRoute";
import type { KnowledgeSection } from "@features/thought-workshop/KnowledgeSections";
import { PageErrorBoundary } from "@app/PageErrorBoundary";
import { isWorkshopPage, hasReadOnlyRoute } from "@app/routes";
import { ReadOnlyRoutes } from "./ReadOnlyRoutes";
import { accountAllows } from "@features/accounts/permissions";
import { CloudControlPage } from "@features/cloud-control/CloudControlPage";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { StudioShell } from "@app/layout/StudioSidebar";
import { WorkshopShell } from "@app/layout/WorkshopShell";
import { useStudioSession } from "@app/StudioSession";
import { galgameSpeakerImportSource } from "@app/integrations/galgameSpeakerImport";
import {
  APPLICATION_DEFINITIONS,
  AUDIO_ANNOTATION_MODULE,
  DIRECTOR_DESK_MODULE,
  THOUGHT_WORKSHOP_MODULE,
  GALGAME_WORKSHOP_MODULE,
  VISUAL_WORKSHOP_MODULE,
  VIDEO_EDITOR_MODULE,
  MOTION_COMPOSITOR_MODULE,
  INTERVIEW_ASSISTANT_MODULE,
} from "@app/applicationRegistry";
import {
  isAudioAnnotationPage,
  isDirectorDeskPage,
  isGalgameWorkshopPage,
  isThoughtWorkshopPage,
  isVisualWorkshopPage,
  isVideoEditorPage,
  type StudioPage,
  type WorkshopPage,
} from "@app/routes";

const InterviewAssistantPage = lazy(INTERVIEW_ASSISTANT_MODULE.pages.workspace);

const HomePage = lazy(() =>
  import("@features/home/HomePage").then((module) => ({
    default: module.HomePage,
  })),
);
const ApplicationCenterPage = lazy(() =>
  import("@features/applications/ApplicationCenterRoute").then((module) => ({
    default: module.ApplicationCenterRoute,
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
const VideoDownloaderPage = lazy(() =>
  import("@features/tools/VideoDownloaderPage").then((module) => ({
    default: module.VideoDownloaderPage,
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
const MotionCompositorProjectsPage = lazy(
  MOTION_COMPOSITOR_MODULE.pages.projects,
);
const MotionCompositorEditorPage = lazy(MOTION_COMPOSITOR_MODULE.pages.editor);

const KnowledgeCommunityPage = lazy(() =>
  import("@features/thought-workshop/community/KnowledgeCommunityPage").then(
    (m) => ({ default: m.KnowledgeCommunityPage }),
  ),
);
const ThoughtWorkshopPage = lazy(THOUGHT_WORKSHOP_MODULE.pages.notes);
const LegacyOfficialPage = lazy(() =>
  import("@features/thought-workshop/community/LegacyOfficialPage").then(
    (m) => ({ default: m.LegacyOfficialPage }),
  ),
);

function PageBoundary({ children }: { children: ReactNode }) {
  return (
    <PageErrorBoundary key={window.location.pathname}>
      <Suspense fallback={<LoadingState label="正在加载…" variant="page" />}>
        {children}
      </Suspense>
    </PageErrorBoundary>
  );
}

export default function WebsiteRoutes() {
  const session = useStudioSession();
  const { me } = session;
  const localBrowser = useRuntimeAccess();
  const {
    route,
    navigate,
    navigatePath,
    replaceRoute,
    registerNavigationGuard,
  } = useWebsiteNavigation();
  const [catalogTestModel, setCatalogTestModel] = useState<string | null>(null);
  const [focusModelTab, setFocusModelTab] = useState(false);
  const page = route.page;
  useEffect(() => {
    const key = String(page);
    const applications: Record<string, string> = {
      "presentation-workshop": "演示工坊",
      "interview-assistant": "面试助手",
      "thought-workshop": "思绪工坊",
      "visual-workshop": "视觉创作工坊",
      "galgame-workshop": "Galgame 工坊",
      "video-editor": "视频剪辑工坊",
      "motion-compositor": "特效制作工坊",
      "audio-annotation": "音频标注工坊",
      "director-desk": "导演台",
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
            accountId: me.user.id,
          },
        }),
      ),
    );
  }, [page, route.projectId, route.documentId, me.user.id]);
  const navigateModelView = (next: StudioPage, keyboard = false) => {
    setFocusModelTab(keyboard);
    navigate(next);
  };
  const navigateKnowledgeSection = (section: KnowledgeSection) =>
    navigate(
      section === "private"
        ? "thought-workshop-notes"
        : section === "favorites"
          ? "thought-workshop-favorites"
          : section === "published"
            ? "thought-workshop-published"
            : "thought-workshop-community",
    );
  if (
    [
      "thought-workshop-community",
      "thought-workshop-favorites",
      "thought-workshop-published",
    ].includes(page)
  )
    return (
      <PageBoundary>
        <KnowledgeCommunityPage
          section={
            page === "thought-workshop-favorites"
              ? "favorites"
              : page === "thought-workshop-published"
                ? "published"
                : "community"
          }
          publication={route.projectId}
          noteId={route.documentId}
          navigate={navigateKnowledgeSection}
          onOpen={(id, note) =>
            navigate("thought-workshop-community", id, note)
          }
          onOpenNote={(id) => navigate("thought-workshop-editor", id)}
          onBack={() => navigate("apps")}
          registerNavigationGuard={registerNavigationGuard}
        />
      </PageBoundary>
    );
  if (page === "thought-workshop-official") {
    return (
      <PageBoundary>
        <LegacyOfficialPage
          key={me.user.id}
          libraryId={route.projectId}
          documentId={route.documentId}
          onOpen={(publication, document) =>
            navigate("thought-workshop-community", publication, document)
          }
          onBack={() => navigate("thought-workshop-community")}
        />
      </PageBoundary>
    );
  }

  if (page === "interview-assistant-session")
    return (
      <WorkshopShell
        module={INTERVIEW_ASSISTANT_MODULE}
        page={page}
        navigate={(next) => navigate(next as WorkshopPage)}
        onBack={() => navigate("apps")}
      >
        <PageBoundary>
          <InterviewAssistantPage
            key={`${me.user.id}:${me.user.id}`}
            scopeKey={`${me.user.id}:${me.user.id}`}
            registerNavigationGuard={registerNavigationGuard}
          />
        </PageBoundary>
      </WorkshopShell>
    );

  if (page.startsWith("presentation-workshop-"))
    return (
      <PageBoundary>
        <PresentationWorkshopRoute
          page={page as WorkshopPage}
          projectId={route.projectId}
          readOnly={!accountAllows(me, "content.write")}
          navigate={navigate}
          registerNavigationGuard={registerNavigationGuard}
        />
      </PageBoundary>
    );

  if (page === "motion-compositor-editor" && route.projectId)
    return (
      <PageBoundary>
        <MotionCompositorEditorPage
          key={route.projectId}
          projectId={route.projectId}
          onBack={() => navigate("motion-compositor-projects")}
          registerNavigationGuard={registerNavigationGuard}
          readOnly={!accountAllows(me, "content.write")}
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
            readOnly={!accountAllows(me, "content.write")}
            onOpen={(projectId) =>
              navigate("motion-compositor-editor", projectId)
            }
          />
        </PageBoundary>
      </WorkshopShell>
    );

  if (
    (!accountAllows(me, "content.write") && hasReadOnlyRoute(page)) ||
    (!accountAllows(me, "configuration.manage") && page === "model-service") ||
    (!accountAllows(me, "logs.read") && page === "model-call-logs")
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
              <p>完整模型调用日志与诊断包仅向账号所有者开放。</p>
            </section>
          ) : page === "model-service" ? (
            <ModelServiceRoute
              account={me}
              navigate={navigateModelView}
              focusSelected={focusModelTab}
              canWrite={false}
              onTestModel={(model) => {
                setCatalogTestModel(model.id);
                navigate("model-test");
              }}
            />
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
          key={me.user.id}
          page={page}
          onNavigateSection={navigateKnowledgeSection}
          projectId={route.projectId}
          noteId={route.documentId}
          onOpenOfficial={(library) =>
            navigate("thought-workshop-official", library)
          }
          onNavigate={(project, document, replace) => {
            const next = project
              ? "thought-workshop-editor"
              : "thought-workshop-notes";
            if (replace) replaceRoute(next, project, document);
            else navigate(next, project, document);
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
          accountId={me.user.id}
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
            readOnly={!accountAllows(me, "content.write")}
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
          <HomePage
            onNavigate={navigatePath}
            applications={APPLICATION_DEFINITIONS}
            showFiles
            canWrite={accountAllows(me, "content.write")}
            canReadLogs={accountAllows(me, "logs.read")}
          />
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
            canWrite={accountAllows(me, "content.write")}
            canInstall={accountAllows(me, "configuration.manage")}
            registerNavigationGuard={registerNavigationGuard}
            navigate={(next, id) => navigate(next, id)}
          />
        ) : page === "apps" ? (
          <ApplicationCenterPage
            applications={APPLICATION_DEFINITIONS}
            onOpen={navigatePath}
          />
        ) : page === "cloud-control" ? (
          <CloudControlPage
            owner={me.user.id}
            preferAgent={
              new URLSearchParams(route.search).get("view") === "agent"
            }
          />
        ) : page === "files" ? (
          <FileManagementPage
            canOpenLocalFolder={localBrowser}
            initialKind={
              new URLSearchParams(route.search).get("kind") ?? undefined
            }
          />
        ) : page === "tools" ? (
          <ToolNavigationPage onOpenInternal={navigatePath} />
        ) : page.startsWith("integrations-") ? (
          <IntegrationCenterPage
            registerNavigationGuard={registerNavigationGuard}
            canManage={accountAllows(me, "configuration.manage")}
            kind={
              page === "integrations-mcp"
                ? "mcp"
                : page === "integrations-skills"
                  ? "skills"
                  : page === "integrations-external-connections"
                    ? "external-connections"
                    : "tool-apis"
            }
            onKindChange={(kind) =>
              navigate(
                kind === "mcp"
                  ? "integrations-mcp"
                  : kind === "skills"
                    ? "integrations-skills"
                    : kind === "external-connections"
                      ? "integrations-external-connections"
                      : "integrations-tool-apis",
              )
            }
          />
        ) : page === "video-frame-exporter" ? (
          <VideoFrameExporterPage onBack={() => navigate("tools")} />
        ) : page === "video-downloader" ? (
          <VideoDownloaderPage onBack={() => navigate("tools")} />
        ) : page === "model-test" ? (
          <ModelTestPage
            initialModelId={catalogTestModel}
            initialMode={
              new URLSearchParams(route.search).get("mode") ?? undefined
            }
            onInitialModelHandled={() => setCatalogTestModel(null)}
            onOpenAudioAnnotation={(projectId) =>
              navigate("audio-annotation-editor", projectId)
            }
          />
        ) : page === "code-agents" ? (
          <CodeAgentsRoute
            user={me.user}
            accountId={me.user.id}
            navigate={navigateModelView}
            focusSelected={focusModelTab}
          />
        ) : page === "model-service" ? (
          <ModelServiceRoute
            account={me}
            navigate={navigateModelView}
            focusSelected={focusModelTab}
            onTestModel={(model) => {
              setCatalogTestModel(model.id);
              navigate("model-test");
            }}
          />
        ) : (
          <ModelCallLogsPage
            key={me.user.id}
            currentAccount={{ id: me.user.id, name: me.user.display_name }}
          />
        )}
      </PageBoundary>
    </StudioShell>
  );
}
