import { fetchApiJson } from "@platform/api/client";
import type { Capability } from "./protocol";

export async function configuredCapabilities(input: {
  mode: "agent" | "plan";
  conversationId: string;
  loaded: string[];
  toolApis: Capability[];
  mcpServers: Capability[];
  skills: Capability[];
}) {
  const tools: Array<{
    name: string;
    key: string;
    label: string;
    description: string;
    schema: Record<string, unknown>;
  }> = [];
  if (input.mode === "plan") return { tools, skills: [] };
  for (const item of input.toolApis.filter(
    (item) => input.loaded.includes(`toolapi:${item.id}`) && item.enabled,
  ))
    tools.push({
      name: `amadeus_api_${tools.length}`,
      key: `tool_api:${item.id}`,
      label: item.name,
      description: item.description || item.name,
      schema: item.parameters_schema || { type: "object" },
    });
  for (const item of input.mcpServers.filter(
    (item) => input.loaded.includes(`mcp:${item.id}`) && item.enabled,
  )) {
    const found = await fetchApiJson<
      Array<{
        name: string;
        description: string;
        input_schema: Record<string, unknown>;
      }>
    >(`/v1/integrations/mcp/${item.id}/tools`);
    for (const tool of found)
      tools.push({
        name: `amadeus_mcp_${tools.length}`,
        key: `mcp:${item.id}:${tool.name}`,
        label: `${item.name} · ${tool.name}`,
        description: tool.description,
        schema: tool.input_schema || { type: "object" },
      });
  }
  const skills = await Promise.all(
    input.skills
      .filter(
        (item) => input.loaded.includes(`skill:${item.id}`) && item.enabled,
      )
      .map(async (item) => ({
        id: item.id,
        ...(await fetchApiJson<{
          name: string;
          version: string;
          content: string;
        }>(
          `/v1/amadeus/conversations/${input.conversationId}/skills/${item.id}/load`,
          { method: "POST" },
        )),
      })),
  );
  return { tools, skills };
}
