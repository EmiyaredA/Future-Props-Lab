export const workbenchKeys = {
  root: (owner: string) => ["agent-workbench", owner] as const,
  sources: (owner: string) =>
    [...workbenchKeys.root(owner), "sources"] as const,
  candidates: (owner: string) =>
    [...workbenchKeys.root(owner), "candidates"] as const,
  lists: (owner: string) => [...workbenchKeys.root(owner), "lists"] as const,
  list: (owner: string, filters: object) =>
    [...workbenchKeys.lists(owner), filters] as const,
  session: (owner: string, id: string) =>
    [...workbenchKeys.root(owner), "session", id] as const,
  histories: (owner: string, id: string) =>
    [...workbenchKeys.root(owner), "history", id] as const,
  history: (owner: string, id: string, branch?: string) =>
    [...workbenchKeys.histories(owner, id), branch ?? ""] as const,
};
