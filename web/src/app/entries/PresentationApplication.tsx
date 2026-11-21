import { useStudioSession } from "@app/StudioSession";
import { PresentationWorkshopRoute } from "@app/routing/PresentationWorkshopRoute";
import type { WorkshopPage } from "@app/routes";
import { RuntimeAccessProvider } from "@features/accounts";
import { AmadeusPageProvider } from "@features/amadeus/PageProvider";
import { PRESENTATION_WORKSHOP_MODULE as presentation } from "@features/presentation-workshop/module";
import { useAccountPermission } from "@platform/auth/AccountAccess";
import { NavigationProtection } from "@shared/ui/NavigationProtection";
import { useNavigationGuardRegistration } from "@shared/ui/navigationGuards";
import { ApplicationUpdate } from "./ApplicationUpdate";
import { useWorkshopNavigation } from "@app/routing/useWorkshopNavigation";
import { ApplicationPage } from "@app/layout/ApplicationPage";

function PresentationWorkspace() {
  const writable = useAccountPermission("content.write");
  const registerNavigationGuard = useNavigationGuardRegistration();
  const { route, navigate } = useWorkshopNavigation(presentation);
  if (!route)
    return (
      <section className="independent-not-found">
        <h1>页面不存在</h1>
        <a href="/apps/presentation-workshop">返回演示文稿工坊</a>
      </section>
    );
  return (
    <PresentationWorkshopRoute
      page={route.page as WorkshopPage}
      projectId={route.projectId}
      readOnly={!writable}
      navigate={navigate}
      registerNavigationGuard={registerNavigationGuard}
    />
  );
}

export default function PresentationApplication() {
  const session = useStudioSession();
  return (
    <RuntimeAccessProvider>
      <AmadeusPageProvider key={session.me.user.id} session={session}>
        <NavigationProtection>
          <ApplicationUpdate />
          <ApplicationPage>
            <PresentationWorkspace />
          </ApplicationPage>
        </NavigationProtection>
      </AmadeusPageProvider>
    </RuntimeAccessProvider>
  );
}
