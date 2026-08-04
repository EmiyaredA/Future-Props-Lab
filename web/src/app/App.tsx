import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { StudioSidebar } from "@app/layout/StudioSidebar";
import { VisualWorkshopShell } from "@app/layout/VisualWorkshopShell";
import {
  isWorkshopPage,
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
const ModelTestPage = lazy(() =>
  import("@features/models/conversation").then((module) => ({
    default: module.ModelTestPage,
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
const VisualWorkshopCanvasPage = lazy(() =>
  import("@features/visual-workshop/canvas").then((module) => ({
    default: module.VisualWorkshopCanvasPage,
  })),
);
const VisualWorkshopProjectsPage = lazy(() =>
  import("@features/visual-workshop/projects").then((module) => ({
    default: module.VisualWorkshopProjectsPage,
  })),
);
const VisualWorkshopAssetsPage = lazy(() =>
  import("@features/visual-workshop/assets").then((module) => ({
    default: module.VisualWorkshopAssetsPage,
  })),
);
const VisualWorkshopTasksPage = lazy(() =>
  import("@features/visual-workshop/generation").then((module) => ({
    default: module.VisualWorkshopTasksPage,
  })),
);
const VisualWorkshopEmptyPage = lazy(() =>
  import("@features/visual-workshop/pages/VisualWorkshopEmptyPage").then(
    (module) => ({ default: module.VisualWorkshopEmptyPage }),
  ),
);

function PageBoundary({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="page-loading">正在加载…</div>}>
      {children}
    </Suspense>
  );
}

export default function App() {
  const [route, setRoute] = useState<AppRoute>(parseRoute);
  const page = route.page;
  useEffect(() => {
    if (window.location.pathname === "/")
      window.history.replaceState({}, "", "/home");
    const pop = () => setRoute(parseRoute());
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const navigate = (next: AppPage, projectId?: string) => {
    const path = pathFor(next, projectId);
    if (path !== window.location.pathname)
      window.history.pushState({}, "", path);
    setRoute({ page: next, projectId });
  };
  const navigatePath = (path: string) => {
    const next = parseRoute(path);
    navigate(next.page, next.projectId);
  };

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

  if (isWorkshopPage(page)) {
    return (
      <VisualWorkshopShell
        page={page}
        navigate={(next: WorkshopPage) => navigate(next)}
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
      </VisualWorkshopShell>
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
            <ApplicationCenterPage onOpen={navigatePath} />
          ) : page === "files" ? (
            <FileManagementPage />
          ) : page === "tools" ? (
            <ToolNavigationPage onOpenInternal={navigatePath} />
          ) : page === "model-test" ? (
            <ModelTestPage />
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
