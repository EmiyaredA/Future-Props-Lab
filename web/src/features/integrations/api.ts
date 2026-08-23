import type { components } from "@generated/api";
import { api, fetchApiBlob, unwrap } from "@platform/api/client";

export type ToolApi = components["schemas"]["ToolApiOut"];
export type ToolApiCatalog = components["schemas"]["ToolApiCatalogOut"];
export type ToolApiInput = components["schemas"]["ToolApiCreateIn"];
export type McpServer = components["schemas"]["McpOut"];
export type McpCatalog = components["schemas"]["McpCatalogOut"];
export type McpInput = components["schemas"]["McpCreateIn"];
export type McpTool = components["schemas"]["McpToolOut"];
export type Skill = components["schemas"]["SkillOut"];
export type SkillCatalog = components["schemas"]["SkillCatalogOut"];
export type SkillVersion = components["schemas"]["SkillVersionOut"];

export const getToolApis = async () =>
  unwrap(await api.GET("/v1/integrations/tool-apis"));

export const createToolApi = async (body: ToolApiInput) =>
  unwrap(await api.POST("/v1/integrations/tool-apis", { body }));

export const updateToolApi = async (current: ToolApi, body: ToolApiInput) =>
  unwrap(
    await api.PATCH("/v1/integrations/tool-apis/{integration_id}", {
      params: { path: { integration_id: current.id } },
      body: { ...body, expected_revision: current.revision },
    }),
  );

export const deleteToolApi = async (current: ToolApi) =>
  unwrap(
    await api.DELETE("/v1/integrations/tool-apis/{integration_id}", {
      params: {
        path: { integration_id: current.id },
        query: { expected_revision: current.revision },
      },
    }),
  );

export const validateToolApi = async (current: ToolApi, input: unknown) =>
  unwrap(
    await api.POST("/v1/integrations/tool-apis/{integration_id}/validate", {
      params: { path: { integration_id: current.id } },
      body: { input: input as Record<string, never> },
    }),
  );

export const getMcpServers = async () =>
  unwrap(await api.GET("/v1/integrations/mcp"));

export const createMcpServer = async (body: McpInput) =>
  unwrap(await api.POST("/v1/integrations/mcp", { body }));

export const updateMcpServer = async (current: McpServer, body: McpInput) =>
  unwrap(
    await api.PATCH("/v1/integrations/mcp/{integration_id}", {
      params: { path: { integration_id: current.id } },
      body: { ...body, expected_revision: current.revision },
    }),
  );

export const deleteMcpServer = async (current: McpServer) =>
  unwrap(
    await api.DELETE("/v1/integrations/mcp/{integration_id}", {
      params: {
        path: { integration_id: current.id },
        query: { expected_revision: current.revision },
      },
    }),
  );

export const validateMcpServer = async (current: McpServer) =>
  unwrap(
    await api.POST("/v1/integrations/mcp/{integration_id}/validate", {
      params: { path: { integration_id: current.id } },
    }),
  );

export const getMcpTools = async (current: McpServer) =>
  unwrap(
    await api.GET("/v1/integrations/mcp/{integration_id}/tools", {
      params: { path: { integration_id: current.id } },
    }),
  );

export const getSkills = async () =>
  unwrap(await api.GET("/v1/integrations/skills"));

export async function createSkill(file: File, enabled: boolean) {
  return unwrap(
    await api.POST("/v1/integrations/skills", {
      body: { file: file as unknown as string, enabled },
      bodySerializer() {
        const data = new FormData();
        data.set("file", file);
        data.set("enabled", String(enabled));
        return data;
      },
    }),
  );
}

export async function addSkillVersion(current: Skill, file: File) {
  return unwrap(
    await api.POST("/v1/integrations/skills/{skill_id}/versions", {
      params: { path: { skill_id: current.id } },
      body: {
        file: file as unknown as string,
        expected_revision: current.revision,
      },
      bodySerializer() {
        const data = new FormData();
        data.set("file", file);
        data.set("expected_revision", String(current.revision));
        return data;
      },
    }),
  );
}

export const updateSkill = async (
  current: Skill,
  enabled: boolean,
  defaultVersion: string,
) =>
  unwrap(
    await api.PATCH("/v1/integrations/skills/{skill_id}", {
      params: { path: { skill_id: current.id } },
      body: {
        expected_revision: current.revision,
        enabled,
        default_version: defaultVersion,
      },
    }),
  );

export const deleteSkill = async (current: Skill) =>
  unwrap(
    await api.DELETE("/v1/integrations/skills/{skill_id}", {
      params: {
        path: { skill_id: current.id },
        query: { expected_revision: current.revision },
      },
    }),
  );

export const getSkillVersions = async (current: Skill) =>
  unwrap(
    await api.GET("/v1/integrations/skills/{skill_id}/versions", {
      params: { path: { skill_id: current.id } },
    }),
  );

export const downloadSkillVersion = (current: Skill, version: string) =>
  fetchApiBlob(
    `/v1/integrations/skills/${encodeURIComponent(current.id)}/versions/${encodeURIComponent(version)}/content`,
  );
