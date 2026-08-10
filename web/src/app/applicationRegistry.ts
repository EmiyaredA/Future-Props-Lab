import { GALGAME_WORKSHOP_MODULE } from "@features/galgame-workshop/module";
import { VISUAL_WORKSHOP_MODULE } from "@features/visual-workshop/module";

export const APPLICATION_MODULES = [
  VISUAL_WORKSHOP_MODULE,
  GALGAME_WORKSHOP_MODULE,
] as const;

export const APPLICATION_DEFINITIONS = APPLICATION_MODULES.map(
  (application) => application.definition,
);

export function matchApplicationPath(pathname: string) {
  for (const application of APPLICATION_MODULES) {
    const match = application.matchPath(pathname);
    if (match) return match;
  }
  return undefined;
}

export function applicationPathFor(page: string, projectId?: string) {
  for (const application of APPLICATION_MODULES) {
    const path = application.pathFor(page, projectId);
    if (path) return path;
  }
  return undefined;
}

export { GALGAME_WORKSHOP_MODULE, VISUAL_WORKSHOP_MODULE };
