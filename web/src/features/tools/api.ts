import type { components } from "@generated/api";
import { api, unwrap } from "@platform/api/client";

export type ToolNavigationItem = components["schemas"]["ToolNavigationItemOut"];
export type ToolNavigationState =
  components["schemas"]["ToolNavigationStateOut"];

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
