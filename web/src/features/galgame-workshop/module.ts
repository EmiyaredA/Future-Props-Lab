import { GALGAME_WORKSHOP_DEFINITION } from "@features/applications";
import { Box } from "lucide-react";
import { defineApplicationModule } from "@features/applications";

const galgameWorkshopModule = {
  definition: GALGAME_WORKSHOP_DEFINITION,
  supportsProjects: true,
  shell: "galgame-workshop",
  shellConfig: {
    className: "galgame-workshop-shell",
    subtitle: "Galgame Workshop",
    backSubtitle: "浏览全部应用",
    navigation: [
      {
        page: "galgame-workshop-projects",
        label: "项目工作台",
        icon: Box,
        activePages: [
          "galgame-workshop-projects",
          "galgame-workshop-overview",
          "galgame-workshop-editor",
        ],
      },
    ],
  },
  matchPath(pathname: string) {
    const project = pathname.match(
      /^\/apps\/galgame-workshop\/projects\/([^/]+)\/(editor|overview|preview)/,
    );
    if (project)
      return {
        page:
          project[2] === "editor"
            ? "galgame-workshop-editor"
            : project[2] === "preview"
              ? "galgame-workshop-preview"
              : "galgame-workshop-overview",
        projectId: decodeURIComponent(project[1]),
      };
    if (pathname.startsWith("/apps/galgame-workshop"))
      return { page: "galgame-workshop-projects" };
    return undefined;
  },
  pathFor(page: string, projectId?: string) {
    if (page === "galgame-workshop-editor" && projectId)
      return `/apps/galgame-workshop/projects/${encodeURIComponent(projectId)}/editor`;
    if (page === "galgame-workshop-preview" && projectId)
      return `/apps/galgame-workshop/projects/${encodeURIComponent(projectId)}/preview`;
    if (page === "galgame-workshop-overview" && projectId)
      return `/apps/galgame-workshop/projects/${encodeURIComponent(projectId)}/overview`;
    if (page === "galgame-workshop-projects") return "/apps/galgame-workshop";
    return undefined;
  },
  pages: {
    projects: () =>
      import("@features/galgame-workshop/projects").then((module) => ({
        default: module.GalgameWorkshopProjectsPage,
      })),
    overview: () =>
      import("@features/galgame-workshop/overview").then((module) => ({
        default: module.GalgameWorkshopOverviewPage,
      })),
    editor: () =>
      import("@features/galgame-workshop/editor").then((module) => ({
        default: module.GalgameWorkshopEditorPage,
      })),
    preview: () =>
      import("@features/galgame-workshop/editor/GalgameFastPreviewPage").then(
        (module) => ({
          default: module.GalgameFastPreviewPage,
        }),
      ),
  },
} as const;

export const GALGAME_WORKSHOP_MODULE = defineApplicationModule(
  galgameWorkshopModule,
);
