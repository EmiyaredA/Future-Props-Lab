export const integrationKeys = {
  all: ["integrations"] as const,
  catalog: (kind: string) => ["integrations", kind] as const,
  detail: (kind: string, id: string) =>
    ["integrations", kind, "detail", id] as const,
  versions: (id: string) => ["integrations", "skills", "versions", id] as const,
  skillMarkdown: (id: string, version: string) =>
    ["integrations", "skills", "skill-md", id, version] as const,
  tools: (id: string) => ["integrations", "mcp", "tools", id] as const,
};
