import { api, unwrap } from "@platform/api/client";
import type { components } from "@generated/api";
import { read, type KnowledgeBase } from "./api";
export type Directory = components["schemas"]["ThoughtDirectoryOut"];
export type Move = components["schemas"]["ThoughtMoveIn"];
export const listKnowledge = async (
  query: string,
  trash: boolean,
  signal?: AbortSignal,
) =>
  read(
    async (signal) =>
      unwrap(
        await api.GET("/v1/thought-workshop/knowledge-bases", {
          params: { query: { query, trash } },
          signal,
        }),
      ),
    signal,
  );
export const getDirectory = async (id: string, signal?: AbortSignal) =>
  read(
    async (signal) =>
      unwrap(
        await api.GET(
          "/v1/thought-workshop/knowledge-bases/{project_id}/directory",
          { params: { path: { project_id: id } }, signal },
        ),
      ),
    signal,
  );
export const createKnowledge = async (title: string) =>
  unwrap(
    await api.POST("/v1/thought-workshop/knowledge-bases", {
      body: { title, description: "" },
    }),
  );
export const updateKnowledge = async (
  project: KnowledgeBase,
  changes: Partial<components["schemas"]["KnowledgeBaseIn"]>,
) =>
  unwrap(
    await api.PUT("/v1/thought-workshop/knowledge-bases/{project_id}", {
      params: { path: { project_id: project.id } },
      body: {
        title: project.title,
        description: project.description,
        cover_asset_id: project.cover_asset_id,
        ...changes,
        expected_revision: project.revision,
      },
    }),
  );
export const trashKnowledge = async (project: KnowledgeBase) =>
  unwrap(
    await api.DELETE("/v1/thought-workshop/knowledge-bases/{project_id}", {
      params: {
        path: { project_id: project.id },
        query: { expected_revision: project.revision },
      },
    }),
  );
export const restoreKnowledge = async (project: KnowledgeBase) =>
  unwrap(
    await api.POST(
      "/v1/thought-workshop/knowledge-bases/{project_id}/restore",
      {
        params: { path: { project_id: project.id } },
        body: { expected_revision: project.revision },
      },
    ),
  );
export const createDocument = async (
  project: KnowledgeBase,
  parent_id: string | null = null,
) =>
  unwrap(
    await api.POST(
      "/v1/thought-workshop/knowledge-bases/{project_id}/documents",
      {
        params: { path: { project_id: project.id } },
        body: {
          title: "未命名文档",
          parent_id,
          expected_revision: project.revision,
        },
      },
    ),
  );
export const moveEntry = async (
  project: KnowledgeBase,
  body: Omit<Move, "expected_revision">,
) =>
  unwrap(
    await api.POST("/v1/thought-workshop/knowledge-bases/{project_id}/move", {
      params: { path: { project_id: project.id } },
      body: { ...body, expected_revision: project.revision },
    }),
  );
