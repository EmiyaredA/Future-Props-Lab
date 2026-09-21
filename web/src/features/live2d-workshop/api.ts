import { api, unwrap, fetchApiJson, fetchApiBlob } from "@platform/api/client";
import type { Asset, CharacterDocument, ExportRequest, Project } from "./types";
const path = (project_id: string) => ({ path: { project_id } });
export const listProjects = async () =>
  unwrap(await api.GET("/v1/live2d-workshop/projects"));
export const createProject = async (title: string) =>
  unwrap(
    await api.POST("/v1/live2d-workshop/projects", {
      body: { title, width: 1200, height: 1600 },
    }),
  );
export const getProject = async (id: string) =>
  unwrap(
    await api.GET("/v1/live2d-workshop/projects/{project_id}", {
      params: path(id),
    }),
  );
export const renameProject = async (
  id: string,
  expectedRevision: number,
  title: string,
) =>
  unwrap(
    await api.PATCH("/v1/live2d-workshop/projects/{project_id}", {
      params: path(id),
      body: { title, expectedRevision },
    }),
  );
export const deleteProject = async (id: string, expectedRevision: number) =>
  unwrap(
    await api.DELETE("/v1/live2d-workshop/projects/{project_id}", {
      params: { ...path(id), query: { expectedRevision } },
    }),
  );
export const getDocument = async (id: string) =>
  unwrap(
    await api.GET("/v1/live2d-workshop/projects/{project_id}/document", {
      params: path(id),
    }),
  );
export const saveDocument = async (
  id: string,
  expectedRevision: number,
  document: CharacterDocument,
) =>
  unwrap(
    await api.PUT("/v1/live2d-workshop/projects/{project_id}/document", {
      params: path(id),
      body: { expectedRevision, document },
    }),
  );
export const listAssets = async (id: string) =>
  unwrap(
    await api.GET("/v1/live2d-workshop/projects/{project_id}/assets", {
      params: path(id),
    }),
  );
export const listExports = async (id: string) =>
  unwrap(
    await api.GET("/v1/live2d-workshop/projects/{project_id}/exports", {
      params: path(id),
    }),
  );
export const preflight = async (id: string, body: ExportRequest) =>
  unwrap(
    await api.POST(
      "/v1/live2d-workshop/projects/{project_id}/exports/preflight",
      { params: path(id), body },
    ),
  );
export const createExport = async (id: string, body: ExportRequest) =>
  unwrap(
    await api.POST("/v1/live2d-workshop/projects/{project_id}/exports", {
      params: path(id),
      body,
    }),
  );
export const cancelExport = async (id: string, task_id: string) =>
  unwrap(
    await api.POST(
      "/v1/live2d-workshop/projects/{project_id}/exports/{task_id}/cancel",
      { params: { path: { project_id: id, task_id } } },
    ),
  );
export async function uploadAsset(id: string, file: File): Promise<Asset> {
  const body = new FormData();
  body.append("file", file);
  return fetchApiJson(
    `/v1/live2d-workshop/projects/${encodeURIComponent(id)}/assets`,
    { method: "POST", body },
  );
}
export async function importProject(file: File): Promise<Project> {
  const body = new FormData();
  body.append("file", file);
  return fetchApiJson("/v1/live2d-workshop/projects/import", {
    method: "POST",
    body,
  });
}
export async function download(url: string, filename: string) {
  const blob = await fetchApiBlob(url);
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
export const downloadProject = (id: string) =>
  download(
    `/v1/live2d-workshop/projects/${encodeURIComponent(id)}/package`,
    "character.fpllive2d",
  );
