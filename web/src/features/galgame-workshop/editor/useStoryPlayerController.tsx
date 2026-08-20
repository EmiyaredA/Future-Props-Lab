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
import {
  DEFAULT_DIALOGUE_BOX_STYLE,
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
import {
  createAudioLevelMonitor,
  resolveLipSyncPresentation,
} from "@features/galgame-workshop/editor/lipSync";
import {
  loadStageViewportPreferences,
  resolveStageAspectParts,
  storeStageViewportPreferences,
  type StageViewportPreferences,
} from "@features/galgame-workshop/editor/stageViewportPreferences";
import { TimelineClock } from "@features/galgame-workshop/editor/timelineClock";
import {
  estimatedCueDuration,
  effectivePointTime,
  projectFragmentTimeline,
  timelineAudioStateAt,
  timelineCues,
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
  DEFAULT_STORY_PLAYER_MIX,
  playerContentText,
  type PlayerFrame,
  type StoryPlayerHandle,
  type StoryPlayerProps,
  type TimelinePlayback,
} from "@features/galgame-workshop/editor/storyPlayerModel";
import type { ForwardedRef } from "react";
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
  const inlineWaitReleaseRef = useRef<(() => void) | null>(null);
  const advanceRef = useRef<() => void>(() => undefined);
  const advanceModeRef = useRef(advanceMode);
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
    setAudioLevelDb,
    mouthFrame,
    setMouthFrame,
    lipSyncTrackerRef,
    mixRef,
    voiceRef,
    timelineRef,
    pendingRef,
    generationRef,
    channelGenerationRef,
    stopPlaying,
    fadeAndStop,
    objectUrl,
    tryPlay,
    stopChannel,
    executeAudioBlock,
    syncTimelineBgm,
    cleanupPlayback,
  } = useStoryPlayerAudio(document, mix);
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

  useEffect(() => {
    if (
      mode !== "play" ||
      (displayFrame.mode !== "content" && displayFrame.mode !== "stageOnly")
    )
      return;
    const source = chapter
      ? fragmentById(chapter, displayFrame.fragmentId)
      : undefined;
    if (!source) return;
    const projected = projectFragmentTimeline(source);
    const blockId =
      displayFrame.mode === "content" ? displayFrame.block.id : undefined;
    const blockIndex = blockId
      ? projected.blocks?.findIndex((block) => block.id === blockId)
      : undefined;
    const projectedPosition =
      blockIndex != null && blockIndex >= 0
        ? (effectivePointTime(projected, blockIndex) ??
          timelineCues(projected).find((cue) => cue.block.id === blockId)
            ?.startMs ??
          0)
        : 0;
    onPlaybackPosition?.({
      chapterId: runtimeRef.current.chapterId,
      fragmentId: source.id,
      positionMs: source.timeline ? timelinePositionMs : projectedPosition,
      blockId,
    });
  }, [chapter, displayFrame, mode, onPlaybackPosition, timelinePositionMs]);

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
  const [videoUrl, setVideoUrl] = useState<string>();
  useEffect(() => {
    let active = true;
    if (!activeVideoAsset) {
      setVideoUrl(undefined);
      return;
    }
    void objectUrl(activeVideoAsset.fileId).then((url) => {
      if (active) setVideoUrl(url);
    });
    return () => {
      active = false;
    };
  }, [activeVideoAsset, objectUrl]);
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
  const dialogueStyle = {
    ...DEFAULT_DIALOGUE_BOX_STYLE,
    ...document.presentation?.dialogueBox,
  };
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

  useEffect(() => {
    if (mode === "edit") return;
    channelGenerationRef.current.voice += 1;
    const requestGeneration = channelGenerationRef.current.voice;
    stopPlaying(voiceRef.current);
    voiceRef.current = null;
    if (!activeDialogue?.voiceAssetId || activeVoiceAsset?.type !== "audio")
      return;
    const playerGeneration = generationRef.current;
    let autoAdvanceTimer: number | undefined;
    void objectUrl(activeVoiceAsset.fileId)
      .then((url) => {
        if (
          playerGeneration !== generationRef.current ||
          requestGeneration !== channelGenerationRef.current.voice
        )
          return;
        const audio = new Audio(url);
        const playing = {
          audio,
          baseVolume: (activeDialogue.voiceVolume ?? 100) / 100,
          levelMonitor: createAudioLevelMonitor(audio, setAudioLevelDb),
        };
        audio.volume = playing.baseVolume * (mixRef.current.voice / 100);
        audio.addEventListener("play", () => setVoicePlaying(true));
        audio.addEventListener("pause", () => setVoicePlaying(false));
        audio.addEventListener("ended", () => {
          setVoicePlaying(false);
          if (advanceModeRef.current === "auto") {
            autoAdvanceTimer = window.setTimeout(
              () => advanceRef.current(),
              400,
            );
          }
        });
        voiceRef.current = playing;
        void (async () => {
          await playing.levelMonitor?.resume().catch(() => undefined);
          setVoicePlaying(await tryPlay(audio));
        })();
      })
      .catch(() => undefined);
    return () => {
      if (autoAdvanceTimer != null) window.clearTimeout(autoAdvanceTimer);
    };
  }, [
    activeDialogue?.id,
    activeDialogue?.voiceAssetId,
    activeDialogue?.voiceVolume,
    activeVoiceAsset,
    channelGenerationRef,
    generationRef,
    mixRef,
    mode,
    objectUrl,
    setAudioLevelDb,
    setVoicePlaying,
    stopPlaying,
    tryPlay,
    voiceRef,
  ]);

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

  const showTimelinePosition = useCallback(
    (fragment: GalgameStoryFragment, milliseconds: number) => {
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

  const reconcileTimelineAudio = useCallback(
    (fragment: GalgameStoryFragment, milliseconds: number) => {
      stopChannel("sfx", 0);
      stopChannel("ambient", 80);
      const state = timelineAudioStateAt(fragment, milliseconds);
      if (state.ambient) executeAudioBlock(state.ambient);
      syncTimelineBgm(
        fragment,
        milliseconds,
        timelineRef.current?.clock.isPlaying ?? false,
      );
    },
    [executeAudioBlock, stopChannel, syncTimelineBgm, timelineRef],
  );

  const startTimeline = useCallback(
    (fragment: GalgameStoryFragment, autoplay = advanceMode === "auto") => {
      if (!fragment.timeline) return;
      const timelineDurationMs = fragment.timeline.durationMs;
      showTimelinePosition(fragment, 0);
      setTimelinePositionMs(0);
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
          setTimelinePositionMs(milliseconds);
          showTimelinePosition(fragment, milliseconds);
        },
        onPlayingChange: (next) => {
          const playing = playback.current;
          if (timelineRef.current !== playing || !playing) return;
          setTimelinePlaying(next);
          syncTimelineBgm(fragment, Math.max(0, playing.lastPositionMs), next);
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
      });
      const playing = {
        fragmentId: fragment.id,
        clock,
        lastPositionMs: -1,
      };
      playback.current = playing;
      timelineRef.current = playing;
      const firstStep = timelinePlaybackSteps(fragment)[0];
      clock.seek(autoplay ? 0 : (firstStep?.startMs ?? 0));
      if (autoplay) clock.play();
      else if (firstStep)
        clock.playUntil(Math.max(firstStep.startMs, firstStep.endMs - 1));
    },
    [
      advanceMode,
      executeAudioBlock,
      finishTimeline,
      generationRef,
      setTimelinePlaying,
      setTimelinePositionMs,
      showTimelinePosition,
      syncTimelineBgm,
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
    setAdvanceMode("manual");
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
      startTimeline(entryFragment, false);
      return;
    }
    presentRuntime(advanceRuntime(document, initial));
  };
  useImperativeHandle(ref, () => ({ restart }));
  const enterFragment = (fragmentId: string) => {
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
  const seekTimeline = (milliseconds: number, triggerPointEffects = false) => {
    const playing = timelineRef.current;
    if (!playing || !activeFragment?.timeline) return;
    const target = Math.max(
      0,
      Math.min(activeFragment.timeline.durationMs, milliseconds),
    );
    if (advanceModeRef.current === "manual") playing.clock.pause();
    playing.lastPositionMs = target;
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
    if (target >= activeFragment.timeline.durationMs) {
      finishTimeline(activeFragment);
    }
  };
  const fadeCurrentVoice = () => {
    channelGenerationRef.current.voice += 1;
    const playing = voiceRef.current;
    voiceRef.current = null;
    setVoicePlaying(false);
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
        timelineRef.current?.clock.playUntil(
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
      clock.play();
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
      playing.clock.play();
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
          ? null
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
    const durationMs = Math.max(50, (characters.length / speed) * 1000);
    const stepMs =
      advanceMode === "skip"
        ? 0
        : Math.max(16, durationMs / Math.max(1, characters.length));
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
      visible = Math.min(characters.length, visible + 1);
      setVisibleTextLength(visible);
      if (visible < characters.length) schedule(stepMs);
    };
    schedule(stepMs);
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
      inlineWaitReleaseRef.current = null;
    };
  }, [advanceMode, displayBlockId, displayText, mode]);

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
  };
}
