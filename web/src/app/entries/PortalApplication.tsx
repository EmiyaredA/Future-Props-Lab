import { RuntimeAccessProvider } from "@features/accounts/RuntimeAccessProvider";
import { useRuntimeAccess } from "@features/accounts/useRuntimeAccess";
import { useAccountPermission } from "@platform/auth/AccountAccess";
import { useStudioSession } from "@app/StudioSession";
import { HomePage } from "@features/home/HomePage";
import { ApplicationCenterRoute } from "@features/applications/ApplicationCenterRoute";
import { APPLICATION_DEFINITIONS } from "@features/applications/definitions";
import { CloudControlPage } from "@features/cloud-control/CloudControlPage";
import { AmadeusPageProvider } from "@features/amadeus/PageProvider";
import { openAmadeus } from "@platform/assistant";
import { IndependentShell } from "./IndependentShell";
import { guardedNavigation } from "./navigation";
import "./portal.css";

const applications = APPLICATION_DEFINITIONS;

function PortalContents() {
  const localBrowser = useRuntimeAccess();
  const { me } = useStudioSession();
  const canWrite = useAccountPermission("content.write");
  const canRead = useAccountPermission("content.read");
  const canReadLogs = useAccountPermission("logs.read");
  const open = (path: string) =>
    guardedNavigation(() => window.location.assign(path), true);
  return (
    <IndependentShell
      title="Future Props Lab"
      openAssistant={canRead ? openAmadeus : undefined}
    >
      <div className="portal-scroll">
        {/^\/cloud-control\/?$/.test(location.pathname) ? (
          <CloudControlPage
            owner={me.user.id}
            hideUnavailableAgent
            preferAgent={
              new URLSearchParams(location.search).get("view") === "agent"
            }
          />
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
  const session = useStudioSession();
  return (
    <RuntimeAccessProvider>
      <AmadeusPageProvider key={session.me.user.id} session={session}>
        <PortalContents />
      </AmadeusPageProvider>
    </RuntimeAccessProvider>
  );
}
