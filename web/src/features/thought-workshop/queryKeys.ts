export const thoughtKeys = {
  all: ["thought-workshop"] as const,
  linkPreview: (workspaceId: string, url: string) =>
    [...thoughtKeys.all, "link-preview", workspaceId, url] as const,
  notes: (query: object) => [...thoughtKeys.all, "notes", query] as const,
  projectLists: () => [...thoughtKeys.all, "projects"] as const,
  projects: (query = "", trash = false) =>
    [...thoughtKeys.all, "projects", query, trash] as const,
  directory: (id: string) => [...thoughtKeys.all, "directory", id] as const,
  note: (id: string) => [...thoughtKeys.all, "note", id] as const,
  history: (id: string) => [...thoughtKeys.all, "history", id] as const,
  historyDetail: (id: string, record: string) =>
    [...thoughtKeys.all, "history-detail", id, record] as const,
  models: () => [...thoughtKeys.all, "models"] as const,
};
