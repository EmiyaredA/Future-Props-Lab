import { api, unwrap } from "@platform/api/client";

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
