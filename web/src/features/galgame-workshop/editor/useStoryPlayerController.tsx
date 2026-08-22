import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  GalgameStoryBlock,
  GalgameStoryFragment,
} from "@features/galgame-workshop/api";
import { resolveDialogueBoxStyle } from "@features/galgame-workshop/api";
import {
  DEFAULT_STAGE_STYLE,
  DEFAULT_UI_STYLE,
  chapterById,
  entryChapter,
  fragmentById,
  scenePalette,
} from "@features/galgame-workshop/editor/model";
import {
  emptyStageState,
  enterContentBlock,
  leaveContentBlock,
  replayStageAtTime,
  replayStageToBlock,
  visibleStageActors,
} from "@features/galgame-workshop/editor/stage";
import { characterExpressionAssetId } from "@features/galgame-workshop/editor/richText";
import { dialogueSpeakerIds } from "@features/galgame-workshop/editor/dialogue";
import { resolveLipSyncPresentation } from "@features/galgame-workshop/editor/lipSync";
import {
  loadStageViewportPreferences,
  resolveStageAspectParts,
  storeStageViewportPreferences,
  type StageViewportPreferences,
} from "@features/galgame-workshop/editor/stageViewportPreferences";
import { TimelineClock } from "@features/galgame-workshop/editor/timelineClock";
import {
  activeTimelineCue,
  estimatedCueDuration,
  timelineEvents,
  timelinePlaybackSteps,
} from "@features/galgame-workshop/editor/timeline";
import {
  advanceRuntime,
  chooseRuntimeFragment,
  continueRuntime,
  continueRuntimeWithVariable,
  initialRuntime,
  type StoryRuntimeResult,
  type StoryRuntimeState,
} from "@features/galgame-workshop/editor/storyRuntime";
import {
  inlineExpressionAt,
  richTextDocument,
  richTextPlainText,
  richTextWaitEvents,
  resolvedRichTextDocument,
  truncateRichText,
} from "@features/galgame-workshop/editor/richText";
import { localizedStoryDocument } from "@features/galgame-workshop/editor/localization";
import { useStoryPlayerAudio } from "@features/galgame-workshop/editor/useStoryPlayerAudio";
import {
  timelineExportBounds,
  timelineExportVideoOffset,
  timelineExportVoiceOffset,
  useStoryPlayerPlaybackFollow,
  useStoryPlayerVideoUrl,
} from "@features/galgame-workshop/editor/useStoryPlayerPlaybackFollow";
import { useStoryPlayerVoicePlayback } from "@features/galgame-workshop/editor/useStoryPlayerVoicePlayback";
import {
  DEFAULT_STORY_PLAYER_MIX,
  playerContentText,
  type PlayerFrame,
  type StoryPlayerHandle,
  type StoryPlayerProps,
  type TimelinePlayback,
} from "@features/galgame-workshop/editor/storyPlayerModel";
import type { ForwardedRef } from "react";

const TIMELINE_UI_UPDATE_INTERVAL_MS = 100;

