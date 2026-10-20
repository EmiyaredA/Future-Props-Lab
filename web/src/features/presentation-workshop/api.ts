import { api, unwrap } from "@platform/api/client";
import type { Draft } from "./types";

export const listProjects = async (
  query: string,
  offset: number,
  signal?: AbortSignal,
) =>
  unwrap(
    await api.GET("/v1/presentation-workshop/projects", {
      params: { query: { query, offset, limit: 24 } },
      signal,
    }),
  );
export const getProject = async (id: string, signal?: AbortSignal) =>
  unwrap(
    await api.GET("/v1/presentation-workshop/projects/{project_id}", {
      params: { path: { project_id: id } },
      signal,
    }),
  );
export const createProject = async (body: Draft) =>
  unwrap(await api.POST("/v1/presentation-workshop/projects", { body }));
export const saveProject = async (id: string, body: Draft, revision: number) =>
  unwrap(
    await api.PUT("/v1/presentation-workshop/projects/{project_id}", {
      params: { path: { project_id: id } },
      body: { ...body, expected_revision: revision },
    }),
  );
export const deleteProject = async (id: string, revision: number) =>
  unwrap(
    await api.DELETE("/v1/presentation-workshop/projects/{project_id}", {
      params: {
        path: { project_id: id },
        query: { expected_revision: revision },
      },
    }),
  );
export const exportProject = async (id: string, revision: number) =>
  unwrap(
    await api.POST("/v1/presentation-workshop/projects/{project_id}/export", {
      params: { path: { project_id: id } },
      body: { expected_revision: revision },
      parseAs: "blob",
    }),
  );
export const listImages = async (signal?: AbortSignal, query = "") =>
  unwrap(
    await api.GET("/v1/files", {
      params: {
        query: {
          media_kind: "image",
          include_references: false,
          query,
          include_svg: true,
        },
      },
      signal,
    }),
  );
export const uploadImage = async (file: File) =>
  unwrap(
    await api.POST("/v1/files", {
      body: { upload: file as unknown as string },
      bodySerializer() {
        const form = new FormData();
        form.append("upload", file);
        return form;
      },
    }),
  );

export const listMedia = async (
  kind: "image" | "audio" | "video",
  query = "",
  signal?: AbortSignal,
) =>
  unwrap(
    await api.GET("/v1/files", {
      params: {
        query: {
          media_kind: kind,
          include_references: false,
          include_svg: kind === "image",
          query,
        },
      },
      signal,
    }),
  );
export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const imageBlob = async (id: string) =>
  unwrap(
    await api.GET("/v1/files/{asset_id}/content", {
      params: { path: { asset_id: id } },
      parseAs: "blob",
    }),
  );

export const previewSvg = async (svg: string, signal?: AbortSignal) =>
  unwrap(await api.POST("/v1/files/svg/preview", { body: { svg }, signal }));
