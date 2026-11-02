import { VISUAL_WORKSHOP_DEFINITION } from "@features/applications";
import { Box, ListChecks } from "lucide-react";
import { defineApplicationModule } from "@features/applications";

const visualWorkshopModule = {
  definition: VISUAL_WORKSHOP_DEFINITION,
  supportsProjects: true,
  shell: "visual-workshop",
  shellConfig: {
    subtitle: "Visual Workshop",
    backSubtitle: "浏览全部应用",
    navigation: [
      {
        page: "visual-workshop-projects",
        label: "项目工作台",
        icon: Box,
        activePages: ["visual-workshop-projects"],
      },
      {
        page: "visual-workshop-tasks",
        label: "生成任务",
        icon: ListChecks,
        activePages: ["visual-workshop-tasks"],
      },
    ],
  },
  matchPath(pathname: string) {
    const project = pathname.match(
      /^\/apps\/visual-workshop\/projects\/([^/]+)\/(canvas|assets)/,
    );
    if (project)
      return {
        page:
          project[2] === "canvas"
            ? "visual-workshop-canvas"
            : "visual-workshop-assets",
        projectId: decodeURIComponent(project[1]),
      };
    if (pathname.startsWith("/apps/visual-workshop/tasks"))
      return { page: "visual-workshop-tasks" };
    if (pathname.startsWith("/apps/visual-workshop"))
      return { page: "visual-workshop-projects" };
    return undefined;
  },
  pathFor(page: string, projectId?: string) {
    if (page === "visual-workshop-canvas" && projectId)
      return `/apps/visual-workshop/projects/${encodeURIComponent(projectId)}/canvas`;
    if (page === "visual-workshop-assets" && projectId)
      return `/apps/visual-workshop/projects/${encodeURIComponent(projectId)}/assets`;
    if (page === "visual-workshop-tasks") return "/apps/visual-workshop/tasks";
    if (page === "visual-workshop-projects") return "/apps/visual-workshop";
    return undefined;
  },
  pages: {
    projects: () =>
      import("@features/visual-workshop/projects").then((module) => ({
        default: module.VisualWorkshopProjectsPage,
      })),
    canvas: () =>
      import("@features/visual-workshop/canvas").then((module) => ({
        default: module.VisualWorkshopCanvasPage,
      })),
    assets: () =>
      import("@features/visual-workshop/assets").then((module) => ({
        default: module.VisualWorkshopAssetsPage,
      })),
    tasks: () =>
      import("@features/visual-workshop/generation").then((module) => ({
        default: module.VisualWorkshopTasksPage,
      })),
    empty: () =>
      import("@features/visual-workshop/pages/VisualWorkshopEmptyPage").then(
        (module) => ({ default: module.VisualWorkshopEmptyPage }),
      ),
  },
} as const;

export const VISUAL_WORKSHOP_MODULE =
  defineApplicationModule(visualWorkshopModule);
