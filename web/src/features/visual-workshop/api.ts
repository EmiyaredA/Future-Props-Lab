import type { components } from "@generated/api";
import {
  api,
  fetchApiDownload,
  fetchApiJson,
  unwrap,
} from "@platform/api/client";
import { postSse } from "@platform/api/sse";

export type VisualWorkshopProject =
  components["schemas"]["VisualWorkshopProjectOut"];
export type VisualWorkshopProjectKind =
  components["schemas"]["VisualWorkshopProjectCreateIn"]["kind"];
export type VisualWorkshopProjectStatus = VisualWorkshopProject["status"];
export type VisualProjectSnapshotImport =
  components["schemas"]["VisualProjectSnapshotImportOut"];
export type VisualCanvasDocument =
  components["schemas"]["VisualCanvasDocumentOut"];
export type VisualCanvasNode = VisualCanvasDocument["nodes"][number];
export type VisualCanvasEdge = VisualCanvasDocument["edges"][number];
export type VisualCanvasImageGenerationDraft =
  components["schemas"]["VisualCanvasImageGenerationDraft"];
export type VisualCanvasVideoGenerationDraft =
  components["schemas"]["VisualCanvasVideoGenerationDraft"];
export type VisualCanvasAudioGenerationDraft =
  components["schemas"]["VisualCanvasAudioGenerationDraft"];
export type VisualCanvasGenerationDraft =
  | VisualCanvasImageGenerationDraft
  | VisualCanvasVideoGenerationDraft
  | VisualCanvasAudioGenerationDraft;
export type GenerationOptions = components["schemas"]["GenerationOptionsOut"];
export type GenerationTask = components["schemas"]["GenerationTaskOut"];
export type GenerationTaskStatus = GenerationTask["status"];
export type ImageGenerationTaskInput =
  components["schemas"]["ImageGenerationTaskCreateIn"];
export type VideoGenerationTaskInput =
  components["schemas"]["VideoGenerationTaskCreateIn"];
export type AudioGenerationTaskInput =
  components["schemas"]["AudioGenerationTaskCreateIn"];
export type GenerationTaskInput =
  | ImageGenerationTaskInput
  | VideoGenerationTaskInput
  | AudioGenerationTaskInput;
export type VisualAssistantConversation =
  components["schemas"]["VisualAssistantConversationOut"];
export type VisualAssistantConversationSummary =
  components["schemas"]["VisualAssistantConversationSummaryOut"];
export type VisualAssistantMessage =
  components["schemas"]["VisualAssistantMessageOut"];
export type VisualAssistantAction =
  components["schemas"]["VisualAssistantActionOut"];
export type VisualAssistantAsset =
  components["schemas"]["VisualAssistantAssetOut"];
export type VisualAssistantContentPart = NonNullable<
  components["schemas"]["VisualAssistantMessageOut"]["content_parts"]
>[number];
export type VisualAssistantModelOption =
  components["schemas"]["VisualAssistantModelOptionOut"];
export type VisualAssistantStreamEvent = {
  type:
    | "start"
    | "delta"
    | "step"
    | "approval_required"
    | "approval_resolved"
    | "canvas_updated"
    | "generation_task_created"
    | "done"
    | "error";
  schema_version: 2;
  sequence: number;
  payload: Record<string, unknown>;
};

export async function getVisualWorkshopProjects() {
  return unwrap(await api.GET("/v1/visual-workshop/projects"));
}

export async function getVisualWorkshopProject(projectId: string) {
  return unwrap(
    await api.GET("/v1/visual-workshop/projects/{project_id}", {
      params: { path: { project_id: projectId } },
    }),
  );
}

export async function createVisualWorkshopProject(
  title: string,
  kind: VisualWorkshopProjectKind,
) {
  return unwrap(
    await api.POST("/v1/visual-workshop/projects", {
      body: { title, kind },
    }),
  );
}

export async function patchVisualWorkshopProject(
  project: VisualWorkshopProject,
  changes: Partial<Pick<VisualWorkshopProject, "title" | "kind" | "status">>,
) {
  return unwrap(
    await api.PATCH("/v1/visual-workshop/projects/{project_id}", {
      params: { path: { project_id: project.id } },
      body: { ...changes, expected_revision: project.revision },
    }),
  );
}

export async function deleteVisualWorkshopProject(
  project: VisualWorkshopProject,
) {
  return unwrap(
    await api.DELETE("/v1/visual-workshop/projects/{project_id}", {
      params: {
        path: { project_id: project.id },
        query: { expected_revision: project.revision },
      },
    }),
  );
}

export function exportVisualWorkshopProjectSnapshot(projectId: string) {
  return fetchApiDownload(
    `/v1/visual-workshop/projects/${encodeURIComponent(projectId)}/snapshot`,
  );
}

export function importVisualWorkshopProjectSnapshot(file: File) {
  const body = new FormData();
  body.append("file", file);
  return fetchApiJson<VisualProjectSnapshotImport>(
    "/v1/visual-workshop/projects/snapshot-imports",
    { method: "POST", body },
  );
}

export function openVisualWorkshopProjectFolder(projectId: string) {
  return fetchApiJson<components["schemas"]["ProjectFolderOpenOut"]>(
    `/v1/visual-workshop/projects/${encodeURIComponent(projectId)}/open-folder`,
    { method: "POST" },
  );
}

export async function getVisualCanvas(projectId: string) {
  return unwrap(
    await api.GET("/v1/visual-workshop/projects/{project_id}/canvas", {
      params: { path: { project_id: projectId } },
    }),
  );
}

