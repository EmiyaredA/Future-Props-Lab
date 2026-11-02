import { INTERVIEW_ASSISTANT_DEFINITION } from "@features/applications";
import { MessagesSquare } from "lucide-react";
import { defineApplicationModule } from "@features/applications";

const definition = {
  definition: INTERVIEW_ASSISTANT_DEFINITION,
  supportsProjects: false,
  shell: "interview-assistant",
  shellConfig: {
    subtitle: "Interview Assistant · Codex 资料准备",
    backSubtitle: "浏览全部应用",
    navigation: [
      {
        page: "interview-assistant-session",
        label: "面试室",
        icon: MessagesSquare,
        activePages: ["interview-assistant-session"],
      },
    ],
  },
  matchPath(path: string) {
    if (/^\/apps\/interview-assistant\/?$/.test(path))
      return { page: "interview-assistant-session" };
  },
  pathFor(page: string) {
    if (page === "interview-assistant-session")
      return "/apps/interview-assistant";
  },
  pages: {
    workspace: () =>
      import("./InterviewAssistantPage").then((m) => ({
        default: m.InterviewAssistantPage,
      })),
  },
} as const;
export const INTERVIEW_ASSISTANT_MODULE = defineApplicationModule(definition);
