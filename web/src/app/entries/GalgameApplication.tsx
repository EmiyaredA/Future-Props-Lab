import { WorkshopUtilities } from "@app/layout/StudioGlobalHeader";
import { lazy } from "react";
import { useStudioSession } from "@app/StudioSession";
import { WorkshopShell } from "@app/layout/WorkshopShell";
import { RuntimeAccessProvider } from "@features/accounts";
import { AmadeusPageProvider } from "@features/amadeus/PageProvider";
import { GALGAME_WORKSHOP_MODULE as galgame } from "@features/galgame-workshop/module";
import { useAccountPermission } from "@platform/auth/AccountAccess";
import { NavigationProtection } from "@shared/ui/NavigationProtection";
import { ApplicationUpdate } from "./ApplicationUpdate";
import { guardedNavigation } from "./navigation";

const Projects = lazy(galgame.pages.projects);
const Overview = lazy(galgame.pages.overview);
const Editor = lazy(galgame.pages.editor);
const Preview = lazy(galgame.pages.preview);
const ReadOnly = lazy(() =>
  import("@features/galgame-workshop/ReadOnlyGalgame").then((module) => ({
    default: module.ReadOnlyGalgame,
  })),
);

function go(path: string) {
  guardedNavigation(() => location.assign(path), true);
}

function navigate(page: string, projectId?: string) {
  const path = galgame.pathFor(page, projectId);
  if (path && path !== location.pathname) go(path);
}

function openProjects() {
  navigate("galgame-workshop-projects");
}

function openOverview(id: string) {
  navigate("galgame-workshop-overview", id);
}

function GalgameWorkspace() {
  const writable = useAccountPermission("content.write");
  const route = galgame.matchPath(location.pathname);
  const page = route?.page ?? "galgame-workshop-projects";
  const projectId = route?.projectId;

  if (writable && projectId) {
    if (page === "galgame-workshop-editor") {
      return (
        <Editor
          projectId={projectId}
          onOverview={() => openOverview(projectId)}
        />
      );
    }
    if (page === "galgame-workshop-preview") {
      return <Preview projectId={projectId} />;
    }
  }

  return (
    <WorkshopShell
      module={galgame}
      page={page}
      navigate={navigate}
      onBack={() => go("/apps")}
    >
      {!writable ? (
        <ReadOnly
          utilities={
            <WorkshopUtilities
              application={galgame.definition.name}
              projectId={projectId}
            />
          }
          projectId={projectId}
          onOpen={openOverview}
          onBack={openProjects}
        />
      ) : projectId ? (
        <Overview
          projectId={projectId}
          onProjects={openProjects}
          onOpenEditor={() => navigate("galgame-workshop-editor", projectId)}
        />
      ) : (
        <Projects
          utilities={
            <WorkshopUtilities application={galgame.definition.name} />
          }
          onOpenProject={openOverview}
        />
      )}
    </WorkshopShell>
  );
}

export default function GalgameApplication() {
  const session = useStudioSession();
  return (
    <RuntimeAccessProvider>
      <AmadeusPageProvider key={session.me.user.id} session={session}>
        <NavigationProtection>
          <ApplicationUpdate />
          <GalgameWorkspace />
        </NavigationProtection>
      </AmadeusPageProvider>
    </RuntimeAccessProvider>
  );
}
