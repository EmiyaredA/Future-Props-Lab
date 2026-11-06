export const workbenchKeys = {
  root: (owner: string) => ["agent-workbench", owner] as const,
  executionCatalog: (owner: string) =>
    [...workbenchKeys.root(owner), "execution-catalog"] as const,
  directories: (owner: string, parent: string | undefined) =>
    [...workbenchKeys.root(owner), "directories", parent ?? null] as const,
  chats: (owner: string) => [...workbenchKeys.root(owner), "chats"] as const,
  chat: (owner: string, id: string) =>
    [...workbenchKeys.chats(owner), id] as const,
  source: (owner: string, chat: string, turn: string, call: string) =>
    [...workbenchKeys.chat(owner, chat), "source", turn, call] as const,
  historySource: (
    owner: string,
    session: string,
    path: string,
    line?: number,
  ) =>
    [...workbenchKeys.session(owner, session), "source", path, line] as const,
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
