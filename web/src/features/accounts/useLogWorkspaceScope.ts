import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspacePermission } from "@platform/auth/WorkspacePermissions";
import { accountQueryKeys } from "./queryKeys";
import {
  fetchLogWorkspaces,
  fetchCrossWorkspaceLogs,
  fetchCrossWorkspaceLogStats,
  type LogOverviewFilters,
} from "./platformApi";

export function useLogWorkspaceScope(current: { id: string; name: string }) {
  const allowed = useWorkspacePermission("logs.cross_workspace");
  const [choice, setChoice] = useState("current");
  const spaces = useQuery({
    queryKey: [...accountQueryKeys.logWorkspaces, current.id],
    queryFn: fetchLogWorkspaces,
    enabled: allowed,
    staleTime: 0,
  });
  const scope = allowed ? choice : "current";
  const all = scope === "all";
  const local = scope === "current";
  const ids = local
    ? [current.id]
    : all
      ? (spaces.data ?? []).map((x) => x.id).sort()
      : [scope];
  return {
    allowed,
    scope,
    all,
    local,
    ids,
    spaces,
    setScope: setChoice,
    options: [
      { value: "current", label: `当前工作区 · ${current.name}` },
      { value: "all", label: "全部工作区" },
      ...(spaces.data ?? [])
        .filter((x) => x.id !== current.id)
        .map((x) => ({ value: x.id, label: x.name })),
    ],
  };
}

export function useCrossWorkspaceLogQueries(
  ids: string[],
  filters: LogOverviewFilters,
  enabled: boolean,
) {
  const list = useQuery({
    queryKey: accountQueryKeys.crossLogs(ids, filters),
    queryFn: () => fetchCrossWorkspaceLogs(ids, filters),
    enabled: enabled && ids.length > 0,
  });
  const stats = useQuery({
    queryKey: accountQueryKeys.crossLogStats(ids),
    queryFn: () => fetchCrossWorkspaceLogStats(ids),
    enabled: enabled && ids.length > 0,
  });
  return { list, stats };
}
