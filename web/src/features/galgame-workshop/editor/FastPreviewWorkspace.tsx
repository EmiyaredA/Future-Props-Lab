import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ExternalLink,
  Eye,
  Film,
  Image,
  Pause,
  Play,
  Repeat2,
  RotateCcw,
  SkipBack,
  SkipForward,
  X,
} from "lucide-react";
import type { GalgameStoryProject } from "@features/galgame-workshop/api";
import {
  StoryPlayer,
  type StoryPlayerHandle,
} from "@features/galgame-workshop/editor/StoryPlayer";
import { FastPreviewDialogueQueue } from "@features/galgame-workshop/editor/FastPreviewDialogueQueue";
import {
  FastPreviewInspector,
  type FastPreviewInspectorTab,
} from "@features/galgame-workshop/editor/FastPreviewInspector";
import type {
  FastPreviewDialogueDraft,
  FastPreviewDialogueEdit,
  FastPreviewDialogueEditResult,
} from "@features/galgame-workshop/editor/fastPreviewDialogueEdit";
import {
  formatTimelineTime,
  playerContentText,
  type FastPreviewCursor,
  type StoryPlayerPlaybackRange,
  type StoryPlayerRuntimeSnapshot,
} from "@features/galgame-workshop/editor/storyPlayerModel";
import { visibleStageActors } from "@features/galgame-workshop/editor/stage";
import {
  loadFastPreviewAutoRevealPortraits,
  loadFastPreviewAuthoringOverlays,
  saveFastPreviewAutoRevealPortraits,
  saveFastPreviewAuthoringOverlays,
} from "@features/galgame-workshop/editor/fastPreviewPreferences";
import { revealHiddenDialoguePortraits } from "@features/galgame-workshop/editor/fastPreviewPortraits";
import {
  fastPreviewExpressionOverrides,
  fastPreviewPortraitWarmupFileIds,
  fastPreviewStageActorEditors,
  type FastPreviewStageActorEditor,
} from "@features/galgame-workshop/editor/fastPreviewStageActors";
import { useFastPreviewDialogueDrafts } from "@features/galgame-workshop/editor/useFastPreviewDialogueDrafts";
import { useFastPreviewDraftSaving } from "@features/galgame-workshop/editor/useFastPreviewDraftSaving";
import { useFastPreviewExactFrame } from "@features/galgame-workshop/editor/useFastPreviewExactFrame";
import { useFastPreviewSourceDocument } from "@features/galgame-workshop/editor/useFastPreviewSourceDocument";
import {
  applyFastPreviewStageExpressionEdit,
  stageSourceExpressionId,
  type FastPreviewStageExpressionDraft,
  type FastPreviewStageExpressionEdit,
  type FastPreviewStageExpressionEditResult,
} from "@features/galgame-workshop/editor/fastPreviewStageExpressionEdit";
import "@features/galgame-workshop/editor/fast-preview-workspace.css";

