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
import { guardedNavigation } from "./navigation";
import "./portal.css";

const applications = APPLICATION_DEFINITIONS;

function PortalContents() {
  const localBrowser = useRuntimeAccess();
  const session = useStudioSession();
  const { me } = session;
  const canWrite = useAccountPermission("content.write");
  const canRead = useAccountPermission("content.read");
  const canReadLogs = useAccountPermission("logs.read");
  const open = (path: string) =>
    guardedNavigation(() => window.location.assign(path), true);
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
    <IndependentShell title="Future Props Lab">
      <div className="portal-scroll">
        {/^\/cloud-control\/?$/.test(location.pathname) ? (
          <CloudControlPage owner={me.user.id} />
        ) : /^\/apps\/?$/.test(location.pathname) ? (
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
