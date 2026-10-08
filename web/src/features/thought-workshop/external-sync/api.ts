import type { components } from "@generated/api";
import { api, unwrap } from "@platform/api/client";

export type SyncPreview = components["schemas"]["ArticleSyncPreview"];
export type SyncTask = components["schemas"]["ArticleSyncTaskOut"];
const path = (note_id: string) => ({ note_id });
export const getArticleSync = async (id: string) =>
  unwrap(
    await api.GET("/v1/thought-workshop/notes/{note_id}/external-sync", {
      params: { path: path(id) },
    }),
  );
export const bindArticle = async (
  id: string,
  connection_id: string,
  url: string,
  expected_revision: number,
) =>
  unwrap(
    await api.PUT(
      "/v1/thought-workshop/notes/{note_id}/external-sync/binding",
      {
        params: { path: path(id) },
        body: { connection_id, url, expected_revision },
      },
    ),
  );
export const unbindArticle = async (id: string, expected_revision: number) =>
  unwrap(
    await api.DELETE(
      "/v1/thought-workshop/notes/{note_id}/external-sync/binding",
      { params: { path: path(id), query: { expected_revision } } },
    ),
  );
export const previewArticle = async (
  id: string,
  expected_revision: number,
  binding_revision: number,
) =>
  unwrap(
    await api.POST(
      "/v1/thought-workshop/notes/{note_id}/external-sync/preview",
      {
        params: { path: path(id) },
        body: { expected_revision, binding_revision },
      },
    ),
  );
export const submitArticle = async (
  id: string,
  preview_id: string,
  operation_id: string,
) =>
  unwrap(
    await api.POST("/v1/thought-workshop/notes/{note_id}/external-sync/tasks", {
      params: { path: path(id) },
      body: { preview_id, operation_id, confirm_replace: true },
    }),
  );
export const getArticleSyncTask = async (note_id: string, task_id: string) =>
  unwrap(
    await api.GET(
      "/v1/thought-workshop/notes/{note_id}/external-sync/tasks/{task_id}",
      { params: { path: { note_id, task_id } } },
    ),
  );
export const reconcileArticle = async (
  note_id: string,
  task_id: string,
  acknowledge_partial = false,
) =>
  unwrap(
    await api.POST(
      "/v1/thought-workshop/notes/{note_id}/external-sync/tasks/{task_id}/reconcile",
      { params: { path: { note_id, task_id } }, body: { acknowledge_partial } },
    ),
  );
