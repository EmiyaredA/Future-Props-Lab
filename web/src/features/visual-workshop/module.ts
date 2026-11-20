import { visualWorkshopPath } from "./paths";
import { VISUAL_WORKSHOP_DEFINITION } from "@features/applications";
import { Box, FolderOpen, Library, ListChecks } from "lucide-react";
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
        page: "visual-workshop-assets",
        label: "项目素材库",
        icon: FolderOpen,
        activePages: ["visual-workshop-assets"],
      },
      {
        page: "visual-workshop-card-library",
        label: "设定库",
        icon: Library,
        activePages: ["visual-workshop-card-library"],
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
    if (/^\/apps\/visual-workshop\/assets\/?$/.test(pathname))
      return { page: "visual-workshop-assets" };
    if (/^\/apps\/visual-workshop\/card-library\/?$/.test(pathname))
      return { page: "visual-workshop-card-library" };
    if (pathname.startsWith("/apps/visual-workshop/tasks"))
      return { page: "visual-workshop-tasks" };
    if (pathname.startsWith("/apps/visual-workshop"))
      return { page: "visual-workshop-projects" };
    return undefined;
  },
  pathFor: visualWorkshopPath,
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
    assetProjects: () =>
      import("@features/visual-workshop/assets/AssetProjectPicker"),
    cardLibrary: () =>
      import("@features/visual-workshop/creative/CardLibraryPage"),
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
