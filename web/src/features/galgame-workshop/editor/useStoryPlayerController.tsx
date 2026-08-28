import { useEffect, useRef } from "react";
import type { GalgameStoryBlock } from "@features/galgame-workshop/api";
import { leaveContentBlock } from "@features/galgame-workshop/editor/stage";
import { estimatedCueDuration } from "@features/galgame-workshop/editor/timeline";
import {
  continueRuntime,
  continueRuntimeWithVariable,
} from "@features/galgame-workshop/editor/storyRuntime";
import {
  richTextDocument,
  richTextPlainText,
  richTextWaitEvents,
  resolvedRichTextDocument,
  truncateRichText,
} from "@features/galgame-workshop/editor/richText";
import {
  playerContentText,
  type StoryPlayerProps,
} from "@features/galgame-workshop/editor/storyPlayerModel";

import { useStoryPlayerTimelineController } from "./useStoryPlayerTimelineController";
import { useStoryPlayerBase } from "./useStoryPlayerBase";
export function useStoryPlayerController({
  document: sourceDocument,
  previewExpressionIds,
  locale,
  includeStaleTranslations = false,
  startCursor,
  mode = "play",
  suppressMissingPortraitFallback = false,
  showAuthoringOverlays = true,
  chrome = "full",
  editFragment: sourceEditFragment,
  editBlockIndex,
  editTimelinePositionMs,
  editableCgBlockId,
  collapsed = false,
  onCollapsedChange,
  viewportPreferences: viewportPreferencesProp,
  onViewportPreferencesChange,
  headerModeControl,
  workbenchHeader = false,
  onCgOverlayChange,
  onPlaybackPosition,
  playbackRange,
  exportMode,
}: StoryPlayerProps) {
  const base = useStoryPlayerBase({
    document: sourceDocument,
    previewExpressionIds,
    locale,
    includeStaleTranslations,
    startCursor,
    mode,
    suppressMissingPortraitFallback,
    showAuthoringOverlays,
    chrome,
    editFragment: sourceEditFragment,
    editBlockIndex,
    editTimelinePositionMs,
    editableCgBlockId,
    collapsed,
    onCollapsedChange,
    viewportPreferences: viewportPreferencesProp,
    onViewportPreferencesChange,
    headerModeControl,
    workbenchHeader,
    onCgOverlayChange,
    onPlaybackPosition,
    playbackRange,
    exportMode,
  });
  const {
    activeDialogue,
    activeDialogueAvatar,
    activeFragment,
    stageScenes,
    activeTimeline,
    activeVideoAsset,
    activeVideoOffsetMs,
    activeVoiceAsset,
    advanceMode,
    advanceRef,
    aspectMenuOpen,
    aspectParts,
    autoplayBlocked,
    characters,
    currentAudioLevelDb,
    customHeightDraft,
    customUiComponents,
    customWidthDraft,
    dialogueAvatarAsset,
    dialogueSkinAsset,
    dialogueStyle,
    displayFrame,
    document,
    editFragment,
    exportCompletedRef,
    frame,
    inlinePlayerWait,
    inlineWaitReleaseRef,
    lipSyncSpeaking,
    mix,
    mixerOpen,
    palette,
    pendingRef,
    revealTextImmediatelyRef,
    runtimeRef,
    runtimeVariables,
    scenes,
    showAuthoringOverlays: resolvedShowAuthoringOverlays,
    selectedExportChoiceId,
    setAspectMenuOpen,
    setAutoplayBlocked,
    setCustomHeightDraft,
    setCustomWidthDraft,
    setInlinePlayerWait,
    setMix,
    setMixerOpen,
    setVisibleTextLength,
    stageActors,
    stageCgs,
    stageStyle,
    timelinePlaying,
    timelinePositionMs,
    tryPlay,
    updateViewportPreferences,
    videoUrl,
    viewportPreferences,
    visibleTextLength,
    mouthFrame,
    voiceRef,
  } = base;
  const timeline = useStoryPlayerTimelineController(base);
  const {
    enterFragment,
    fadeCurrentVoice,
    presentRuntime,
    restart,
    seekTimeline,
    selectAdvanceMode,
    skipTimelineStep,
    toggleTimeline,
  } = timeline;
  const paragraphSourceFragment =
    mode === "edit" ? editFragment : activeFragment;
  const paragraphGroup =
    displayFrame.mode === "content" &&
    displayFrame.block.type === "storyParagraph" &&
    paragraphSourceFragment
      ? (() => {
          const blocks = paragraphSourceFragment.blocks ?? [];
          let start = displayFrame.blockIndex;
          let end = displayFrame.blockIndex;
          while (start > 0 && blocks[start - 1]?.type === "storyParagraph")
            start -= 1;
          while (
            end + 1 < blocks.length &&
            blocks[end + 1]?.type === "storyParagraph"
          )
            end += 1;
          return {
            start,
            end,
            blocks: blocks
              .slice(start, end + 1)
              .filter(
                (
                  block,
                ): block is Extract<
                  GalgameStoryBlock,
                  { type: "storyParagraph" }
                > => block.type === "storyParagraph",
              ),
          };
        })()
      : undefined;
  const advance = () => {
    if (frame.mode !== "content") return;
    if (inlineWaitReleaseRef.current) {
      const release = inlineWaitReleaseRef.current;
      inlineWaitReleaseRef.current = null;
      setInlinePlayerWait(false);
      release();
      return;
    }
    const activeRichBlock =
      frame.block.type === "dialogue" ||
      frame.block.type === "narration" ||
      frame.block.type === "storyParagraph"
        ? frame.block
        : undefined;
    const pendingPlayerWait = activeRichBlock
      ? richTextWaitEvents(
          richTextDocument(activeRichBlock),
          runtimeRef.current.variables,
        ).find(
          (event) =>
            event.node.mode === "player" && event.offset >= visibleTextLength,
        )
      : undefined;
    if (pendingPlayerWait) {
      setVisibleTextLength(pendingPlayerWait.offset);
      return;
    }
    if (
      playerContentText(frame.block, runtimeRef.current.variables) &&
      visibleTextLength <
        Array.from(
          playerContentText(frame.block, runtimeRef.current.variables)!,
        ).length
    ) {
      revealTextImmediatelyRef.current = true;
      setVisibleTextLength(
        Array.from(
          playerContentText(frame.block, runtimeRef.current.variables)!,
        ).length,
      );
      return;
    }
    if (activeTimeline) {
      skipTimelineStep(1);
      return;
    }
    fadeCurrentVoice();
    const state = {
      ...runtimeRef.current,
      blockIndex:
        frame.block.type === "storyParagraph" && paragraphGroup
          ? paragraphGroup.end
          : runtimeRef.current.blockIndex,
      stage: leaveContentBlock(frame.stage, frame.block),
    };
    runtimeRef.current = state;
    presentRuntime(continueRuntime(document, state));
  };
  advanceRef.current = advance;

  useEffect(() => {
    if (
      mode !== "play" ||
      frame.mode !== "content" ||
      frame.block.type !== "wait" ||
      frame.block.mode !== "player"
    )
      return;
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key !== " " &&
        event.key !== "Enter" &&
        event.key !== "ArrowDown"
      )
        return;
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      )
        return;
      event.preventDefault();
      advanceRef.current();
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY <= 0) return;
      event.preventDefault();
      advanceRef.current();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", onWheel);
    };
  }, [advanceRef, frame, mode]);

  const displayText =
    displayFrame.mode === "content"
      ? displayFrame.block.type === "storyParagraph" && paragraphGroup
        ? paragraphGroup.blocks
            .map((block) => playerContentText(block, runtimeVariables) ?? "")
            .join("\n")
        : (playerContentText(displayFrame.block, runtimeVariables) ?? "")
      : "";
  const displayBlockId =
    displayFrame.mode === "content" ? displayFrame.block.id : "";
  const typewriterContextRef = useRef({
    frame: displayFrame,
    variables: runtimeVariables,
    defaultSpeedCps: document.presentation?.text?.defaultSpeedCps ?? 40,
  });
  typewriterContextRef.current = {
    frame: displayFrame,
    variables: runtimeVariables,
    defaultSpeedCps: document.presentation?.text?.defaultSpeedCps ?? 40,
  };

  const waitDurationMs =
    frame.mode === "content" && !activeTimeline
      ? frame.block.type === "wait"
        ? frame.block.mode === "player"
          ? exportMode
            ? 1200
            : null
          : advanceMode === "skip"
            ? 0
            : frame.block.durationMs
        : "waitForCompletion" in frame.block &&
            frame.block.waitForCompletion &&
            "durationMs" in frame.block &&
            typeof frame.block.durationMs === "number"
          ? frame.block.durationMs
          : null
      : null;
  useEffect(() => {
    if (mode !== "play" || waitDurationMs == null) return;
    const timer = window.setTimeout(
      () => advanceRef.current(),
      Math.max(0, waitDurationMs),
    );
    return () => window.clearTimeout(timer);
  }, [advanceRef, displayBlockId, mode, waitDurationMs]);

  useEffect(() => {
    if (!exportMode || !inlinePlayerWait) return;
    const timer = window.setTimeout(() => advanceRef.current(), 300);
    return () => window.clearTimeout(timer);
  }, [advanceRef, exportMode, inlinePlayerWait]);

  useEffect(() => {
    if (
      !exportMode ||
      frame.mode !== "content" ||
      frame.block.type !== "systemMessage"
    )
      return;
    const timer = window.setTimeout(() => resolveSystemMessage(true), 1200);
    return () => window.clearTimeout(timer);
    // resolveSystemMessage follows the current runtime frame by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportMode, displayBlockId]);

  useEffect(() => {
    if (!exportMode || exportCompletedRef.current) return;
    if (frame.mode !== "ending" && frame.mode !== "error") return;
    exportCompletedRef.current = true;
    exportMode.onComplete?.({
      ok: frame.mode === "ending",
      label: frame.mode === "ending" ? frame.label : frame.message,
    });
  }, [exportCompletedRef, exportMode, frame]);

  useEffect(() => {
    const typewriterContext = typewriterContextRef.current;
    const typewriterFrame = typewriterContext.frame;
    revealTextImmediatelyRef.current = false;
    if (!displayText) {
      setVisibleTextLength(0);
      return;
    }
    if (
      (typewriterFrame.mode === "content" &&
        typewriterFrame.block.type === "storyParagraph" &&
        runtimeRef.current.paragraph.revealEffect === "instant") ||
      (typewriterFrame.mode === "content" &&
        (exportMode?.timelineRange ?? playbackRange)?.fragmentId ===
          typewriterFrame.fragmentId &&
        "startMs" in typewriterFrame.block &&
        typeof typewriterFrame.block.startMs === "number" &&
        typewriterFrame.block.startMs <
          (exportMode?.timelineRange ?? playbackRange)!.startMs) ||
      globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      setVisibleTextLength(Array.from(displayText).length);
      return;
    }
    const characters = Array.from(displayText);
    const authoredSpeed =
      typewriterFrame.mode === "content" &&
      typewriterFrame.block.type === "storyParagraph"
        ? typewriterFrame.block.textSpeedCps
        : 0;
    const speed =
      authoredSpeed ||
      runtimeRef.current.paragraph.textSpeedCps ||
      typewriterContext.defaultSpeedCps;
    const authoredDurationMs = Math.max(50, (characters.length / speed) * 1000);
    const durationMs =
      advanceMode === "auto" && activeTimeline?.masterAudio
        ? Math.min(300, authoredDurationMs)
        : authoredDurationMs;
    const stepMs =
      advanceMode === "skip"
        ? 0
        : Math.max(16, durationMs / Math.max(1, characters.length));
    const charactersPerStep =
      advanceMode === "auto" && activeTimeline?.masterAudio
        ? Math.max(
            1,
            Math.ceil(
              characters.length /
                Math.max(1, Math.floor(durationMs / Math.max(1, stepMs))),
            ),
          )
        : 1;
    const waitEvents =
      typewriterFrame.mode === "content" &&
      (typewriterFrame.block.type === "dialogue" ||
        typewriterFrame.block.type === "narration" ||
        typewriterFrame.block.type === "storyParagraph")
        ? richTextWaitEvents(
            richTextDocument(typewriterFrame.block),
            typewriterContext.variables,
          )
        : [];
    setVisibleTextLength(0);
    setInlinePlayerWait(false);
    inlineWaitReleaseRef.current = null;
    let visible = 0;
    let waitIndex = 0;
    let timer: number | undefined;
    let cancelled = false;
    const schedule = (delay: number) => {
      timer = window.setTimeout(tick, delay);
    };
    const tick = () => {
      if (cancelled || revealTextImmediatelyRef.current) return;
      const wait = waitEvents[waitIndex];
      if (wait && wait.offset <= visible) {
        waitIndex += 1;
        if (wait.node.mode === "player") {
          setInlinePlayerWait(true);
          inlineWaitReleaseRef.current = () => schedule(stepMs);
          return;
        }
        schedule(advanceMode === "skip" ? 0 : (wait.node.durationMs ?? 0));
        return;
      }
      visible = Math.min(characters.length, visible + charactersPerStep);
      setVisibleTextLength(visible);
      if (visible < characters.length) schedule(stepMs);
    };
    schedule(stepMs);
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
      inlineWaitReleaseRef.current = null;
    };
  }, [
    activeTimeline?.masterAudio,
    advanceMode,
    displayBlockId,
    displayText,
    exportMode?.timelineRange,
    inlineWaitReleaseRef,
    mode,
    playbackRange,
    revealTextImmediatelyRef,
    runtimeRef,
    setInlinePlayerWait,
    setVisibleTextLength,
  ]);

  useEffect(() => {
    if (
      mode !== "play" ||
      (advanceMode !== "auto" && advanceMode !== "skip") ||
      activeTimeline ||
      activeVoiceAsset ||
      frame.mode !== "content" ||
      !playerContentText(frame.block, runtimeRef.current.variables)
    )
      return;
    const timer = window.setTimeout(
      () => advanceRef.current(),
      advanceMode === "skip"
        ? 0
        : estimatedCueDuration(
            playerContentText(frame.block, runtimeRef.current.variables) ?? "",
          ),
    );
    return () => window.clearTimeout(timer);
  }, [
    activeTimeline,
    activeVoiceAsset,
    advanceMode,
    advanceRef,
    frame,
    mode,
    runtimeRef,
  ]);

  const visibleRichContent =
    displayFrame.mode === "content" &&
    (displayFrame.block.type === "dialogue" ||
      displayFrame.block.type === "narration")
      ? truncateRichText(
          richTextDocument(displayFrame.block),
          runtimeVariables,
          visibleTextLength,
        )
      : undefined;
  const paragraphVisibleContents = paragraphGroup
    ? (() => {
        let remaining = visibleTextLength;
        return paragraphGroup.blocks.map((block) => {
          const content = resolvedRichTextDocument(
            richTextDocument(block),
            runtimeVariables,
          );
          const length = Array.from(richTextPlainText(content)).length;
          const visible = truncateRichText(content, {}, remaining);
          remaining = Math.max(0, remaining - length - 1);
          return { block, content: visible };
        });
      })()
    : [];
  const systemMessageStyle = (() => {
    const binding = document.presentation?.systemMessage?.binding;
    if (binding?.source !== "project") return undefined;
    return document.presentation?.systemMessage?.customStyles?.find(
      (style) => style.id === binding.id,
    );
  })();
  const resolveSystemMessage = (accepted: boolean) => {
    if (frame.mode !== "content" || frame.block.type !== "systemMessage")
      return;
    if (activeTimeline) {
      if (frame.block.resultVariableId)
        runtimeRef.current = {
          ...runtimeRef.current,
          variables: {
            ...runtimeRef.current.variables,
            [frame.block.resultVariableId]: accepted,
          },
        };
      skipTimelineStep(1);
      return;
    }
    presentRuntime(
      continueRuntimeWithVariable(
        document,
        runtimeRef.current,
        frame.block.resultVariableId,
        accepted,
      ),
    );
  };

  return {
    mode,
    chrome,
    editableCgBlockId,
    collapsed,
    onCollapsedChange,
    headerModeControl,
    workbenchHeader,
    onCgOverlayChange,
    document,
    frame,
    runtimeRef,
    mix,
    setMix,
    mixerOpen,
    setMixerOpen,
    aspectMenuOpen,
    setAspectMenuOpen,
    viewportPreferences,
    updateViewportPreferences,
    customWidthDraft,
    setCustomWidthDraft,
    customHeightDraft,
    setCustomHeightDraft,
    aspectParts,
    advanceMode,
    visibleTextLength,
    inlinePlayerWait,
    advanceRef,
    autoplayBlocked,
    setAutoplayBlocked,
    timelinePositionMs,
    timelinePlaying,
    mouthFrame,
    voiceRef,
    pendingRef,
    tryPlay,
    characters,
    scenes,
    showAuthoringOverlays: resolvedShowAuthoringOverlays,
    displayFrame,
    palette,
    activeDialogue,
    runtimeVariables,
    activeTimeline,
    stageScenes,
    activeVideoAsset,
    activeVideoOffsetMs,
    videoUrl,
    stageCgs,
    dialogueStyle,
    dialogueSkinAsset,
    stageStyle,
    lipSyncSpeaking,
    currentAudioLevelDb,
    stageActors,
    activeDialogueAvatar,
    dialogueAvatarAsset,
    customUiComponents,
    restart,
    enterFragment,
    seekTimeline,
    skipTimelineStep,
    toggleTimeline,
    selectAdvanceMode,
    paragraphGroup,
    advance,
    displayText,
    visibleRichContent,
    paragraphVisibleContents,
    systemMessageStyle,
    resolveSystemMessage,
    exportMode,
    selectedExportChoiceId,
  };
}
