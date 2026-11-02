import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "@platform/api/client";
import { useAccountId } from "@platform/auth/AccountAccess";
import { ApplicationCenterPage } from "./ApplicationCenterPage";
import { applicationQueryKeys } from "./queryKeys";
import type { ApplicationDefinition } from "./catalog";

export function ApplicationCenterRoute(props: {
  onOpen: (path: string) => void;
  applications: readonly ApplicationDefinition[];
}) {
  const accountId = useAccountId();
  const query = useQuery({
    queryKey: applicationQueryKeys.services(accountId),
    enabled: accountId !== null,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET("/v1/automation/services", { signal })),
    refetchInterval: 5000,
    staleTime: 3000,
    retry: false,
  });
  const old =
    query.data && Date.now() - Date.parse(query.data.checked_at) > 20_000;
  return (
    <ApplicationCenterPage
      {...props}
      services={query.data}
      checking={query.isFetching || query.isPending}
      unavailable={query.isError || query.fetchStatus === "paused" || !!old}
      onRefresh={() => void query.refetch()}
    />
  );
}
