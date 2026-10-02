export const thoughtKeys = {
  copySnapshot: (id: string, subtree: boolean) =>
    ["thought-workshop", "copy-snapshot", id, subtree] as const,
  backlinks: (id: string) => ["thought-workshop", "backlinks", id] as const,
  referenceLists: () => ["thought-workshop", "references"] as const,
  references: (workspace: string, ids: string[]) =>
    ["thought-workshop", "references", workspace, ids] as const,
  search: (criteria: object) =>
    ["thought-workshop", "global-search", criteria] as const,
  templates: () => ["thought-workshop", "templates"] as const,
  checkpoints: (id: string) => ["thought-workshop", "checkpoints", id] as const,
  filters: (user: string, workspace: string) =>
    ["thought-workshop", "filters", user, workspace] as const,
  recent: (user: string, workspace: string) =>
    ["thought-workshop", "visited", user, workspace] as const,
  reading: (user: string, workspace: string, id: string) =>
    ["thought-workshop", "reading", user, workspace, id] as const,
  all: ["thought-workshop"] as const,
  officialDocument: (library: string, document: string) =>
    [...thoughtKeys.all, "official", library, "document", document] as const,
  officialSearch: (library: string, query: string) =>
    [...thoughtKeys.all, "official", library, "search", query] as const,
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
};
