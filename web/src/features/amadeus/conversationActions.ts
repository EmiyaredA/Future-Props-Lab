import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { fetchApiJson, requestApi } from "@platform/api/client";
import type { Conversation, Detail, Reference, WorkFile } from "./protocol";
import {
  conversationConflict,
  CONVERSATION_CONFLICT_MESSAGE,
} from "./revisionConflict";

type Options = {
  detailRef: MutableRefObject<Detail | null>;
  busy: boolean;
  filesOpen: boolean;
  refreshList: () => Promise<Conversation[]>;
  open: (id: string) => Promise<void>;
  setDetail: Dispatch<SetStateAction<Detail | null>>;
  setError: Dispatch<SetStateAction<string>>;
  setRenameItem: Dispatch<SetStateAction<Conversation | null>>;
  setDeleteItem: Dispatch<SetStateAction<Conversation | null>>;
  setAttachments: Dispatch<
    SetStateAction<Array<{ name: string; bytes: number }>>
  >;
  setReferences: Dispatch<SetStateAction<Reference[]>>;
  setFilesOpen: Dispatch<SetStateAction<boolean>>;
  setWorkFiles: Dispatch<SetStateAction<WorkFile[]>>;
  setFilePreview: Dispatch<
    SetStateAction<{ name: string; text: string } | null>
  >;
};

export function conversationActions(options: Options) {
  const {
    detailRef,
    busy,
    filesOpen,
    refreshList,
    open,
    setDetail,
    setError,
    setRenameItem,
    setDeleteItem,
    setAttachments,
    setReferences,
    setFilesOpen,
    setWorkFiles,
    setFilePreview,
  } = options;
  const create = async () => {
    const next = await fetchApiJson<Conversation>("/v1/amadeus/conversations", {
      method: "POST",
    });
    await refreshList();
    await open(next.id);
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
      else setDetail(null);
    }
    setDeleteItem(null);
  };
  const importAttachment = async (file: File) => {
    if (file.size > 50 * 1024 * 1024) {
      setError("单个文件不能超过 50 MiB");
      return;
    }
    try {
      let current = detailRef.current;
      if (!current) {
        const created = await fetchApiJson<Conversation>(
          "/v1/amadeus/conversations",
          { method: "POST" },
        );
        current = { conversation: created, messages: [], actions: [] };
        setDetail(current);
        detailRef.current = current;
        await refreshList();
      }
      const form = new FormData();
      form.append("upload", file, file.name);
      await fetchApiJson(
        `/v1/amadeus/conversations/${current.conversation.id}/imports`,
        { method: "POST", body: form },
      );
      setAttachments((previous) => [
        ...previous,
        { name: file.name, bytes: file.size },
      ]);
      setReferences((previous) => [
        ...previous,
        {
          id: `file:${file.name}`,
          application: "会话文件",
          name: file.name,
          value: `${Math.ceil(file.size / 1024)} KiB`,
          source: "imports",
        },
      ]);
      const listing = await fetchApiJson<{ items: WorkFile[] }>(
        `/v1/amadeus/conversations/${current.conversation.id}/files`,
      );
      setWorkFiles(listing.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
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
    try {
      const response = await requestApi(fileUrl(item));
      setFilePreview({ name: item.name, text: await response.text() });
    } catch (cause) {
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
    rename,
    remove,
    importAttachment,
    showFiles,
    previewFile,
    downloadFile,
  };
}
