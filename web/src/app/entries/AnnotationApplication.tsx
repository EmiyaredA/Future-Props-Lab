import { WorkshopUtilities } from "@app/layout/StudioGlobalHeader";
import { lazy } from "react";
import { useStudioSession } from "@app/StudioSession";
import { WorkshopShell } from "@app/layout/WorkshopShell";
import { galgameSpeakerImportSource } from "@app/integrations/galgameSpeakerImport";
import { RuntimeAccessProvider } from "@features/accounts";
import { AmadeusPageProvider } from "@features/amadeus/PageProvider";
import { AUDIO_ANNOTATION_MODULE as annotation } from "@features/audio-annotation/module";
import { useAccountPermission } from "@platform/auth/AccountAccess";
import { NavigationProtection } from "@shared/ui/NavigationProtection";
import { useNavigationGuardRegistration } from "@shared/ui/navigationGuards";
import { ApplicationUpdate } from "./ApplicationUpdate";
import { useWorkshopNavigation } from "@app/routing/useWorkshopNavigation";
import { ApplicationPage } from "@app/layout/ApplicationPage";

const Editor = lazy(annotation.pages.editor);
const Projects = lazy(annotation.pages.projects);
const ReadOnly = lazy(() =>
  import("@features/audio-annotation/ReadOnlyAnnotation").then((module) => ({
    default: module.ReadOnlyAnnotation,
  })),
);
const index = "/apps/audio-annotation";

function AnnotationEditor({
  projectId,
  onBack,
}: {
  projectId: string;
  onBack: () => void;
}) {
  const { me } = useStudioSession();
  const registerNavigationGuard = useNavigationGuardRegistration();
  return (
    <Editor
      projectId={projectId}
      accountId={me.user.id}
      onBack={onBack}
      registerNavigationGuard={registerNavigationGuard}
      speakerImportSource={galgameSpeakerImportSource}
    />
  );
}

function AnnotationContent() {
  const writable = useAccountPermission("content.write");
  const { route, go } = useWorkshopNavigation(annotation);
  const open = (id: string) => {
    const path = annotation.pathFor("audio-annotation-editor", id);
    if (path) go(path);
  };
  if (route?.page === "audio-annotation-editor" && route.projectId)
    return (
      <>
        <ApplicationUpdate />
        {writable ? (
          <AnnotationEditor
            key={route.projectId}
            projectId={route.projectId}
            onBack={() => go(index)}
          />
        ) : (
          <ReadOnly
            key={route.projectId}
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
          <ApplicationPage>
            <AnnotationContent />
          </ApplicationPage>
        </NavigationProtection>
      </AmadeusPageProvider>
    </RuntimeAccessProvider>
  );
}