export function useStoryPlayerController(
  {
    document: sourceDocument,
    locale,
    includeStaleTranslations = false,
    startCursor,
    mode = "play",
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
    exportMode,
  }: StoryPlayerProps,
  ref: ForwardedRef<StoryPlayerHandle>,
) {
  const document = useMemo(
    () =>
      localizedStoryDocument(sourceDocument, locale, {
        includeStale: includeStaleTranslations,
      }),
    [includeStaleTranslations, locale, sourceDocument],
  );
  const editFragment = useMemo(() => {
    if (!sourceEditFragment) return undefined;
    const chapterIndex = (sourceDocument.chapters ?? []).findIndex((chapter) =>
      chapter.fragments?.some((fragment) => fragment === sourceEditFragment),
    );
    if (chapterIndex < 0) return sourceEditFragment;
    return document.chapters?.[chapterIndex]?.fragments?.find(
      (fragment) => fragment.id === sourceEditFragment.id,
    );
  }, [document.chapters, sourceDocument.chapters, sourceEditFragment]);
  const [frame, setFrame] = useState<PlayerFrame>({
    mode: "idle",
    stage: emptyStageState(),
  });
  const runtimeRef = useRef<StoryRuntimeState>(initialRuntime(document));
  const [mix, setMix] = useState(DEFAULT_STORY_PLAYER_MIX);
  const [mixerOpen, setMixerOpen] = useState(false);
  const [aspectMenuOpen, setAspectMenuOpen] = useState(false);
  const [localViewportPreferences, setLocalViewportPreferences] = useState(
    loadStageViewportPreferences,
  );
  const viewportPreferences =
    viewportPreferencesProp ?? localViewportPreferences;
  const updateViewportPreferences = useCallback(
    (next: StageViewportPreferences) => {
      if (onViewportPreferencesChange) {
        onViewportPreferencesChange(next);
        return;
      }
      setLocalViewportPreferences(next);
      storeStageViewportPreferences(next);
    },
    [onViewportPreferencesChange],
  );
  const [customWidthDraft, setCustomWidthDraft] = useState(
    String(viewportPreferences.customWidth),
  );
  const [customHeightDraft, setCustomHeightDraft] = useState(
    String(viewportPreferences.customHeight),
  );
  useEffect(() => {
    setCustomWidthDraft(String(viewportPreferences.customWidth));
    setCustomHeightDraft(String(viewportPreferences.customHeight));
  }, [viewportPreferences.customWidth, viewportPreferences.customHeight]);
  const aspectParts = resolveStageAspectParts(viewportPreferences);
  const [advanceMode, setAdvanceMode] = useState<"manual" | "auto" | "skip">(
    "manual",
  );
  const [visibleTextLength, setVisibleTextLength] = useState(0);
  const revealTextImmediatelyRef = useRef(false);
  const [inlinePlayerWait, setInlinePlayerWait] = useState(false);
  const [selectedExportChoiceId, setSelectedExportChoiceId] =
    useState<string>();
  const exportCompletedRef = useRef(false);
  const inlineWaitReleaseRef = useRef<(() => void) | null>(null);
  const advanceRef = useRef<() => void>(() => undefined);
  const advanceModeRef = useRef(advanceMode);
  const playerAudio = useStoryPlayerAudio(
    document,
    mix,
    exportMode?.onAudioEvent,
  );
  const {
    autoplayBlocked,
    setAutoplayBlocked,
    timelinePositionMs,
    setTimelinePositionMs,
    timelinePlaying,
    setTimelinePlaying,
    voicePlaying,
    setVoicePlaying,
    audioLevelDb,
    mouthFrame,
    setMouthFrame,
    lipSyncTrackerRef,
    voiceRef,
    timelineRef,
    pendingRef,
    generationRef,
    channelGenerationRef,
    fadeAndStop,
    objectUrl,
    tryPlay,
    executeAudioBlock,
    syncTimelineBgm,
    syncTimelineAmbient,
    syncTimelineMaster,
    reconcileTimelineAudio,
    pauseTimelineMaster,
    timelineMasterPositionMs,
    cleanupPlayback,
  } = playerAudio;
  const chapter =
    chapterById(document, runtimeRef.current.chapterId) ??
    entryChapter(document);
  const characters = new Map(
    (document.characters ?? []).map((character) => [character.id, character]),
  );
  const scenes = new Map(
    (document.scenes ?? []).map((scene) => [scene.id, scene]),
  );
  const editFrame = useMemo<PlayerFrame>(() => {
    if (editFragment?.timeline && editTimelinePositionMs != null) {
      const preview = replayStageAtTime(
        document,
        editFragment,
        editTimelinePositionMs,
      );
      return preview.block && preview.blockIndex != null
        ? {
            mode: "content",
            fragmentId: editFragment.id,
            blockIndex: preview.blockIndex,
            block: preview.block,
            stage: preview.stage,
          }
        : {
            mode: "stageOnly",
            fragmentId: editFragment.id,
            stage: preview.stage,
          };
    }
    if (!editFragment || editBlockIndex == null)
      return { mode: "idle", stage: emptyStageState() };
    const block = editFragment.blocks?.[editBlockIndex];
    if (!block) return { mode: "idle", stage: emptyStageState() };
    return {
      mode: "content",
      fragmentId: editFragment.id,
      blockIndex: editBlockIndex,
      block,
      stage: replayStageToBlock(document, editFragment, editBlockIndex),
    };
  }, [document, editBlockIndex, editFragment, editTimelinePositionMs]);
  const displayFrame = mode === "edit" ? editFrame : frame;
  useStoryPlayerPlaybackFollow({
    mode,
    displayFrame,
    chapter,
    chapterId: runtimeRef.current.chapterId,
    timelinePositionMs,
    onPlaybackPosition,
    onExportProgress: exportMode?.onProgress,
  });

  useEffect(() => {
    advanceModeRef.current = advanceMode;
  }, [advanceMode]);

  const palette = useMemo(
    () => scenePalette(displayFrame.stage.sceneId),
    [displayFrame.stage.sceneId],
  );
  const activeDialogue =
    displayFrame.mode === "content" && displayFrame.block.type === "dialogue"
      ? displayFrame.block
      : undefined;
  const activeDialogueSpeakerIds = activeDialogue
    ? dialogueSpeakerIds(activeDialogue)
    : [];
  const runtimeVariables = runtimeRef.current.variables;
  const activeDialogueCharacter = activeDialogue
    ? characters.get(activeDialogue.characterId)
    : undefined;
  const activeDialogueContent = activeDialogue
    ? richTextDocument(activeDialogue)
    : undefined;
  const activeInlineExpressionId = activeDialogueContent
    ? inlineExpressionAt(activeDialogueContent, visibleTextLength)
    : undefined;
  const activeFragment =
    mode === "play" &&
    (displayFrame.mode === "content" || displayFrame.mode === "stageOnly") &&
    chapter
      ? fragmentById(chapter, displayFrame.fragmentId)
      : undefined;
  const activeTimeline = activeFragment?.timeline;
  const activeVoiceAsset = (document.assets ?? []).find(
    (asset) =>
      asset.type === "audio" && asset.id === activeDialogue?.voiceAssetId,
  );
  const exportTimelineRange = exportMode?.timelineRange;
  const exportVoiceOffsetMs = timelineExportVoiceOffset(
    exportTimelineRange,
    activeFragment?.id,
    activeDialogue?.startMs,
  );
  const activeScene = scenes.get(displayFrame.stage.sceneId ?? "");
  const activeSceneLayers = (activeScene?.layers ?? []).flatMap((layer) => {
    const asset = (document.assets ?? []).find(
      (candidate) => candidate.id === layer.assetId,
    );
    return asset?.type === "image" ? [{ layer, asset }] : [];
  });
  const activeVideoAsset = (document.assets ?? []).find(
    (asset) =>
      asset.type === "video" && asset.id === displayFrame.stage.video?.assetId,
  );
  const activeVideoOffsetMs = timelineExportVideoOffset(
    activeFragment,
    activeVideoAsset?.id,
    timelinePositionMs,
    exportTimelineRange,
  );
  const videoUrl = useStoryPlayerVideoUrl(activeVideoAsset?.fileId, objectUrl);
  const stageCgs = [
    displayFrame.stage.exitingCg
      ? { key: "exiting", state: displayFrame.stage.exitingCg }
      : undefined,
    displayFrame.stage.cg
      ? { key: "active", state: displayFrame.stage.cg }
      : undefined,
  ].flatMap((entry) => {
    if (!entry) return [];
    const cg = (document.cgs ?? []).find(
      (candidate) => candidate.id === entry.state.cgId,
    );
    const variant = (cg?.variants ?? []).find(
      (candidate) => candidate.id === entry.state.variantId,
    );
    const asset = (document.assets ?? []).find(
      (candidate) => candidate.id === variant?.assetId,
    );
    return asset?.type === "image" ? [{ ...entry, cg, variant, asset }] : [];
  });
  const dialogueStyle = resolveDialogueBoxStyle(
    document.presentation?.dialogueBox,
    displayFrame.stage.dialoguePreset,
  );
  const dialogueSkinAsset = (document.assets ?? []).find(
    (asset) => asset.id === dialogueStyle.assetId,
  );
  const uiStyle = {
    ...DEFAULT_UI_STYLE,
    ...document.presentation?.ui,
  };
  const stageStyle = {
    ...DEFAULT_STAGE_STYLE,
    ...document.presentation?.stage,
  };
  const activeDialogueExpressionId =
    activeInlineExpressionId ??
    activeDialogue?.expressionId ??
    activeDialogueCharacter?.defaultExpressionId;
  const activeDialogueExpression = activeDialogueCharacter?.expressions?.find(
    (expression) => expression.id === activeDialogueExpressionId,
  );
  const lipSyncFps =
    activeDialogueExpression?.sequence?.playbackMode === "lipSync"
      ? activeDialogueExpression.sequence.fps
      : 2;
  useEffect(() => {
    if (mode !== "play" || !displayFrame.stage.autoPlay) return;
    setAdvanceMode(displayFrame.stage.autoPlay.enabled ? "auto" : "manual");
  }, [displayFrame.stage.autoPlay, mode]);
  const lipSyncSpeaking =
    stageStyle.lipSyncEnabled &&
    Boolean(activeDialogue) &&
    mode === "play" &&
    voicePlaying;
  const currentAudioLevelDb = audioLevelDb;

  useEffect(() => {
    const speaking = Boolean(lipSyncSpeaking && currentAudioLevelDb != null);
    const next = lipSyncTrackerRef.current.update(
      currentAudioLevelDb ?? -100,
      speaking,
      performance.now(),
      lipSyncFps,
    );
    setMouthFrame(next);
  }, [
    currentAudioLevelDb,
    lipSyncFps,
    lipSyncSpeaking,
    lipSyncTrackerRef,
    setMouthFrame,
  ]);

  useEffect(() => {
    lipSyncTrackerRef.current.reset();
    setMouthFrame(0);
  }, [activeDialogueExpressionId, lipSyncTrackerRef, setMouthFrame]);

  const showMissingPortraitFallback = !exportMode;
  const stageActors = visibleStageActors(displayFrame.stage).flatMap(
    (actor) => {
      const character = characters.get(actor.characterId);
      if (!character) return [];
      const authoredExpressionId =
        (activeDialogue?.characterId === actor.characterId
          ? activeInlineExpressionId
          : undefined) ??
        actor.expressionId ??
        character.defaultExpressionId;
      const lipSyncPresentation = resolveLipSyncPresentation(
        character,
        authoredExpressionId,
        activeDialogueSpeakerIds.includes(actor.characterId) ? mouthFrame : 0,
      );
      const renderedExpressionId = lipSyncPresentation.expressionId;
      const skinAssetId = character.portraitSkins
        ?.find(
          (skin) =>
            skin.id === (actor.skinId ?? character.defaultPortraitSkinId),
        )
        ?.overrides?.find(
          (override) => override.expressionId === renderedExpressionId,
        )?.assetId;
      const expression = character.expressions?.find(
        (candidate) => candidate.id === renderedExpressionId,
      );
      if (!expression && !skinAssetId && !showMissingPortraitFallback)
        return [];
      const overlays = (expression?.overlays ?? []).flatMap((overlay) => {
        const overlayAsset = (document.assets ?? []).find(
          (candidate) => candidate.id === overlay.assetId,
        );
        return overlayAsset?.type === "image"
          ? [{ overlay, asset: overlayAsset }]
          : [];
      });
      return [
        {
          actor,
          character,
          renderedExpressionId,
          controlledFrameIndex: lipSyncPresentation.controlledFrameIndex,
          expression,
          skinAssetId,
          overlays,
        },
      ];
    },
  );
  const activeDialogueAvatar = activeDialogueExpression?.dialogueAvatar;
  const dialogueAvatarAssetId =
    activeDialogue?.portrait?.mode === "dialogueAvatar" &&
    activeDialogue.portrait.visible !== false &&
    activeDialogueCharacter?.dialogueAvatar?.enabled
      ? activeDialogueAvatar?.source === "independent"
        ? activeDialogueAvatar.assetId
        : characterExpressionAssetId(
            activeDialogueCharacter,
            activeDialogueExpressionId,
            activeDialogue.portrait.skinId,
          )
      : undefined;
  const dialogueAvatarAsset = (document.assets ?? []).find(
    (asset) => asset.id === dialogueAvatarAssetId,
  );
  const customUiComponents = (uiStyle.components ?? []).flatMap((component) => {
    const visible =
      component.visibility === "always" ||
      (component.visibility === "content" && displayFrame.mode === "content") ||
      (component.visibility === "dialogue" &&
        displayFrame.mode === "content" &&
        (displayFrame.block.type === "dialogue" ||
          displayFrame.block.type === "narration")) ||
      (component.visibility === "choices" &&
        displayFrame.mode === "content" &&
        displayFrame.block.type === "branch");
    const asset = (document.assets ?? []).find(
      (candidate) => candidate.id === component.assetId,
    );
    return visible && asset ? [{ component, asset }] : [];
  });

  useStoryPlayerVoicePlayback({
    mode,
    dialogue: activeDialogue,
    voiceAsset:
      activeVoiceAsset?.type === "audio" ? activeVoiceAsset : undefined,
    hasTimelineMaster: Boolean(activeTimeline?.masterAudio),
    voiceOffsetMs: exportVoiceOffsetMs,
    advanceModeRef,
    advanceRef,
    exportAudioEvent: exportMode?.onAudioEvent,
    audio: playerAudio,
  });

  useEffect(() => {
    if (frame.mode === "ending" || frame.mode === "error") cleanupPlayback();
  }, [cleanupPlayback, frame.mode]);

  useEffect(() => () => cleanupPlayback(), [cleanupPlayback]);

  const finishTimeline = useCallback(
    (fragment: GalgameStoryFragment) => {
      setTimelinePlaying(false);
      const terminatorIndex = (fragment.blocks ?? []).findIndex(
        (block) => block.type === "branch" || block.type === "endChapter",
      );
      const terminator = fragment.blocks?.[terminatorIndex];
      const stage = replayStageAtTime(
        document,
        fragment,
        fragment.timeline?.durationMs ?? 0,
      ).stage;
      runtimeRef.current = {
        ...runtimeRef.current,
        fragmentId: fragment.id,
        blockIndex:
          terminatorIndex < 0
            ? (fragment.blocks?.length ?? 0)
            : terminatorIndex,
        stage,
      };
      if (terminator?.type === "endChapter") {
        const result = advanceRuntime(document, runtimeRef.current);
        runtimeRef.current = result.state;
        setFrame(
          result.kind === "stopped"
            ? {
                mode: "ending",
                label: result.label,
                stage: result.state.stage,
              }
            : result.kind === "error"
              ? {
                  mode: "error",
                  message: result.message,
                  stage: result.state.stage,
                }
              : {
                  mode: "content",
                  fragmentId: result.state.fragmentId,
                  blockIndex: result.state.blockIndex,
                  block: result.block,
                  stage: result.state.stage,
                },
        );
        return;
      }
      setFrame(
        terminator?.type === "branch"
          ? {
              mode: "content",
              fragmentId: fragment.id,
              blockIndex: terminatorIndex,
              block: terminator,
              stage: enterContentBlock(stage, terminator, document),
            }
          : {
              mode: "ending",
              label: "故事结束",
              stage,
            },
      );
    },
    [document, setTimelinePlaying],
  );

  const timelineVisualKeyRef = useRef("");
  useEffect(() => {
    timelineVisualKeyRef.current = "";
  }, [document]);

  const showTimelinePosition = useCallback(
    (fragment: GalgameStoryFragment, milliseconds: number) => {
      const events = timelineEvents(fragment);
      let eventCount = 0;
      while (
        eventCount < events.length &&
        events[eventCount]!.timeMs <= milliseconds
      )
        eventCount += 1;
      const activeCue = activeTimelineCue(fragment, milliseconds);
      const visualKey = `${fragment.id}:${eventCount}:${activeCue?.blockIndex ?? "stage"}`;
      if (timelineVisualKeyRef.current === visualKey) return;
      timelineVisualKeyRef.current = visualKey;
      const preview = replayStageAtTime(document, fragment, milliseconds);
      setFrame(
        preview.block && preview.blockIndex != null
          ? {
              mode: "content",
              fragmentId: fragment.id,
              blockIndex: preview.blockIndex,
              block: preview.block,
              stage: preview.stage,
            }
          : {
              mode: "stageOnly",
              fragmentId: fragment.id,
              stage: preview.stage,
            },
      );
    },
    [document],
  );

  const playTimeline = useCallback(
    async (
      fragment: GalgameStoryFragment,
      clock: TimelineClock,
      stopAtMs?: number,
    ) => {
      if (
        fragment.timeline?.masterAudio &&
        !(await syncTimelineMaster(fragment, clock.position, true))
      )
        return;
      if (stopAtMs == null) clock.play();
      else clock.playUntil(stopAtMs);
    },
    [syncTimelineMaster],
  );

  const startTimeline = useCallback(
    (fragment: GalgameStoryFragment, autoplay = advanceMode === "auto") => {
      if (!fragment.timeline) return;
      const timelineDurationMs = fragment.timeline.durationMs;
      const {
        range: exportRange,
        startMs,
        endMs,
      } = timelineExportBounds(fragment, exportMode?.timelineRange);
      showTimelinePosition(fragment, startMs);
      setTimelinePositionMs(startMs);
      const playerGeneration = generationRef.current;
      const audioEvents = timelineEvents(fragment).filter(
        (event) => event.block.type === "audio",
      );
      const playback = { current: undefined as TimelinePlayback | undefined };
      const clock = new TimelineClock(timelineDurationMs, {
        onPosition: (milliseconds) => {
          const playing = playback.current;
          if (
            !playing ||
            playerGeneration !== generationRef.current ||
            timelineRef.current !== playing
          )
            return;
          if (milliseconds >= playing.lastPositionMs)
            for (const event of audioEvents) {
              if (
                event.timeMs <= playing.lastPositionMs ||
                event.timeMs > milliseconds ||
                event.block.type !== "audio"
              )
                continue;
              executeAudioBlock(event.block);
            }
          playing.lastPositionMs = milliseconds;
          if (
            exportMode ||
            milliseconds < playing.lastPublishedPositionMs ||
            milliseconds - playing.lastPublishedPositionMs >=
              TIMELINE_UI_UPDATE_INTERVAL_MS
          ) {
            playing.lastPublishedPositionMs = milliseconds;
            setTimelinePositionMs(milliseconds);
          }
          showTimelinePosition(fragment, milliseconds);
        },
        onPlayingChange: (next) => {
          const playing = playback.current;
          if (timelineRef.current !== playing || !playing) return;
          setTimelinePlaying(next);
          if (!next) {
            playing.lastPublishedPositionMs = playing.lastPositionMs;
            setTimelinePositionMs(playing.lastPositionMs);
          }
          syncTimelineBgm(fragment, Math.max(0, playing.lastPositionMs), next);
          syncTimelineAmbient(
            fragment,
            Math.max(0, playing.lastPositionMs),
            next,
          );
          if (!next) pauseTimelineMaster();
        },
        onBoundary: (milliseconds) => {
          if (
            !exportRange ||
            milliseconds < endMs ||
            exportCompletedRef.current
          )
            return;
          exportCompletedRef.current = true;
          exportMode?.onComplete?.({ ok: true, label: "快速试片完成" });
        },
        onFinish: () => {
          const playing = playback.current;
          if (
            !playing ||
            playerGeneration !== generationRef.current ||
            timelineRef.current !== playing
          )
            return;
          finishTimeline(fragment);
        },
        positionSource: fragment.timeline.masterAudio
          ? timelineMasterPositionMs
          : undefined,
      });
      const playing = {
        fragmentId: fragment.id,
        clock,
        lastPositionMs: startMs,
        lastPublishedPositionMs: Number.NEGATIVE_INFINITY,
      };
      playback.current = playing;
      timelineRef.current = playing;
      const firstStep = timelinePlaybackSteps(fragment)[0];
      if (fragment.timeline.masterAudio) {
        clock.seek(startMs);
        syncTimelineBgm(fragment, startMs, false);
        syncTimelineAmbient(fragment, startMs, false);
        void syncTimelineMaster(fragment, startMs, false).then((ready) => {
          if (
            ready &&
            autoplay &&
            playerGeneration === generationRef.current &&
            timelineRef.current === playing
          )
            void playTimeline(fragment, clock, exportRange ? endMs : undefined);
        });
      } else {
        clock.seek(
          exportRange ? startMs : autoplay ? 0 : (firstStep?.startMs ?? 0),
        );
        syncTimelineBgm(fragment, startMs, false);
        syncTimelineAmbient(fragment, startMs, false);
        if (autoplay)
          void playTimeline(fragment, clock, exportRange ? endMs : undefined);
        else if (firstStep)
          clock.playUntil(Math.max(firstStep.startMs, firstStep.endMs - 1));
      }
    },
    [
      advanceMode,
      executeAudioBlock,
      exportMode,
      finishTimeline,
      generationRef,
      pauseTimelineMaster,
      playTimeline,
      setTimelinePlaying,
      setTimelinePositionMs,
      showTimelinePosition,
      syncTimelineBgm,
      syncTimelineAmbient,
      syncTimelineMaster,
      timelineMasterPositionMs,
      timelineRef,
    ],
  );

  const presentRuntime = useCallback(
    (result: StoryRuntimeResult) => {
      runtimeRef.current = result.state;
      if (result.effects.some((effect) => effect.type === "returnToEntry"))
        cleanupPlayback();
      for (const effect of result.effects)
        if (effect.type === "audio") executeAudioBlock(effect);
      if (result.kind === "error") {
        setFrame({
          mode: "error",
          message: result.message,
          stage: result.state.stage,
        });
        return;
      }
      if (result.kind === "stopped") {
        setFrame({
          mode: "ending",
          label: result.label,
          stage: result.state.stage,
        });
        return;
      }
      setFrame({
        mode: "content",
        fragmentId: result.state.fragmentId,
        blockIndex: result.state.blockIndex,
        block: result.block,
        stage: result.state.stage,
      });
    },
    [cleanupPlayback, executeAudioBlock],
  );

  const restart = () => {
    cleanupPlayback();
    exportCompletedRef.current = false;
    setSelectedExportChoiceId(undefined);
    setAdvanceMode(exportMode ? "auto" : "manual");
    advanceModeRef.current = exportMode ? "auto" : "manual";
    const base = initialRuntime(document);
    const startChapter = startCursor
      ? chapterById(document, startCursor.chapterId)
      : undefined;
    const startFragment =
      startChapter && startCursor
        ? fragmentById(startChapter, startCursor.fragmentId)
        : undefined;
    const startIndex = Math.max(0, startCursor?.blockIndex ?? 0);
    const initial =
      startChapter && startFragment
        ? {
            ...base,
            chapterId: startChapter.id,
            fragmentId: startFragment.id,
            blockIndex: startIndex,
            stage: replayStageToBlock(document, startFragment, startIndex),
          }
        : base;
    runtimeRef.current = initial;
    const initialChapter = chapterById(document, initial.chapterId);
    if (!initialChapter) {
      setFrame({
        mode: "error",
        message: "工程没有可试玩章节",
        stage: emptyStageState(),
      });
      return;
    }
    const entryFragment = fragmentById(initialChapter, initial.fragmentId);
    if (entryFragment?.timeline) {
      startTimeline(entryFragment, Boolean(exportMode));
      return;
    }
    presentRuntime(advanceRuntime(document, initial));
  };
  useImperativeHandle(ref, () => ({ restart }));
  const enterFragment = (fragmentId: string) => {
    pauseTimelineMaster();
    timelineRef.current?.clock.dispose();
    timelineRef.current = null;
    const next = chooseRuntimeFragment(
      document,
      runtimeRef.current,
      fragmentId,
    );
    runtimeRef.current = next;
    const targetChapter = chapterById(document, next.chapterId);
    const target = targetChapter
      ? fragmentById(targetChapter, fragmentId)
      : undefined;
    if (target?.timeline) {
      startTimeline(target, advanceMode === "auto");
      return;
    }
    presentRuntime(advanceRuntime(document, next));
  };
  useEffect(() => {
    if (!exportMode) return;
    restart();
    // Export mode owns the complete player lifecycle and starts exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (
      !exportMode ||
      frame.mode !== "content" ||
      frame.block.type !== "branch"
    )
      return;
    const choiceId = exportMode.branchSelections[frame.block.id];
    const choice = frame.block.choices.find((item) => item.id === choiceId);
    if (!choice) {
      if (!exportCompletedRef.current) {
        exportCompletedRef.current = true;
        exportMode.onComplete?.({ ok: false, label: "导出路线缺少分支选择" });
      }
      return;
    }
    const highlightAt = Math.max(
      0,
      exportMode.choiceDurationMs - exportMode.choiceHighlightMs,
    );
    const highlight = window.setTimeout(
      () => setSelectedExportChoiceId(choice.id),
      highlightAt,
    );
    const select = window.setTimeout(() => {
      setSelectedExportChoiceId(undefined);
      enterFragment(choice.targetFragmentId);
    }, exportMode.choiceDurationMs);
    return () => {
      window.clearTimeout(highlight);
      window.clearTimeout(select);
    };
    // The timer must remain tied to this rendered branch; enterFragment is
    // intentionally read from the same render instead of restarting on every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportMode, frame]);
  const seekTimeline = (milliseconds: number, triggerPointEffects = false) => {
    const playing = timelineRef.current;
    if (!playing || !activeFragment?.timeline) return;
    const target = Math.max(
      0,
      Math.min(activeFragment.timeline.durationMs, milliseconds),
    );
    if (advanceModeRef.current === "manual") playing.clock.pause();
    playing.lastPositionMs = target;
    playing.lastPublishedPositionMs = target;
    setTimelinePositionMs(target);
    reconcileTimelineAudio(activeFragment, target);
    if (triggerPointEffects)
      for (const event of timelineEvents(activeFragment))
        if (
          event.timeMs === target &&
          event.block.type === "audio" &&
          event.block.channel === "sfx" &&
          event.block.action === "play"
        )
          executeAudioBlock(event.block);
    playing.clock.seek(target);
    void syncTimelineMaster(activeFragment, target, playing.clock.isPlaying);
    if (target >= activeFragment.timeline.durationMs) {
      finishTimeline(activeFragment);
    }
  };
  const fadeCurrentVoice = () => {
    channelGenerationRef.current.voice += 1;
    const playing = voiceRef.current;
    voiceRef.current = null;
    setVoicePlaying(false);
    if (playing)
      exportMode?.onAudioEvent?.({
        action: "stop",
        channel: "voice",
        fadeMs: 80,
      });
    if (playing) fadeAndStop(playing, 80);
  };
  const skipTimelineStep = (direction: -1 | 1) => {
    if (!activeFragment) return;
    fadeCurrentVoice();
    const steps = timelinePlaybackSteps(activeFragment);
    const currentIndex =
      frame.mode === "content"
        ? steps.findIndex(
            ({ contentBlockIndex }) => contentBlockIndex === frame.blockIndex,
          )
        : Math.max(
            0,
            steps.findIndex(
              (step, index) =>
                step.startMs <= timelinePositionMs &&
                (timelinePositionMs < step.endMs ||
                  (index === steps.length - 1 &&
                    timelinePositionMs <= step.endMs)),
            ),
          );
    const nextIndex = Math.max(
      0,
      Math.min(steps.length - 1, currentIndex + direction),
    );
    if (direction === 1 && currentIndex >= steps.length - 1)
      seekTimeline(activeFragment.timeline?.durationMs ?? 0, true);
    else {
      const nextStep = steps[nextIndex];
      seekTimeline(nextStep?.startMs ?? 0, true);
      if (advanceModeRef.current === "manual" && nextStep)
        void playTimeline(
          activeFragment,
          timelineRef.current!.clock,
          Math.max(nextStep.startMs, nextStep.endMs - 1),
        );
    }
  };
  const toggleTimeline = () => {
    const playing = timelineRef.current;
    if (!playing) return;
    const { clock } = playing;
    if (!clock.isPlaying) {
      if (clock.position >= (activeFragment?.timeline?.durationMs ?? 0))
        clock.seek(0);
      setAdvanceMode("auto");
      if (activeFragment) void playTimeline(activeFragment, clock);
    } else {
      clock.pause();
      setAdvanceMode("manual");
    }
  };
  const selectAdvanceMode = (next: "manual" | "auto" | "skip") => {
    setAdvanceMode(next);
    const playing = timelineRef.current;
    if (!playing) return;
    if (next === "auto" || next === "skip") {
      if (playing.clock.position >= (activeFragment?.timeline?.durationMs ?? 0))
        playing.clock.seek(0);
      if (activeFragment) void playTimeline(activeFragment, playing.clock);
    } else playing.clock.pause();
  };
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
  }, [frame, mode]);

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
  }, [displayBlockId, mode, waitDurationMs]);

  useEffect(() => {
    if (!exportMode || !inlinePlayerWait) return;
    const timer = window.setTimeout(() => advanceRef.current(), 300);
    return () => window.clearTimeout(timer);
  }, [exportMode, inlinePlayerWait]);

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
  }, [exportMode, frame]);

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
        exportMode?.timelineRange?.fragmentId === typewriterFrame.fragmentId &&
        "startMs" in typewriterFrame.block &&
        typeof typewriterFrame.block.startMs === "number" &&
        typewriterFrame.block.startMs < exportMode.timelineRange.startMs) ||
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
    mode,
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
  }, [activeTimeline, activeVoiceAsset, advanceMode, frame, mode]);

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
    displayFrame,
    palette,
    activeDialogue,
    runtimeVariables,
    activeTimeline,
    activeSceneLayers,
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
