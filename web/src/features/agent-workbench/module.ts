import { AGENT_WORKBENCH_DEFINITION } from "@features/applications";
import { MessagesSquare, Cable } from "lucide-react";
import { defineApplicationModule } from "@features/applications";

const definition = {
  definition: AGENT_WORKBENCH_DEFINITION,
  supportsProjects: false,
  shell: "agent-workbench",
  shellConfig: {
    subtitle: "本机编程会话",
    backSubtitle: "浏览全部应用",
    navigation: [
      {
        page: "agent-workbench-session",
        label: "会话",
        icon: MessagesSquare,
        activePages: ["agent-workbench-session"],
      },
      {
        page: "agent-workbench-sources",
        label: "来源",
        icon: Cable,
        activePages: ["agent-workbench-sources"],
      },
    ],
  },
  matchPath(path: string) {
    if (/^\/apps\/agent-workbench\/sources\/?$/.test(path))
      return { page: "agent-workbench-sources" };
    const match = /^\/apps\/agent-workbench(?:\/sessions\/([^/]+))?\/?$/.exec(
      path,
    );
    if (match) return { page: "agent-workbench-session", projectId: match[1] };
  },
  pathFor(page: string, id?: string) {
    if (page === "agent-workbench-sources")
      return "/apps/agent-workbench/sources";
    if (page === "agent-workbench-session")
      return (
        "/apps/agent-workbench" +
        (id ? `/sessions/${encodeURIComponent(id)}` : "")
      );
  },
  pages: {
    workspace: () =>
      import("./AgentWorkbenchPage").then((m) => ({
        default: m.AgentWorkbenchPage,
      })),
  },
} as const;

export const AGENT_WORKBENCH_MODULE = defineApplicationModule(definition);
