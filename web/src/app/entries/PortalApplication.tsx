import { RuntimeAccessProvider } from "@features/accounts/RuntimeAccessProvider";
import { useRuntimeAccess } from "@features/accounts/useRuntimeAccess";
import { useAccountPermission } from "@platform/auth/AccountAccess";
import { useStudioSession } from "@app/StudioSession";
import { HomePage } from "@features/home/HomePage";
import { ApplicationCenterPage } from "@features/applications/ApplicationCenterPage";
import { APPLICATION_DEFINITIONS } from "@features/applications/definitions";
import { IndependentShell } from "./IndependentShell";
import { guardedNavigation } from "./navigation";
import "./portal.css";

const applications = APPLICATION_DEFINITIONS.map((app) => ({
  ...app,
  path: app.id === "agent-workbench" ? "/agents" : app.path,
}));

function PortalContents() {
  const localBrowser = useRuntimeAccess();
  const { me } = useStudioSession();
  const canWrite = useAccountPermission("content.write");
  const canRead = useAccountPermission("content.read");
  const canReadLogs = useAccountPermission("logs.read");
  const open = (path: string) =>
    guardedNavigation(() => window.location.assign(path), true);
  return (
    <IndependentShell title="Future Props Lab">
      <div className="portal-scroll">
        {/^\/apps\/?$/.test(location.pathname) ? (
          <ApplicationCenterPage applications={applications} onOpen={open} />
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
