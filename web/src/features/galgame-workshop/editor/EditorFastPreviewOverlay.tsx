import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ChevronDown, Play } from "lucide-react";
import type { EditorPageViewModel } from "@features/galgame-workshop/editor/editorViewModel";
import {
  applyFastPreviewDialogueEdit,
  type FastPreviewDialogueEdit,
} from "@features/galgame-workshop/editor/fastPreviewDialogueEdit";
import {
  createEditorFastPreviewSession,
  type EditorFastPreviewSession,
} from "@features/galgame-workshop/editor/editorFastPreviewSession";
import { openFastPreviewWindow } from "@features/galgame-workshop/editor/fastPreviewSession";
import { updateBlock } from "@features/galgame-workshop/editor/model";

const FastPreviewWorkspace = lazy(() =>
  import("@features/galgame-workshop/editor/FastPreviewWorkspace").then(
    (module) => ({ default: module.FastPreviewWorkspace }),
  ),
);

export function EditorFastPreviewRunMenu({
  model,
  onLaunch,
  onConfigureRange,
}: {
  model: Extract<EditorPageViewModel, { status: "ready" }>;
  onLaunch: (session: EditorFastPreviewSession) => void;
  onConfigureRange: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeMenu = () => setMenuOpen(false);
  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      toggleRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);
  const launch = (scope: "project" | "chapter" | "block") => {
    closeMenu();
    onLaunch(
      createEditorFastPreviewSession({
        document: model.document,
        scope,
        chapter: model.chapter,
        selectedFragment: model.selectedFragment,
        selectedIndex: model.selectedIndex,
      }),
    );
  };
  return (
    <div ref={menuRef} className="galgame-run-menu" style={{ display: "flex" }}>
      <button
        type="button"
        className="galgame-preview-launch"
        aria-label="开始试玩"
        onClick={() => launch("project")}
      >
        <Play aria-hidden /> 运行
      </button>
      <button
        ref={toggleRef}
        type="button"
        className="galgame-preview-launch"
        style={{ paddingInline: 8 }}
        aria-label="打开运行菜单"
        aria-expanded={menuOpen}
        aria-haspopup="true"
        onClick={() => setMenuOpen((open) => !open)}
      >
        <ChevronDown aria-hidden />
      </button>
      {menuOpen ? (
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
          <button
            type="button"
            disabled={!model.selectedFragment?.timeline}
            title={
              model.selectedFragment?.timeline
                ? undefined
                : "当前 Fragment 没有时间轴"
            }
            onClick={() => {
              closeMenu();
              onConfigureRange();
            }}
          >
            预演时间区间
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function EditorFastPreviewOverlay({
  session,
  model,
  onClose,
  onRenderRange,
}: {
  session: EditorFastPreviewSession;
  model: Extract<EditorPageViewModel, { status: "ready" }>;
  onClose: () => void;
  onRenderRange: (
    range: NonNullable<EditorFastPreviewSession["playbackRange"]>,
  ) => void;
}) {
  const applyDialogueEdit = async (edit: FastPreviewDialogueEdit) => {
    const current = model.documentRef.current ?? model.document;
    const next = updateBlock(current, edit.fragmentId, edit.blockId, (block) =>
      block.type === "dialogue"
        ? applyFastPreviewDialogueEdit(block, edit)
        : block,
    );
    if (!(await model.commitDocument(next)))
      throw new Error("保存失败或故事版本已发生冲突");
    return {
      document: next,
      storyRevision: model.revisionRef.current,
    };
  };
  const exactFrameDisabledReason = model.conflict
    ? "存在版本冲突，解决后才能生成精确帧"
    : model.saveState === "saving"
      ? "故事仍在保存，保存完成后才能生成精确帧"
      : model.saveState !== "saved"
        ? "当前故事尚未成功保存"
        : undefined;
  const renderDisabledReason = model.conflict
    ? "存在版本冲突，解决后才能渲染"
    : model.saveState === "saving"
      ? "故事仍在保存，保存完成后才能渲染"
      : model.saveState !== "saved"
        ? "当前故事尚未成功保存"
        : undefined;
  return (
    <Suspense fallback={<div className="page-loading">正在启动快速预演…</div>}>
      <FastPreviewWorkspace
        projectId={model.projectId}
        storyRevision={model.revisionRef.current}
        exactFrameDisabledReason={exactFrameDisabledReason}
        document={session.document}
        startCursor={session.startCursor}
        playbackRange={session.playbackRange}
        renderDisabledReason={renderDisabledReason}
        onRenderRange={onRenderRange}
        onApplyDialogueEdit={applyDialogueEdit}
        onOpenWindow={() =>
          openFastPreviewWindow({
            projectId: model.projectId,
            storyRevision: model.revisionRef.current,
            exactFrameDisabledReason,
            document: session.document,
            startCursor: session.startCursor,
            playbackRange: session.playbackRange,
            latestDocument: () => model.documentRef.current ?? model.document,
            applyDialogueEdit,
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
