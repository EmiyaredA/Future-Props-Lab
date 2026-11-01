export const thoughtKeys = {
  externalSync: (id: string) =>
    ["thought-workshop", "external-sync", id] as const,
  officialImport: (user: string, workspace: string) =>
    [...thoughtKeys.community(user), "official-import", workspace] as const,
  officialLink: (user: string, library: string, document: string) =>
    [
      ...thoughtKeys.community(user),
      "official-link",
      library,
      document,
    ] as const,
  multitable: (context: string, note: string) =>
    [...thoughtKeys.all, "multitable", context, note] as const,
  multitableRecords: (
    context: string,
    note: string,
    table?: string,
    view?: string,
    search?: string,
  ) =>
    table
      ? ([
          ...thoughtKeys.all,
          "multitable-records",
          context,
          note,
          table,
          view,
          search,
        ] as const)
      : ([...thoughtKeys.all, "multitable-records", context, note] as const),
  multitableChoices: (context: string, query: string) =>
    [...thoughtKeys.all, "multitable-choices", context, query] as const,
  accountDirectory: () => [...thoughtKeys.all, "account-directory"] as const,
  multitableHistory: (context: string, note: string, offset: number) =>
    [...thoughtKeys.all, "multitable-history", context, note, offset] as const,
  multitableSnapshot: (
    context: string,
    note: string,
    revision: number | null,
  ) =>
    [
      ...thoughtKeys.all,
      "multitable-snapshot",
      context,
      note,
      revision,
    ] as const,
  layoutDirectory: (namespace: string, library: string) =>
    ["thought-workshop", "layout-directory", namespace, library] as const,
  community: (user: string) => ["thought-workshop", "community", user] as const,
  communityList: (user: string, criteria: object) =>
    [...thoughtKeys.community(user), "list", criteria] as const,
  communityFavorites: (user: string) =>
    [...thoughtKeys.community(user), "favorites"] as const,
  communityDirectory: (user: string, id: string) =>
    [...thoughtKeys.community(user), "directory", id] as const,
  communityNote: (user: string, id: string, note: string) =>
    [...thoughtKeys.community(user), "note", id, note] as const,
  publicationConfig: (user: string, id: string) =>
    [...thoughtKeys.community(user), "publication-config", id] as const,
  communityPermissions: (user: string, id: string, notes: string[]) =>
    [
      ...thoughtKeys.community(user),
      "community-permissions",
      id,
      notes,
    ] as const,
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
  linkPreview: (accountId: string, url: string) =>
    [...thoughtKeys.all, "link-preview", accountId, url] as const,
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
