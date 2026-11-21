import { useCallback } from "react";
import type { ApplicationModule } from "@features/applications";
import { useApplicationNavigation } from "./useApplicationNavigation";

type Routes = Pick<ApplicationModule, "definition" | "matchPath" | "pathFor">;

export function useWorkshopNavigation(module: Routes) {
  const ownsPath = useCallback(
    (path: string) =>
      (path === module.definition.path ||
        path.startsWith(module.definition.path + "/")) &&
      Boolean(module.matchPath(path)),
    [module],
  );
  const { path, navigate: go } = useApplicationNavigation(
    module.definition.id,
    ownsPath,
  );
  const navigate = useCallback(
    (page: string, projectId?: string, documentId?: string) => {
      const target =
        page === "apps" ? "/apps" : module.pathFor(page, projectId, documentId);
      if (target) go(target);
    },
    [go, module],
  );
  return {
    route: module.matchPath(new URL(path, location.origin).pathname),
    navigate,
    go,
  };
}
