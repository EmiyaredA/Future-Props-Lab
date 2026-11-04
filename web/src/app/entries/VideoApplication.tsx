import { lazy, useCallback, useEffect, useRef } from "react";
import { useStudioSession } from "@app/StudioSession";
import { WorkshopShell } from "@app/layout/WorkshopShell";
import { RuntimeAccessProvider } from "@features/accounts";
import { AmadeusPageProvider } from "@features/amadeus/PageProvider";
import { VIDEO_EDITOR_MODULE as video } from "@features/video-editor/module";
import { useAccountPermission } from "@platform/auth/AccountAccess";
import { NavigationProtection } from "@shared/ui/NavigationProtection";
import {
  type Guard,
  useNavigationProtection,
} from "@shared/ui/navigationGuards";
import { ApplicationUpdate } from "./ApplicationUpdate";
import { guardedNavigation } from "./navigation";

const Editor = lazy(video.pages.editor);
const Projects = lazy(video.pages.projects);
const Tasks = lazy(video.pages.tasks);
const ReadOnlyVideo = lazy(() =>
  import("@features/video-editor/ReadOnlyVideo").then((module) => ({
    default: module.ReadOnlyVideo,
  })),
);

function go(path: string) {
  guardedNavigation(() => location.assign(path), true);
}

function navigate(page: string, projectId?: string) {
  const path = video.pathFor(page, projectId);
  if (path && path !== location.pathname) go(path);
}

function VideoWorkspace() {
  const writable = useAccountPermission("content.write");
  const protection = useNavigationProtection();
  const unregister = useRef<(() => void) | null>(null);
  const registerNavigationGuard = useCallback(
    (guard: Guard | null) => {
      unregister.current?.();
      unregister.current =
        guard && protection ? protection.register(guard) : null;
    },
    [protection],
  );
  useEffect(() => () => unregister.current?.(), []);
  const route = video.matchPath(location.pathname);
  const openProject = (id: string) => navigate("video-editor-editor", id);
  const back = () => navigate("video-editor-projects");
  if (writable && route?.page === "video-editor-editor" && route.projectId)
    return (
      <Editor
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
        <Tasks onOpenProject={openProject} />
      ) : writable ? (
        <Projects onOpenProject={openProject} />
      ) : (
        <ReadOnlyVideo
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
          <VideoWorkspace />
        </NavigationProtection>
      </AmadeusPageProvider>
    </RuntimeAccessProvider>
  );
}
