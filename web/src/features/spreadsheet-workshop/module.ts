import { Sheet } from "lucide-react";
import {
  defineApplicationModule,
  SPREADSHEET_WORKSHOP_DEFINITION,
} from "@features/applications";

const definition = {
  definition: SPREADSHEET_WORKSHOP_DEFINITION,
  supportsProjects: true,
  shell: "spreadsheet-workshop",
  shellConfig: {
    subtitle: "Spreadsheet Workshop",
    backSubtitle: "浏览全部应用",
    navigation: [
      {
        page: "spreadsheet-workshop-projects",
        label: "我的工作簿",
        icon: Sheet,
        activePages: [
          "spreadsheet-workshop-projects",
          "spreadsheet-workshop-editor",
        ],
      },
    ],
  },
  matchPath(path: string) {
    const match = path.match(
      /^\/apps\/spreadsheet-workshop\/projects\/([^/]+)\/?$/,
    );
    if (match)
      return {
        page: "spreadsheet-workshop-editor",
        projectId: decodeURIComponent(match[1]),
      };
    if (/^\/apps\/spreadsheet-workshop\/?$/.test(path))
      return { page: "spreadsheet-workshop-projects" };
  },
  pathFor(page: string, id?: string) {
    if (page === "spreadsheet-workshop-projects")
      return "/apps/spreadsheet-workshop";
    if (page === "spreadsheet-workshop-editor" && id)
      return `/apps/spreadsheet-workshop/projects/${encodeURIComponent(id)}`;
  },
  pages: {
    workspace: () =>
      import("./SpreadsheetPage").then((m) => ({ default: m.SpreadsheetPage })),
  },
} as const;

export const SPREADSHEET_WORKSHOP_MODULE = defineApplicationModule(definition);
