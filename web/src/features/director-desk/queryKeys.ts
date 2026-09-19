export const directorDeskKeys = {
  all: ["director-desk"] as const,
  projects: (query = "") => ["director-desk", "projects", query] as const,
  project: (id: string) => ["director-desk", "project", id] as const,
};
