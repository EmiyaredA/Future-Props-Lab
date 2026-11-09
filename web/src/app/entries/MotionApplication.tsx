import { WorkshopUtilities } from "@app/layout/StudioGlobalHeader";
import { lazy, useCallback, useEffect, useRef } from "react";
import { useStudioSession } from "@app/StudioSession";
import { WorkshopShell } from "@app/layout/WorkshopShell";
import { RuntimeAccessProvider } from "@features/accounts";
import { AmadeusPageProvider } from "@features/amadeus/PageProvider";
import { MOTION_COMPOSITOR_MODULE as motion } from "@features/motion-compositor/module";
import { useAccountPermission } from "@platform/auth/AccountAccess";
import { NavigationProtection } from "@shared/ui/NavigationProtection";
import {
  type Guard,
  useNavigationProtection,
} from "@shared/ui/navigationGuards";
import { ApplicationUpdate } from "./ApplicationUpdate";
import { guardedNavigation } from "./navigation";

const Editor = lazy(motion.pages.editor);
const Projects = lazy(motion.pages.projects);
const index = "/apps/motion-compositor";

function go(path: string) {
  guardedNavigation(() => location.assign(path), true);
}

function MotionWorkspace() {
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
  const route = motion.matchPath(location.pathname);
  if (route?.page === "motion-compositor-editor" && route.projectId)
    return (
      <Editor
        projectId={route.projectId}
        onBack={() => go(index)}
        readOnly={!writable}
        registerNavigationGuard={registerNavigationGuard}
      />
    );
  return (
    <WorkshopShell
      module={motion}
      page="motion-compositor-projects"
      navigate={(page) => {
        const target = motion.pathFor(page);
        if (target && target !== location.pathname) go(target);
      }}
      onBack={() => go("/apps")}
    >
      <Projects
        utilities={<WorkshopUtilities application={motion.definition.name} />}
        readOnly={!writable}
        onOpen={(id) => {
          const target = motion.pathFor("motion-compositor-editor", id);
          if (target) go(target);
        }}
      />
    </WorkshopShell>
  );
}

export default function MotionApplication() {
  const session = useStudioSession();
  return (
    <RuntimeAccessProvider>
      <AmadeusPageProvider key={session.me.user.id} session={session}>
        <NavigationProtection>
          <ApplicationUpdate />
          <MotionWorkspace />
        </NavigationProtection>
      </AmadeusPageProvider>
    </RuntimeAccessProvider>
  );
}
