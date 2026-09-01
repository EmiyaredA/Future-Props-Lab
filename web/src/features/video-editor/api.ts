import type { components } from "@generated/api";
import {
  api,
  fetchApiDownload,
  fetchApiJson,
  unwrap,
} from "@platform/api/client";
import type {
  VideoEditorOperation,
  VideoEditorPreset,
  VideoEditorProject,
  VideoEditorSegmentExportInput,
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

export const exportVideoEditorProjectSnapshot = (projectId: string) =>
  fetchApiDownload(
    `/v1/video-editor/projects/${encodeURIComponent(projectId)}/snapshot`,
  );

export function importVideoEditorProjectSnapshot(file: File) {
  const body = new FormData();
  body.append("file", file);
  return fetchApiJson<
    components["schemas"]["VideoEditorProjectSnapshotImportOut"]
  >("/v1/video-editor/projects/snapshot-imports", { method: "POST", body });
}

export const openVideoEditorProjectFolder = (projectId: string) =>
  fetchApiJson<components["schemas"]["ProjectFolderOpenOut"]>(
    `/v1/video-editor/projects/${encodeURIComponent(projectId)}/open-folder`,
    { method: "POST" },
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

export const deleteVideoEditorAsset = async (
  projectId: string,
  assetId: string,
) =>
  unwrap(
    await api.DELETE(
      "/v1/video-editor/projects/{project_id}/assets/{asset_id}",
      {
        params: { path: { project_id: projectId, asset_id: assetId } },
      },
    ),
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

export const createVideoEditorSegmentExport = async (
  projectId: string,
  body: Omit<VideoEditorSegmentExportInput, "requestId">,
  requestId = crypto.randomUUID(),
) =>
  unwrap(
    await api.POST("/v1/video-editor/projects/{project_id}/segment-exports", {
      params: { path: { project_id: projectId } },
      body: { ...body, requestId },
    }),
  );

export const listVideoEditorSegmentExports = async (projectId: string) =>
  unwrap(
    await api.GET("/v1/video-editor/projects/{project_id}/segment-exports", {
      params: { path: { project_id: projectId } },
    }),
  );

export const getVideoEditorSegmentExport = async (
  projectId: string,
  taskId: string,
) =>
  unwrap(
    await api.GET(
      "/v1/video-editor/projects/{project_id}/segment-exports/{task_id}",
      { params: { path: { project_id: projectId, task_id: taskId } } },
    ),
  );

export const cancelVideoEditorSegmentExport = async (
  projectId: string,
  taskId: string,
) =>
  unwrap(
    await api.POST(
      "/v1/video-editor/projects/{project_id}/segment-exports/{task_id}/cancel",
      { params: { path: { project_id: projectId, task_id: taskId } } },
    ),
  );

export const exactFramePath = (
  projectId: string,
  revision: number,
  timeUs: number,
  width = 960,
) =>
  `/v1/video-editor/projects/${encodeURIComponent(projectId)}/preview/frame?revision=${revision}&timeUs=${Math.max(0, Math.round(timeUs))}&width=${width}`;

export const exactFrameUrl = (
  projectId: string,
  revision: number,
  timeUs: number,
  width = 960,
) =>
  `${import.meta.env.VITE_API_BASE || ""}${exactFramePath(projectId, revision, timeUs, width)}`;
