import type { ApplicationDefinition } from "./catalog";
import type { LucideIcon } from "lucide-react";

export type ApplicationRouteMatch = {
  page: string;
  projectId?: string;
  documentId?: string;
};

export type ApplicationModule = {
  definition: ApplicationDefinition;
  supportsProjects: boolean;
  shell:
    | "visual-workshop"
    | "galgame-workshop"
    | "video-editor"
    | "thought-workshop"
    | "presentation-workshop"
    | "audio-annotation"
    | "director-desk";
  shellConfig: {
    className?: string;
    brandClassName?: string;
    subtitle: string;
    backSubtitle: string;
    navigation: readonly {
      page: string;
      label: string;
      icon: LucideIcon;
      activePages: readonly string[];
    }[];
  };
  matchPath: (pathname: string) => ApplicationRouteMatch | undefined;
  pathFor: (
    page: string,
    projectId?: string,
    documentId?: string,
  ) => string | undefined;
  pages: Readonly<Record<string, () => Promise<{ default: unknown }>>>;
};

export function defineApplicationModule<T extends ApplicationModule>(
  module: T,
): T {
  return module;
}
