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
};
