export const videoEditorQueryKeys = {
  projects: ["video-editor-projects"] as const,
  project: (projectId: string) => ["video-editor-project", projectId] as const,
  timeline: (projectId: string) =>
    ["video-editor-timeline", projectId] as const,
  assets: (projectId: string) => ["video-editor-assets", projectId] as const,
  renders: (projectId: string) => ["video-editor-renders", projectId] as const,
  allRenders: (projectIds: unknown) =>
    ["video-editor-all-renders", projectIds] as const,
  importSources: ["video-editor-import-sources"] as const,
};
