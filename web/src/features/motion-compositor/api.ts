import type { components } from "@generated/api";
import {
  api,
  fetchApiDownload,
  fetchApiJson,
  unwrap,
} from "@platform/api/client";
import type { MotionFormat, MotionOperation } from "./types";

export const listProjects = async () =>
  unwrap(await api.GET("/v1/motion-compositor/projects"));

export const createProject = async (
  body: components["schemas"]["ProjectCreateIn"],
) => unwrap(await api.POST("/v1/motion-compositor/projects", { body }));

export const getProject = async (projectId: string) =>
  unwrap(
    await api.GET("/v1/motion-compositor/projects/{project_id}", {
      params: { path: { project_id: projectId } },
    }),
  );

export const patchProject = async (
  projectId: string,
  revision: number,
  title: string,
) =>
  unwrap(
    await api.PATCH("/v1/motion-compositor/projects/{project_id}", {
      params: { path: { project_id: projectId } },
      body: { expectedRevision: revision, title },
    }),
  );

export const deleteProject = async (projectId: string, revision: number) =>
  unwrap(
    await api.DELETE("/v1/motion-compositor/projects/{project_id}", {
      params: {
        path: { project_id: projectId },
        query: { expectedRevision: revision },
      },
    }),
  );

export const getDocument = async (projectId: string) =>
  unwrap(
    await api.GET("/v1/motion-compositor/projects/{project_id}/document", {
      params: { path: { project_id: projectId } },
    }),
  );

export const applyOperations = async (
  projectId: string,
  revision: number,
  operations: MotionOperation[],
  requestId = crypto.randomUUID(),
) =>
  unwrap(
    await api.POST(
      "/v1/motion-compositor/projects/{project_id}/document/operations",
      {
        params: { path: { project_id: projectId } },
        body: { expectedRevision: revision, requestId, operations },
      },
    ),
  );

export const listAssets = async (projectId: string) =>
  unwrap(
    await api.GET("/v1/motion-compositor/projects/{project_id}/assets", {
      params: { path: { project_id: projectId } },
    }),
  );

export const listImportSources = async () =>
  unwrap(await api.GET("/v1/motion-compositor/import-sources"));

export const importAssets = async (projectId: string, assetIds: string[]) =>
  unwrap(
    await api.POST(
      "/v1/motion-compositor/projects/{project_id}/assets/import",
      {
        params: { path: { project_id: projectId } },
        body: { assetIds },
      },
    ),
  );

export async function uploadAsset(projectId: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  return fetchApiJson<components["schemas"]["AssetOut"]>(
    `/v1/motion-compositor/projects/${encodeURIComponent(projectId)}/assets`,
    { method: "POST", body: form },
  );
}

export const createExport = async (
  projectId: string,
  expectedRevision: number,
  formats: MotionFormat[],
  startFrame: number,
  endFrame: number,
) =>
  unwrap(
    await api.POST("/v1/motion-compositor/projects/{project_id}/exports", {
      params: { path: { project_id: projectId } },
      body: {
        expectedRevision,
        requestId: crypto.randomUUID(),
        formats,
        startFrame,
        endFrame,
      },
    }),
  );

export const listExports = async (projectId: string) =>
  unwrap(
    await api.GET("/v1/motion-compositor/projects/{project_id}/exports", {
      params: { path: { project_id: projectId } },
    }),
  );

export const listVideoTargets = async () =>
  unwrap(await api.GET("/v1/video-editor/projects"));

export const cancelExport = async (projectId: string, taskId: string) =>
  unwrap(
    await api.POST(
      "/v1/motion-compositor/projects/{project_id}/exports/{task_id}/cancel",
      {
        params: { path: { project_id: projectId, task_id: taskId } },
      },
    ),
  );

export const sendToEditor = async (
  projectId: string,
  taskId: string,
  body: components["schemas"]["HandoffIn"],
) =>
  unwrap(
    await api.POST(
      "/v1/motion-compositor/projects/{project_id}/exports/{task_id}/video-editor-handoffs",
      {
        params: { path: { project_id: projectId, task_id: taskId } },
        body,
      },
    ),
  );

export const downloadExport = (
  projectId: string,
  taskId: string,
  format: MotionFormat,
) =>
  fetchApiDownload(
    `/v1/motion-compositor/projects/${encodeURIComponent(projectId)}/exports/${encodeURIComponent(taskId)}/download/${format}`,
  );

export const downloadSnapshot = (projectId: string) =>
  fetchApiDownload(
    `/v1/motion-compositor/projects/${encodeURIComponent(projectId)}/snapshot`,
  );

export async function importSnapshot(file: File) {
  const form = new FormData();
  form.append("file", file);
  return fetchApiJson<components["schemas"]["ProjectOut"]>(
    "/v1/motion-compositor/projects/snapshot-imports",
    { method: "POST", body: form },
  );
}
