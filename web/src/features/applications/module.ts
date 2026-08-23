import type { ApplicationDefinition } from "./catalog";

export type ApplicationRouteMatch = {
  page: string;
  projectId?: string;
};

export type ApplicationModule = {
  definition: ApplicationDefinition;
  supportsProjects: boolean;
  shell: "visual-workshop" | "galgame-workshop" | "video-editor";
  matchPath: (pathname: string) => ApplicationRouteMatch | undefined;
  pathFor: (page: string, projectId?: string) => string | undefined;
  pages: Readonly<Record<string, () => Promise<{ default: unknown }>>>;
};

export function defineApplicationModule<T extends ApplicationModule>(
  module: T,
): T {
  return module;
}
