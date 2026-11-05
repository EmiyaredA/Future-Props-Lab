import { MOTION_COMPOSITOR_DEFINITION } from "@features/applications";
import { Layers3 } from "lucide-react";
import { defineApplicationModule } from "@features/applications";

const definition = {
  definition: MOTION_COMPOSITOR_DEFINITION,
  supportsProjects: true,
  shell: "motion-compositor",
  shellConfig: {
    className: "motion-compositor-shell",
    subtitle: "Effects Workshop",
    backSubtitle: "浏览全部应用",
    navigation: [
      {
        page: "motion-compositor-projects",
        label: "特效项目",
        icon: Layers3,
        activePages: ["motion-compositor-projects"],
      },
    ],
  },
  matchPath(pathname: string) {
    const editor = pathname.match(
      /^\/apps\/motion-compositor\/projects\/([^/]+)\/editor\/?$/,
    );
    if (editor)
      return {
        page: "motion-compositor-editor",
        projectId: decodeURIComponent(editor[1]),
      };
    if (pathname.startsWith("/apps/motion-compositor"))
      return { page: "motion-compositor-projects" };
    return undefined;
  },
  pathFor(page: string, projectId?: string) {
    if (page === "motion-compositor-editor" && projectId)
      return `/apps/motion-compositor/projects/${encodeURIComponent(projectId)}/editor`;
    if (page === "motion-compositor-projects") return "/apps/motion-compositor";
    return undefined;
  },
  pages: {
    projects: () =>
      import("./ProjectsPage").then((module) => ({
        default: module.ProjectsPage,
      })),
    editor: () =>
      import("./EditorPage").then((module) => ({
        default: module.EditorPage,
      })),
  },
} as const;

export const MOTION_COMPOSITOR_MODULE = defineApplicationModule(definition);
