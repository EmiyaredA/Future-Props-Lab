import { lazy, Suspense } from "react";
import { ChevronDown, Play } from "lucide-react";
import type { EditorPageViewModel } from "@features/galgame-workshop/editor/editorViewModel";
import {
  createEditorFastPreviewSession,
  type EditorFastPreviewSession,
} from "@features/galgame-workshop/editor/editorFastPreviewSession";
import { openFastPreviewWindow } from "@features/galgame-workshop/editor/fastPreviewSession";

const FastPreviewWorkspace = lazy(() =>
  import("@features/galgame-workshop/editor/FastPreviewWorkspace").then(
    (module) => ({ default: module.FastPreviewWorkspace }),
  ),
);

export function EditorFastPreviewRunMenu({
  model,
  onLaunch,
}: {
  model: Extract<EditorPageViewModel, { status: "ready" }>;
  onLaunch: (session: EditorFastPreviewSession) => void;
}) {
  const launch = (scope: "project" | "chapter" | "block") =>
    onLaunch(
      createEditorFastPreviewSession({
        document: model.document,
        scope,
        chapter: model.chapter,
        selectedFragment: model.selectedFragment,
        selectedIndex: model.selectedIndex,
      }),
    );
  return (
    <details className="galgame-run-menu">
      <summary
        className="galgame-preview-launch"
        role="button"
        aria-label="开始试玩"
        onClick={() => launch("project")}
      >
        <Play aria-hidden /> 运行 <ChevronDown aria-hidden />
      </summary>
      <div>
        <button type="button" onClick={() => launch("project")}>
          从项目入口开始
        </button>
        <button type="button" onClick={() => launch("chapter")}>
          从当前章节开始
        </button>
        <button
          type="button"
          disabled={!model.selectedBlock}
          onClick={() => launch("block")}
        >
          从当前 Block 开始
        </button>
      </div>
    </details>
  );
}

export function EditorFastPreviewOverlay({
  session,
  model,
  onClose,
}: {
  session: EditorFastPreviewSession;
  model: Extract<EditorPageViewModel, { status: "ready" }>;
  onClose: () => void;
}) {
  return (
    <Suspense fallback={<div className="page-loading">正在启动快速预演…</div>}>
      <FastPreviewWorkspace
        document={session.document}
        startCursor={session.startCursor}
        onOpenWindow={() =>
          openFastPreviewWindow({
            projectId: model.projectId,
            document: session.document,
            startCursor: session.startCursor,
            latestDocument: () => model.documentRef.current ?? model.document,
          })
        }
        onExit={(snapshot) => {
          onClose();
          if (!snapshot) return;
          model.setSelectedChapterId(snapshot.chapterId);
          model.setSelectedFragmentId(snapshot.fragmentId);
          const blockId =
            snapshot.frame.mode === "content"
              ? snapshot.frame.block.id
              : undefined;
          if (blockId) model.setSelectedBlockId(blockId);
          model.setPlaybackFollow({
            chapterId: snapshot.chapterId,
            fragmentId: snapshot.fragmentId,
            positionMs: snapshot.positionMs,
            blockId,
          });
          window.setTimeout(() => {
            if (blockId)
              globalThis.document
                .querySelector(`[data-block-id="${blockId}"]`)
                ?.scrollIntoView({ block: "center" });
          });
        }}
      />
    </Suspense>
  );
}
