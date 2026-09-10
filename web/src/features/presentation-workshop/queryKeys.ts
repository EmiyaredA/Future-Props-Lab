export const presentationKeys = {
  all: ["presentation-workshop"] as const,
  projects: (query = "", offset = 0) =>
    ["presentation-workshop", "projects", query, offset] as const,
  project: (id: string) => ["presentation-workshop", "project", id] as const,
  images: ["presentation-workshop", "images"] as const,
};
