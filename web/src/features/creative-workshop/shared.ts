import type { CreativeDraft, CreativeKind } from "./api";

export type Mode =
  | "creative-workshop"
  | "creative-workshop-mine"
  | "creative-workshop-new"
  | "creative-workshop-editor"
  | "creative-workshop-detail";
export type Nav = (page: Mode, id?: string) => void;
export const labels: Record<CreativeKind, string> = {
  tool_api: "工具 API",
  mcp: "MCP",
  skill: "Skill",
  bundle: "方案包",
};
export const kinds: CreativeKind[] = ["tool_api", "mcp", "skill", "bundle"];
export const presets = ["sunrise", "violet", "ocean", "mint"];
export const initialDraft = (kind: CreativeKind): CreativeDraft => ({
  kind,
  title: "",
  summary: "",
  description: "",
  tags: [],
  cover_preset: "sunrise",
  manifest:
    kind === "tool_api"
      ? { method: "GET", url: "", auth_kind: "none" }
      : kind === "mcp"
        ? { transport: "streamable_http", url: "" }
        : {},
  components: [],
});
export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "操作失败，请重试";
