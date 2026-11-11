import type { Dispatch, SetStateAction } from "react";
import { fetchApiJson, requestApi } from "@platform/api/client";
import type { ChatMessage, Conversation, Detail } from "./protocol";
import {
  conversationConflict,
  CONVERSATION_CONFLICT_MESSAGE,
} from "./revisionConflict";

type Options = {
  getDetail: () => Detail | null;
  captureSelection: () => () => boolean;
  busy: boolean;
  refreshList: () => Promise<Conversation[]>;
  open: (id: string) => Promise<unknown>;
  clearSelection: () => void;
  updateDetail: (
    isCurrent: () => boolean,
    update: (detail: Detail) => Detail,
  ) => void;
  setError: Dispatch<SetStateAction<string>>;
  setRenameItem: Dispatch<SetStateAction<Conversation | null>>;
  setDeleteItem: Dispatch<SetStateAction<Conversation | null>>;
};

export function conversationActions(options: Options) {
  const {
    getDetail,
    captureSelection,
    busy,
    refreshList,
    open,
    clearSelection,
    updateDetail,
    setError,
    setRenameItem,
    setDeleteItem,
  } = options;
  const create = async () => {
    const isCurrent = captureSelection();
    const next = await fetchApiJson<Conversation>("/v1/amadeus/conversations", {
      method: "POST",
    });
    await refreshList();
    if (!isCurrent()) return;
    await open(next.id);
    if (getDetail()?.conversation.id === next.id) return next.id;
  };
  const pinMessage = async (
    conversationId: string,
    messageId: string,
    pinned: boolean,
  ) => {
    const isCurrent = captureSelection();
    const saved = await fetchApiJson<ChatMessage>(
      `/v1/amadeus/conversations/${conversationId}/messages/${messageId}/pin`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned }),
      },
    );
    updateDetail(isCurrent, (current) =>
      current?.conversation.id === conversationId
        ? {
            ...current,
            messages: current.messages.map((message) =>
              message.id === saved.id
                ? { ...message, pinned: saved.pinned }
                : message,
            ),
          }
        : current,
    );
  };
  const forkMessage = async (
    conversationId: string,
    messageId: string,
    requestId: string,
  ) => {
    const isCurrent = captureSelection();
    const branch = await fetchApiJson<Conversation>(
      `/v1/amadeus/conversations/${conversationId}/messages/${messageId}/fork`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: requestId }),
      },
    );
    await refreshList();
    if (!isCurrent() || getDetail()?.conversation.id !== conversationId) return;
    await open(branch.id);
    if (getDetail()?.conversation.id === branch.id) return branch.id;
  };
  const rename = async (item: Conversation, title: string) => {
    const isCurrent = captureSelection();
    title = title.trim();
    if (!title || title === item.title) {
      setRenameItem(null);
      return;
    }
    try {
      await fetchApiJson(`/v1/amadeus/conversations/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expected_revision: item.revision, title }),
      });
    } catch (cause) {
      const current = conversationConflict(cause);
      if (current) {
        setRenameItem(current);
        setError(CONVERSATION_CONFLICT_MESSAGE);
        try {
          await refreshList();
          if (isCurrent() && getDetail()?.conversation.id === item.id)
            await open(item.id);
        } catch (refreshError) {
          setError(
            `${CONVERSATION_CONFLICT_MESSAGE} 刷新失败：${String(refreshError)}`,
          );
        }
        return;
      }
      setError(cause instanceof Error ? cause.message : String(cause));
      return;
    }
    await refreshList();
    if (isCurrent() && getDetail()?.conversation.id === item.id)
      await open(item.id);
    setRenameItem(null);
  };
  const remove = async (item: Conversation) => {
    const isCurrent = captureSelection();
    if (busy) {
      setError("请先停止当前任务，再删除会话和工作文件。");
      return;
    }
    try {
      await requestApi(
        `/v1/amadeus/conversations/${item.id}?expected_revision=${item.revision}`,
        { method: "DELETE" },
      );
    } catch (cause) {
      const current = conversationConflict(cause);
      if (current) {
        setDeleteItem(current);
        setError(CONVERSATION_CONFLICT_MESSAGE);
        try {
          await refreshList();
          if (isCurrent() && getDetail()?.conversation.id === item.id)
            await open(item.id);
        } catch (refreshError) {
          setError(
            `${CONVERSATION_CONFLICT_MESSAGE} 刷新失败：${String(refreshError)}`,
          );
        }
        return;
      }
      setError(cause instanceof Error ? cause.message : String(cause));
      return;
    }
    const next = await refreshList();
    if (isCurrent() && getDetail()?.conversation.id === item.id) {
      if (next[0]) await open(next[0].id);
      else clearSelection();
    }
    setDeleteItem(null);
  };
  return {
    create,
    pinMessage,
    forkMessage,
    rename,
    remove,
  };
}
