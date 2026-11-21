import { useStudioSession } from "@app/StudioSession";
import { RuntimeAccessProvider } from "@features/accounts";
import { AmadeusPageProvider } from "@features/amadeus/PageProvider";
import { SPREADSHEET_WORKSHOP_MODULE as module } from "@features/spreadsheet-workshop/module";
import { NavigationProtection } from "@shared/ui/NavigationProtection";
import { useAccountPermission } from "@platform/auth/AccountAccess";
import { SpreadsheetWorkshopRoute } from "@app/routing/SpreadsheetWorkshopRoute";
import type { WorkshopPage } from "@app/routes";
import { ApplicationUpdate } from "./ApplicationUpdate";
import { useWorkshopNavigation } from "@app/routing/useWorkshopNavigation";

function Workspace() {
  const writable = useAccountPermission("content.write");
  const { route, navigate } = useWorkshopNavigation(module);
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
