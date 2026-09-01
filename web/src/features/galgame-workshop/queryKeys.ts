import type { QueryClient } from "@tanstack/react-query";

export const galgameQueryKeys = {
  projects: ["galgame-workshop-projects"] as const,
  project: (projectId: string) =>
    ["galgame-workshop-project", projectId] as const,
  story: (projectId: string) => ["galgame-workshop-story", projectId] as const,
  storyReport: (projectId: string) =>
    ["galgame-workshop-story-report", projectId] as const,
  projectAssets: (projectId: string, query?: string) =>
    query === undefined
      ? (["galgame-project-assets", projectId] as const)
      : (["galgame-project-assets", projectId, query] as const),
  assetOverview: (projectId: string) =>
    ["galgame-asset-overview", projectId] as const,
  packageManifest: (projectId: string) =>
    ["galgame-package-manifest", projectId] as const,
  videoExports: (projectId: string) =>
    ["galgame-video-exports", projectId] as const,
};

export function invalidateGalgameAssetQueries(
  client: QueryClient,
  projectId: string,
) {
  return Promise.all([
    client.invalidateQueries({
      queryKey: galgameQueryKeys.projectAssets(projectId),
    }),
    client.invalidateQueries({
      queryKey: galgameQueryKeys.assetOverview(projectId),
    }),
    client.invalidateQueries({
      queryKey: galgameQueryKeys.packageManifest(projectId),
    }),
  ]);
}
