import { useEffect, useState } from "react";
import { ApplicationCenterPage } from "@features/applications/ApplicationCenterPage";
import { FileManagementPage } from "@features/files/FileManagementPage";
import { HomePage } from "@features/home/HomePage";
import { ModelCallLogsPage } from "@features/models/ModelCallLogsPage";
import { ModelServicePage } from "@features/models/ModelServicePage";
import { ModelTestPage } from "@features/models/ModelTestPage";
import { ToolNavigationPage } from "@features/tools/ToolNavigationPage";
import { VisualWorkshopEmptyPage } from "@features/visual-workshop/VisualWorkshopEmptyPage";
import { VisualWorkshopAssetsPage } from "@features/visual-workshop/VisualWorkshopAssetsPage";
import { VisualWorkshopCanvasPage } from "@features/visual-workshop/VisualWorkshopCanvasPage";
import { VisualWorkshopProjectsPage } from "@features/visual-workshop/VisualWorkshopProjectsPage";
import { VisualWorkshopTasksPage } from "@features/visual-workshop/VisualWorkshopTasksPage";
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
      <VisualWorkshopCanvasPage
        projectId={route.projectId}
        onBack={() => navigate("visual-workshop-projects")}
        onAssets={() => navigate("visual-workshop-assets", route.projectId)}
      />
    );
  }

  if (isWorkshopPage(page)) {
    return (
      <VisualWorkshopShell
        page={page}
        navigate={(next: WorkshopPage) => navigate(next)}
        onBack={() => navigate("apps")}
      >
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
            onCanvas={() => navigate("visual-workshop-canvas", route.projectId)}
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
      </main>
    </div>
  );
}
