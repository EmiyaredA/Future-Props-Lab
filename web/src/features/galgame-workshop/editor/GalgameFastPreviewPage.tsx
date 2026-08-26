import { useEffect, useRef, useState } from "react";
import {
  getGalgameStoryDocument,
  putGalgameStoryDocument,
  type GalgameStoryProject,
} from "@features/galgame-workshop/api";
import {
  FastPreviewWorkspace,
  type FastPreviewCursor,
} from "@features/galgame-workshop/editor/FastPreviewWorkspace";
import {
  applyFastPreviewDialogueEdit,
  type FastPreviewDialogueEdit,
} from "@features/galgame-workshop/editor/fastPreviewDialogueEdit";
import type {
  FastPreviewDocumentMessage,
  FastPreviewEditRequestMessage,
  FastPreviewEditResultMessage,
} from "@features/galgame-workshop/editor/fastPreviewSession";
import {
  entryChapter,
  updateBlock,
} from "@features/galgame-workshop/editor/model";

function fallbackCursor(document: GalgameStoryProject): FastPreviewCursor {
  const chapter = entryChapter(document) ?? document.chapters?.[0];
  return {
    chapterId: chapter?.id ?? "",
    fragmentId: chapter?.entryFragmentId ?? chapter?.fragments?.[0]?.id ?? "",
    blockIndex: 0,
  };
}

export function GalgameFastPreviewPage({ projectId }: { projectId: string }) {
  const [session, setSession] = useState<FastPreviewDocumentMessage>();
  const receivedRef = useRef(false);
  const channelRef = useRef<BroadcastChannel | undefined>(undefined);
  const pendingEditsRef = useRef(
    new Map<
      string,
      {
        resolve: (
          result: NonNullable<FastPreviewEditResultMessage["result"]>,
        ) => void;
        reject: (error: Error) => void;
      }
    >(),
  );
  const [notice, setNotice] = useState("正在等待编辑器快照…");
  const sessionId = new URLSearchParams(window.location.search).get("session");

  useEffect(() => {
    let active = true;
    let channel: BroadcastChannel | undefined;
    const loadSaved = async () => {
      try {
        const saved = await getGalgameStoryDocument(projectId);
        if (!active) return;
        setSession({
          type: "document",
          document: saved.document,
          startCursor: fallbackCursor(saved.document),
          source: "launch",
          storyRevision: saved.revision,
        });
        setNotice("编辑器未连接，正在预演服务器已保存版本");
      } catch {
        if (active) setNotice("无法取得编辑器快照或服务器版本");
      }
    };
    if (sessionId && typeof BroadcastChannel !== "undefined") {
      const pendingEdits = pendingEditsRef.current;
      channel = new BroadcastChannel(`fpl-galgame-preview:${sessionId}`);
      channelRef.current = channel;
      channel.addEventListener("message", (event) => {
        if (event.data?.type === "edit-dialogue-result") {
          const message = event.data as FastPreviewEditResultMessage;
          const pending = pendingEditsRef.current.get(message.requestId);
          if (!pending) return;
          pendingEditsRef.current.delete(message.requestId);
          if (message.result) pending.resolve(message.result);
          else pending.reject(new Error(message.error ?? "保存失败"));
          return;
        }
        if (!active || event.data?.type !== "document") return;
        receivedRef.current = true;
        setSession(event.data as FastPreviewDocumentMessage);
        setNotice(
          event.data.source === "reload"
            ? "已手动载入最新编辑内容并重启"
            : "启动时内存快照",
        );
      });
      channel.postMessage({ type: "ready" });
      const fallback = window.setTimeout(() => {
        if (!receivedRef.current) void loadSaved();
      }, 1500);
      return () => {
        active = false;
        channelRef.current = undefined;
        for (const pending of pendingEdits.values())
          pending.reject(new Error("编辑器连接已断开"));
        pendingEdits.clear();
        window.clearTimeout(fallback);
        channel?.close();
      };
    }
    void loadSaved();
    return () => {
      active = false;
    };
  }, [projectId, sessionId]);

  if (!session) return <div className="page-loading">{notice}</div>;
  const applyDialogueEdit = async (edit: FastPreviewDialogueEdit) => {
    if (channelRef.current) {
      const requestId = crypto.randomUUID();
      const result = await new Promise<
        NonNullable<FastPreviewEditResultMessage["result"]>
      >((resolve, reject) => {
        pendingEditsRef.current.set(requestId, { resolve, reject });
        channelRef.current?.postMessage({
          type: "edit-dialogue",
          requestId,
          edit,
        } satisfies FastPreviewEditRequestMessage);
      });
      setSession((current) =>
        current
          ? {
              ...current,
              document: result.document,
              storyRevision: result.storyRevision,
            }
          : current,
      );
      return result;
    }
    if (session.storyRevision == null)
      throw new Error("当前预览缺少可保存的故事修订号");
    const next = updateBlock(
      session.document,
      edit.fragmentId,
      edit.blockId,
      (block) =>
        block.type === "dialogue"
          ? applyFastPreviewDialogueEdit(block, edit)
          : block,
    );
    const saved = await putGalgameStoryDocument(
      projectId,
      next,
      session.storyRevision,
    );
    setSession((current) =>
      current
        ? {
            ...current,
            document: saved.document,
            storyRevision: saved.revision,
          }
        : current,
    );
    return { document: saved.document, storyRevision: saved.revision };
  };
  return (
    <FastPreviewWorkspace
      key={`${session.source}-${session.document.schemaVersion}-${notice}`}
      document={session.document}
      projectId={projectId}
      storyRevision={session.storyRevision}
      exactFrameDisabledReason={session.exactFrameDisabledReason}
      startCursor={session.startCursor}
      playbackRange={session.playbackRange}
      sourceNotice={notice}
      onApplyDialogueEdit={applyDialogueEdit}
      onReload={
        sessionId
          ? () => {
              setNotice("正在请求最新编辑内容…");
              const channel = new BroadcastChannel(
                `fpl-galgame-preview:${sessionId}`,
              );
              channel.postMessage({ type: "reload" });
              channel.close();
            }
          : undefined
      }
      onExit={() => window.close()}
    />
  );
}
