import { api, fetchApiJson, unwrap } from "@platform/api/client";
import { postSse } from "@platform/api/sse";
import type { components } from "@generated/api";

type S = components["schemas"];
export type PetProject = S["PetProjectOut"];
export type PetDocument = S["PetDocumentOut"];
export type PetConfig = S["PetConfig"];
export type PetReaction = S["PetReaction"];
export type PetSkin = S["PetSkin"];
export type PetHabits = S["PetHabits"];
export type PetChat = S["PetChatOut"];
export type PetChatMessage = S["PetChatMessageOut"];
export type PetChatStreamEvent = {
  type: "start" | "delta" | "done" | "error";
  revision: number | null;
  text: string;
  detail: string;
};

const path = (project_id: string) => ({ path: { project_id } });

export const listProjects = async () =>
  unwrap(await api.GET("/v1/desktop-pet/projects"));
export const getProject = async (id: string) =>
  unwrap(
    await api.GET("/v1/desktop-pet/projects/{project_id}", {
      params: path(id),
    }),
  );
export const createProject = async (
  sourceProjectId: string,
  sourceRevision: number,
  title: string,
) =>
  unwrap(
    await api.POST("/v1/desktop-pet/projects", {
      body: { sourceProjectId, sourceRevision, title },
    }),
  );
export async function importWhale(file: File): Promise<PetProject> {
  const body = new FormData();
  body.append("file", file);
  return fetchApiJson("/v1/desktop-pet/projects/import-whale", {
    method: "POST",
    body,
  });
}
export const renameProject = async (
  id: string,
  expectedRevision: number,
  title: string,
) =>
  unwrap(
    await api.PATCH("/v1/desktop-pet/projects/{project_id}", {
      params: path(id),
      body: { expectedRevision, title },
    }),
  );
export const deleteProject = async (id: string, expectedRevision: number) =>
  unwrap(
    await api.DELETE("/v1/desktop-pet/projects/{project_id}", {
      params: { ...path(id), query: { expectedRevision } },
    }),
  );
export const getDocument = async (id: string) =>
  unwrap(
    await api.GET("/v1/desktop-pet/projects/{project_id}/document", {
      params: path(id),
    }),
  );

export const getChat = async (id: string) =>
  unwrap(
    await api.GET("/v1/desktop-pet/projects/{project_id}/chat", {
      params: path(id),
    }),
  );

export const updateChat = async (
  id: string,
  expectedRevision: number,
  modelId: string | null,
  proactiveLinesEnabled: boolean,
) =>
  unwrap(
    await api.PATCH("/v1/desktop-pet/projects/{project_id}/chat", {
      params: path(id),
      body: { expectedRevision, modelId, proactiveLinesEnabled },
    }),
  );

export const olderChatMessages = async (id: string, before: number) =>
  unwrap(
    await api.GET("/v1/desktop-pet/projects/{project_id}/chat/messages", {
      params: { ...path(id), query: { before, limit: 50 } },
    }),
  );

export const clearChat = async (id: string, expectedRevision: number) =>
  unwrap(
    await api.DELETE("/v1/desktop-pet/projects/{project_id}/chat/messages", {
      params: path(id),
      body: { expectedRevision },
    }),
  );

export const sendChat = async (
  id: string,
  expectedRevision: number,
  content: string,
  signal: AbortSignal,
  onEvent: (event: PetChatStreamEvent) => void,
) =>
  postSse<PetChatStreamEvent>({
    path: `/v1/desktop-pet/projects/${encodeURIComponent(id)}/chat/messages/stream`,
    body: { expectedRevision, requestId: crypto.randomUUID(), content },
    signal,
    onEvent,
    defaultErrorMessage: "桌宠聊天失败",
  });
export const saveDocument = async (
  id: string,
  expectedRevision: number,
  config: PetConfig,
) =>
  unwrap(
    await api.PUT("/v1/desktop-pet/projects/{project_id}/document", {
      params: path(id),
      body: { expectedRevision, config },
    }),
  );
export const syncSource = async (
  id: string,
  expectedRevision: number,
  sourceRevision: number,
) =>
  unwrap(
    await api.POST("/v1/desktop-pet/projects/{project_id}/sync-source", {
      params: path(id),
      body: { expectedRevision, sourceRevision },
    }),
  );
export async function uploadSkin(
  id: string,
  skinId: string,
  sourceAssetId: string,
  expectedRevision: number,
  file: File,
): Promise<PetDocument> {
  const body = new FormData();
  body.append("file", file);
  body.append("expectedRevision", String(expectedRevision));
  return fetchApiJson(
    `/v1/desktop-pet/projects/${encodeURIComponent(id)}/skins/${encodeURIComponent(skinId)}/replacements/${encodeURIComponent(sourceAssetId)}`,
    { method: "PUT", body },
  );
}
