import { WorkshopUtilities } from "@app/layout/StudioGlobalHeader";
import { lazy, useCallback, useEffect, useRef } from "react";
import { useStudioSession } from "@app/StudioSession";
import { WorkshopShell } from "@app/layout/WorkshopShell";
import { galgameSpeakerImportSource } from "@app/integrations/galgameSpeakerImport";
import { RuntimeAccessProvider } from "@features/accounts";
import { AmadeusPageProvider } from "@features/amadeus/PageProvider";
import { AUDIO_ANNOTATION_MODULE as annotation } from "@features/audio-annotation/module";
import { useAccountPermission } from "@platform/auth/AccountAccess";
import { NavigationProtection } from "@shared/ui/NavigationProtection";
import {
  type Guard,
  useNavigationProtection,
} from "@shared/ui/navigationGuards";
import { ApplicationUpdate } from "./ApplicationUpdate";
import { guardedNavigation } from "./navigation";

const Editor = lazy(annotation.pages.editor);
const Projects = lazy(annotation.pages.projects);
const ReadOnly = lazy(() =>
  import("@features/audio-annotation/ReadOnlyAnnotation").then((module) => ({
    default: module.ReadOnlyAnnotation,
  })),
);
const index = "/apps/audio-annotation";

function go(path: string) {
  guardedNavigation(() => location.assign(path), true);
}

function AnnotationEditor({ projectId }: { projectId: string }) {
  const { me } = useStudioSession();
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
  return (
    <Editor
      projectId={projectId}
      accountId={me.user.id}
      onBack={() => go(index)}
      registerNavigationGuard={registerNavigationGuard}
      speakerImportSource={galgameSpeakerImportSource}
    />
  );
}

function AnnotationContent() {
  const writable = useAccountPermission("content.write");
  const route = annotation.matchPath(location.pathname);
  const open = (id: string) => {
    const path = annotation.pathFor("audio-annotation-editor", id);
    if (path) go(path);
  };
  if (route?.page === "audio-annotation-editor" && route.projectId)
    return (
      <>
        <ApplicationUpdate />
        {writable ? (
          <AnnotationEditor projectId={route.projectId} />
        ) : (
          <ReadOnly
            utilities={
              <WorkshopUtilities
                application={annotation.definition.name}
                projectId={route.projectId}
              />
            }
            projectId={route.projectId}
            onOpen={open}
            onBack={() => go(index)}
          />
        )}
      </>
    );
  return (
    <WorkshopShell
      module={annotation}
      page="audio-annotation-projects"
      navigate={() => {}}
      onBack={() => go("/apps")}
    >
      <ApplicationUpdate />
      {writable ? (
        <Projects
          utilities={
            <WorkshopUtilities application={annotation.definition.name} />
          }
          onOpen={open}
        />
      ) : (
        <ReadOnly
          utilities={
            <WorkshopUtilities application={annotation.definition.name} />
          }
          onOpen={open}
          onBack={() => go(index)}
        />
      )}
    </WorkshopShell>
  );
}

export default function AnnotationApplication() {
  const session = useStudioSession();
  return (
    <RuntimeAccessProvider>
      <AmadeusPageProvider key={session.me.user.id} session={session}>
        <NavigationProtection>
          <AnnotationContent />
        </NavigationProtection>
      </AmadeusPageProvider>
    </RuntimeAccessProvider>
  );
}
