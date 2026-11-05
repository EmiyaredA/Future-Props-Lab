export const applicationQueryKeys = {
  services: (accountId: string | null) =>
    ["applications", "services", accountId] as const,
};
