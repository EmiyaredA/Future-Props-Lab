import type { components } from "@generated/api";
import { api, ApiError, unwrap } from "@platform/api/client";
import { getStudioToken, notifyAuthRequired } from "@platform/api/studioAuth";

export type VisualWorkshopProject =
  components["schemas"]["VisualWorkshopProjectOut"];
export type VisualWorkshopProjectKind =
  components["schemas"]["VisualWorkshopProjectCreateIn"]["kind"];
export type VisualWorkshopProjectStatus = VisualWorkshopProject["status"];
export type VisualCanvasDocument =
  components["schemas"]["VisualCanvasDocumentOut"];
export type VisualCanvasNode = VisualCanvasDocument["nodes"][number];
export type VisualCanvasImageGenerationDraft =
  components["schemas"]["VisualCanvasImageGenerationDraft"];
export type VisualCanvasVideoGenerationDraft =
  components["schemas"]["VisualCanvasVideoGenerationDraft"];
export type VisualCanvasGenerationDraft =
  VisualCanvasImageGenerationDraft | VisualCanvasVideoGenerationDraft;
export type GenerationOptions = components["schemas"]["GenerationOptionsOut"];
export type GenerationTask = components["schemas"]["GenerationTaskOut"];
export type GenerationTaskStatus = GenerationTask["status"];
export type ImageGenerationTaskInput =
  components["schemas"]["ImageGenerationTaskCreateIn"];
export type VideoGenerationTaskInput =
  components["schemas"]["VideoGenerationTaskCreateIn"];
export type GenerationTaskInput =
  ImageGenerationTaskInput | VideoGenerationTaskInput;
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

export async function getVisualCanvas(projectId: string) {
  return unwrap(
    await api.GET("/v1/visual-workshop/projects/{project_id}/canvas", {
      params: { path: { project_id: projectId } },
    }),
  );
}

export async function putVisualCanvas(
  projectId: string,
  nodes: VisualCanvasNode[],
  expectedRevision: number,
) {
  return unwrap(
    await api.PUT("/v1/visual-workshop/projects/{project_id}/canvas", {
      params: { path: { project_id: projectId } },
      body: { nodes, expected_revision: expectedRevision },
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
    kind?: "image" | "video";
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
  const base = String(import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");
  const token = getStudioToken();
  const response = await fetch(
    `${base}/v1/visual-workshop/projects/${encodeURIComponent(projectId)}` +
      `/conversations/${encodeURIComponent(conversationId)}/messages/stream`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...(token ? { "X-Studio-Token": token } : {}),
      },
      body: JSON.stringify(body),
      signal,
    },
  );
  if (response.status === 401) notifyAuthRequired();
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const detail = problem.detail as
      Record<string, unknown> | string | undefined;
    throw new ApiError(
      typeof detail === "object"
        ? String(detail.message || "对话请求失败")
        : String(detail || problem.message || "对话请求失败"),
      problem,
      response.status,
    );
  }
  if (!response.body) throw new Error("浏览器不支持流式响应");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const data = frame
        .split("\n")
        .find((line) => line.startsWith("data:"))
        ?.slice(5)
        .trim();
      if (data) onEvent(JSON.parse(data) as VisualAssistantStreamEvent);
    }
    if (done) break;
  }
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
