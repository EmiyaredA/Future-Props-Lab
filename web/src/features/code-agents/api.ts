import type { components } from "@generated/api";
import { api, unwrap } from "@platform/api/client";

export type Agent = components["schemas"]["AgentOut"];
export type Grants = components["schemas"]["GrantsOut"];
export type Grant = components["schemas"]["Grant"];
export const codeAgentKeys = {
  root: ["code-agents"] as const,
  catalog: (scope = "") => ["code-agents", scope, "catalog"] as const,
  grants: (scope = "") => ["code-agents", scope, "grants"] as const,
};
export const getAgents = async () => unwrap(await api.GET("/v1/code-agents"));
export const detectAgents = async () =>
  unwrap(await api.POST("/v1/code-agents/detect"));
export const getGrants = async () =>
  unwrap(await api.GET("/v1/code-agents/grants"));
export const putGrants = async (body: components["schemas"]["GrantUpdate"]) =>
  unwrap(await api.PUT("/v1/code-agents/grants", { body }));
