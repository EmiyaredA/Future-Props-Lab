import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bug,
  ExternalLink,
  Eye,
  Film,
  GitBranch,
  Image,
  ListTree,
  Pause,
  PencilLine,
  Play,
  Repeat2,
  RotateCcw,
  SkipBack,
  SkipForward,
  Variable,
  X,
} from "lucide-react";
import {
  previewGalgameVideoExportFrame,
  type GalgameStoryProject,
} from "@features/galgame-workshop/api";
import {
  StoryPlayer,
  type StoryPlayerHandle,
} from "@features/galgame-workshop/editor/StoryPlayer";
import { FastPreviewQuickEdit } from "@features/galgame-workshop/editor/FastPreviewQuickEdit";
import type {
  FastPreviewDialogueDraft,
  FastPreviewDialogueEdit,
  FastPreviewDialogueEditResult,
} from "@features/galgame-workshop/editor/fastPreviewDialogueEdit";
import {
  formatTimelineTime,
  playerContentText,
  type StoryPlayerPlaybackRange,
  type StoryPlayerRuntimeSnapshot,
} from "@features/galgame-workshop/editor/storyPlayerModel";
import { visibleStageActors } from "@features/galgame-workshop/editor/stage";
import {
  loadFastPreviewAuthoringOverlays,
  saveFastPreviewAuthoringOverlays,
} from "@features/galgame-workshop/editor/fastPreviewPreferences";
import { useFastPreviewDialogueDrafts } from "@features/galgame-workshop/editor/useFastPreviewDialogueDrafts";
import "@features/galgame-workshop/editor/fast-preview-workspace.css";

export type {
  FastPreviewDialogueEdit,
  FastPreviewDialogueEditResult,
} from "@features/galgame-workshop/editor/fastPreviewDialogueEdit";

