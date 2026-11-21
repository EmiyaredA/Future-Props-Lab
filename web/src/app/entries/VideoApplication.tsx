import { WorkshopUtilities } from "@app/layout/StudioGlobalHeader";
import { lazy } from "react";
import { useStudioSession } from "@app/StudioSession";
import { WorkshopShell } from "@app/layout/WorkshopShell";
import { RuntimeAccessProvider } from "@features/accounts";
import { AmadeusPageProvider } from "@features/amadeus/PageProvider";
import { VIDEO_EDITOR_MODULE as video } from "@features/video-editor/module";
import { useAccountPermission } from "@platform/auth/AccountAccess";
import { NavigationProtection } from "@shared/ui/NavigationProtection";
import { useNavigationGuardRegistration } from "@shared/ui/navigationGuards";
import { ApplicationUpdate } from "./ApplicationUpdate";
import { useWorkshopNavigation } from "@app/routing/useWorkshopNavigation";
import { ApplicationPage } from "@app/layout/ApplicationPage";

const Editor = lazy(video.pages.editor);
const Projects = lazy(video.pages.projects);
const Tasks = lazy(video.pages.tasks);
const ReadOnlyVideo = lazy(() =>
  import("@features/video-editor/ReadOnlyVideo").then((module) => ({
    default: module.ReadOnlyVideo,
  })),
);

function VideoWorkspace() {
  const writable = useAccountPermission("content.write");
  const registerNavigationGuard = useNavigationGuardRegistration();
  const { route, navigate, go } = useWorkshopNavigation(video);
  const utilities = (
    <WorkshopUtilities
      application={video.definition.name}
      projectId={route?.projectId}
    />
  );
  const openProject = (id: string) => navigate("video-editor-editor", id);
  const back = () => navigate("video-editor-projects");
  if (writable && route?.page === "video-editor-editor" && route.projectId)
    return (
      <Editor
        key={route.projectId}
        projectId={route.projectId}
        onBack={back}
        registerNavigationGuard={registerNavigationGuard}
      />
    );

  const page =
    route?.page === "video-editor-tasks"
      ? "video-editor-tasks"
      : "video-editor-projects";
  return (
    <WorkshopShell
      module={video}
      page={page}
      navigate={navigate}
      onBack={() => go("/apps")}
    >
      {page === "video-editor-tasks" ? (
        <Tasks utilities={utilities} onOpenProject={openProject} />
      ) : writable ? (
        <Projects utilities={utilities} onOpenProject={openProject} />
      ) : (
        <ReadOnlyVideo
          key={route?.projectId ?? "library"}
          utilities={utilities}
          projectId={route?.projectId}
          onOpen={openProject}
          onBack={back}
        />
      )}
    </WorkshopShell>
  );
}

export default function VideoApplication() {
  const session = useStudioSession();
  return (
    <RuntimeAccessProvider>
      <AmadeusPageProvider key={session.me.user.id} session={session}>
        <NavigationProtection>
          <ApplicationUpdate />
          <ApplicationPage>
            <VideoWorkspace />
          </ApplicationPage>
        </NavigationProtection>
      </AmadeusPageProvider>
    </RuntimeAccessProvider>
  );
}
