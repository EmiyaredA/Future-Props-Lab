import type { components } from "@generated/api";
import { api, unwrap } from "@platform/api/client";

export type VisualWorkshopProject =
  components["schemas"]["VisualWorkshopProjectOut"];
export type VisualWorkshopProjectKind =
  components["schemas"]["VisualWorkshopProjectCreateIn"]["kind"];
export type VisualWorkshopProjectStatus = VisualWorkshopProject["status"];
export type VisualCanvasDocument =
  components["schemas"]["VisualCanvasDocumentOut"];
export type VisualCanvasNode = VisualCanvasDocument["nodes"][number];
export type GenerationOptions = components["schemas"]["GenerationOptionsOut"];
export type GenerationTask = components["schemas"]["GenerationTaskOut"];
export type GenerationTaskStatus = GenerationTask["status"];
export type ImageGenerationTaskInput =
  components["schemas"]["ImageGenerationTaskCreateIn"];
export type VideoGenerationTaskInput =
  components["schemas"]["VideoGenerationTaskCreateIn"];
export type GenerationTaskInput =
  ImageGenerationTaskInput | VideoGenerationTaskInput;

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
