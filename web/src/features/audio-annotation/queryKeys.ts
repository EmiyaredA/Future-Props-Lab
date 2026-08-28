export const audioAnnotationQueryKeys = {
  projects: ["audio-annotation-projects"] as const,
  projectList: (query: string) => ["audio-annotation-projects", query] as const,
  libraryAudio: (query: string) =>
    ["audio-annotation-library-audio", query] as const,
  project: (projectId: string) =>
    ["audio-annotation-project", projectId] as const,
  document: (projectId: string) =>
    ["audio-annotation-document", projectId] as const,
  waveform: (projectId: string) =>
    ["audio-annotation-waveform", projectId] as const,
  speakerImportProjects: ["galgame-speaker-import-projects"] as const,
  speakerImportStory: (projectId: string) =>
    ["galgame-speaker-import-story", projectId] as const,
};
