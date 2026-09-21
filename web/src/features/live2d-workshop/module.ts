import { Network, Layers3 } from "lucide-react";
import { defineApplicationModule } from "@features/applications";
export const LIVE2D_WORKSHOP_MODULE = defineApplicationModule({
  definition: {
    id: "live2d-workshop",
    name: "Live2D 工坊",
    description: "从分层立绘开始，制作网格、参数绑定与角色动画。",
    category: "visual",
    capabilities: ["角色", "网格", "参数绑定", "动画", "序列导出"],
    path: "/apps/live2d-workshop",
    icon: Network,
    brandImage: "/brand/live2d-workshop-mark.png",
  },
  supportsProjects: true,
  shell: "live2d-workshop",
  shellConfig: {
    className: "live2d-workshop-shell",
    subtitle: "Character Studio",
    backSubtitle: "浏览全部应用",
    navigation: [
      {
        page: "live2d-workshop-projects",
        label: "角色项目",
        icon: Layers3,
        activePages: ["live2d-workshop-projects"],
      },
    ],
  },
  matchPath(pathname: string) {
    const editor = pathname.match(
      /^\/apps\/live2d-workshop\/projects\/([^/]+)\/editor\/?$/,
    );
    if (editor)
      return {
        page: "live2d-workshop-editor",
        projectId: decodeURIComponent(editor[1]),
      };
    if (
      pathname === "/apps/live2d-workshop" ||
      pathname === "/apps/live2d-workshop/"
    )
      return { page: "live2d-workshop-projects" };
  },
  pathFor(page: string, projectId?: string) {
    if (page === "live2d-workshop-editor" && projectId)
      return `/apps/live2d-workshop/projects/${encodeURIComponent(projectId)}/editor`;
    if (page === "live2d-workshop-projects") return "/apps/live2d-workshop";
  },
  pages: {
    projects: () =>
      import("./ProjectsPage").then((m) => ({ default: m.ProjectsPage })),
    editor: () =>
      import("./EditorPage").then((m) => ({ default: m.EditorPage })),
  },
});
