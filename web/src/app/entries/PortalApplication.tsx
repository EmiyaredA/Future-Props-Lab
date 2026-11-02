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

export default function PortalApplication() {
  const open = (path: string) =>
    guardedNavigation(() => window.location.assign(path), true);
  return (
    <IndependentShell title="Future Props Lab">
      <div className="portal-scroll">
        {/^\/apps\/?$/.test(location.pathname) ? (
          <ApplicationCenterPage applications={applications} onOpen={open} />
        ) : (
          <HomePage onNavigate={open} />
        )}
      </div>
    </IndependentShell>
  );
}
