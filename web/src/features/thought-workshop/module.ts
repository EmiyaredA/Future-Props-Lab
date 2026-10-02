import { BookOpen } from "lucide-react";
import { defineApplicationModule } from "@features/applications";
import { officialPath } from "./official/catalog";

const moduleDefinition = {
  definition: {
    id: "thought-workshop",
    name: "思绪工坊",
    category: "productivity",
    description:
      "记录灵感，整理思绪。支持丰富排版、公式图表；AI 写作经 Agent/SDK 接入。",
    capabilities: ["笔记", "富文本"],
    path: "/apps/thought-workshop",
    icon: BookOpen,
    brandImage: "/brand/thought-workshop-mark.png",
  },
  supportsProjects: true,
  shell: "thought-workshop",
  shellConfig: {
    className: "thought-shell",
    subtitle: "Thought Workshop",
    backSubtitle: "浏览全部应用",
    navigation: [
      {
        page: "thought-workshop-notes",
        label: "知识库",
        icon: BookOpen,
        activePages: ["thought-workshop-notes", "thought-workshop-editor"],
      },
    ],
  },
  matchPath(pathname: string) {
    const official = pathname.match(
      /^\/apps\/thought-workshop\/official-knowledge-bases\/([^/]+)(?:\/documents\/([^/]+))?\/?$/,
    );
    if (official)
      return {
        page: "thought-workshop-official",
        projectId: decodeURIComponent(official[1]),
        documentId: official[2] ? decodeURIComponent(official[2]) : undefined,
      };
    const legacy = pathname.match(
      /^\/apps\/thought-workshop\/notes\/([^/]+)\/?$/,
    );
    if (legacy)
      return {
        page: "thought-workshop-legacy",
        documentId: decodeURIComponent(legacy[1]),
      };
    const match = pathname.match(
      /^\/apps\/thought-workshop\/knowledge-bases\/([^/]+)(?:\/documents\/([^/]+))?\/?$/,
    );
    if (match)
      return {
        page: "thought-workshop-editor",
        projectId: decodeURIComponent(match[1]),
        documentId: match[2] ? decodeURIComponent(match[2]) : undefined,
      };
    if (/^\/apps\/thought-workshop\/?$/.test(pathname))
      return { page: "thought-workshop-notes" };
    return undefined;
  },
  pathFor(page: string, projectId?: string, documentId?: string) {
    if (page === "thought-workshop-official" && projectId)
      return officialPath(projectId, documentId);
    if (page === "thought-workshop-editor" && projectId)
      return `/apps/thought-workshop/knowledge-bases/${encodeURIComponent(projectId)}${documentId ? `/documents/${encodeURIComponent(documentId)}` : ""}`;
    if (page === "thought-workshop-legacy" && documentId)
      return `/apps/thought-workshop/notes/${encodeURIComponent(documentId)}`;
    if (page === "thought-workshop-notes") return "/apps/thought-workshop";
    return undefined;
  },
  pages: {
    notes: () =>
      import("./ThoughtWorkshopPage").then((m) => ({
        default: m.ThoughtWorkshopPage,
      })),
  },
} as const;

export const THOUGHT_WORKSHOP_MODULE =
  defineApplicationModule(moduleDefinition);
