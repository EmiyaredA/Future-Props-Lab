import { lazy, useCallback, useEffect, useRef } from "react";
import { useStudioSession } from "@app/StudioSession";
import { galgameSpeakerImportSource } from "@app/integrations/galgameSpeakerImport";
import { RuntimeAccessProvider } from "@features/accounts";
import { AUDIO_ANNOTATION_MODULE as annotation } from "@features/audio-annotation/module";
import { NavigationProtection } from "@shared/ui/NavigationProtection";
import {
  type Guard,
  useNavigationProtection,
} from "@shared/ui/navigationGuards";
import { ApplicationUpdate } from "./ApplicationUpdate";
import { IndependentShell } from "./IndependentShell";
import { guardedNavigation } from "./navigation";

const Editor = lazy(annotation.pages.editor);
const Projects = lazy(annotation.pages.projects);
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

export default function AnnotationApplication() {
  const route = annotation.matchPath(location.pathname);
  if (route?.page === "audio-annotation-editor" && route.projectId)
    return (
      <RuntimeAccessProvider>
        <NavigationProtection>
          <ApplicationUpdate />
          <AnnotationEditor projectId={route.projectId} />
        </NavigationProtection>
      </RuntimeAccessProvider>
    );
  return (
    <IndependentShell title="音频标注">
      <Projects
        onOpen={(id) => {
          const path = annotation.pathFor("audio-annotation-editor", id);
          if (path) go(path);
        }}
      />
    </IndependentShell>
  );
}