export type FastPreviewCursor = {
  chapterId: string;
  fragmentId: string;
  blockIndex?: number;
};

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
}) {
  const playerRef = useRef<StoryPlayerHandle>(null);
  const editPauseRequestedRef = useRef(false);
  const editRestorePendingRef = useRef(false);
  const restorePositionRef = useRef<
    { positionMs: number; pauseAfterSeek: boolean } | undefined
  >(undefined);
  const snapshotRef = useRef<StoryPlayerRuntimeSnapshot | undefined>(undefined);
  const [document, setPreviewDocument] = useState(sourceDocument);
  const [currentRevision, setCurrentRevision] = useState(storyRevision);
  const [snapshot, setSnapshot] = useState<StoryPlayerRuntimeSnapshot>();
  const [tab, setTab] = useState<
    "stage" | "edit" | "variables" | "branches" | "logs"
  >("stage");
  const [editSaving, setEditSaving] = useState(false);
  const [editMessage, setEditMessage] = useState("");
  const [logs, setLogs] = useState<string[]>(["预演快照已冻结"]);
  const [rangeLoop, setRangeLoop] = useState(Boolean(playbackRange?.loop));
  const [showAuthoringOverlays, setShowAuthoringOverlays] = useState(
    loadFastPreviewAuthoringOverlays,
  );
  const [exactFrame, setExactFrame] = useState<{
    url: string;
    fragmentId: string;
    timeMs: number;
  }>();
  const [exactFrameLoading, setExactFrameLoading] = useState(false);
  const [exactFrameError, setExactFrameError] = useState("");
  const exactFrameRequestRef = useRef(0);
  const exactFrameUrlRef = useRef("");

  useEffect(() => {
    setPreviewDocument(sourceDocument);
    setCurrentRevision(storyRevision);
  }, [sourceDocument, storyRevision]);
  const {
    discardDraft,
    editDraft,
    editDirty,
    hasDirtyDrafts,
    pendingDraftCount,
    previewDocument,
    selectDialogue,
    updateDraft,
  } = useFastPreviewDialogueDrafts(document);
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
  }, [previewDocument, startCursor]);

  useEffect(
    () => () => {
      exactFrameRequestRef.current += 1;
      if (exactFrameUrlRef.current)
        URL.revokeObjectURL(exactFrameUrlRef.current);
    },
    [],
  );

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

  const receiveSnapshot = (next: StoryPlayerRuntimeSnapshot) => {
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
  };
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
  useEffect(() => {
    if (editRestorePendingRef.current) return;
    if (!snapshotDialogue || !activeFragment) return;
    const targetChanged =
      editDraft.fragmentId !== activeFragment.id ||
      editDraft.blockId !== snapshotDialogue.id;
    if (!targetChanged) return;
    const sourceBlock = document.chapters
      ?.flatMap((chapter) => chapter.fragments ?? [])
      .find((fragment) => fragment.id === activeFragment.id)
      ?.blocks?.find((block) => block.id === snapshotDialogue.id);
    if (sourceBlock?.type !== "dialogue") return;
    selectDialogue(activeFragment.id, sourceBlock);
    setEditMessage(
      pendingDraftCount
        ? `已保留 ${pendingDraftCount} 个未保存草稿，可切回对应对白继续修改`
        : "",
    );
  }, [
    activeFragment,
    document.chapters,
    editDraft.blockId,
    editDraft.fragmentId,
    pendingDraftCount,
    selectDialogue,
    snapshotDialogue,
  ]);
  const editableBlock = previewDocument.chapters
    ?.flatMap((chapter) => chapter.fragments ?? [])
    .find((fragment) => fragment.id === editDraft.fragmentId)
    ?.blocks?.find((block) => block.id === editDraft.blockId);
  const editableDialogue =
    editableBlock?.type === "dialogue" ? editableBlock : undefined;
  const pauseForEditing = () => {
    const currentSnapshot = snapshotRef.current;
    if (!currentSnapshot?.playing || editPauseRequestedRef.current) return;
    editPauseRequestedRef.current = true;
    playerRef.current?.togglePlayback();
  };
  const openQuickEdit = () => {
    pauseForEditing();
    setTab("edit");
  };
  const updateEditDraft = (nextDraft: FastPreviewDialogueDraft) => {
    editRestorePendingRef.current = true;
    exactFrameRequestRef.current += 1;
    setExactFrame(undefined);
    setExactFrameError("");
    if (exactFrameUrlRef.current) {
      URL.revokeObjectURL(exactFrameUrlRef.current);
      exactFrameUrlRef.current = "";
    }
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
  const applyDialogueEdit = async () => {
    if (
      editableDialogue?.type !== "dialogue" ||
      !editDraft.fragmentId ||
      !editDraft.blockId ||
      !onApplyDialogueEdit
    )
      return;
    if (snapshot?.playing) playerRef.current?.togglePlayback();
    const restorePosition = snapshot?.positionMs ?? 0;
    setEditSaving(true);
    setEditMessage("");
    try {
      const result = await onApplyDialogueEdit({
        fragmentId: editDraft.fragmentId,
        blockId: editDraft.blockId,
        text: editDraft.text,
        expressionId: editDraft.expressionId || null,
        portrait: editDraft.portrait,
      });
      restorePositionRef.current = {
        positionMs: restorePosition,
        pauseAfterSeek: false,
      };
      editRestorePendingRef.current = true;
      setPreviewDocument(result.document);
      setCurrentRevision(result.storyRevision);
      discardDraft(editDraft.fragmentId, editDraft.blockId);
      const remainingDrafts = Math.max(0, pendingDraftCount - 1);
      setEditMessage(
        remainingDrafts
          ? `已保存当前对白，另有 ${remainingDrafts} 个未保存草稿`
          : "已保存，当前区间可继续播放",
      );
    } catch (error) {
      setEditMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setEditSaving(false);
    }
  };
  const exactFrameUnavailableReason =
    exactFrameDisabledReason ??
    (hasDirtyDrafts
      ? "请先保存全部实时草稿，再生成精确导出帧"
      : !projectId || currentRevision == null
        ? "当前快照缺少已保存的项目修订信息"
        : !activeFragment?.timeline
          ? "当前片段没有精确时间轴"
          : !snapshot
            ? "快速预演尚未就绪"
            : undefined);
  const exactFrameStale = Boolean(
    exactFrame &&
    snapshot &&
    (exactFrame.fragmentId !== snapshot.fragmentId ||
      Math.abs(exactFrame.timeMs - snapshot.positionMs) >= 100),
  );
  const generateExactFrame = async () => {
    if (
      exactFrameUnavailableReason ||
      !projectId ||
      currentRevision == null ||
      !activeFragment?.timeline ||
      !snapshot
    )
      return;
    if (snapshot.playing) playerRef.current?.togglePlayback();
    const requestId = ++exactFrameRequestRef.current;
    const fragmentId = activeFragment.id;
    const timelineTimeMs = Math.min(
      snapshot.positionMs,
      Math.max(0, activeFragment.timeline.durationMs - 1),
    );
    const clipStartMs = Math.max(0, timelineTimeMs - 1000);
    const clipEndMs = Math.min(
      activeFragment.timeline.durationMs,
      timelineTimeMs + 1001,
    );
    setExactFrameLoading(true);
    setExactFrameError("");
    try {
      const blob = await previewGalgameVideoExportFrame(projectId, {
        expectedStoryRevision: currentRevision,
        locale: "zh",
        preset: "1080p30",
        scope: "clip",
        fragmentIds: [],
        branchSelections: [],
        captureFrame: { x: 0, y: 0, width: 1920, height: 1080 },
        clipRange: {
          fragmentId,
          startMs: clipStartMs,
          endMs: clipEndMs,
        },
        timeMs: timelineTimeMs - clipStartMs,
        width: 960,
      });
      if (requestId !== exactFrameRequestRef.current) return;
      const url = URL.createObjectURL(blob);
      const previousUrl = exactFrameUrlRef.current;
      exactFrameUrlRef.current = url;
      setExactFrame({ url, fragmentId, timeMs: timelineTimeMs });
      if (previousUrl) URL.revokeObjectURL(previousUrl);
    } catch (error) {
      if (requestId !== exactFrameRequestRef.current) return;
      setExactFrameError(
        error instanceof Error ? error.message : "精确导出帧生成失败",
      );
    } finally {
      if (requestId === exactFrameRequestRef.current)
        setExactFrameLoading(false);
    }
  };
  const closeExactFrame = () => {
    exactFrameRequestRef.current += 1;
    setExactFrameLoading(false);
    setExactFrameError("");
    setExactFrame(undefined);
    if (exactFrameUrlRef.current) {
      URL.revokeObjectURL(exactFrameUrlRef.current);
      exactFrameUrlRef.current = "";
    }
  };
  return (
    <main
      className="galgame-fast-preview"
      data-authoring-overlays={showAuthoringOverlays ? "true" : "false"}
    >
      <header>
        <span>
          <strong>快速预演</strong>
          <small>动态预演 · {sourceNotice ?? "启动时内存快照"}</small>
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
        <aside className="galgame-preview-dialogue-queue">
          {(["previous", "current", "next"] as const).map((position) => {
            const item = dialogueQueue[position];
            let speaker = "旁白";
            if (
              item &&
              item.block.type === "dialogue" &&
              "characterId" in item.block
            ) {
              const characterId = item.block.characterId;
              speaker =
                previewDocument.characters?.find(
                  (character) => character.id === characterId,
                )?.name ?? "角色";
            }
            return (
              <article key={position} className={`is-${position}`}>
                <small>
                  {position === "previous"
                    ? "前一句"
                    : position === "current"
                      ? "当前句"
                      : "下一句"}
                </small>
                <strong>{speaker}</strong>
                <p>{item?.text ?? "—"}</p>
              </article>
            );
          })}
        </aside>
        <section className="galgame-fast-preview-stage">
          <StoryPlayer
            ref={playerRef}
            document={previewDocument}
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
              <button type="button" onClick={() => setExactFrameError("")}>
                关闭
              </button>
            </div>
          ) : null}
        </section>
        <aside className="galgame-fast-preview-inspector">
          <nav>
            <button
              className={tab === "stage" ? "active" : ""}
              onClick={() => setTab("stage")}
            >
              <ListTree aria-hidden />
              舞台
            </button>
            <button
              className={tab === "edit" ? "active" : ""}
              onClick={openQuickEdit}
            >
              <PencilLine aria-hidden />
              快速修改
            </button>
            <button
              className={tab === "variables" ? "active" : ""}
              onClick={() => setTab("variables")}
            >
              <Variable aria-hidden />
              变量
            </button>
            <button
              className={tab === "branches" ? "active" : ""}
              onClick={() => setTab("branches")}
            >
              <GitBranch aria-hidden />
              分支
            </button>
            <button
              className={tab === "logs" ? "active" : ""}
              onClick={() => setTab("logs")}
            >
              <Bug aria-hidden />
              日志
            </button>
          </nav>
          <div>
            {tab === "stage"
              ? actors.map((actor) => (
                  <article key={actor.characterId}>
                    <strong>
                      {previewDocument.characters?.find(
                        (character) => character.id === actor.characterId,
                      )?.name ?? actor.characterId}
                    </strong>
                    <small>
                      {actor.positionId ?? "自定义位置"} · {actor.distance}
                    </small>
                  </article>
                ))
              : null}
            {tab === "edit" ? (
              editableDialogue ? (
                <FastPreviewQuickEdit
                  document={previewDocument}
                  block={editableDialogue}
                  draft={editDraft}
                  positionMs={snapshot?.positionMs ?? 0}
                  dirty={editDirty}
                  saving={editSaving}
                  message={editMessage}
                  canSave={Boolean(onApplyDialogueEdit)}
                  onDraft={updateEditDraft}
                  onSave={() => void applyDialogueEdit()}
                />
              ) : (
                <p>当前时间点不是可编辑对白。</p>
              )
            ) : null}
            {tab === "variables"
              ? Object.entries(snapshot?.variables ?? {}).map(
                  ([key, value]) => (
                    <article key={key}>
                      <strong>
                        {previewDocument.variables?.find(
                          (item) => item.id === key,
                        )?.name ?? key}
                      </strong>
                      <code>{String(value)}</code>
                    </article>
                  ),
                )
              : null}
            {tab === "branches"
              ? branches.map((choice) => (
                  <article key={choice.id}>
                    <strong>{choice.text || "未命名选项"}</strong>
                    <small>{choice.targetFragmentId}</small>
                  </article>
                ))
              : null}
            {tab === "logs"
              ? logs.map((line, index) => (
                  <code key={`${line}-${index}`}>{line}</code>
                ))
              : null}
            {tab === "stage" && !actors.length ? <p>舞台上没有角色</p> : null}
            {tab === "branches" && !branches.length ? (
              <p>当前没有待选分支</p>
            ) : null}
          </div>
        </aside>
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
