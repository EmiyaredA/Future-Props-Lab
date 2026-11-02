import {
  ApplicationCard,
  type ApplicationDefinition,
} from "@features/applications";
import { CloudControlAccess } from "./CloudControlAccess";

export function CloudControlPage({
  onOpen,
  workbench,
}: {
  onOpen: (path: string) => void;
  workbench: ApplicationDefinition;
}) {
  return (
    <CloudControlAccess>
      <section
        className="page cloud-control-page"
        aria-labelledby="cloud-control-title"
      >
        <header className="applications-header">
          <h1 id="cloud-control-title">云控</h1>
          <p>通过云端访问、控制并管理本机</p>
        </header>
        <div className="application-grid">
          <ApplicationCard
            application={workbench}
            onOpen={(application) => onOpen(application.path)}
          />
        </div>
      </section>
    </CloudControlAccess>
  );
}
