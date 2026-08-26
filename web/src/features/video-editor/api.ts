import { api, fetchApiJson, unwrap } from "@platform/api/client";
import type {
  VideoEditorOperation,
  VideoEditorPreset,
  VideoEditorProject,
} from "./types";

export const listVideoEditorProjects = async () =>
  unwrap(await api.GET("/v1/video-editor/projects"));

export const getVideoEditorProject = async (projectId: string) =>
  unwrap(
    await api.GET("/v1/video-editor/projects/{project_id}", {
      params: { path: { project_id: projectId } },
    }),
  );

export const createVideoEditorProject = async (title = "未命名剪辑") =>
  unwrap(await api.POST("/v1/video-editor/projects", { body: { title } }));

export const patchVideoEditorProject = async (
  project: VideoEditorProject,
  changes: Partial<Pick<VideoEditorProject, "title" | "status">>,
) =>
  unwrap(
    await api.PATCH("/v1/video-editor/projects/{project_id}", {
      params: { path: { project_id: project.id } },
      body: { expectedRevision: project.revision, ...changes },
    }),
  );

export const deleteVideoEditorProject = async (project: VideoEditorProject) =>
  unwrap(
    await api.DELETE("/v1/video-editor/projects/{project_id}", {
      params: {
        path: { project_id: project.id },
        query: { expected_revision: project.revision },
      },
    }),
  );

export const getVideoEditorTimeline = async (projectId: string) =>
  unwrap(
    await api.GET("/v1/video-editor/projects/{project_id}/timeline", {
      params: { path: { project_id: projectId } },
    }),
  );

export const applyVideoEditorOperations = async (
  projectId: string,
  expectedRevision: number,
  operations: VideoEditorOperation[],
  requestId = crypto.randomUUID(),
) =>
  unwrap(
    await api.POST(
      "/v1/video-editor/projects/{project_id}/timeline/operations",
      {
        params: { path: { project_id: projectId } },
        body: { expectedRevision, requestId, operations },
      },
    ),
  );

export const listVideoEditorAssets = async (projectId: string) =>
  unwrap(
    await api.GET("/v1/video-editor/projects/{project_id}/assets", {
      params: { path: { project_id: projectId } },
    }),
  );

export const listVideoEditorImportSources = async () =>
  unwrap(await api.GET("/v1/video-editor/import-sources"));

export const importVideoEditorAssets = async (
  projectId: string,
  assetIds: string[],
) =>
  unwrap(
    await api.POST("/v1/video-editor/projects/{project_id}/assets/import", {
      params: { path: { project_id: projectId } },
      body: { assetIds },
    }),
  );

export async function uploadVideoEditorAsset(projectId: string, file: File) {
  const form = new FormData();
  form.append("upload", file);
  return fetchApiJson(
    `/v1/video-editor/projects/${encodeURIComponent(projectId)}/assets`,
    { method: "POST", body: form },
  );
}

export const renderPreflight = async (
  projectId: string,
  expectedRevision: number,
  preset: VideoEditorPreset,
) =>
  unwrap(
    await api.POST("/v1/video-editor/projects/{project_id}/renders/preflight", {
      params: { path: { project_id: projectId } },
      body: { expectedRevision, preset, startUs: 0 },
    }),
  );

export const createVideoEditorRender = async (
  projectId: string,
  expectedRevision: number,
  preset: VideoEditorPreset,
  previewFingerprint: string,
) =>
  unwrap(
    await api.POST("/v1/video-editor/projects/{project_id}/renders", {
      params: { path: { project_id: projectId } },
      body: {
        expectedRevision,
        preset,
        startUs: 0,
        previewFingerprint,
        requestId: crypto.randomUUID(),
      },
    }),
  );

export const listVideoEditorRenders = async (projectId: string) =>
  unwrap(
    await api.GET("/v1/video-editor/projects/{project_id}/renders", {
      params: { path: { project_id: projectId } },
    }),
  );

export const cancelVideoEditorRender = async (
  projectId: string,
  taskId: string,
) =>
  unwrap(
    await api.POST(
      "/v1/video-editor/projects/{project_id}/renders/{task_id}/cancel",
      { params: { path: { project_id: projectId, task_id: taskId } } },
    ),
  );

export const exactFrameUrl = (
  projectId: string,
  revision: number,
  timeUs: number,
  width = 960,
) =>
  `${import.meta.env.VITE_API_BASE || ""}/v1/video-editor/projects/${encodeURIComponent(projectId)}/preview/frame?revision=${revision}&timeUs=${Math.max(0, Math.round(timeUs))}&width=${width}`;
