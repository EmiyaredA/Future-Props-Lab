import { api, unwrap } from "@platform/api/client";
import type { components } from "@generated/api";

type Schema = components["schemas"];
export type Chat = Schema["ChatOut"];
export type ChatDetail = Schema["ChatDetail"];
export type ChatCreate = Schema["ChatCreate"];
export type TurnCreate = Schema["TurnCreate"];

export const getExecutionCatalog = async (signal?: AbortSignal) =>
  unwrap(await api.GET("/v1/agent-workbench/execution/catalog", { signal }));
export const getChats = async (signal?: AbortSignal) =>
  unwrap(await api.GET("/v1/agent-workbench/chats", { signal }));
export const getChat = async (chat_id: string, signal?: AbortSignal) =>
  unwrap(
    await api.GET("/v1/agent-workbench/chats/{chat_id}", {
      params: { path: { chat_id } },
      signal,
    }),
  );
export const createChat = async (body: ChatCreate) =>
  unwrap(await api.POST("/v1/agent-workbench/chats", { body }));
export const sendTurn = async (chat_id: string, body: TurnCreate) =>
  unwrap(
    await api.POST("/v1/agent-workbench/chats/{chat_id}/turns", {
      params: { path: { chat_id } },
      body,
    }),
  );
export const stopTurn = async (chat_id: string, turn_id: string) =>
  unwrap(
    await api.POST("/v1/agent-workbench/chats/{chat_id}/turns/{turn_id}/stop", {
      params: { path: { chat_id, turn_id } },
    }),
  );
export const decideApproval = async (
  chat_id: string,
  turn_id: string,
  approval_id: string,
  approved: boolean,
) =>
  unwrap(
    await api.POST(
      "/v1/agent-workbench/chats/{chat_id}/turns/{turn_id}/approvals/{approval_id}",
      {
        params: { path: { chat_id, turn_id, approval_id } },
        body: { approved },
      },
    ),
  );
