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
import { useWorkshopNavigation } from "@app/routing/useWorkshopNavigation";
import { ApplicationPage } from "@app/layout/ApplicationPage";

const Projects = lazy(galgame.pages.projects);
const Overview = lazy(galgame.pages.overview);
const Editor = lazy(galgame.pages.editor);
const Preview = lazy(galgame.pages.preview);
const ReadOnly = lazy(() =>
  import("@features/galgame-workshop/ReadOnlyGalgame").then((module) => ({
    default: module.ReadOnlyGalgame,
  })),
);

function GalgameWorkspace() {
  const writable = useAccountPermission("content.write");
  const { route, navigate, go } = useWorkshopNavigation(galgame);
  const openProjects = () => navigate("galgame-workshop-projects");
  const openOverview = (id: string) =>
    navigate("galgame-workshop-overview", id);
  const page = route?.page ?? "galgame-workshop-projects";
  const projectId = route?.projectId;

  if (writable && projectId) {
    if (page === "galgame-workshop-editor") {
      return (
        <Editor
          key={projectId}
          projectId={projectId}
          onOverview={() => openOverview(projectId)}
        />
      );
    }
    if (page === "galgame-workshop-preview") {
      return <Preview key={projectId} projectId={projectId} />;
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
          key={projectId}
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
          key={projectId}
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
          <ApplicationPage>
            <GalgameWorkspace />
          </ApplicationPage>
        </NavigationProtection>
      </AmadeusPageProvider>
    </RuntimeAccessProvider>
  );
}
