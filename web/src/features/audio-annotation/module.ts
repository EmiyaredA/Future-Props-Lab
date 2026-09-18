import { Mic2 } from "lucide-react";
import { defineApplicationModule } from "@features/applications";

const definition = {
  definition: {
    id: "audio-annotation",
    name: "录音标注工坊",
    category: "productivity",
    description: "切分录音、配置说话人与情绪，逐段转写并导出字幕与片段。",
    capabilities: ["音频切分", "说话人", "语音识别", "字幕导出"],
    path: "/apps/audio-annotation",
    icon: Mic2,
    brandImage: "/brand/audio-annotation-mark.png",
  },
  supportsProjects: true,
  shell: "audio-annotation",
  shellConfig: {
    className: "audio-annotation-shell",
    brandClassName: "audio-annotation-brand",
    subtitle: "Audio Annotation",
    backSubtitle: "浏览全部应用",
    navigation: [
      {
        page: "audio-annotation-projects",
        label: "标注项目",
        icon: Mic2,
        activePages: ["audio-annotation-projects", "audio-annotation-editor"],
      },
    ],
  },
  matchPath(path: string) {
    const match = path.match(
      /^\/apps\/audio-annotation\/projects\/([^/]+)\/?$/,
    );
    if (match)
      return {
        page: "audio-annotation-editor",
        projectId: decodeURIComponent(match[1]),
      };
    if (/^\/apps\/audio-annotation\/?$/.test(path))
      return { page: "audio-annotation-projects" };
    return undefined;
  },
  pathFor(page: string, id?: string) {
    if (page === "audio-annotation-editor" && id)
      return `/apps/audio-annotation/projects/${encodeURIComponent(id)}`;
    if (page === "audio-annotation-projects") return "/apps/audio-annotation";
    return undefined;
  },
  pages: {
    projects: () =>
      import("./AudioAnnotationProjectsPage").then((module) => ({
        default: module.AudioAnnotationProjectsPage,
      })),
    editor: () =>
      import("./AudioAnnotationEditorPage").then((module) => ({
        default: module.AudioAnnotationEditorPage,
      })),
  },
} as const;

export const AUDIO_ANNOTATION_MODULE = defineApplicationModule(definition);
