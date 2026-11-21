import { RuntimeAccessProvider } from "@features/accounts/RuntimeAccessProvider";
import { useRuntimeAccess } from "@features/accounts/useRuntimeAccess";
import { useAccountPermission } from "@platform/auth/AccountAccess";
import { useStudioSession } from "@app/StudioSession";
import { HomePage } from "@features/home/HomePage";
import { ApplicationCenterRoute } from "@features/applications/ApplicationCenterRoute";
import { APPLICATION_DEFINITIONS } from "@features/applications/definitions";
import { CloudControlPage } from "@features/cloud-control/CloudControlPage";
import {
  AmadeusPageProvider,
  AmadeusWorkspace,
} from "@features/amadeus/PageProvider";
import { ApplicationUpdate } from "./ApplicationUpdate";
import { IndependentShell } from "./IndependentShell";
import { useApplicationLocation } from "@app/routing/applicationNavigationContext";
import "./portal.css";

const applications = APPLICATION_DEFINITIONS;
// /apps is a portal page; its child paths belong to independent workshops.
const exactPaths = ["/", "/home", "/apps", "/cloud-control"];

function PortalMain() {
  const localBrowser = useRuntimeAccess();
  const session = useStudioSession();
  const { me } = session;
  const canWrite = useAccountPermission("content.write");
  const canRead = useAccountPermission("content.read");
  const canReadLogs = useAccountPermission("logs.read");
  const { path, navigate: open } = useApplicationLocation();
  const pathname = new URL(path, location.origin).pathname;
  return (
    <div className="portal-scroll">
      {/^\/cloud-control\/?$/.test(pathname) ? (
        <CloudControlPage owner={me.user.id} />
      ) : /^\/apps\/?$/.test(pathname) ? (
        <ApplicationCenterRoute applications={applications} onOpen={open} />
      ) : (
        <HomePage
          onNavigate={open}
          applications={applications}
          canWrite={canWrite}
          showFiles={canRead}
          canReadLogs={canReadLogs}
          canManageHost={localBrowser && me.user.is_platform_admin}
        />
      )}
    </div>
  );
}

function PortalContents() {
  const session = useStudioSession();
  const { me } = session;
  const canRead = useAccountPermission("content.read");
  if (/^\/amadeus\/?$/.test(location.pathname)) {
    return canRead ? (
      <AmadeusPageProvider key={me.user.id} session={session} workspaceOnly>
        <div className="portal-amadeus">
          <ApplicationUpdate />
          <AmadeusWorkspace session={session} />
        </div>
      </AmadeusPageProvider>
    ) : (
      <p role="alert">当前账号没有 Amadeus 访问权限。</p>
    );
  }
  return (
    <IndependentShell title="Future Props Lab" exactPaths={exactPaths}>
      <PortalMain />
    </IndependentShell>
  );
}

export default function PortalApplication() {
  return (
    <RuntimeAccessProvider>
      <PortalContents />
    </RuntimeAccessProvider>
  );
}
