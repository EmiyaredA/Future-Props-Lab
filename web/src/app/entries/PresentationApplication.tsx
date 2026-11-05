import { useCallback, useEffect, useRef } from "react";
import { useStudioSession } from "@app/StudioSession";
import { PresentationWorkshopRoute } from "@app/routing/PresentationWorkshopRoute";
import type { WorkshopPage } from "@app/routes";
import { RuntimeAccessProvider } from "@features/accounts";
import { AmadeusPageProvider } from "@features/amadeus/PageProvider";
import { PRESENTATION_WORKSHOP_MODULE as presentation } from "@features/presentation-workshop/module";
import { useAccountPermission } from "@platform/auth/AccountAccess";
import { NavigationProtection } from "@shared/ui/NavigationProtection";
import {
  type Guard,
  useNavigationProtection,
} from "@shared/ui/navigationGuards";
import { ApplicationUpdate } from "./ApplicationUpdate";
import { guardedNavigation } from "./navigation";

function navigate(page: WorkshopPage | "apps", id?: string) {
  const path = page === "apps" ? "/apps" : presentation.pathFor(page, id);
  if (path) guardedNavigation(() => location.assign(path), true);
}

function PresentationWorkspace() {
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
  const route = presentation.matchPath(location.pathname);
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
          <PresentationWorkspace />
        </NavigationProtection>
      </AmadeusPageProvider>
    </RuntimeAccessProvider>
  );
}
