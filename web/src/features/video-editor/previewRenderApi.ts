import { api, unwrap } from "@platform/api/client";
import type { components } from "@generated/api";

export type PreviewRender =
  components["schemas"]["VideoEditorPreviewRenderOut"];
export const listPreviewRenders = async (projectId: string) =>
  unwrap(
    await api.GET("/v1/video-editor/projects/{project_id}/preview/renders", {
      params: { path: { project_id: projectId } },
    }),
  );
export const createPreviewRender = async (
  projectId: string,
  revision: number,
) =>
  unwrap(
    await api.POST("/v1/video-editor/projects/{project_id}/preview/renders", {
      params: { path: { project_id: projectId } },
      body: { expectedRevision: revision, requestId: crypto.randomUUID() },
    }),
  );
export const cancelPreviewRender = async (projectId: string, taskId: string) =>
  unwrap(
    await api.POST(
      "/v1/video-editor/projects/{project_id}/preview/renders/{task_id}/cancel",
      {
        params: { path: { project_id: projectId, task_id: taskId } },
      },
    ),
  );
export const clearPreviewRenders = async (projectId: string) =>
  unwrap(
    await api.DELETE("/v1/video-editor/projects/{project_id}/preview/renders", {
      params: { path: { project_id: projectId } },
    }),
  );

export function previewMediaUrl(path: string) {
  return `${String(import.meta.env.VITE_API_BASE || "").replace(/\/$/, "")}${path}`;
}
