import { Film } from "lucide-react";
import { defineApplicationModule } from "@features/applications";

const moduleDefinition = {
  definition: {
    id: "video-editor",
    name: "视频剪辑工坊",
    description: "确定性多轨剪辑、精确停帧与原生 FFmpeg 成片。",
    category: "visual",
    capabilities: ["视频", "多轨剪辑", "字幕", "确定性导出"],
    path: "/apps/video-editor",
    icon: Film,
  },
  supportsProjects: true,
  shell: "video-editor",
  matchPath(pathname: string) {
    const editor = pathname.match(
      /^\/apps\/video-editor\/projects\/([^/]+)\/editor/,
    );
    if (editor)
      return {
        page: "video-editor-editor",
        projectId: decodeURIComponent(editor[1]),
      };
    if (pathname.startsWith("/apps/video-editor/tasks"))
      return { page: "video-editor-tasks" };
    if (pathname.startsWith("/apps/video-editor"))
      return { page: "video-editor-projects" };
    return undefined;
  },
  pathFor(page: string, projectId?: string) {
    if (page === "video-editor-editor" && projectId)
      return `/apps/video-editor/projects/${encodeURIComponent(projectId)}/editor`;
    if (page === "video-editor-tasks") return "/apps/video-editor/tasks";
    if (page === "video-editor-projects") return "/apps/video-editor";
    return undefined;
  },
  pages: {
    projects: () =>
      import("@features/video-editor/VideoEditorProjectsPage").then(
        (module) => ({ default: module.VideoEditorProjectsPage }),
      ),
    editor: () =>
      import("@features/video-editor/VideoEditorPage").then((module) => ({
        default: module.VideoEditorPage,
      })),
    tasks: () =>
      import("@features/video-editor/VideoEditorTasksPage").then((module) => ({
        default: module.VideoEditorTasksPage,
      })),
  },
} as const;

export const VIDEO_EDITOR_MODULE = defineApplicationModule(moduleDefinition);
