export const integrationKeys = {
  all: ["integrations"] as const,
  validationAttemptsRoot: ["integrations", "validation-attempts"] as const,
  validationAttempts: (offset: number) =>
    ["integrations", "validation-attempts", offset] as const,
  catalog: (kind: string) => ["integrations", kind] as const,
  detail: (kind: string, id: string) =>
    ["integrations", kind, "detail", id] as const,
  versions: (id: string) => ["integrations", "skills", "versions", id] as const,
  skillMarkdown: (id: string, version: string) =>
    ["integrations", "skills", "skill-md", id, version] as const,
  skillFiles: (id: string, version: string) =>
    ["integrations", "skills", "files", id, version] as const,
  skillFileText: (id: string, version: string, path: string) =>
    ["integrations", "skills", "file", id, version, path] as const,
  tools: (id: string) => ["integrations", "mcp", "tools", id] as const,
};
