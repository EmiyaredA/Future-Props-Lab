import { useEffect, useRef, useState } from "react";
import { LoadingState } from "@shared/ui/LoadingState";
import {
  getGalgameStoryDocument,
  patchGalgameStoryDialogue,
  patchGalgameStoryEdits,
  putGalgameStoryDocument,
  type GalgameStoryProject,
} from "@features/galgame-workshop/api";
import { FastPreviewWorkspace } from "@features/galgame-workshop/editor/FastPreviewWorkspace";
import type { FastPreviewCursor } from "@features/galgame-workshop/editor/storyPlayerModel";
import type { FastPreviewDialogueEdit } from "@features/galgame-workshop/editor/fastPreviewDialogueEdit";
import type { FastPreviewStoryEdit } from "@features/galgame-workshop/editor/fastPreviewEdits";
import {
  applyFastPreviewStageExpressionEdit,
  type FastPreviewStageExpressionEdit,
} from "@features/galgame-workshop/editor/fastPreviewStageExpressionEdit";
import type {
  FastPreviewDocumentMessage,
  FastPreviewEditsRequestMessage,
  FastPreviewEditsResultMessage,
  FastPreviewEditRequestMessage,
  FastPreviewEditResultMessage,
  FastPreviewStageExpressionRequestMessage,
  FastPreviewStageExpressionResultMessage,
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
  const sessionRef = useRef<FastPreviewDocumentMessage | undefined>(undefined);
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
  const [loadFailed, setLoadFailed] = useState(false);
  const sessionId = new URLSearchParams(window.location.search).get("session");

  useEffect(() => {
    let active = true;
    let channel: BroadcastChannel | undefined;
    const loadSaved = async () => {
      try {
        const saved = await getGalgameStoryDocument(projectId);
        if (!active) return;
        const nextSession: FastPreviewDocumentMessage = {
          type: "document",
          document: saved.document,
          startCursor: fallbackCursor(saved.document),
          source: "launch",
          storyRevision: saved.revision,
        };
        sessionRef.current = nextSession;
        setSession(nextSession);
        setNotice("编辑器未连接，正在预演服务器已保存版本");
      } catch {
        if (active) {
          setLoadFailed(true);
          setNotice("无法取得编辑器快照或服务器版本");
        }
      }
    };
    if (sessionId && typeof BroadcastChannel !== "undefined") {
      const pendingEdits = pendingEditsRef.current;
      channel = new BroadcastChannel(`fpl-galgame-preview:${sessionId}`);
      channelRef.current = channel;
      channel.addEventListener("message", (event) => {
        if (
          event.data?.type === "edit-dialogue-result" ||
          event.data?.type === "edit-stage-expression-result" ||
          event.data?.type === "edit-batch-result"
        ) {
          const message = event.data as
            | FastPreviewEditResultMessage
            | FastPreviewStageExpressionResultMessage
            | FastPreviewEditsResultMessage;
          const pending = pendingEditsRef.current.get(message.requestId);
          if (!pending) return;
          pendingEditsRef.current.delete(message.requestId);
          if (message.result) pending.resolve(message.result);
          else pending.reject(new Error(message.error ?? "保存失败"));
          return;
        }
        if (!active || event.data?.type !== "document") return;
        receivedRef.current = true;
        sessionRef.current = event.data as FastPreviewDocumentMessage;
        setSession(sessionRef.current);
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

  if (!session)
    return loadFailed ? (
      <div className="page-loading" role="alert">
        {notice}
      </div>
    ) : (
      <LoadingState label={notice} variant="page" />
    );
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
      const nextSession = {
        ...(sessionRef.current ?? session),
        document: result.document,
        storyRevision: result.storyRevision,
      };
      sessionRef.current = nextSession;
      setSession(nextSession);
      return result;
    }
    const currentSession = sessionRef.current ?? session;
    if (currentSession.storyRevision == null)
      throw new Error("当前预览缺少可保存的故事修订号");
    const saved = await patchGalgameStoryDialogue(
      projectId,
      edit,
      currentSession.storyRevision,
    );
    const next = updateBlock(
      currentSession.document,
      edit.fragmentId,
      edit.blockId,
      (block) => (block.type === "dialogue" ? saved.block : block),
    );
    const nextSession = {
      ...currentSession,
      document: next,
      storyRevision: saved.revision,
    };
    sessionRef.current = nextSession;
    setSession(nextSession);
    return { document: next, storyRevision: saved.revision };
  };
  const applyStageExpressionEdit = async (
    edit: FastPreviewStageExpressionEdit,
  ) => {
    if (channelRef.current) {
      const requestId = crypto.randomUUID();
      const result = await new Promise<
        NonNullable<FastPreviewStageExpressionResultMessage["result"]>
      >((resolve, reject) => {
        pendingEditsRef.current.set(requestId, { resolve, reject });
        channelRef.current?.postMessage({
          type: "edit-stage-expression",
          requestId,
          edit,
        } satisfies FastPreviewStageExpressionRequestMessage);
      });
      const nextSession = {
        ...(sessionRef.current ?? session),
        document: result.document,
        storyRevision: result.storyRevision,
      };
      sessionRef.current = nextSession;
      setSession(nextSession);
      return result;
    }
    const currentSession = sessionRef.current ?? session;
    if (currentSession.storyRevision == null)
      throw new Error("当前预览缺少可保存的故事修订号");
    const next = applyFastPreviewStageExpressionEdit(
      currentSession.document,
      edit,
    );
    const saved = await putGalgameStoryDocument(
      projectId,
      next,
      currentSession.storyRevision,
    );
    const nextSession = {
      ...currentSession,
      document: saved.document,
      storyRevision: saved.revision,
    };
    sessionRef.current = nextSession;
    setSession(nextSession);
    return { document: saved.document, storyRevision: saved.revision };
  };
  const applyEdits = async (edits: FastPreviewStoryEdit[]) => {
    if (channelRef.current) {
      const requestId = crypto.randomUUID();
      const result = await new Promise<
        NonNullable<FastPreviewEditsResultMessage["result"]>
      >((resolve, reject) => {
        pendingEditsRef.current.set(requestId, { resolve, reject });
        channelRef.current?.postMessage({
          type: "edit-batch",
          requestId,
          edits,
        } satisfies FastPreviewEditsRequestMessage);
      });
      const nextSession = {
        ...(sessionRef.current ?? session),
        document: result.document,
        storyRevision: result.storyRevision,
      };
      sessionRef.current = nextSession;
      setSession(nextSession);
      return result;
    }
    const currentSession = sessionRef.current ?? session;
    if (currentSession.storyRevision == null)
      throw new Error("当前预览缺少可保存的故事修订号");
    const saved = await patchGalgameStoryEdits(
      projectId,
      edits,
      currentSession.storyRevision,
    );
    const nextSession = {
      ...currentSession,
      document: saved.document,
      storyRevision: saved.revision,
    };
    sessionRef.current = nextSession;
    setSession(nextSession);
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
      onApplyStageExpressionEdit={applyStageExpressionEdit}
      onApplyEdits={applyEdits}
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
