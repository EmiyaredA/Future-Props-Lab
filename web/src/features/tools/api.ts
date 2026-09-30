import type { components } from "@generated/api";
import { api, unwrap } from "@platform/api/client";

export type ToolNavigationItem = components["schemas"]["ToolNavigationItemOut"];
export type ToolNavigationState =
  components["schemas"]["ToolNavigationStateOut"];
export type CodexSourceState = components["schemas"]["CodexSourceState"];

export async function getToolNavigationState(): Promise<ToolNavigationState> {
  return unwrap(await api.GET("/v1/tool-navigation/state"));
}

export async function setToolFavorite(
  toolId: string,
  isFavorite: boolean,
): Promise<ToolNavigationItem> {
  return unwrap(
    await api.PATCH("/v1/tool-navigation/tools/{tool_id}", {
      params: { path: { tool_id: toolId } },
      body: { is_favorite: isFavorite },
    }),
  );
}

export async function recordToolUse(
  toolId: string,
): Promise<ToolNavigationItem> {
  return unwrap(
    await api.POST("/v1/tool-navigation/tools/{tool_id}/use", {
      params: { path: { tool_id: toolId } },
    }),
  );
}

export async function getCodexSource(): Promise<CodexSourceState> {
  return unwrap(await api.GET("/v1/tool-navigation/codex-source"));
}

export async function updateCodexSource(body: {
  expected_revision: string;
  source: "openai" | "custom";
  model: string;
  base_url: string;
  env_key: string;
}): Promise<CodexSourceState> {
  return unwrap(await api.PUT("/v1/tool-navigation/codex-source", { body }));
}

export async function restoreCodexSource(
  expectedRevision: string,
): Promise<CodexSourceState> {
  return unwrap(
    await api.POST("/v1/tool-navigation/codex-source/restore", {
      body: { expected_revision: expectedRevision },
    }),
  );
}
