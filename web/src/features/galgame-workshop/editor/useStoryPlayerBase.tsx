import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  initialRuntime,
  type StoryRuntimeState,
} from "@features/galgame-workshop/editor/storyRuntime";
import {
  inlineExpressionAt,
  richTextDocument,
} from "@features/galgame-workshop/editor/richText";
import { localizedStoryDocument } from "@features/galgame-workshop/editor/localization";
import { useStoryPlayerAudio } from "@features/galgame-workshop/editor/useStoryPlayerAudio";
import {
  timelineExportVideoOffset,
  timelineExportVoiceOffset,
  useStoryPlayerPlaybackFollow,
  useStoryPlayerVideoUrl,
} from "@features/galgame-workshop/editor/useStoryPlayerPlaybackFollow";
import { useStoryPlayerVoicePlayback } from "@features/galgame-workshop/editor/useStoryPlayerVoicePlayback";
import {
  DEFAULT_STORY_PLAYER_MIX,
  type PlayerFrame,
  type StoryPlayerProps,
} from "@features/galgame-workshop/editor/storyPlayerModel";

export function useStoryPlayerBase({
  document: sourceDocument,
  locale,
  includeStaleTranslations = false,
  startCursor,
  mode = "play",
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
  const playbackRangeRef = useRef(playbackRange);
  playbackRangeRef.current = playbackRange;
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
  const exportTimelineRange = exportMode?.timelineRange ?? playbackRange;
  const exportVoiceOffsetMs = timelineExportVoiceOffset(
    exportTimelineRange,
    activeFragment?.id,
    activeDialogue?.startMs,
  );
  const stageScenes = [
    displayFrame.stage.exitingScene
      ? { key: "exiting", state: displayFrame.stage.exitingScene }
      : undefined,
    displayFrame.stage.scene
      ? { key: "active", state: displayFrame.stage.scene }
      : displayFrame.stage.sceneId
        ? {
            key: "active",
            state: {
              sourceBlockId: "legacy-scene",
              sceneId: displayFrame.stage.sceneId,
              transition: { durationMs: 0, fade: false },
              entering: false,
              exiting: false,
            },
          }
        : undefined,
  ].flatMap((entry) => {
    if (!entry) return [];
    const scene = scenes.get(entry.state.sceneId);
    return (scene?.layers ?? []).flatMap((layer) => {
      const asset = (document.assets ?? []).find(
        (candidate) => candidate.id === layer.assetId,
      );
      return asset?.type === "image" ? [{ ...entry, layer, asset }] : [];
    });
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

  const showMissingPortraitFallback = mode === "edit" && !exportMode;
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

  return {
    activeDialogue,
    activeDialogueAvatar,
    activeFragment,
    stageScenes,
    activeTimeline,
    activeVideoAsset,
    activeVideoOffsetMs,
    activeVoiceAsset,
    advanceMode,
    advanceModeRef,
    advanceRef,
    aspectMenuOpen,
    aspectParts,
    autoplayBlocked,
    channelGenerationRef,
    characters,
    chrome,
    cleanupPlayback,
    collapsed,
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
    editableCgBlockId,
    executeAudioBlock,
    exportCompletedRef,
    exportMode,
    frame,
    fadeAndStop,
    generationRef,
    headerModeControl,
    inlinePlayerWait,
    inlineWaitReleaseRef,
    lipSyncSpeaking,
    mix,
    mixerOpen,
    mouthFrame,
    mode,
    onCgOverlayChange,
    onCollapsedChange,
    onPlaybackPosition,
    playbackRange,
    playbackRangeRef,
    palette,
    pauseTimelineMaster,
    pendingRef,
    reconcileTimelineAudio,
    revealTextImmediatelyRef,
    runtimeRef,
    runtimeVariables,
    scenes,
    selectedExportChoiceId,
    setAdvanceMode,
    setAspectMenuOpen,
    setAutoplayBlocked,
    setCustomHeightDraft,
    setCustomWidthDraft,
    setFrame,
    setInlinePlayerWait,
    setMix,
    setMixerOpen,
    setSelectedExportChoiceId,
    setTimelinePlaying,
    setTimelinePositionMs,
    setVisibleTextLength,
    setVoicePlaying,
    stageActors,
    stageCgs,
    stageStyle,
    startCursor,
    syncTimelineAmbient,
    syncTimelineBgm,
    syncTimelineMaster,
    timelineMasterPositionMs,
    timelinePlaying,
    timelinePositionMs,
    timelineRef,
    tryPlay,
    updateViewportPreferences,
    videoUrl,
    viewportPreferences,
    visibleTextLength,
    voiceRef,
    workbenchHeader,
  };
}

export type StoryPlayerBase = ReturnType<typeof useStoryPlayerBase>;
