import { WorkshopUtilities } from "@app/layout/StudioGlobalHeader";
import { lazy, Suspense } from "react";
import { useStudioSession } from "@app/StudioSession";
import { WorkshopShell } from "@app/layout/WorkshopShell";
import { RuntimeAccessProvider } from "@features/accounts";
import { AmadeusPageProvider } from "@features/amadeus/PageProvider";
import { VISUAL_WORKSHOP_MODULE as visual } from "@features/visual-workshop/module";
import { useAccountPermission } from "@platform/auth/AccountAccess";
import { NavigationProtection } from "@shared/ui/NavigationProtection";
import { LoadingState } from "@shared/ui/LoadingState";
import { useApplicationNavigation } from "@app/routing/useApplicationNavigation";
import { ApplicationUpdate } from "./ApplicationUpdate";

const Canvas = lazy(visual.pages.canvas);
const Projects = lazy(visual.pages.projects);
const Assets = lazy(visual.pages.assets);
const AssetProjects = lazy(visual.pages.assetProjects);
const CardLibrary = lazy(visual.pages.cardLibrary);
const Tasks = lazy(visual.pages.tasks);
const ReadOnlyVisual = lazy(() =>
  import("@features/visual-workshop/ReadOnlyVisual").then((module) => ({
    default: module.ReadOnlyVisual,
  })),
);

const ownsPath = (pathname: string) => Boolean(visual.matchPath(pathname));

function VisualWorkspace() {
  const writable = useAccountPermission("content.write");
  const navigation = useApplicationNavigation(visual.definition.id, ownsPath);
  const route = visual.matchPath(
    new URL(navigation.path, location.origin).pathname,
  );
  const navigate = (page: string, projectId?: string) => {
    const path = visual.pathFor(page, projectId);
    if (path) navigation.navigate(path);
  };
  const openCanvas = (id: string) => navigate("visual-workshop-canvas", id);
  const openAssets = (id: string) => navigate("visual-workshop-assets", id);
  const openProjects = () => navigate("visual-workshop-projects");
  const page = route?.page ?? "visual-workshop-projects";
  const projectId = route?.projectId;
  const utilities = (
    <WorkshopUtilities
      application={visual.definition.name}
      projectId={projectId}
    />
  );

  if (writable && page === "visual-workshop-canvas" && projectId) {
    return (
      <Suspense
        fallback={<LoadingState label="正在打开画布…" variant="page" />}
      >
        <Canvas key={projectId} projectId={projectId} onBack={openProjects} />
      </Suspense>
    );
  }

  return (
    <WorkshopShell
      module={visual}
      page={page}
      navigate={(next) =>
        navigate(
          next,
          next === "visual-workshop-assets" ? projectId : undefined,
        )
      }
      onBack={() => navigation.navigate("/apps")}
    >
      <Suspense
        fallback={<LoadingState label="正在打开页面…" variant="region" />}
      >
        {page === "visual-workshop-tasks" ? (
          <Tasks
            utilities={utilities}
            onOpenProject={openCanvas}
            onOpenAssets={openAssets}
          />
        ) : page === "visual-workshop-card-library" ? (
          <CardLibrary utilities={utilities} readOnly={!writable} />
        ) : page === "visual-workshop-assets" ? (
          !projectId ? (
            <AssetProjects utilities={utilities} onOpen={openAssets} />
          ) : (
            <Assets
              key={projectId}
              utilities={utilities}
              projectId={projectId}
              onCanvas={() => openCanvas(projectId)}
              onProjects={openProjects}
              readOnly={!writable}
            />
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
              key={projectId}
              utilities={utilities}
              projectId={projectId}
              onOpen={openCanvas}
              onBack={openProjects}
            />
          </>
        )}
      </Suspense>
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
