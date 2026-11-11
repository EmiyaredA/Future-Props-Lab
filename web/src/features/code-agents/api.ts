import type { components } from "@generated/api";
import { api, unwrap } from "@platform/api/client";

export type Agent = components["schemas"]["AgentOut"];
export const codeAgentKeys = {
  root: ["code-agents"] as const,
  catalog: (scope = "") => ["code-agents", scope, "catalog"] as const,
};
export const getAgents = async ({ signal }: { signal?: AbortSignal } = {}) =>
  unwrap(await api.GET("/v1/code-agents", { signal }));
export const detectAgents = async () =>
  unwrap(await api.POST("/v1/code-agents/detect"));
export const enableAgent = async (agent_id: Agent["id"]) =>
  unwrap(
    await api.POST("/v1/code-agents/{agent_id}/enable", {
      params: { path: { agent_id } },
    }),
  );
