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
export const retireAsset = async (
  id: string,
  assetId: string,
  expectedRevision: number,
) =>
  unwrap(
    await api.DELETE(
      "/v1/live2d-workshop/projects/{project_id}/assets/{asset_id}",
      {
        params: {
          path: { project_id: id, asset_id: assetId },
          query: { expectedRevision },
        },
      },
    ),
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

export interface CubismAttachment {
  revision: number;
  sha256: string;
  metadata: import("./cubismRuntime").CubismMetadata;
  stateBindings: Record<string, { motion?: string; expression?: string }>;
}

export const getCubism = (id: string) =>
  fetchApiJson<CubismAttachment>(`/v1/live2d-workshop/projects/${encodeURIComponent(id)}/cubism`);

export async function preflightCubism(id: string, file: File) {
  const body = new FormData();
  body.append("file", file);
  return fetchApiJson<import("./cubismRuntime").CubismMetadata>(
    `/v1/live2d-workshop/projects/${encodeURIComponent(id)}/cubism/preflight`,
    { method: "POST", body },
  );
}

export async function attachCubism(id: string, revision: number, file: File) {
  const body = new FormData();
  body.append("file", file);
  body.append("expectedRevision", String(revision));
  return fetchApiJson<CubismAttachment>(
    `/v1/live2d-workshop/projects/${encodeURIComponent(id)}/cubism`,
    { method: "PUT", body },
  );
}

export const saveCubismBindings = (
  id: string,
  revision: number,
  stateBindings: CubismAttachment["stateBindings"],
) => fetchApiJson<CubismAttachment>(
  `/v1/live2d-workshop/projects/${encodeURIComponent(id)}/cubism/bindings`,
  { method: "PUT", body: JSON.stringify({ expectedRevision: revision, stateBindings }),
    headers: { "Content-Type": "application/json" } },
);

export const removeCubism = (id: string, revision: number) =>
  fetchApiJson<{ deleted: boolean }>(
    `/v1/live2d-workshop/projects/${encodeURIComponent(id)}/cubism?expectedRevision=${revision}`,
    { method: "DELETE" },
  );

export const downloadCubism = (id: string) =>
  fetchApiBlob(`/v1/live2d-workshop/projects/${encodeURIComponent(id)}/cubism/package`);

export async function createCubismCopy(id: string, revision: number, nativePackage: Blob, source: Blob, stateBindings: CubismAttachment["stateBindings"]): Promise<Project> {
  const body = new FormData();
  body.append("file", new File([nativePackage], "converted.fpllive2d", { type: "application/zip" }));
  body.append("source", new File([source], "cubism-runtime.zip", { type: "application/zip" }));
  body.append("expectedRevision", String(revision));
  body.append("stateBindings", JSON.stringify(stateBindings));
  return fetchApiJson<Project>(`/v1/live2d-workshop/projects/${encodeURIComponent(id)}/cubism/convert`, { method: "POST", body });
}
