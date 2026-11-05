import { api, unwrap } from "@platform/api/client";
import type { components } from "@generated/api";

type Schema = components["schemas"];
export type Chat = Schema["ChatOut"];
export type ChatDetail = Schema["ChatDetail"];
export type ChatCreate = Schema["ChatCreate"];
export type TurnCreate = Schema["TurnCreate"];
export type ProjectChoice = Schema["ProjectChoice"];
export type ExecutionCatalog = Schema["ExecutionCatalog"];

export const getExecutionCatalog = async (signal?: AbortSignal) =>
  unwrap(await api.GET("/v1/agent-workbench/execution/catalog", { signal }));
export const browseProjectDirectories = async (
  parent?: string,
  signal?: AbortSignal,
) =>
  unwrap(
    await api.GET("/v1/agent-workbench/execution/directories", {
      params: { query: { parent } },
      signal,
    }),
  );
export const registerProjectDirectory = async (root: string) =>
  unwrap(
    await api.POST("/v1/agent-workbench/execution/projects", {
      body: { root },
    }),
  );
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

export const removeQueuedTurn = async (chat_id: string, turn_id: string) =>
  unwrap(
    await api.DELETE("/v1/agent-workbench/chats/{chat_id}/queue/{turn_id}", {
      params: { path: { chat_id, turn_id } },
    }),
  );

export const resumeQueue = async (chat_id: string) =>
  unwrap(
    await api.POST("/v1/agent-workbench/chats/{chat_id}/queue/resume", {
      params: { path: { chat_id } },
    }),
  );

export const insertInstruction = async (
  chat_id: string,
  turn_id: string,
  body: Schema["InstructionCreate"],
) =>
  unwrap(
    await api.POST(
      "/v1/agent-workbench/chats/{chat_id}/turns/{turn_id}/instructions",
      {
        params: { path: { chat_id, turn_id } },
        body,
      },
    ),
  );

export type SourcePreview = Schema["SourcePreview"];

export const getTurnSource = async (
  chat_id: string,
  turn_id: string,
  call_id: string,
  signal?: AbortSignal,
) =>
  unwrap(
    await api.GET(
      "/v1/agent-workbench/chats/{chat_id}/turns/{turn_id}/source",
      {
        params: { path: { chat_id, turn_id }, query: { call_id } },
        signal,
      },
    ),
  );
