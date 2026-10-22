export const interviewQueryKeys = {
  root: (scope: string) => ["interview-assistant", scope] as const,
  rooms: (scope: string) =>
    [...interviewQueryKeys.root(scope), "rooms"] as const,
  room: (scope: string, id: string | null) =>
    [...interviewQueryKeys.root(scope), "room", id] as const,
  executor: (scope: string) =>
    [...interviewQueryKeys.root(scope), "executor"] as const,
  bundle: (scope: string, room: string, task: string) =>
    [...interviewQueryKeys.root(scope), "bundle", room, task] as const,
  progress: (scope: string, room: string, task: string) =>
    [...interviewQueryKeys.root(scope), "progress", room, task] as const,
};
