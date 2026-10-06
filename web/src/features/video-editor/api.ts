import type { paths } from "@generated/api";
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
  VideoEditorTask,
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

export const listVideoEditorAssets = async (
  projectId: string,
  signal?: AbortSignal,
) =>
  unwrap(
    await api.GET("/v1/video-editor/projects/{project_id}/assets", {
      params: { path: { project_id: projectId } },
      signal,
    }),
  );

export const findAudioSeamCandidates = async (
  projectId: string,
  expectedRevision: number,
  fromClipId: string,
  toClipId: string,
) =>
  unwrap(
    await api.POST(
      "/v1/video-editor/projects/{project_id}/audio-seams/candidates",
      {
        params: { path: { project_id: projectId } },
        body: { expectedRevision, fromClipId, toClipId },
      },
    ),
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

const updateVideoEditorAsset = async (
  projectId: string,
  assetId: string,
  expectedRevision: number,
  changes: Omit<
    components["schemas"]["VideoEditorAssetPatchIn"],
    "expectedRevision"
  >,
) =>
  unwrap(
    await api.PATCH(
      "/v1/video-editor/projects/{project_id}/assets/{asset_id}",
      {
        params: { path: { project_id: projectId, asset_id: assetId } },
        body: { expectedRevision, ...changes },
      },
    ),
  );

export const patchVideoEditorAsset = (
  projectId: string,
  assetId: string,
  expectedRevision: number,
  defaultEffects: components["schemas"]["VideoEditorDefaultEffects"],
) =>
  updateVideoEditorAsset(projectId, assetId, expectedRevision, {
    defaultEffects,
  });

export const renameVideoEditorAsset = (
  projectId: string,
  assetId: string,
  expectedRevision: number,
  displayName: string,
) =>
  updateVideoEditorAsset(projectId, assetId, expectedRevision, { displayName });

export const createVideoEditorAssetBake = async (
  projectId: string,
  assetId: string,
  expectedRevision: number,
  requestId = crypto.randomUUID(),
  effects?: components["schemas"]["VideoEditorDefaultEffects"],
) =>
  unwrap(
    await api.POST(
      "/v1/video-editor/projects/{project_id}/assets/{asset_id}/bakes",
      {
        params: { path: { project_id: projectId, asset_id: assetId } },
        body: {
          expectedRevision,
          requestId,
          ...(effects ? { effects } : {}),
        },
      },
    ),
  );

export const getVideoEditorAssetBake = async (
  projectId: string,
  taskId: string,
) =>
  unwrap(
    await api.GET(
      "/v1/video-editor/projects/{project_id}/asset-bakes/{task_id}",
      {
        params: { path: { project_id: projectId, task_id: taskId } },
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

export async function uploadVideoEditorAsset(
  projectId: string,
  file: File,
  signal?: AbortSignal,
) {
  const form = new FormData();
  form.append("upload", file);
  return fetchApiJson<components["schemas"]["VideoEditorAssetOut"]>(
    `/v1/video-editor/projects/${encodeURIComponent(projectId)}/assets`,
    { method: "POST", body: form, signal },
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

export const deleteVideoEditorRender = async (task: VideoEditorTask) =>
  unwrap(
    await api.DELETE(
      "/v1/video-editor/projects/{project_id}/renders/{task_id}",
      {
        params: {
          path: { project_id: task.projectId, task_id: task.id },
          query: { expected_revision: task.revision },
        },
      },
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
  withoutChromaClipId?: string,
) =>
  `/v1/video-editor/projects/${encodeURIComponent(projectId)}/preview/frame?revision=${revision}&timeUs=${Math.max(0, Math.round(timeUs))}&width=${width}&renderVersion=5${withoutChromaClipId ? `&withoutChromaClipId=${encodeURIComponent(withoutChromaClipId)}` : ""}`;

export const exactFrameUrl = (
  projectId: string,
  revision: number,
  timeUs: number,
  width = 960,
  withoutChromaClipId?: string,
) =>
  `${import.meta.env.VITE_API_BASE || ""}${exactFramePath(projectId, revision, timeUs, width, withoutChromaClipId)}`;

export const downloadVideoEditorSegments = (
  projectId: string,
  taskId: string,
) =>
  fetchApiDownload(
    `/v1/video-editor/projects/${encodeURIComponent(projectId)}/segment-exports/${encodeURIComponent(taskId)}/download`,
  );

export const textLayerPath = (
  projectId: string,
  clipId: string,
  revision: number,
) => {
  const path =
    "/v1/video-editor/projects/{project_id}/text-clips/{clip_id}/layer" satisfies keyof paths;
  return `${path.replace("{project_id}", encodeURIComponent(projectId)).replace("{clip_id}", encodeURIComponent(clipId))}?revision=${revision}&renderVersion=2`;
};
