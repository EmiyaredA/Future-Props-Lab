import { api, fetchApiBlob, fetchApiJson, unwrap } from "@platform/api/client";
import { externalizeTree, hydrateTree } from "./documentFiles";

async function uploadBytes(path: string, bytes: Uint8Array) {
  const body = new FormData();
  body.append("upload", new Blob([bytes]), "asset");
  const saved = await fetchApiJson<{ key: string }>(path, {
    method: "POST",
    body,
  });
  return saved.key;
}

export const uploadDirectorProjectFile = (
  projectId: string,
  bytes: Uint8Array,
) => uploadBytes(`/v1/director-desk/projects/${projectId}/files`, bytes);

export const downloadDirectorProjectFile = async (
  projectId: string,
  key: string,
) =>
  new Uint8Array(
    await (
      await fetchApiBlob(`/v1/director-desk/projects/${projectId}/files/${key}`)
    ).arrayBuffer(),
  );

export const uploadDirectorLibraryFile = (bytes: Uint8Array) =>
  uploadBytes("/v1/director-desk/library/files", bytes);

export const downloadDirectorLibraryFile = async (key: string) =>
  new Uint8Array(
    await (
      await fetchApiBlob(`/v1/director-desk/library/files/${key}`)
    ).arrayBuffer(),
  );

export const externalizeDocument = (projectId: string, document: unknown) =>
  externalizeTree(document, (bytes) =>
    uploadDirectorProjectFile(projectId, bytes),
  );

export const hydrateDocument = (projectId: string, document: unknown) =>
  hydrateTree(document, (key) => downloadDirectorProjectFile(projectId, key));

export const listDirectorProjects = async (query = "", signal?: AbortSignal) =>
  unwrap(
    await api.GET("/v1/director-desk/projects", {
      params: { query: { query, offset: 0, limit: 100 } },
      signal,
    }),
  );

export const createDirectorProject = async (title: string) =>
  unwrap(
    await api.POST("/v1/director-desk/projects", {
      body: { title },
    }),
  );

export const getDirectorProject = async (id: string, signal?: AbortSignal) =>
  unwrap(
    await api.GET("/v1/director-desk/projects/{project_id}", {
      params: { path: { project_id: id } },
      signal,
    }),
  );

export const patchDirectorProject = async (
  id: string,
  body: {
    title: string;
    expected_revision: number;
    document?: unknown;
  },
) =>
  unwrap(
    await api.PATCH("/v1/director-desk/projects/{project_id}", {
      params: { path: { project_id: id } },
      body: body as {
        title: string;
        expected_revision: number;
        document?: {
          format: "director-desk";
          version: 3;
          name: string;
          activeSceneId?: string | null;
          resources?: Record<string, unknown>[];
          media?: Record<string, unknown>[] | null;
          scenes?: Record<string, unknown>[];
        };
      },
    }),
  );

export const deleteDirectorProject = async (id: string, revision: number) =>
  unwrap(
    await api.DELETE("/v1/director-desk/projects/{project_id}", {
      params: {
        path: { project_id: id },
        query: { expected_revision: revision },
      },
    }),
  );

export const listDirectorMotions = (query = "") =>
  fetchApiJson<{ items: unknown[] }>(
    `/v1/director-desk/motions?query=${encodeURIComponent(query)}`,
  );

export const getDirectorMotion = (id: string) =>
  fetchApiJson<{ motion: unknown; resource: unknown }>(
    `/v1/director-desk/motions/${encodeURIComponent(id)}`,
  );

export const saveDirectorMotion = (
  id: string,
  body: { motion: unknown; resource: unknown },
) =>
  fetchApiJson<{ motion: unknown; resource: unknown }>(
    `/v1/director-desk/motions/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );

export const deleteDirectorMotion = (id: string) =>
  fetchApiJson<{ deleted: boolean }>(
    `/v1/director-desk/motions/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
    },
  );
