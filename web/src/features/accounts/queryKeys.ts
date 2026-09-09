export const accountQueryKeys = {
  logWorkspaces: ["accounts", "log-workspaces"] as const,
  crossLogs: (workspace: string, q: string, page: number) =>
    ["accounts", "cross-logs", workspace, q, page] as const,
  syncHistory: (role: string) =>
    ["accounts", "platform", "sync-history", role] as const,
  invites: (filters: object) =>
    ["accounts", "platform", "invites", filters] as const,
  redemptions: (id: string, page: number) =>
    ["accounts", "platform", "redemptions", id, page] as const,
  policy: ["accounts", "platform", "policy"] as const,
  quotas: ["accounts", "platform", "quotas"] as const,
  template: (role: string) =>
    ["accounts", "platform", "template", role] as const,
  syncJob: (id: string) => ["accounts", "platform", "sync-job", id] as const,
  demoServices: ["accounts", "platform", "demo-services"] as const,
  root: ["accounts"] as const,
  platform: ["accounts", "platform"] as const,
  accounts: (filters: object) =>
    ["accounts", "platform", "users", filters] as const,
  workspaces: (filters: object) =>
    ["accounts", "platform", "workspaces", filters] as const,
  audit: (workspaceId: string | null, filters: object) =>
    ["accounts", "audit", workspaceId, filters] as const,
};
