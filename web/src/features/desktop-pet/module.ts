import { Heart, PawPrint } from "lucide-react";
import { defineApplicationModule } from "@features/applications";

export const DESKTOP_PET_MODULE = defineApplicationModule({
  definition: {
    id: "desktop-pet",
    name: "桌宠工坊",
    description: "让 Live2D 角色拥有皮肤、触摸反应和桌面习惯。",
    category: "visual",
    capabilities: ["角色", "动画", "桌宠", "皮肤"],
    path: "/apps/desktop-pet",
    icon: Heart,
  },
  supportsProjects: true,
  shell: "desktop-pet",
  shellConfig: {
    className: "desktop-pet-shell",
    subtitle: "Desktop Pet Studio",
    backSubtitle: "浏览全部应用",
    navigation: [
      {
        page: "desktop-pet-projects",
        label: "桌宠项目",
        icon: PawPrint,
        activePages: ["desktop-pet-projects"],
      },
    ],
  },
  matchPath(pathname: string) {
    const editor = pathname.match(
      /^\/apps\/desktop-pet\/projects\/([^/]+)\/editor\/?$/,
    );
    if (editor)
      return {
        page: "desktop-pet-editor",
        projectId: decodeURIComponent(editor[1]),
      };
    if (pathname === "/apps/desktop-pet" || pathname === "/apps/desktop-pet/")
      return { page: "desktop-pet-projects" };
  },
  pathFor(page: string, projectId?: string) {
    if (page === "desktop-pet-editor" && projectId)
      return `/apps/desktop-pet/projects/${encodeURIComponent(projectId)}/editor`;
    if (page === "desktop-pet-projects") return "/apps/desktop-pet";
  },
  pages: {
    projects: () =>
      import("./ProjectsPage").then((m) => ({ default: m.ProjectsPage })),
    editor: () =>
      import("./EditorPage").then((m) => ({ default: m.EditorPage })),
  },
});
