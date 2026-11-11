import { useEffect, useRef, useState } from "react";
import { fetchApiJson, requestApi } from "@platform/api/client";
import {
  conversationFileUrl,
  importConversationFile,
} from "./attachmentImport";
import { referenceLimit } from "./elementReferences";
import type { Conversation, FilePreview, WorkFile } from "./protocol";
import type { useAmadeusData } from "./useAmadeusData";

export function useAmadeusAttachments(
  owner: string,
  conversations: Pick<
    ReturnType<typeof useAmadeusData>,
    | "detail"
    | "getDetail"
    | "captureSelection"
    | "adopt"
    | "addReference"
    | "refreshList"
    | "references"
    | "selectionPending"
    | "selectionSignal"
  >,
  keepModelSelection: (id: string) => void,
  setError: (message: string) => void,
) {
  const [importing, setImporting] = useState(false);
  const importingRef = useRef(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [workFiles, setWorkFiles] = useState<WorkFile[]>([]);
  const [filePreview, setFilePreview] = useState<FilePreview | null>(null);
  const listRequest = useRef<AbortController | undefined>(undefined);
  const previewRequest = useRef<AbortController | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    detail,
    getDetail,
    captureSelection,
    adopt,
    addReference,
    refreshList,
    references,
    selectionPending,
    selectionSignal,
  } = conversations;
  const conversationId = detail?.conversation.id;
  useEffect(() => {
    setFilesOpen(false);
    setWorkFiles([]);
    setFilePreview(null);
    return () => {
      listRequest.current?.abort();
      previewRequest.current?.abort();
    };
  }, [owner, conversationId]);

  const loadFiles = async (id: string, isCurrent: () => boolean) => {
    listRequest.current?.abort();
    const request = new AbortController();
    listRequest.current = request;
    try {
      const listing = await fetchApiJson<{ items: WorkFile[] }>(
        `/v1/amadeus/conversations/${id}/files`,
        { signal: request.signal },
      );
      if (!request.signal.aborted && isCurrent()) setWorkFiles(listing.items);
    } catch (cause) {
      if (!request.signal.aborted && isCurrent()) throw cause;
    }
  };
  const showFiles = async () => {
    setFilesOpen(!filesOpen);
    const id = getDetail()?.conversation.id;
    if (filesOpen || !id) return;
    try {
      await loadFiles(id, captureSelection());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const closeFilePreview = () => {
    previewRequest.current?.abort();
    setFilePreview(null);
  };
  const previewFile = async (item: WorkFile) => {
    if (item.bytes > 1024 * 1024) {
      setError("预览文件不能超过 1 MiB");
      return;
    }
    const id = getDetail()?.conversation.id;
    if (!id) return;
    const isCurrent = captureSelection();
    previewRequest.current?.abort();
    const request = new AbortController();
    previewRequest.current = request;
    try {
      const response = await requestApi(
        conversationFileUrl(id, item.kind, item.name),
        {
          signal: request.signal,
        },
      );
      const text = await response.text();
      if (!request.signal.aborted && isCurrent())
        setFilePreview({ conversationId: id, name: item.name, text });
    } catch (cause) {
      if (!request.signal.aborted && isCurrent())
        setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const downloadFile = async (item: WorkFile) => {
    const id = getDetail()?.conversation.id;
    if (!id) return;
    const isCurrent = captureSelection();
    try {
      const response = await requestApi(
        conversationFileUrl(id, item.kind, item.name),
        {
          signal: selectionSignal(),
        },
      );
      const blob = await response.blob();
      if (!isCurrent()) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = item.name;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (cause) {
      if (isCurrent())
        setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const importAttachments = async (files: File[], isBusy: () => boolean) => {
    if (!files.length || isBusy() || importingRef.current) return;
    if (selectionPending()) {
      setError("正在打开对话，请稍后重新导入附件。");
      return;
    }
    let available = referenceLimit - references.length;
    if (available <= 0) {
      setError(`每轮最多引用 ${referenceLimit} 项。`);
      return;
    }
    importingRef.current = true;
    setImporting(true);
    setError("");
    let isCurrent = captureSelection();
    const failures: string[] = [];
    try {
      let current = getDetail();
      for (const file of files) {
        if (!isCurrent()) break;
        if (file.size > 50 * 1024 * 1024) {
          failures.push(`${file.name}：单个文件不能超过 50 MiB`);
          continue;
        }
        if (available <= 0) {
          failures.push(`${file.name}：已达到引用上限`);
          continue;
        }
        try {
          if (!current) {
            const created = await fetchApiJson<Conversation>(
              "/v1/amadeus/conversations",
              { method: "POST" },
            );
            if (!isCurrent()) break;
            keepModelSelection(created.id);
            current = { conversation: created, messages: [], actions: [] };
            adopt(current);
            isCurrent = captureSelection();
            void refreshList().catch(() => {});
          }
          const reference = await importConversationFile(
            current.conversation.id,
            file,
          );
          if (!isCurrent()) break;
          addReference(reference, isCurrent);
          available--;
        } catch (cause) {
          failures.push(
            `${file.name}：${cause instanceof Error ? cause.message : String(cause)}`,
          );
          if (!current) break;
        }
      }
      if (current && filesOpen && isCurrent()) {
        try {
          await loadFiles(current.conversation.id, isCurrent);
        } catch {
          if (isCurrent())
            failures.push("会话文件列表读取失败，请重新打开列表。");
        }
      }
      if (failures.length && isCurrent()) setError(failures.join("；"));
    } finally {
      importingRef.current = false;
      setImporting(false);
    }
  };

  return {
    importing,
    isImporting: () => importingRef.current,
    fileInputRef,
    filesOpen,
    setFilesOpen,
    workFiles,
    filePreview:
      filePreview?.conversationId === conversationId ? filePreview : null,
    closeFilePreview,
    showFiles,
    previewFile,
    downloadFile,
    importAttachments,
  };
}
