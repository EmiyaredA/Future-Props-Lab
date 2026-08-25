import { useEffect, useRef, useState } from "react";
import {
  getGalgameStoryDocument,
  type GalgameStoryProject,
} from "@features/galgame-workshop/api";
import {
  FastPreviewWorkspace,
  type FastPreviewCursor,
} from "@features/galgame-workshop/editor/FastPreviewWorkspace";
import type { FastPreviewDocumentMessage } from "@features/galgame-workshop/editor/fastPreviewSession";
import { entryChapter } from "@features/galgame-workshop/editor/model";

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
        });
        setNotice("编辑器未连接，正在预演服务器已保存版本");
      } catch {
        if (active) setNotice("无法取得编辑器快照或服务器版本");
      }
    };
    if (sessionId && typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(`fpl-galgame-preview:${sessionId}`);
      channel.addEventListener("message", (event) => {
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
  return (
    <FastPreviewWorkspace
      key={`${session.source}-${session.document.schemaVersion}-${notice}`}
      document={session.document}
      startCursor={session.startCursor}
      playbackRange={session.playbackRange}
      sourceNotice={notice}
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