export function FastPreviewWorkspace({
  document: sourceDocument,
  startCursor,
  sourceNotice,
  projectId,
  storyRevision,
  exactFrameDisabledReason,
  onExit,
  onOpenWindow,
  onReload,
  playbackRange,
  renderDisabledReason,
  onRenderRange,
  onApplyDialogueEdit,
  onApplyStageExpressionEdit,
}: {
  document: GalgameStoryProject;
  startCursor: FastPreviewCursor;
  sourceNotice?: string;
  projectId?: string;
  storyRevision?: number;
  exactFrameDisabledReason?: string;
  onExit: (snapshot?: StoryPlayerRuntimeSnapshot) => void;
  onOpenWindow?: () => void;
  onReload?: () => void;
  playbackRange?: StoryPlayerPlaybackRange;
  renderDisabledReason?: string;
  onRenderRange?: (range: StoryPlayerPlaybackRange) => void;
  onApplyDialogueEdit?: (
    edit: FastPreviewDialogueEdit,
  ) => Promise<FastPreviewDialogueEditResult>;
  onApplyStageExpressionEdit?: (
    edit: FastPreviewStageExpressionEdit,
  ) => Promise<FastPreviewStageExpressionEditResult>;
}) {
  const playerRef = useRef<StoryPlayerHandle>(null);
  const editPauseRequestedRef = useRef(false);
  const editRestorePendingRef = useRef(false);
  const restorePositionRef = useRef<
    { positionMs: number; pauseAfterSeek: boolean } | undefined
  >(undefined);
  const snapshotRef = useRef<StoryPlayerRuntimeSnapshot | undefined>(undefined);
  const selectedSnapshotDialogueRef = useRef("");
  const [document, setPreviewDocument, currentRevision, setCurrentRevision] =
    useFastPreviewSourceDocument(sourceDocument, storyRevision);
  const [snapshot, setSnapshot] = useState<StoryPlayerRuntimeSnapshot>();
  const [tab, setTab] = useState<FastPreviewInspectorTab>("stage");
  const [selectedStageActorId, setSelectedStageActorId] = useState("");
  const [stageExpressionDraft, setStageExpressionDraft] =
    useState<FastPreviewStageExpressionDraft>();
  const [logs, setLogs] = useState<string[]>(["预演快照已冻结"]);
  const [rangeLoop, setRangeLoop] = useState(Boolean(playbackRange?.loop));
  const [showAuthoringOverlays, setShowAuthoringOverlays] = useState(
    loadFastPreviewAuthoringOverlays,
  );
  const [autoRevealPortraits, setAutoRevealPortraits] = useState(
    loadFastPreviewAutoRevealPortraits,
  );
  const {
    discardDraft,
    editDraft,
    editDirty,
    hasDirtyDrafts: dialogueHasDirtyDrafts,
    pendingDrafts: dialoguePendingDrafts,
    presentationRevision: dialoguePresentationRevision,
    previewDocument: dialoguePreviewDocument,
    selectDialogue,
    updateDraft,
  } = useFastPreviewDialogueDrafts(document);
  const stageExpressionDirty = Boolean(
    stageExpressionDraft &&
    stageSourceExpressionId(document, stageExpressionDraft) !==
      stageExpressionDraft.expressionId,
  );
  const {
    canSaveAll,
    message: editMessage,
    pendingCount: pendingDraftCount,
    saveAll,
    saveDialogue,
    saveStageExpression,
    saving: editSaving,
    setMessage: setEditMessage,
  } = useFastPreviewDraftSaving({
    dialogueDraft: editDraft,
    dialogueDrafts: dialoguePendingDrafts,
    dialogueDirty: editDirty,
    stageExpressionDraft,
    stageExpressionDirty,
    positionMs: snapshot?.positionMs ?? 0,
    playing: Boolean(snapshot?.playing),
    onPausePlayback: () => playerRef.current?.togglePlayback(),
    onRestorePosition: (positionMs) => {
      restorePositionRef.current = { positionMs, pauseAfterSeek: false };
      editRestorePendingRef.current = true;
    },
    onApplyDialogueEdit,
    onApplyStageExpressionEdit,
    onDiscardDialogueDraft: discardDraft,
    onDocument: setPreviewDocument,
    onRevision: setCurrentRevision,
  });
  const previewDocument = useMemo(
    () =>
      stageExpressionDraft
        ? applyFastPreviewStageExpressionEdit(dialoguePreviewDocument, {
            ...stageExpressionDraft,
            expressionId: stageExpressionDraft.expressionId || null,
          })
        : dialoguePreviewDocument,
    [dialoguePreviewDocument, stageExpressionDraft],
  );
  const playerDocument = useMemo(
    () =>
      autoRevealPortraits
        ? revealHiddenDialoguePortraits(previewDocument)
        : previewDocument,
    [autoRevealPortraits, previewDocument],
  );
  const effectivePlaybackRange = useMemo(
    () =>
      playbackRange
        ? {
            ...playbackRange,
            loop: rangeLoop,
            autoPlay: tab === "edit" ? false : playbackRange.autoPlay,
          }
        : undefined,
    [playbackRange, rangeLoop, tab],
  );
  const activeFragmentId =
    snapshot?.frame.mode === "content" || snapshot?.frame.mode === "stageOnly"
      ? snapshot.frame.fragmentId
      : (snapshot?.fragmentId ?? startCursor.fragmentId);
  const activeBlockIndex =
    snapshot?.frame.mode === "content"
      ? snapshot.frame.blockIndex
      : snapshot?.blockIndex;
  const snapshotVariables = snapshot?.variables;
  const activeFragment = useMemo(
    () =>
      previewDocument.chapters
        ?.flatMap((chapter) => chapter.fragments ?? [])
        .find((fragment) => fragment.id === activeFragmentId),
    [activeFragmentId, previewDocument.chapters],
  );
  const dialogueQueue = useMemo(() => {
    const content = (activeFragment?.blocks ?? []).flatMap(
      (block, blockIndex) => {
        const text = playerContentText(block, snapshotVariables);
        return text ? [{ block, blockIndex, text }] : [];
      },
    );
    const active = content.findIndex(
      (item) => item.blockIndex === activeBlockIndex,
    );
    return {
      previous: active > 0 ? content[active - 1] : undefined,
      current: active >= 0 ? content[active] : content[0],
      next: active >= 0 ? content[active + 1] : content[1],
    };
  }, [activeBlockIndex, activeFragment?.blocks, snapshotVariables]);
  const portraitWarmupFileIds = useMemo(
    () =>
      fastPreviewPortraitWarmupFileIds(playerDocument, [
        dialogueQueue.previous?.block,
        dialogueQueue.current?.block,
        dialogueQueue.next?.block,
      ]),
    [dialogueQueue, playerDocument],
  );

  useEffect(() => {
    playerRef.current?.restart();
    const restore = restorePositionRef.current;
    if (!restore) return;
    restorePositionRef.current = undefined;
    const timer = window.setTimeout(() => {
      playerRef.current?.seekTimeline(restore.positionMs);
      if (restore.pauseAfterSeek) playerRef.current?.togglePlayback();
      editRestorePendingRef.current = false;
    });
    return () => window.clearTimeout(timer);
  }, [
    autoRevealPortraits,
    document,
    dialoguePresentationRevision,
    startCursor.blockIndex,
    startCursor.chapterId,
    startCursor.fragmentId,
  ]);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("input, textarea, button, [role='combobox']")
      )
        return;
      if (event.key === "Escape") onExit(snapshot);
      else if (event.key === " ") {
        event.preventDefault();
        playerRef.current?.togglePlayback();
      } else if (event.key === "ArrowRight") playerRef.current?.nextDialogue();
      else if (event.key === "ArrowLeft") playerRef.current?.previousDialogue();
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [onExit, snapshot]);

  const receiveSnapshot = useCallback((next: StoryPlayerRuntimeSnapshot) => {
    snapshotRef.current = next;
    if (!next.playing) editPauseRequestedRef.current = false;
    setSnapshot(next);
    const blockId =
      next.frame.mode === "content" ? next.frame.block.id : next.frame.mode;
    setLogs((current) => {
      const line = `${formatTimelineTime(next.positionMs)} · ${blockId}`;
      return current[current.length - 1] === line
        ? current
        : [...current.slice(-39), line];
    });
  }, []);
  const actors = snapshot ? visibleStageActors(snapshot.stage) : [];
  const branches =
    snapshot?.frame.mode === "content" && snapshot.frame.block.type === "branch"
      ? snapshot.frame.block.choices
      : [];
  const snapshotDialogue =
    snapshot?.frame.mode === "content" &&
    snapshot.frame.block.type === "dialogue"
      ? snapshot.frame.block
      : undefined;
  const stageActorEditors = fastPreviewStageActorEditors({
    document: previewDocument,
    fragment: activeFragment,
    activeBlockIndex,
    positionMs: snapshot?.positionMs,
    actors,
    autoRevealPortraits,
  });
  useEffect(() => {
    if (!activeFragment) return;
    if (!snapshotDialogue) {
      const first = stageActorEditors.find((actor) => actor.source);
      if (
        first &&
        !stageActorEditors.some(
          (actor) => actor.characterId === selectedStageActorId,
        )
      ) {
        setSelectedStageActorId(first.characterId);
        setStageExpressionDraft(first.stageExpressionDraft);
      }
      return;
    }
    const selectionKey = `${activeFragment.id}:${snapshotDialogue.id}`;
    if (
      editRestorePendingRef.current &&
      selectedSnapshotDialogueRef.current === selectionKey
    )
      return;
    if (selectedSnapshotDialogueRef.current === selectionKey) return;
    const sourceBlock = document.chapters
      ?.flatMap((chapter) => chapter.fragments ?? [])
      .find((fragment) => fragment.id === activeFragment.id)
      ?.blocks?.find((block) => block.id === snapshotDialogue.id);
    if (sourceBlock?.type !== "dialogue") return;
    selectedSnapshotDialogueRef.current = selectionKey;
    setSelectedStageActorId(sourceBlock.characterId);
    selectDialogue(activeFragment.id, sourceBlock);
    setEditMessage(
      pendingDraftCount
        ? `已保留 ${pendingDraftCount} 个未保存草稿，可切回对应对白继续修改`
        : "",
    );
  }, [
    activeFragment,
    document.chapters,
    pendingDraftCount,
    selectDialogue,
    selectedStageActorId,
    setEditMessage,
    snapshotDialogue,
    stageActorEditors,
  ]);
  const editableBlock = previewDocument.chapters
    ?.flatMap((chapter) => chapter.fragments ?? [])
    .find((fragment) => fragment.id === editDraft.fragmentId)
    ?.blocks?.find((block) => block.id === editDraft.blockId);
  const editableDialogue =
    editableBlock?.type === "dialogue" ? editableBlock : undefined;
  const selectedStageActor = stageActorEditors.find(
    (actor) => actor.characterId === selectedStageActorId,
  );
  const editingStageExpression = Boolean(
    selectedStageActor?.source?.kind !== "dialogue" &&
    stageExpressionDraft?.characterId === selectedStageActor?.characterId,
  );
  const pauseForEditing = () => {
    const currentSnapshot = snapshotRef.current;
    if (!currentSnapshot?.playing || editPauseRequestedRef.current) return;
    editPauseRequestedRef.current = true;
    playerRef.current?.togglePlayback();
  };
  const {
    clearExactFrameError,
    closeExactFrame,
    exactFrame,
    exactFrameError,
    exactFrameLoading,
    exactFrameStale,
    exactFrameUnavailableReason,
    generateExactFrame,
    invalidateExactFrame,
  } = useFastPreviewExactFrame({
    projectId,
    revision: currentRevision,
    disabledReason: exactFrameDisabledReason,
    hasDirtyDrafts: dialogueHasDirtyDrafts || stageExpressionDirty,
    activeFragment,
    snapshot,
    pausePlayback: () => playerRef.current?.togglePlayback(),
  });
  const openQuickEdit = () => {
    pauseForEditing();
    setTab("edit");
  };
  const selectStageActor = (actor: FastPreviewStageActorEditor) => {
    if (!actor.source || !activeFragment) return;
    pauseForEditing();
    setSelectedStageActorId(actor.characterId);
    if (actor.stageExpressionDraft) {
      setStageExpressionDraft(actor.stageExpressionDraft);
      setEditMessage("");
      return;
    }
    selectDialogue(activeFragment.id, actor.sourceBlock!);
    setEditMessage(
      actor.source.block.id === snapshotDialogue?.id
        ? ""
        : `正在修改舞台角色 ${actor.name} 最近一次登场时的表情与立绘`,
    );
  };
  const updateEditDraft = (nextDraft: FastPreviewDialogueDraft) => {
    editRestorePendingRef.current = true;
    invalidateExactFrame();
    const currentSnapshot = snapshotRef.current;
    pauseForEditing();
    if (currentSnapshot)
      restorePositionRef.current = {
        positionMs: currentSnapshot.positionMs,
        pauseAfterSeek: false,
      };
    updateDraft(nextDraft);
    setEditMessage("未保存草稿已实时显示在画面中");
  };
  const updateStageExpressionDraft = (
    nextDraft: FastPreviewStageExpressionDraft,
  ) => {
    pauseForEditing();
    invalidateExactFrame();
    setStageExpressionDraft(nextDraft);
    setEditMessage("未保存表情草稿已实时显示在画面中");
  };
  return (
    <main
      className="galgame-fast-preview"
      data-authoring-overlays={showAuthoringOverlays ? "true" : "false"}
    >
      <header>
        <span>
          <strong>快速预演</strong>
          <small>
            轻量舞台预览（暂停时固定闭口，口型请以精确导出帧为准） ·{" "}
            {sourceNotice ?? "启动时内存快照"}
          </small>
        </span>
        <nav>
          {onReload ? (
            <button type="button" onClick={onReload}>
              <RotateCcw aria-hidden />
              重新载入编辑内容
            </button>
          ) : null}
          {onOpenWindow ? (
            <button type="button" onClick={onOpenWindow}>
              <ExternalLink aria-hidden />
              独立窗口
            </button>
          ) : null}
          <button
            type="button"
            aria-pressed={showAuthoringOverlays}
            onClick={() => {
              const visible = !showAuthoringOverlays;
              setShowAuthoringOverlays(visible);
              saveFastPreviewAuthoringOverlays(visible);
            }}
          >
            <Eye aria-hidden />
            {showAuthoringOverlays ? "隐藏辅助信息" : "显示辅助信息"}
          </button>
          <button
            type="button"
            disabled={Boolean(exactFrameUnavailableReason) || exactFrameLoading}
            title={exactFrameUnavailableReason}
            onClick={() => void generateExactFrame()}
          >
            <Image aria-hidden />
            {exactFrameLoading ? "正在生成精确帧…" : "生成当前精确帧"}
          </button>
          <button type="button" onClick={() => onExit(snapshot)}>
            <X aria-hidden />
            退出预演
          </button>
        </nav>
      </header>
      <section className="galgame-fast-preview-body">
        <FastPreviewDialogueQueue
          document={previewDocument}
          queue={dialogueQueue}
          onPrevious={() => playerRef.current?.previousDialogue()}
          onPlay={() => playerRef.current?.togglePlayback()}
          onNext={() => playerRef.current?.nextDialogue()}
        />
        <section className="galgame-fast-preview-stage">
          <StoryPlayer
            ref={playerRef}
            document={playerDocument}
            preloadFileIds={portraitWarmupFileIds}
            previewExpressionIds={fastPreviewExpressionOverrides(
              stageActorEditors,
            )}
            startCursor={startCursor}
            playbackRange={effectivePlaybackRange}
            mode="play"
            suppressMissingPortraitFallback
            showAuthoringOverlays={showAuthoringOverlays}
            chrome="stage-only"
            onRuntimeSnapshot={receiveSnapshot}
          />
          {exactFrame ? (
            <section
              className="galgame-fast-preview-exact-frame"
              data-stale={exactFrameStale ? "true" : undefined}
              aria-label="当前时间点精确导出帧"
            >
              <img src={exactFrame.url} alt="正式导出引擎生成的当前帧" />
              <header>
                <strong>精确导出帧</strong>
                <time>{formatTimelineTime(exactFrame.timeMs)}</time>
                {exactFrameStale ? <em>播放位置已变化，请重新生成</em> : null}
              </header>
              <footer>
                <button type="button" onClick={closeExactFrame}>
                  返回动态预览
                </button>
                <button
                  type="button"
                  disabled={exactFrameLoading}
                  onClick={() => void generateExactFrame()}
                >
                  {exactFrameLoading ? "正在生成…" : "重新生成"}
                </button>
              </footer>
            </section>
          ) : exactFrameError ? (
            <div className="galgame-fast-preview-exact-error" role="alert">
              <span>{exactFrameError}</span>
              <button type="button" onClick={clearExactFrameError}>
                关闭
              </button>
            </div>
          ) : null}
        </section>
        <FastPreviewInspector
          tab={tab}
          document={previewDocument}
          actors={actors}
          stageActors={stageActorEditors}
          selectedActor={selectedStageActor}
          selectedActorId={selectedStageActorId}
          editableDialogue={editableDialogue}
          dialogueDraft={editDraft}
          stageExpressionDraft={stageExpressionDraft}
          editingStageExpression={editingStageExpression}
          editingCurrentDialogue={editDraft.blockId === snapshotDialogue?.id}
          dialogueDirty={editDirty}
          stageExpressionDirty={stageExpressionDirty}
          saving={editSaving}
          message={editMessage}
          canSaveDialogue={Boolean(onApplyDialogueEdit)}
          canSaveStageExpression={Boolean(onApplyStageExpressionEdit)}
          canSaveAll={canSaveAll}
          pendingDraftCount={pendingDraftCount}
          autoRevealPortraits={autoRevealPortraits}
          positionMs={snapshot?.positionMs ?? 0}
          variables={snapshot?.variables ?? {}}
          branches={branches}
          logs={logs}
          onTab={setTab}
          onOpenEdit={openQuickEdit}
          onDialogueDraft={updateEditDraft}
          onStageExpressionDraft={updateStageExpressionDraft}
          onSaveDialogue={() => void saveDialogue()}
          onSaveStageExpression={() => void saveStageExpression()}
          onSaveAll={() => void saveAll()}
          onSelectStageActor={selectStageActor}
          onAutoRevealPortraits={(enabled) => {
            setAutoRevealPortraits(enabled);
            saveFastPreviewAutoRevealPortraits(enabled);
          }}
        />
      </section>
      <footer>
        <button
          type="button"
          onClick={() => {
            playerRef.current?.previousDialogue();
          }}
          disabled={!activeFragment?.timeline}
        >
          <SkipBack aria-hidden />
          <span>上一对白</span>
        </button>
        <button
          type="button"
          onClick={() => {
            playerRef.current?.togglePlayback();
          }}
        >
          {snapshot?.playing ? <Pause aria-hidden /> : <Play aria-hidden />}
          <span>
            {snapshot?.playing
              ? "暂停"
              : activeFragment?.timeline
                ? "播放"
                : "推进"}
          </span>
        </button>
        <button
          type="button"
          onClick={() => {
            playerRef.current?.nextDialogue();
          }}
        >
          <SkipForward aria-hidden />
          <span>下一对白</span>
        </button>
        {playbackRange ? (
          <button
            type="button"
            aria-pressed={rangeLoop}
            className={rangeLoop ? "active" : ""}
            onClick={() => setRangeLoop((current) => !current)}
          >
            <Repeat2 aria-hidden />
            <span>循环区间</span>
          </button>
        ) : null}
        {activeFragment?.timeline ? (
          <>
            <input
              type="range"
              min={playbackRange?.startMs ?? 0}
              max={playbackRange?.endMs ?? activeFragment.timeline.durationMs}
              step="100"
              value={snapshot?.positionMs ?? 0}
              onChange={(event) => {
                playerRef.current?.seekTimeline(Number(event.target.value));
              }}
              aria-label="快速预演时间轴"
            />
            <time>
              {formatTimelineTime(snapshot?.positionMs ?? 0)} /{" "}
              {formatTimelineTime(
                playbackRange?.endMs ?? activeFragment.timeline.durationMs,
              )}
              {playbackRange ? (
                <small>
                  区间 {formatTimelineTime(playbackRange.startMs)}–
                  {formatTimelineTime(playbackRange.endMs)}
                </small>
              ) : null}
            </time>
          </>
        ) : (
          <strong>
            步骤 {(snapshot?.blockIndex ?? 0) + 1} /{" "}
            {activeFragment?.blocks?.length ?? 0} · 左方向键不回写变量历史
          </strong>
        )}
        {playbackRange && onRenderRange ? (
          <button
            type="button"
            disabled={Boolean(renderDisabledReason)}
            title={renderDisabledReason}
            onClick={() => onRenderRange({ ...playbackRange, loop: rangeLoop })}
          >
            <Film aria-hidden />
            <span>渲染此区间</span>
          </button>
        ) : null}
      </footer>
    </main>
  );
}
