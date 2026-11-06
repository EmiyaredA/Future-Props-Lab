import { useQuery } from "@tanstack/react-query";
import { browseProjectDirectories } from "./executionApi";
import { workbenchKeys } from "./queryKeys";

export function useProjectDirectories(
  owner: string,
  parent?: string,
  enabled = true,
) {
  return useQuery({
    queryKey: workbenchKeys.directories(owner, parent),
    queryFn: ({ signal }) => browseProjectDirectories(parent, signal),
    enabled,
    retry: false,
    staleTime: 30_000,
  });
}
