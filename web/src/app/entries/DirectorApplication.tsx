import { lazy } from "react";
import "@app/layout/workshop-shell.css";
import { useStudioSession } from "@app/StudioSession";
import { RuntimeAccessProvider } from "@features/accounts";
import { AmadeusPageProvider } from "@features/amadeus/PageProvider";
import { DIRECTOR_DESK_MODULE as director } from "@features/director-desk/module";
import { useAccountPermission } from "@platform/auth/AccountAccess";
import { NavigationProtection } from "@shared/ui/NavigationProtection";
import { ApplicationUpdate } from "./ApplicationUpdate";
import { IndependentShell } from "./IndependentShell";
import { guardedNavigation } from "./navigation";

const Editor = lazy(director.pages.editor);
const Projects = lazy(director.pages.projects);
const index = "/apps/director-desk";

function go(path: string) {
  guardedNavigation(() => window.location.assign(path), true);
}

function DirectorContent() {
  const writable = useAccountPermission("content.write");
  const route = director.matchPath(window.location.pathname);
  if (route?.page === "director-desk-editor" && route.projectId)
    return (
      <NavigationProtection>
        <ApplicationUpdate />
        <Editor projectId={route.projectId} onBack={() => go(index)} />
      </NavigationProtection>
    );

  return (
    <IndependentShell title="导演台">
      {route?.page === "director-desk-projects" ? (
        <Projects
          readOnly={!writable}
          onOpen={(id) => {
            const url = director.pathFor("director-desk-editor", id);
            if (url) go(url);
          }}
        />
      ) : (
        <section className="independent-not-found">
          <h1>页面不存在</h1>
          <a href={index}>返回导演台</a>
        </section>
      )}
    </IndependentShell>
  );
}

export default function DirectorApplication() {
  const session = useStudioSession();
  return (
    <RuntimeAccessProvider>
      <AmadeusPageProvider key={session.me.user.id} session={session}>
        <DirectorContent />
      </AmadeusPageProvider>
    </RuntimeAccessProvider>
  );
}
