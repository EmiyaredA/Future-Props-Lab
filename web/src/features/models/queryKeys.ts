export const modelQueryKeys = {
  localModels: ["model-local-models"] as const,
  localModelActions: ["model-local-model-actions"] as const,
  inferenceOptions: ["model-inference-options"] as const,
  inferenceTasks: ["model-inference-tasks"] as const,
  catalog: ["model-catalog"] as const,
  catalogFor: (consumer: string) => ["model-catalog", consumer] as const,
  categories: ["model-categories"] as const,
  logs: ["model-logs"] as const,
  logList: (filters: unknown) => ["model-logs", filters] as const,
  log: (id: string) => ["model-log", id] as const,
  logStats: ["model-log-stats"] as const,
  conversations: ["model-test-conversations"] as const,
  conversation: (id: string | null) => ["model-test-conversation", id] as const,
  tools: ["model-test-tools"] as const,
  tool: (id: string) => ["model-test-tool", id] as const,
  realtimeOptions: ["model-test-realtime-options"] as const,
  generationOptions: ["model-test-generation-options"] as const,
  generationTasks: (modelId: string) =>
    ["model-test-generation-tasks", modelId] as const,
  generationAssetBackfill: ["model-test-generation-asset-backfill"] as const,
  transcriptionOptions: ["model-test-transcription-options"] as const,
  transcriptionTasks: (modelId: string) =>
    ["model-test-transcription-tasks", modelId] as const,
  libraryFolders: ["model-test-library-folders"] as const,
  libraryAudio: (folderId: string | undefined, search: string) =>
    ["model-test-library-audio", folderId, search] as const,
};
