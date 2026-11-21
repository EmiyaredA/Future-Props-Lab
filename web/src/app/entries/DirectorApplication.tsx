import { WorkshopUtilities } from "@app/layout/StudioGlobalHeader";
import { lazy } from "react";
import { WorkshopShell } from "@app/layout/WorkshopShell";
import { useStudioSession } from "@app/StudioSession";
import { RuntimeAccessProvider } from "@features/accounts";
import { AmadeusPageProvider } from "@features/amadeus/PageProvider";
import { DIRECTOR_DESK_MODULE as director } from "@features/director-desk/module";
import { useAccountPermission } from "@platform/auth/AccountAccess";
import { NavigationProtection } from "@shared/ui/NavigationProtection";
import { ApplicationUpdate } from "./ApplicationUpdate";
import { useWorkshopNavigation } from "@app/routing/useWorkshopNavigation";
import { ApplicationPage } from "@app/layout/ApplicationPage";

const Editor = lazy(director.pages.editor);
const Projects = lazy(director.pages.projects);
const index = "/apps/director-desk";

function DirectorContent() {
  const writable = useAccountPermission("content.write");
  const { route, go } = useWorkshopNavigation(director);
  if (route?.page === "director-desk-editor" && route.projectId)
    return (
      <Editor
        key={route.projectId}
        projectId={route.projectId}
        onBack={() => go(index)}
      />
    );

  if (route?.page === "director-desk-projects")
    return (
      <WorkshopShell
        module={director}
        page={route.page}
        navigate={() => {}}
        onBack={() => go("/apps")}
      >
        <ApplicationUpdate />
        <Projects
          utilities={
            <WorkshopUtilities application={director.definition.name} />
          }
          readOnly={!writable}
          onOpen={(id) => {
            const url = director.pathFor("director-desk-editor", id);
            if (url) go(url);
          }}
        />
      </WorkshopShell>
    );
  return (
    <section className="independent-not-found">
      <h1>页面不存在</h1>
      <a href={index}>返回导演台</a>
    </section>
  );
}

export default function DirectorApplication() {
  const session = useStudioSession();
  return (
    <RuntimeAccessProvider>
      <AmadeusPageProvider key={session.me.user.id} session={session}>
        <NavigationProtection>
          <ApplicationUpdate />
          <ApplicationPage>
            <DirectorContent />
          </ApplicationPage>
        </NavigationProtection>
      </AmadeusPageProvider>
    </RuntimeAccessProvider>
  );
}
