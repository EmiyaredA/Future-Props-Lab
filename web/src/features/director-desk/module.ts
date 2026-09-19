import { Clapperboard } from "lucide-react";
import { defineApplicationModule } from "@features/applications";

const definition = {
  definition: {
    id: "director-desk",
    name: "导演台",
    category: "visual",
    description: "搭三维场景、排走位和运镜，导出预演参考。",
    brandImage: "/brand/director-desk-mark.png",
    capabilities: ["三维预演", "走位", "运镜"],
    path: "/apps/director-desk",
    icon: Clapperboard,
  },
  supportsProjects: true,
  shell: "director-desk",
  shellConfig: {
    subtitle: "Director Desk",
    backSubtitle: "浏览全部应用",
    navigation: [
      {
        page: "director-desk-projects",
        label: "预演工程",
        icon: Clapperboard,
        activePages: ["director-desk-projects", "director-desk-editor"],
      },
    ],
  },
  matchPath(path: string) {
    const editor = path.match(/^\/apps\/director-desk\/projects\/([^/]+)\/?$/);
    if (editor)
      return {
        page: "director-desk-editor",
        projectId: decodeURIComponent(editor[1]),
      };
    if (/^\/apps\/director-desk\/?$/.test(path))
      return { page: "director-desk-projects" };
    return undefined;
  },
  pathFor(page: string, id?: string) {
    if (page === "director-desk-editor" && id)
      return `/apps/director-desk/projects/${encodeURIComponent(id)}`;
    if (page === "director-desk-projects") return "/apps/director-desk";
    return undefined;
  },
  pages: {
    projects: () =>
      import("./DirectorDeskProjectsPage").then((module) => ({
        default: module.DirectorDeskProjectsPage,
      })),
    editor: () =>
      import("./DirectorDeskEditorPage").then((module) => ({
        default: module.DirectorDeskEditorPage,
      })),
  },
} as const;

export const DIRECTOR_DESK_MODULE = defineApplicationModule(definition);