export function visualAssetDownloadPath(
  assetId: string,
  downloadName?: string,
) {
  const path = `/v1/files/${encodeURIComponent(assetId)}/download`;
  return downloadName
    ? `${path}?download_name=${encodeURIComponent(downloadName)}`
    : path;
}

export async function putVisualCanvas(
  projectId: string,
  nodes: VisualCanvasNode[],
  expectedRevision: number,
  edges: VisualCanvasEdge[] = [],
) {
  return unwrap(
    await api.PUT("/v1/visual-workshop/projects/{project_id}/canvas", {
      params: { path: { project_id: projectId } },
      body: { nodes, edges, expected_revision: expectedRevision },
    }),
  );
}

export async function getGenerationOptions() {
  return unwrap(await api.GET("/v1/visual-workshop/generation-options"));
}

export async function createGenerationTask(
  projectId: string,
  body: GenerationTaskInput,
) {
  return unwrap(
    await api.POST(
      "/v1/visual-workshop/projects/{project_id}/generation-tasks",
      {
        params: { path: { project_id: projectId } },
        body,
      },
    ),
  );
}

export async function getGenerationTasks(
  filters: {
    projectId?: string;
    canvasNodeId?: string;
    kind?: "image" | "video" | "audio";
    status?: GenerationTaskStatus;
    page?: number;
    pageSize?: number;
  } = {},
) {
  return unwrap(
    await api.GET("/v1/visual-workshop/generation-tasks", {
      params: {
        query: {
          project_id: filters.projectId,
          canvas_node_id: filters.canvasNodeId,
          kind: filters.kind,
          status: filters.status,
          page: filters.page ?? 1,
          page_size: filters.pageSize ?? 50,
        },
      },
    }),
  );
}

export async function getGenerationTask(taskId: string) {
  return unwrap(
    await api.GET("/v1/visual-workshop/generation-tasks/{task_id}", {
      params: { path: { task_id: taskId } },
    }),
  );
}

export async function retryGenerationMaterialization(taskId: string) {
  return unwrap(
    await api.POST(
      "/v1/visual-workshop/generation-tasks/{task_id}/retry-materialization",
      { params: { path: { task_id: taskId } } },
    ),
  );
}

export async function getVisualAssistantConversations(projectId: string) {
  return unwrap(
    await api.GET("/v1/visual-workshop/projects/{project_id}/conversations", {
      params: { path: { project_id: projectId } },
    }),
  );
}

export async function createVisualAssistantConversation(projectId: string) {
  return unwrap(
    await api.POST("/v1/visual-workshop/projects/{project_id}/conversations", {
      params: { path: { project_id: projectId } },
    }),
  );
}

export async function getVisualAssistantConversation(
  projectId: string,
  conversationId: string,
) {
  return unwrap(
    await api.GET(
      "/v1/visual-workshop/projects/{project_id}/conversations/{conversation_id}",
      {
        params: {
          path: {
            project_id: projectId,
            conversation_id: conversationId,
          },
        },
      },
    ),
  );
}

export async function getVisualAssistantModels(projectId: string) {
  return unwrap(
    await api.GET(
      "/v1/visual-workshop/projects/{project_id}/conversations/models",
      { params: { path: { project_id: projectId } } },
    ),
  );
}

export async function patchVisualAssistantConversation(
  projectId: string,
  conversationId: string,
  expectedRevision: number,
  changes: {
    title?: string;
    model_id?: string | null;
    image_model_id?: string | null;
    video_model_id?: string | null;
  },
) {
  return unwrap(
    await api.PATCH(
      "/v1/visual-workshop/projects/{project_id}/conversations/{conversation_id}",
      {
        params: {
          path: {
            project_id: projectId,
            conversation_id: conversationId,
          },
        },
        body: { expected_revision: expectedRevision, ...changes },
      },
    ),
  );
}

export async function deleteVisualAssistantConversation(
  projectId: string,
  conversationId: string,
  expectedRevision: number,
) {
  return unwrap(
    await api.DELETE(
      "/v1/visual-workshop/projects/{project_id}/conversations/{conversation_id}",
      {
        params: {
          path: {
            project_id: projectId,
            conversation_id: conversationId,
          },
          query: { expected_revision: expectedRevision },
        },
      },
    ),
  );
}

export async function streamVisualAssistant(
  projectId: string,
  conversationId: string,
  body: {
    expected_revision: number;
    canvas_revision: number;
    content?: string;
    asset_ids?: string[];
    content_parts?: VisualAssistantContentPart[];
  },
  signal: AbortSignal,
  onEvent: (event: VisualAssistantStreamEvent) => void,
) {
  await postSse<VisualAssistantStreamEvent>({
    path:
      `/v1/visual-workshop/projects/${encodeURIComponent(projectId)}` +
      `/conversations/${encodeURIComponent(conversationId)}/messages/stream`,
    body,
    signal,
    onEvent,
    defaultErrorMessage: "对话请求失败",
  });
}

export async function resolveVisualAssistantApproval(
  projectId: string,
  conversationId: string,
  runId: string,
  approvalId: string,
  decision: "approve" | "reject",
  canvasRevision: number,
) {
  return unwrap(
    await api.POST(
      "/v1/visual-workshop/projects/{project_id}/conversations/{conversation_id}/runs/{run_id}/approvals/{approval_id}",
      {
        params: {
          path: {
            project_id: projectId,
            conversation_id: conversationId,
            run_id: runId,
            approval_id: approvalId,
          },
        },
        body: { decision, canvas_revision: canvasRevision },
      },
    ),
  );
}
