export const presentationKeys = {
  templates: ["presentation-workshop", "templates"] as const,
  examples: ["presentation-workshop", "examples"] as const,
  template: (id: string) => ["presentation-workshop", "template", id] as const,
  all: ["presentation-workshop"] as const,
  projects: (query = "", offset = 0) =>
    ["presentation-workshop", "projects", query, offset] as const,
  project: (id: string) => ["presentation-workshop", "project", id] as const,
  imageSearch: (query = "") =>
    ["presentation-workshop", "images", query] as const,
  images: ["presentation-workshop", "images"] as const,
  mediaSearch: (kind: string, query = "") =>
    ["presentation-workshop", "media", kind, query] as const,
};
