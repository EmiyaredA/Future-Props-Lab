import { WorkshopUtilities } from "@app/layout/StudioGlobalHeader";
import { lazy } from "react";
import { useStudioSession } from "@app/StudioSession";
import { WorkshopShell } from "@app/layout/WorkshopShell";
import { RuntimeAccessProvider } from "@features/accounts";
import { AmadeusPageProvider } from "@features/amadeus/PageProvider";
import { VISUAL_WORKSHOP_MODULE as visual } from "@features/visual-workshop/module";
import { useAccountPermission } from "@platform/auth/AccountAccess";
import { NavigationProtection } from "@shared/ui/NavigationProtection";
import { ApplicationUpdate } from "./ApplicationUpdate";
import { guardedNavigation } from "./navigation";

const Canvas = lazy(visual.pages.canvas);
const Projects = lazy(visual.pages.projects);
const Assets = lazy(visual.pages.assets);
const Tasks = lazy(visual.pages.tasks);
const ReadOnlyVisual = lazy(() =>
  import("@features/visual-workshop/ReadOnlyVisual").then((module) => ({
    default: module.ReadOnlyVisual,
  })),
);
const ReadOnlyFiles = lazy(() =>
  import("@features/files/ReadOnlyFiles").then((module) => ({
    default: module.ReadOnlyFiles,
  })),
);

function go(path: string) {
  guardedNavigation(() => location.assign(path), true);
}

function navigate(page: string, projectId?: string) {
  const path = visual.pathFor(page, projectId);
  if (path && path !== location.pathname) go(path);
}

function openCanvas(id: string) {
  navigate("visual-workshop-canvas", id);
}

function openAssets(id: string) {
  navigate("visual-workshop-assets", id);
}

function openProjects() {
  navigate("visual-workshop-projects");
}

function VisualWorkspace() {
  const writable = useAccountPermission("content.write");
  const route = visual.matchPath(location.pathname);
  const page = route?.page ?? "visual-workshop-projects";
  const projectId = route?.projectId;
  const utilities = (
    <WorkshopUtilities
      application={visual.definition.name}
      projectId={projectId}
    />
  );

  if (writable && page === "visual-workshop-canvas" && projectId) {
    return <Canvas projectId={projectId} onBack={openProjects} />;
  }

  return (
    <WorkshopShell
      module={visual}
      page={page}
      navigate={navigate}
      onBack={() => go("/apps")}
    >
      {page === "visual-workshop-tasks" ? (
        <Tasks
          utilities={utilities}
          onOpenProject={openCanvas}
          onOpenAssets={openAssets}
        />
      ) : page === "visual-workshop-assets" && projectId ? (
        writable ? (
          <Assets
            utilities={utilities}
            projectId={projectId}
            onCanvas={() => openCanvas(projectId)}
            onProjects={openProjects}
          />
        ) : (
          <ReadOnlyFiles utilities={utilities} projectId={projectId} />
        )
      ) : writable ? (
        <Projects
          utilities={utilities}
          onOpenProject={openCanvas}
          onOpenAssets={openAssets}
        />
      ) : (
        <>
          {projectId && (
            <div className="readonly-page button-row">
              <button className="btn" onClick={() => openAssets(projectId)}>
                项目素材
              </button>
            </div>
          )}
          <ReadOnlyVisual
            utilities={utilities}
            projectId={projectId}
            onOpen={openCanvas}
            onBack={openProjects}
          />
        </>
      )}
    </WorkshopShell>
  );
}

export default function VisualApplication() {
  const session = useStudioSession();
  return (
    <RuntimeAccessProvider>
      <AmadeusPageProvider key={session.me.user.id} session={session}>
        <NavigationProtection>
          <ApplicationUpdate />
          <VisualWorkspace />
        </NavigationProtection>
      </AmadeusPageProvider>
    </RuntimeAccessProvider>
  );
}
