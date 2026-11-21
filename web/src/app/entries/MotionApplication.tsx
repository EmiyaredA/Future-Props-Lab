import { WorkshopUtilities } from "@app/layout/StudioGlobalHeader";
import { lazy } from "react";
import { useStudioSession } from "@app/StudioSession";
import { WorkshopShell } from "@app/layout/WorkshopShell";
import { RuntimeAccessProvider } from "@features/accounts";
import { AmadeusPageProvider } from "@features/amadeus/PageProvider";
import { MOTION_COMPOSITOR_MODULE as motion } from "@features/motion-compositor/module";
import { useAccountPermission } from "@platform/auth/AccountAccess";
import { NavigationProtection } from "@shared/ui/NavigationProtection";
import { useNavigationGuardRegistration } from "@shared/ui/navigationGuards";
import { ApplicationUpdate } from "./ApplicationUpdate";
import { useWorkshopNavigation } from "@app/routing/useWorkshopNavigation";
import { ApplicationPage } from "@app/layout/ApplicationPage";

const Editor = lazy(motion.pages.editor);
const Projects = lazy(motion.pages.projects);
const index = "/apps/motion-compositor";

function MotionWorkspace() {
  const writable = useAccountPermission("content.write");
  const registerNavigationGuard = useNavigationGuardRegistration();
  const { route, navigate, go } = useWorkshopNavigation(motion);
  if (route?.page === "motion-compositor-editor" && route.projectId)
    return (
      <Editor
        key={route.projectId}
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
      navigate={navigate}
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
          <ApplicationPage>
            <MotionWorkspace />
          </ApplicationPage>
        </NavigationProtection>
      </AmadeusPageProvider>
    </RuntimeAccessProvider>
  );
}
