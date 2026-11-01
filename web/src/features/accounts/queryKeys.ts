export const accountQueryKeys = {
  runtime: () => ["accounts", "runtime"] as const,
  syncHistory: (role: string) =>
    ["accounts", "platform", "sync-history", role] as const,
  invites: (filters: object) =>
    ["accounts", "platform", "invites", filters] as const,
  redemptions: (id: string, page: number) =>
    ["accounts", "platform", "redemptions", id, page] as const,
  quotas: ["accounts", "platform", "quotas"] as const,
  template: (role: string) =>
    ["accounts", "platform", "template", role] as const,
  syncJob: (id: string) => ["accounts", "platform", "sync-job", id] as const,
  demoServices: ["accounts", "platform", "demo-services"] as const,
  root: ["accounts"] as const,
  platform: ["accounts", "platform"] as const,
  accounts: (filters: object) =>
    ["accounts", "platform", "users", filters] as const,
  audit: (filters: object) => ["accounts", "audit", filters] as const,
};
