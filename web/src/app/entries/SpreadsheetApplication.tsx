import { useStudioSession } from "@app/StudioSession";
import { RuntimeAccessProvider } from "@features/accounts";
import { AmadeusPageProvider } from "@features/amadeus/PageProvider";
import { SPREADSHEET_WORKSHOP_MODULE as module } from "@features/spreadsheet-workshop/module";
import { NavigationProtection } from "@shared/ui/NavigationProtection";
import { useAccountPermission } from "@platform/auth/AccountAccess";
import { SpreadsheetWorkshopRoute } from "@app/routing/SpreadsheetWorkshopRoute";
import type { WorkshopPage } from "@app/routes";
import { ApplicationUpdate } from "./ApplicationUpdate";
import { guardedNavigation } from "./navigation";

function navigate(page: WorkshopPage | "apps", id?: string) {
  const path = page === "apps" ? "/apps" : module.pathFor(page, id);
  if (path) guardedNavigation(() => location.assign(path), true);
}

function Workspace() {
  const writable = useAccountPermission("content.write");
  const route = module.matchPath(location.pathname);
  if (!route)
    return (
      <section className="independent-not-found">
        <h1>页面不存在</h1>
        <a href="/apps/spreadsheet-workshop">返回表格工坊</a>
      </section>
    );
  return (
    <SpreadsheetWorkshopRoute
      page={route.page as WorkshopPage}
      projectId={route.projectId}
      readOnly={!writable}
      navigate={navigate}
    />
  );
}

export default function SpreadsheetApplication() {
  const session = useStudioSession();
  return (
    <RuntimeAccessProvider>
      <AmadeusPageProvider key={session.me.user.id} session={session}>
        <NavigationProtection>
          <ApplicationUpdate />
          <Workspace />
        </NavigationProtection>
      </AmadeusPageProvider>
    </RuntimeAccessProvider>
  );
}
