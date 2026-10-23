export const visualWorkshopQueryKeys = {
  acceptanceCatalog: () => ["visual-acceptance-catalog"] as const,
  acceptanceSummary: (project: string) =>
    ["visual-acceptance-summary", project] as const,
  nodeAcceptance: (project: string, node: string, output?: string) =>
    ["visual-node-acceptance", project, node, output ?? "latest"] as const,
  acceptanceTemplates: () => ["visual-acceptance-templates"] as const,
  acceptanceStandard: (id: string) =>
    ["visual-acceptance-standard", id] as const,
  acceptanceRuns: (id: string, page: number) =>
    ["visual-acceptance-runs", id, page] as const,
  acceptanceRun: (id: string, run: string) =>
    ["visual-acceptance-run", id, run] as const,
  acceptanceModels: (id: string) => ["visual-acceptance-models", id] as const,
  acceptanceOutputs: (id: string, node: string, page: number) =>
    ["visual-node-outputs", id, node, "acceptance", page] as const,

  nodeOutput: (projectId: string, nodeId: string, outputId: string) =>
    ["visual-node-output", projectId, nodeId, outputId] as const,
  nodeOutputsProject: (projectId: string) =>
    ["visual-node-outputs", projectId] as const,
  nodeOutputs: (projectId: string, nodeId: string) =>
    ["visual-node-outputs", projectId, nodeId] as const,
  projects: ["visual-workshop-projects"] as const,
  projectsForMediaSource: ["visual-workshop-projects", "media-source"] as const,
  projectsForSegmentTarget: [
    "visual-workshop-projects",
    "segment-target",
  ] as const,
  project: (projectId: string) =>
    ["visual-workshop-project", projectId] as const,
  canvas: (projectId: string) => ["visual-workshop-canvas", projectId] as const,
  generationOptions: ["visual-generation-options"] as const,
  generationTasks: ["visual-generation-tasks"] as const,
  generationBatches: ["visual-generation-batches"] as const,
  generationBatchList: (projectId: string) =>
    ["visual-generation-batches", projectId, "current-nodes"] as const,
  generationBatch: (batchId: string | null | undefined) =>
    ["visual-generation-batch", batchId] as const,
  generationTaskList: (projectId: string, kind: unknown, status: unknown) =>
    ["visual-generation-tasks", projectId, kind, status] as const,
  generationTaskHistory: (projectId: string, canvasNodeId: string) =>
    [
      "visual-generation-tasks",
      projectId,
      "canvas-node",
      canvasNodeId,
    ] as const,
  generationTask: (taskId: string | null | undefined) =>
    ["visual-generation-task", taskId] as const,
  assistantConversations: (projectId: string) =>
    ["visual-assistant-conversations", projectId] as const,
  assistantConversation: (
    projectId: string,
    conversationId: string | null | undefined,
  ) => ["visual-assistant-conversation", projectId, conversationId] as const,
  assistantModels: (projectId: string) =>
    ["visual-assistant-models", projectId] as const,
};
