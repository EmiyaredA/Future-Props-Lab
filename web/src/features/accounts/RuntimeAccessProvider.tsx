import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "@platform/api/client";
import { accountQueryKeys } from "./queryKeys";
import { RuntimeAccessContext } from "./useRuntimeAccess";

export function RuntimeAccessProvider({ children }: { children: ReactNode }) {
  const query = useQuery({
    queryKey: accountQueryKeys.runtime(),
    queryFn: async () => unwrap(await api.GET("/v1/automation/runtime")),
    staleTime: Infinity,
  });
  return (
    <RuntimeAccessContext value={query.data?.local_browser === true}>
      {children}
    </RuntimeAccessContext>
  );
}
