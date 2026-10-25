import { Presentation, LayoutTemplate } from "lucide-react";
import { defineApplicationModule } from "@features/applications";

const definition = {
  definition: {
    id: "presentation-workshop",
    name: "演示工坊",
    category: "productivity",
    description: "用文字、图片和图形整理想法，编辑、放映并导出可编辑 PPTX。",
    capabilities: ["演示文稿", "排版", "PPTX导出"],
    path: "/apps/presentation-workshop",
    icon: Presentation,
    brandImage: "/brand/presentation-workshop-mark.png",
  },
  supportsProjects: true,
  shell: "presentation-workshop",
  shellConfig: {
    subtitle: "Presentation Workshop",
    backSubtitle: "浏览全部应用",
    navigation: [
      {
        page: "presentation-workshop-projects",
        label: "我的文稿",
        icon: Presentation,
        activePages: [
          "presentation-workshop-projects",
          "presentation-workshop-editor",
        ],
      },
      {
        page: "presentation-workshop-templates",
        label: "模板与示例",
        icon: LayoutTemplate,
        activePages: ["presentation-workshop-templates"],
      },
    ],
  },
  matchPath(path: string) {
    if (/^\/apps\/presentation-workshop\/templates\/?$/.test(path))
      return { page: "presentation-workshop-templates" };
    const match = path.match(
      /^\/apps\/presentation-workshop\/projects\/([^/]+)\/?$/,
    );
    if (match)
      return {
        page: "presentation-workshop-editor",
        projectId: decodeURIComponent(match[1]),
      };
    if (/^\/apps\/presentation-workshop\/?$/.test(path))
      return { page: "presentation-workshop-projects" };
  },
  pathFor(page: string, id?: string) {
    if (page === "presentation-workshop-templates")
      return "/apps/presentation-workshop/templates";
    if (page === "presentation-workshop-editor" && id)
      return `/apps/presentation-workshop/projects/${encodeURIComponent(id)}`;
    if (page === "presentation-workshop-projects")
      return "/apps/presentation-workshop";
  },
  pages: {
    workspace: () =>
      import("./PresentationWorkshopPage").then((m) => ({
        default: m.PresentationWorkshopPage,
      })),
  },
} as const;
export const PRESENTATION_WORKSHOP_MODULE = defineApplicationModule(definition);
