import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { fetchApiJson, requestApi } from "@platform/api/client";
import type {
  ChatMessage,
  Conversation,
  Detail,
  FilePreview,
  WorkFile,
} from "./protocol";
import {
  conversationConflict,
  CONVERSATION_CONFLICT_MESSAGE,
} from "./revisionConflict";

type Options = {
  detailRef: MutableRefObject<Detail | null>;
  busy: boolean;
  filesOpen: boolean;
  refreshList: () => Promise<Conversation[]>;
  open: (id: string) => Promise<unknown>;
  clearSelection: () => void;
  setDetail: Dispatch<SetStateAction<Detail | null>>;
  setError: Dispatch<SetStateAction<string>>;
  setRenameItem: Dispatch<SetStateAction<Conversation | null>>;
  setDeleteItem: Dispatch<SetStateAction<Conversation | null>>;
  setFilesOpen: Dispatch<SetStateAction<boolean>>;
  setWorkFiles: Dispatch<SetStateAction<WorkFile[]>>;
  filePreviewRequestRef: MutableRefObject<number>;
  setFilePreview: Dispatch<SetStateAction<FilePreview | null>>;
};

export function conversationActions(options: Options) {
  const {
    detailRef,
    busy,
    filesOpen,
    refreshList,
    open,
    clearSelection,
    setDetail,
    setError,
    setRenameItem,
    setDeleteItem,
    setFilesOpen,
    setWorkFiles,
    filePreviewRequestRef,
    setFilePreview,
  } = options;
  const create = async () => {
    const next = await fetchApiJson<Conversation>("/v1/amadeus/conversations", {
      method: "POST",
    });
    await refreshList();
    await open(next.id);
  };
  const pinMessage = async (
    conversationId: string,
    messageId: string,
    pinned: boolean,
  ) => {
    const saved = await fetchApiJson<ChatMessage>(
      `/v1/amadeus/conversations/${conversationId}/messages/${messageId}/pin`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned }),
      },
    );
    setDetail((current) =>
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
    const branch = await fetchApiJson<Conversation>(
      `/v1/amadeus/conversations/${conversationId}/messages/${messageId}/fork`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: requestId }),
      },
    );
    await refreshList();
    if (detailRef.current?.conversation.id !== conversationId) return;
    await open(branch.id);
    if (detailRef.current?.conversation.id === branch.id) return branch.id;
  };
  const rename = async (item: Conversation, title: string) => {
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
          if (detailRef.current?.conversation.id === item.id)
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
    if (detailRef.current?.conversation.id === item.id) await open(item.id);
    setRenameItem(null);
  };
  const remove = async (item: Conversation) => {
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
          if (detailRef.current?.conversation.id === item.id)
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
    if (detailRef.current?.conversation.id === item.id) {
      if (next[0]) await open(next[0].id);
      else clearSelection();
    }
    setDeleteItem(null);
  };
  const showFiles = async () => {
    setFilesOpen(!filesOpen);
    if (filesOpen || !detailRef.current) return;
    try {
      const listing = await fetchApiJson<{ items: WorkFile[] }>(
        `/v1/amadeus/conversations/${detailRef.current.conversation.id}/files`,
      );
      setWorkFiles(listing.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const fileUrl = (item: WorkFile) =>
    `/v1/amadeus/conversations/${detailRef.current?.conversation.id}/files/${encodeURIComponent(item.kind)}/${encodeURIComponent(item.name)}`;
  const previewFile = async (item: WorkFile) => {
    if (item.bytes > 1024 * 1024) {
      setError("预览文件不能超过 1 MiB");
      return;
    }
    const conversationId = detailRef.current?.conversation.id;
    if (!conversationId) return;
    const request = ++filePreviewRequestRef.current;
    const isCurrent = () =>
      request === filePreviewRequestRef.current &&
      conversationId === detailRef.current?.conversation.id;
    try {
      const response = await requestApi(fileUrl(item));
      const text = await response.text();
      if (isCurrent())
        setFilePreview({ conversationId, name: item.name, text });
    } catch (cause) {
      if (isCurrent())
        setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const downloadFile = async (item: WorkFile) => {
    try {
      const response = await requestApi(fileUrl(item));
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = item.name;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return {
    create,
    pinMessage,
    forkMessage,
    rename,
    remove,
    showFiles,
    previewFile,
    downloadFile,
  };
}
