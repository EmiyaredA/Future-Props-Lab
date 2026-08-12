import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  ChevronDown,
  ChevronUp,
  Clock3,
  Pause,
  Play,
  Ratio,
  RotateCcw,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Volume2,
} from "lucide-react";
import { fetchApiBlob } from "@platform/api/client";
import type {
  GalgameStoryAudioBlock,
  GalgameStoryBlock,
  GalgameStoryCgOverlay,
  GalgameStoryFragment,
  GalgameStoryProject,
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
  CHARACTER_POSITION_MAX,
  CHARACTER_POSITION_MIN,
  emptyStageState,
  enterContentBlock,
  leaveContentBlock,
  replayStageAtTime,
  replayStageToBlock,
  type GalgameStageState,
  visibleStageActors,
} from "@features/galgame-workshop/editor/stage";
import { characterExpressionAssetId } from "@features/galgame-workshop/editor/richText";
import { dialogueSpeakerIds } from "@features/galgame-workshop/editor/dialogue";
import { StoryAssetImage } from "@features/galgame-workshop/editor/StoryAssetImage";
import {
  createAudioLevelMonitor,
  LipSyncLevelTracker,
  resolveLipSyncExpressionId,
  type AudioLevelMonitor,
  type LipSyncFrame,
} from "@features/galgame-workshop/editor/lipSync";
import {
  loadStageViewportPreferences,
  resolveStageAspectParts,
  stageAspectModeLabel,
  storeStageViewportPreferences,
  type StageAspectMode,
  type StageViewportPreferences,
} from "@features/galgame-workshop/editor/stageViewportPreferences";
import { TimelineClock } from "@features/galgame-workshop/editor/timelineClock";
import {
  estimatedCueDuration,
  effectivePointTime,
  projectFragmentTimeline,
  timelineAudioPlaybackStateAt,
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
import { RichTextView } from "@features/galgame-workshop/editor/RichTextEditor";
import {
  dialogueDisplayName,
  inlineExpressionAt,
  richTextDocument,
  richTextPlainText,
  richTextWaitEvents,
  resolvedRichTextDocument,
  truncateRichText,
} from "@features/galgame-workshop/editor/richText";
import { localizedStoryDocument } from "@features/galgame-workshop/editor/localization";

const STAGE_ASPECT_OPTIONS: StageAspectMode[] = [
  "auto",
  "16:9",
  "16:10",
  "4:3",
  "custom",
];

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function contentText(
  block: GalgameStoryBlock,
  variables: Record<string, string | number | boolean> = {},
) {
  if (
    block.type === "dialogue" ||
    block.type === "narration" ||
    block.type === "storyParagraph" ||
    block.type === "floatingText"
  )
    return "content" in block && block.content
      ? richTextPlainText(resolvedRichTextDocument(block.content, variables)) ||
          "（空正文）"
      : block.text || "（空正文）";
  return undefined;
}

type PlayerFrame =
  | { mode: "idle"; stage: GalgameStageState }
  | {
      mode: "stageOnly";
      fragmentId: string;
      stage: GalgameStageState;
    }
  | {
      mode: "content";
      fragmentId: string;
      blockIndex: number;
      block: GalgameStoryBlock;
      stage: GalgameStageState;
    }
  | { mode: "ending"; label: string; stage: GalgameStageState }
  | { mode: "error"; message: string; stage: GalgameStageState };

function hexToRgba(color: string, opacity: number) {
  const value = color.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgb(${red} ${green} ${blue} / ${opacity})`;
}

export interface StoryPlayerHandle {
  restart: () => void;
}

type StoryPlayerProps = {
  document: GalgameStoryProject;
  locale?: string;
  includeStaleTranslations?: boolean;
  startCursor?: { chapterId: string; fragmentId: string; blockIndex?: number };
  mode?: "edit" | "play";
  editFragment?: GalgameStoryFragment;
  editBlockIndex?: number;
  editTimelinePositionMs?: number | null;
  editableCharacterId?: string;
  editableCgBlockId?: string;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  viewportPreferences?: StageViewportPreferences;
  onViewportPreferencesChange?: (preferences: StageViewportPreferences) => void;
  headerModeControl?: ReactNode;
  workbenchHeader?: boolean;
  onCharacterPosition?: (x: number, y: number) => void;
  onCgOverlayChange?: (overlay: GalgameStoryCgOverlay) => void;
  onPlaybackPosition?: (position: {
    chapterId: string;
    fragmentId: string;
    positionMs: number;
    blockId?: string;
  }) => void;
};

type MixChannel = "voice" | "bgm" | "ambient" | "sfx";

type PlayingAudio = {
  audio: HTMLAudioElement;
  baseVolume: number;
  sourceBlockId?: string;
  levelMonitor?: AudioLevelMonitor;
};

type TimelinePlayback = {
  fragmentId: string;
  clock: TimelineClock;
  lastPositionMs: number;
};

function formatTimelineTime(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

const DEFAULT_MIX: Record<MixChannel, number> = {
  voice: 100,
  bgm: 100,
  ambient: 100,
  sfx: 100,
};

export const StoryPlayer = forwardRef<StoryPlayerHandle, StoryPlayerProps>(
  function StoryPlayer(
    {
      document: sourceDocument,
      locale,
      includeStaleTranslations = false,
      startCursor,
      mode = "play",
      editFragment: sourceEditFragment,
      editBlockIndex,
      editTimelinePositionMs,
      editableCharacterId,
      editableCgBlockId,
      collapsed = false,
      onCollapsedChange,
      viewportPreferences: viewportPreferencesProp,
      onViewportPreferencesChange,
      headerModeControl,
      workbenchHeader = false,
      onCharacterPosition,
      onCgOverlayChange,
      onPlaybackPosition,
    },
    ref,
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
      const chapterIndex = (sourceDocument.chapters ?? []).findIndex(
        (chapter) =>
          chapter.fragments?.some(
            (fragment) => fragment === sourceEditFragment,
          ),
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
    const [mix, setMix] = useState(DEFAULT_MIX);
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
    const [autoplayBlocked, setAutoplayBlocked] = useState(false);
    const [timelinePositionMs, setTimelinePositionMs] = useState(0);
    const [timelinePlaying, setTimelinePlaying] = useState(false);
    const [advanceMode, setAdvanceMode] = useState<"manual" | "auto" | "skip">(
      "manual",
    );
    const [visibleTextLength, setVisibleTextLength] = useState(0);
    const revealTextImmediatelyRef = useRef(false);
    const [inlinePlayerWait, setInlinePlayerWait] = useState(false);
    const inlineWaitReleaseRef = useRef<(() => void) | null>(null);
    const advanceRef = useRef<() => void>(() => undefined);
    const advanceModeRef = useRef(advanceMode);
    const [voicePlaying, setVoicePlaying] = useState(false);
    const [audioLevelDb, setAudioLevelDb] = useState<number | null>(null);
    const [mouthFrame, setMouthFrame] = useState<LipSyncFrame>(0);
    const lipSyncTrackerRef = useRef(new LipSyncLevelTracker());
    const mixRef = useRef(mix);
    const voiceRef = useRef<PlayingAudio | null>(null);
    const timelineRef = useRef<TimelinePlayback | null>(null);
    const channelRefs = useRef<Record<"bgm" | "ambient", PlayingAudio | null>>({
      bgm: null,
      ambient: null,
    });
    const sfxRef = useRef<PlayingAudio[]>([]);
    const fadingRef = useRef(new Set<PlayingAudio>());
    const urlsRef = useRef(new Map<string, Promise<string>>());
    const pendingRef = useRef(new Set<HTMLAudioElement>());
    const timersRef = useRef(new Set<number>());
    const generationRef = useRef(0);
    const channelGenerationRef = useRef({
      bgm: 0,
      ambient: 0,
      sfx: 0,
      voice: 0,
    });
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

    useEffect(() => {
      mixRef.current = mix;
      if (voiceRef.current)
        voiceRef.current.audio.volume =
          voiceRef.current.baseVolume * (mix.voice / 100);
      for (const channel of ["bgm", "ambient"] as const) {
        const playing = channelRefs.current[channel];
        if (playing)
          playing.audio.volume = playing.baseVolume * (mix[channel] / 100);
      }
      for (const playing of sfxRef.current)
        playing.audio.volume = playing.baseVolume * (mix.sfx / 100);
    }, [mix]);

    const clearTimers = useCallback(() => {
      for (const timer of timersRef.current) window.clearInterval(timer);
      timersRef.current.clear();
    }, []);

    const stopPlaying = useCallback((playing: PlayingAudio | null) => {
      if (!playing) return;
      playing.levelMonitor?.dispose();
      pendingRef.current.delete(playing.audio);
      playing.audio.pause();
      playing.audio.removeAttribute("src");
      playing.audio.load();
    }, []);

    const fadeTo = useCallback(
      (
        playing: PlayingAudio,
        target: number,
        duration: number,
        onDone?: () => void,
      ) => {
        if (duration <= 0) {
          playing.audio.volume = Math.max(0, Math.min(1, target));
          onDone?.();
          return;
        }
        const start = playing.audio.volume;
        const startedAt = performance.now();
        const timer = window.setInterval(() => {
          const progress = Math.min(
            1,
            (performance.now() - startedAt) / duration,
          );
          playing.audio.volume = Math.max(
            0,
            Math.min(1, start + (target - start) * progress),
          );
          if (progress < 1) return;
          window.clearInterval(timer);
          timersRef.current.delete(timer);
          onDone?.();
        }, 50);
        timersRef.current.add(timer);
      },
      [],
    );

    const fadeAndStop = useCallback(
      (playing: PlayingAudio, duration: number) => {
        fadingRef.current.add(playing);
        fadeTo(playing, 0, duration, () => {
          fadingRef.current.delete(playing);
          stopPlaying(playing);
        });
      },
      [fadeTo, stopPlaying],
    );

    const objectUrl = useCallback((fileId: string) => {
      const existing = urlsRef.current.get(fileId);
      if (existing) return existing;
      const generation = generationRef.current;
      const pending = fetchApiBlob(`/v1/files/${fileId}/content`).then(
        (blob) => {
          const url = URL.createObjectURL(blob);
          if (generation !== generationRef.current) {
            URL.revokeObjectURL(url);
            throw new Error("player_reset");
          }
          return url;
        },
      );
      urlsRef.current.set(fileId, pending);
      return pending;
    }, []);

    const tryPlay = useCallback(async (audio: HTMLAudioElement) => {
      try {
        await audio.play();
        pendingRef.current.delete(audio);
        return true;
      } catch {
        pendingRef.current.add(audio);
        setAutoplayBlocked(true);
        return false;
      }
    }, []);

    const positionAudio = useCallback(
      (playing: PlayingAudio, offsetMs: number, shouldPlay: boolean) => {
        const apply = () => {
          const durationMs = Number.isFinite(playing.audio.duration)
            ? Math.max(0, playing.audio.duration * 1000)
            : 0;
          if (durationMs > 0 && !playing.audio.loop && offsetMs >= durationMs) {
            try {
              playing.audio.currentTime = playing.audio.duration;
            } catch {
              // The media remains paused even if the browser rejects the seek.
            }
            playing.audio.pause();
            return;
          }
          const targetMs =
            durationMs > 0 && playing.audio.loop
              ? offsetMs % durationMs
              : offsetMs;
          try {
            playing.audio.currentTime = Math.max(0, targetMs) / 1000;
          } catch {
            return;
          }
          if (shouldPlay) void tryPlay(playing.audio);
          else playing.audio.pause();
        };
        if (offsetMs > 0 && playing.audio.readyState < 1) {
          playing.audio.addEventListener("loadedmetadata", apply, {
            once: true,
          });
          if (!shouldPlay) playing.audio.pause();
          return;
        }
        apply();
      },
      [tryPlay],
    );

    const stopChannel = useCallback(
      (channel: "bgm" | "ambient" | "sfx", fadeMs: number) => {
        channelGenerationRef.current[channel] += 1;
        if (channel === "sfx") {
          const active = [...sfxRef.current];
          sfxRef.current = [];
          for (const playing of active) {
            if (fadeMs > 0) fadeAndStop(playing, fadeMs);
            else stopPlaying(playing);
          }
          return;
        }
        const playing = channelRefs.current[channel];
        channelRefs.current[channel] = null;
        if (!playing) return;
        if (fadeMs > 0) fadeAndStop(playing, fadeMs);
        else stopPlaying(playing);
      },
      [fadeAndStop, stopPlaying],
    );

    const executeAudioBlock = useCallback(
      (
        block: GalgameStoryAudioBlock,
        options: {
          offsetMs?: number;
          shouldPlay?: boolean;
          skipFade?: boolean;
        } = {},
      ) => {
        if (block.action === "stop") {
          stopChannel(block.channel, block.fadeMs);
          return;
        }
        const asset = (document.assets ?? []).find(
          (candidate) =>
            candidate.type === "audio" && candidate.id === block.assetId,
        );
        if (!asset || asset.type !== "audio") return;
        const channel = block.channel;
        if (channel !== "sfx") stopChannel(channel, block.fadeMs);
        const requestGeneration =
          channel === "sfx"
            ? channelGenerationRef.current.sfx
            : ++channelGenerationRef.current[channel];
        const playerGeneration = generationRef.current;
        void objectUrl(asset.fileId)
          .then((url) => {
            if (
              playerGeneration !== generationRef.current ||
              requestGeneration !== channelGenerationRef.current[channel]
            )
              return;
            if (channel === "sfx" && sfxRef.current.length >= 8)
              stopPlaying(sfxRef.current.shift() ?? null);
            const audio = new Audio(url);
            const playing = {
              audio,
              baseVolume: block.volume / 100,
              sourceBlockId: block.id,
            };
            audio.loop = block.loop;
            const target = playing.baseVolume * (mixRef.current[channel] / 100);
            const fadeMs = options.skipFade ? 0 : block.fadeMs;
            audio.volume = fadeMs > 0 ? 0 : target;
            if (channel === "sfx") {
              sfxRef.current.push(playing);
              audio.addEventListener(
                "ended",
                () => {
                  sfxRef.current = sfxRef.current.filter(
                    (candidate) => candidate !== playing,
                  );
                  stopPlaying(playing);
                },
                { once: true },
              );
            } else channelRefs.current[channel] = playing;
            positionAudio(
              playing,
              Math.max(0, options.offsetMs ?? 0),
              options.shouldPlay ?? true,
            );
            if (fadeMs > 0) fadeTo(playing, target, fadeMs);
          })
          .catch(() => undefined);
      },
      [
        document.assets,
        fadeTo,
        objectUrl,
        positionAudio,
        stopChannel,
        stopPlaying,
      ],
    );

    const syncTimelineBgm = useCallback(
      (
        fragment: GalgameStoryFragment,
        milliseconds: number,
        shouldPlay: boolean,
      ) => {
        const state = timelineAudioPlaybackStateAt(fragment, milliseconds).bgm;
        if (!state) {
          stopChannel("bgm", 0);
          return;
        }
        const offsetMs = Math.max(0, milliseconds - state.startedAtMs);
        const current = channelRefs.current.bgm;
        if (current?.sourceBlockId === state.block.id) {
          positionAudio(current, offsetMs, shouldPlay);
          return;
        }
        executeAudioBlock(state.block, {
          offsetMs,
          shouldPlay,
          skipFade: true,
        });
      },
      [executeAudioBlock, positionAudio, stopChannel],
    );

    const cleanupPlayback = useCallback(() => {
      generationRef.current += 1;
      for (const channel of ["voice", "bgm", "ambient", "sfx"] as const)
        channelGenerationRef.current[channel] += 1;
      clearTimers();
      for (const playing of fadingRef.current) stopPlaying(playing);
      fadingRef.current.clear();
      timelineRef.current?.clock.dispose();
      timelineRef.current = null;
      stopPlaying(voiceRef.current);
      voiceRef.current = null;
      stopPlaying(channelRefs.current.bgm);
      stopPlaying(channelRefs.current.ambient);
      channelRefs.current = { bgm: null, ambient: null };
      for (const playing of sfxRef.current) stopPlaying(playing);
      sfxRef.current = [];
      pendingRef.current.clear();
      for (const pending of urlsRef.current.values())
        void pending
          .then((url) => URL.revokeObjectURL(url))
          .catch(() => undefined);
      urlsRef.current.clear();
      setAutoplayBlocked(false);
      setTimelinePositionMs(0);
      setTimelinePlaying(false);
      setVoicePlaying(false);
      setAudioLevelDb(null);
      setMouthFrame(0);
      lipSyncTrackerRef.current.reset();
    }, [clearTimers, stopPlaying]);
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
        asset.type === "video" &&
        asset.id === displayFrame.stage.video?.assetId,
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
      );
      setMouthFrame(next);
    }, [currentAudioLevelDb, lipSyncSpeaking]);

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
        const renderedExpressionId = resolveLipSyncExpressionId(
          character,
          authoredExpressionId,
          activeDialogueSpeakerIds.includes(actor.characterId) ? mouthFrame : 0,
        );
        const expressionAssetId = characterExpressionAssetId(
          character,
          renderedExpressionId,
          actor.skinId,
        );
        const asset = (document.assets ?? []).find(
          (candidate) => candidate.id === expressionAssetId,
        );
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
            asset,
            renderedExpressionId,
            expression,
            overlays,
          },
        ];
      },
    );
    const activeDialogueExpressionId =
      activeInlineExpressionId ??
      activeDialogue?.expressionId ??
      activeDialogueCharacter?.defaultExpressionId;
    const activeDialogueExpression = activeDialogueCharacter?.expressions?.find(
      (expression) => expression.id === activeDialogueExpressionId,
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
    const customUiComponents = (uiStyle.components ?? []).flatMap(
      (component) => {
        const visible =
          component.visibility === "always" ||
          (component.visibility === "content" &&
            displayFrame.mode === "content") ||
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
      },
    );

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
      mode,
      objectUrl,
      stopPlaying,
      tryPlay,
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
      [document],
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
      [executeAudioBlock, stopChannel, syncTimelineBgm],
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
            syncTimelineBgm(
              fragment,
              Math.max(0, playing.lastPositionMs),
              next,
            );
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
        showTimelinePosition,
        syncTimelineBgm,
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
    const seekTimeline = (
      milliseconds: number,
      triggerPointEffects = false,
    ) => {
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
        if (
          playing.clock.position >= (activeFragment?.timeline?.durationMs ?? 0)
        )
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
        contentText(frame.block, runtimeRef.current.variables) &&
        visibleTextLength <
          Array.from(contentText(frame.block, runtimeRef.current.variables)!)
            .length
      ) {
        revealTextImmediatelyRef.current = true;
        setVisibleTextLength(
          Array.from(contentText(frame.block, runtimeRef.current.variables)!)
            .length,
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
              .map((block) => contentText(block, runtimeVariables) ?? "")
              .join("\n")
          : (contentText(displayFrame.block, runtimeVariables) ?? "")
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
        mode === "edit" ||
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
        !contentText(frame.block, runtimeRef.current.variables)
      )
        return;
      const timer = window.setTimeout(
        () => advanceRef.current(),
        advanceMode === "skip"
          ? 0
          : estimatedCueDuration(
              contentText(frame.block, runtimeRef.current.variables) ?? "",
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

    return (
      <section
        className="galgame-player"
        aria-label="游戏预览"
        data-lip-sync-speaking={lipSyncSpeaking ? "true" : "false"}
        data-mouth-frame={mouthFrame}
        data-audio-level-db={
          currentAudioLevelDb == null
            ? undefined
            : currentAudioLevelDb.toFixed(1)
        }
      >
        <header>
          <div>
            <strong>
              {workbenchHeader
                ? "实时预览"
                : mode === "edit"
                  ? "舞台编辑"
                  : "游戏预览"}
            </strong>
            {workbenchHeader ? (
              <i className="galgame-player-live">● LIVE</i>
            ) : (
              <>
                <small>
                  {scenes.get(displayFrame.stage.sceneId ?? "")?.name ??
                    "空舞台"}
                </small>
                <em className="galgame-player-resolution">
                  {document.settings?.canvas?.width ?? 1920} ×{" "}
                  {document.settings?.canvas?.height ?? 1080}
                </em>
              </>
            )}
          </div>
          <span className="galgame-player-header-actions">
            {workbenchHeader ? (
              <em className="galgame-player-resolution">
                {document.settings?.canvas?.width ?? 1920} ×{" "}
                {document.settings?.canvas?.height ?? 1080}
              </em>
            ) : null}
            {headerModeControl}
            <button
              type="button"
              className={aspectMenuOpen ? "active" : ""}
              onClick={() => {
                setAspectMenuOpen((current) => !current);
                setMixerOpen(false);
              }}
              aria-label="舞台比例"
              aria-expanded={aspectMenuOpen}
              title={`舞台比例：${stageAspectModeLabel(viewportPreferences.aspectMode)}`}
            >
              <Ratio aria-hidden />
            </button>
            {mode === "play" ? (
              <button
                type="button"
                className={mixerOpen ? "active" : ""}
                onClick={() => {
                  setMixerOpen((current) => !current);
                  setAspectMenuOpen(false);
                }}
                aria-label="试玩混音"
              >
                <SlidersHorizontal aria-hidden />
              </button>
            ) : null}
            {mode === "play" ? (
              <button type="button" onClick={restart} aria-label="重新开始试玩">
                <RotateCcw aria-hidden />
              </button>
            ) : null}
            {onCollapsedChange ? (
              <button
                type="button"
                onClick={() => onCollapsedChange(!collapsed)}
                aria-label={collapsed ? "展开舞台预览" : "折叠舞台预览"}
                aria-pressed={collapsed}
                title={collapsed ? "展开舞台预览" : "折叠舞台预览"}
              >
                {collapsed ? (
                  <ChevronDown aria-hidden />
                ) : (
                  <ChevronUp aria-hidden />
                )}
              </button>
            ) : null}
          </span>
        </header>
        {aspectMenuOpen ? (
          <section className="galgame-player-aspect" aria-label="舞台比例选项">
            <header>
              <strong>舞台比例</strong>
              <Ratio aria-hidden />
            </header>
            <div className="galgame-player-aspect-options" role="listbox">
              {STAGE_ASPECT_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="option"
                  aria-selected={viewportPreferences.aspectMode === option}
                  className={
                    viewportPreferences.aspectMode === option ? "active" : ""
                  }
                  onClick={() =>
                    updateViewportPreferences({
                      ...viewportPreferences,
                      aspectMode: option,
                    })
                  }
                >
                  {stageAspectModeLabel(option)}
                </button>
              ))}
            </div>
            {viewportPreferences.aspectMode === "custom" ? (
              <div className="galgame-player-aspect-custom">
                <label>
                  <span>宽</span>
                  <input
                    aria-label="自定义比例宽度"
                    type="number"
                    min="1"
                    max="9999"
                    value={customWidthDraft}
                    onChange={(event) => {
                      const raw = event.target.value;
                      setCustomWidthDraft(raw);
                      const next = Number(raw);
                      if (!Number.isFinite(next) || next <= 0) return;
                      updateViewportPreferences({
                        ...viewportPreferences,
                        customWidth: Math.min(9999, Math.round(next)),
                      });
                    }}
                    onBlur={() =>
                      setCustomWidthDraft(
                        String(viewportPreferences.customWidth),
                      )
                    }
                  />
                </label>
                <span aria-hidden>:</span>
                <label>
                  <span>高</span>
                  <input
                    aria-label="自定义比例高度"
                    type="number"
                    min="1"
                    max="9999"
                    value={customHeightDraft}
                    onChange={(event) => {
                      const raw = event.target.value;
                      setCustomHeightDraft(raw);
                      const next = Number(raw);
                      if (!Number.isFinite(next) || next <= 0) return;
                      updateViewportPreferences({
                        ...viewportPreferences,
                        customHeight: Math.min(9999, Math.round(next)),
                      });
                    }}
                    onBlur={() =>
                      setCustomHeightDraft(
                        String(viewportPreferences.customHeight),
                      )
                    }
                  />
                </label>
              </div>
            ) : null}
          </section>
        ) : null}
        <div
          className="galgame-stage-host"
          data-aspect-mode={viewportPreferences.aspectMode}
          hidden={collapsed || undefined}
          style={
            aspectParts
              ? ({
                  "--galgame-stage-aspect-w": String(aspectParts.width),
                  "--galgame-stage-aspect-h": String(aspectParts.height),
                } as CSSProperties)
              : undefined
          }
        >
          <div
            className={`galgame-stage${displayFrame.stage.stageAnimation ? " is-stage-animated" : ""}`}
            data-camera-effect={displayFrame.stage.camera?.effect}
            data-stage-animation={displayFrame.stage.stageAnimation?.animation}
            data-aspect={
              aspectParts
                ? `${aspectParts.width}:${aspectParts.height}`
                : "auto"
            }
            style={{
              background: `radial-gradient(circle at 55% 25%, ${palette.first}, ${palette.second})`,
              transform: displayFrame.stage.camera
                ? `translate(${displayFrame.stage.camera.x}%, ${displayFrame.stage.camera.y}%) scale(${displayFrame.stage.camera.scale}) rotate(${displayFrame.stage.camera.rotation}deg)`
                : undefined,
              transition: displayFrame.stage.camera
                ? `transform ${displayFrame.stage.camera.durationMs}ms ${displayFrame.stage.camera.easing.replace("easeInOut", "ease-in-out").replace("easeIn", "ease-in").replace("easeOut", "ease-out")}`
                : undefined,
              ...(aspectParts
                ? {
                    aspectRatio: `${aspectParts.width} / ${aspectParts.height}`,
                  }
                : null),
              animationDuration: displayFrame.stage.stageAnimation
                ? `${displayFrame.stage.stageAnimation.durationMs}ms`
                : displayFrame.stage.camera
                  ? `${displayFrame.stage.camera.durationMs}ms`
                  : undefined,
            }}
          >
            {mixerOpen ? (
              <section className="galgame-player-mixer" aria-label="试玩混音">
                <header>
                  <strong>试玩混音</strong>
                  <Volume2 aria-hidden />
                </header>
                {(
                  [
                    ["voice", "配音"],
                    ["bgm", "音乐"],
                    ["ambient", "环境音"],
                    ["sfx", "音效"],
                  ] as const
                ).map(([channel, label]) => (
                  <label key={channel}>
                    <span>
                      {label} <em>{mix[channel]}%</em>
                    </span>
                    <input
                      aria-label={`${label}混音音量`}
                      type="range"
                      min="0"
                      max="100"
                      value={mix[channel]}
                      onChange={(event) =>
                        setMix((current) => ({
                          ...current,
                          [channel]: Number(event.target.value),
                        }))
                      }
                    />
                  </label>
                ))}
              </section>
            ) : null}
            {autoplayBlocked ? (
              <button
                type="button"
                className="galgame-player-enable-audio"
                onClick={() => {
                  const pending = [...pendingRef.current];
                  setAutoplayBlocked(false);
                  void voiceRef.current?.levelMonitor
                    ?.resume()
                    .catch(() => undefined);
                  for (const audio of pending) {
                    void tryPlay(audio);
                  }
                }}
              >
                <Volume2 aria-hidden /> 点击启用声音
              </button>
            ) : null}
            {activeSceneLayers.map(({ layer, asset }, index) => (
              <StoryAssetImage
                key={layer.id}
                fileId={asset.fileId}
                alt=""
                className="galgame-player-background galgame-player-background-layer"
                style={{
                  zIndex: index,
                  transform: `translate(${layer.offsetX}%, ${layer.offsetY}%) scale(${1 + ((displayFrame.stage.camera?.scale ?? 1) - 1) / layer.distance})`,
                  transformOrigin: "center",
                }}
                fallback={null}
              />
            ))}
            {videoUrl && displayFrame.stage.video ? (
              <video
                className="galgame-player-video"
                src={videoUrl}
                autoPlay={mode === "play"}
                loop={displayFrame.stage.video.loop}
                muted={displayFrame.stage.video.volume === 0}
                onLoadedMetadata={(event) => {
                  event.currentTarget.volume =
                    displayFrame.stage.video?.volume != null
                      ? displayFrame.stage.video.volume / 100
                      : 1;
                }}
                onEnded={() => {
                  if (
                    mode === "play" &&
                    frame.mode === "content" &&
                    frame.block.type === "video" &&
                    frame.block.waitForCompletion
                  )
                    advanceRef.current();
                }}
                style={{ objectFit: displayFrame.stage.video.fit }}
              />
            ) : null}
            {displayFrame.stage.particle ? (
              <div
                className={`galgame-player-particles is-${displayFrame.stage.particle.preset}`}
                style={{
                  opacity: Math.min(1, displayFrame.stage.particle.density / 2),
                }}
                aria-label={`${displayFrame.stage.particle.preset} 粒子效果`}
              />
            ) : null}
            {displayFrame.stage.floatingText ? (
              <div
                className="galgame-player-floating-text"
                style={{
                  left: `${displayFrame.stage.floatingText.x}%`,
                  top: `${displayFrame.stage.floatingText.y}%`,
                  color: displayFrame.stage.floatingText.color,
                  animationDuration: `${displayFrame.stage.floatingText.durationMs}ms`,
                }}
              >
                {displayFrame.stage.floatingText.text}
              </div>
            ) : null}
            {displayFrame.stage.curtain ? (
              <div
                key={displayFrame.stage.curtain.transitionKey}
                className={`galgame-player-curtain is-${displayFrame.stage.curtain.mode} is-${displayFrame.stage.curtain.action}`}
                aria-label={`${
                  {
                    fullscreen: "全屏",
                    letterbox: "上下黑边",
                    pillarbox: "左右黑边",
                    frame: "四周黑边",
                  }[displayFrame.stage.curtain.mode]
                }幕布${displayFrame.stage.curtain.visible ? "合上" : "打开"}`}
                style={
                  {
                    "--curtain-color": displayFrame.stage.curtain.color,
                    "--curtain-opacity": displayFrame.stage.curtain.opacity,
                    "--curtain-duration": `${displayFrame.stage.curtain.durationMs}ms`,
                  } as CSSProperties
                }
              >
                <i className="galgame-player-curtain-panel is-fullscreen" />
                <i className="galgame-player-curtain-panel is-top" />
                <i className="galgame-player-curtain-panel is-bottom" />
                <i className="galgame-player-curtain-panel is-left" />
                <i className="galgame-player-curtain-panel is-right" />
              </div>
            ) : null}
            {customUiComponents.map(({ component, asset }) => (
              <div
                key={component.id}
                className="galgame-player-ui-component"
                data-component-id={component.id}
                style={{
                  left: `${component.x}%`,
                  top: `${component.y}%`,
                  width: `${component.width}%`,
                  zIndex: component.layer + 40,
                }}
              >
                <StoryAssetImage
                  fileId={asset.fileId}
                  alt={component.name}
                  className="galgame-player-ui-component-image"
                  fallback={null}
                />
              </div>
            ))}
            {customUiComponents.length === 0 ? (
              <span>
                {scenes.get(displayFrame.stage.sceneId ?? "")?.name ??
                  "等待场景 Block"}
              </span>
            ) : null}
            {stageActors.map(
              ({
                actor,
                character,
                asset,
                renderedExpressionId,
                expression,
                overlays,
              }) => {
                const focused =
                  displayFrame.stage.activeSpeakerIds?.includes(
                    actor.characterId,
                  ) ?? displayFrame.stage.activeSpeakerId === actor.characterId;
                const hasActiveSpeakers = Boolean(
                  displayFrame.stage.activeSpeakerIds?.length ??
                  displayFrame.stage.activeSpeakerId,
                );
                const focusMultiplier =
                  stageStyle.speakerFocusEnabled &&
                  hasActiveSpeakers &&
                  !focused
                    ? stageStyle.inactiveBrightness
                    : 1;
                const editable =
                  mode === "edit" && actor.characterId === editableCharacterId;
                const spriteAnimation =
                  displayFrame.stage.spriteAnimations?.[actor.characterId];
                return (
                  <div
                    key={actor.characterId}
                    className={`galgame-stage-actor${editable ? " is-editable" : ""}${spriteAnimation ? " is-sprite-animated" : ""}`}
                    data-character-id={actor.characterId}
                    data-sprite-animation={spriteAnimation?.animation}
                    data-expression-id={renderedExpressionId ?? undefined}
                    data-entering={
                      actor.entering && actor.transition.fade
                        ? "true"
                        : undefined
                    }
                    data-exiting={actor.exiting ? "true" : undefined}
                    tabIndex={editable ? 0 : -1}
                    aria-label={
                      editable ? `调整角色 ${character.name}` : undefined
                    }
                    onPointerDown={
                      editable && onCharacterPosition
                        ? (event) => {
                            const stage =
                              event.currentTarget.closest(".galgame-stage");
                            if (!(stage instanceof HTMLElement)) return;
                            event.currentTarget.setPointerCapture(
                              event.pointerId,
                            );
                            const move = (moveEvent: PointerEvent) => {
                              const bounds = stage.getBoundingClientRect();
                              onCharacterPosition(
                                Math.max(
                                  CHARACTER_POSITION_MIN,
                                  Math.min(
                                    CHARACTER_POSITION_MAX,
                                    ((moveEvent.clientX - bounds.left) /
                                      bounds.width) *
                                      100,
                                  ),
                                ),
                                Math.max(
                                  CHARACTER_POSITION_MIN,
                                  Math.min(
                                    CHARACTER_POSITION_MAX,
                                    ((moveEvent.clientY - bounds.top) /
                                      bounds.height) *
                                      100,
                                  ),
                                ),
                              );
                            };
                            const finish = () => {
                              window.removeEventListener("pointermove", move);
                              window.removeEventListener("pointerup", finish);
                            };
                            window.addEventListener("pointermove", move);
                            window.addEventListener("pointerup", finish, {
                              once: true,
                            });
                          }
                        : undefined
                    }
                    onKeyDown={
                      editable && onCharacterPosition
                        ? (event) => {
                            const step = event.shiftKey ? 5 : 1;
                            const delta = {
                              ArrowLeft: [-step, 0],
                              ArrowRight: [step, 0],
                              ArrowUp: [0, -step],
                              ArrowDown: [0, step],
                            }[event.key];
                            if (!delta) return;
                            event.preventDefault();
                            onCharacterPosition(
                              Math.max(
                                CHARACTER_POSITION_MIN,
                                Math.min(
                                  CHARACTER_POSITION_MAX,
                                  actor.transform.x + delta[0],
                                ),
                              ),
                              Math.max(
                                CHARACTER_POSITION_MIN,
                                Math.min(
                                  CHARACTER_POSITION_MAX,
                                  actor.transform.y + delta[1],
                                ),
                              ),
                            );
                          }
                        : undefined
                    }
                    style={{
                      left: `${actor.transform.x}%`,
                      top: `${actor.transform.y}%`,
                      zIndex: actor.transform.layer + 10,
                      opacity: actor.exiting ? 0 : actor.transform.opacity,
                      filter: `brightness(${actor.transform.brightness * focusMultiplier}) drop-shadow(0 6px 14px rgb(0 0 0 / 0.3))`,
                      transformOrigin:
                        actor.transform.anchor === "center"
                          ? "center"
                          : actor.transform.anchor === "topLeft"
                            ? "top left"
                            : "bottom center",
                      transform: `${
                        actor.transform.anchor === "center"
                          ? "translate(-50%, -50%)"
                          : actor.transform.anchor === "topLeft"
                            ? "translate(0, 0)"
                            : "translate(-50%, -100%)"
                      } scale(${actor.transform.scale}) scaleX(${actor.transform.flipX ? -1 : 1})`,
                      transitionDuration: `${actor.transition.durationMs}ms, ${actor.transition.durationMs}ms, ${actor.transition.durationMs}ms, ${stageStyle.focusTransitionMs}ms, ${actor.transition.durationMs}ms`,
                      animationDuration: spriteAnimation
                        ? `${spriteAnimation.durationMs}ms`
                        : `${actor.transition.durationMs}ms`,
                      animationIterationCount: spriteAnimation?.loop
                        ? "infinite"
                        : undefined,
                      height: `${expression?.heightPercent ?? character.portraitHeightPercent ?? document.settings?.characterStage?.defaultHeightPercent ?? 100}%`,
                    }}
                  >
                    <StoryAssetImage
                      fileId={asset?.fileId}
                      alt=""
                      className="galgame-player-portrait-image"
                      fallback={
                        <span className="galgame-player-portrait-fallback">
                          {character.name.slice(0, 1) || "角"}
                        </span>
                      }
                    />
                    {overlays.map(({ overlay, asset: overlayAsset }) => (
                      <StoryAssetImage
                        key={overlay.id}
                        fileId={overlayAsset.fileId}
                        alt=""
                        className="galgame-player-character-overlay"
                        style={{
                          left: `${overlay.x}%`,
                          top: `${overlay.y}%`,
                          width: `${overlay.width}%`,
                          opacity: overlay.opacity,
                        }}
                        fallback={null}
                      />
                    ))}
                  </div>
                );
              },
            )}
            {stageCgs.map(({ key, state, cg, variant, asset }) => {
              const overlay = state.displayMode === "overlay";
              const editable =
                key === "active" &&
                overlay &&
                mode === "edit" &&
                state.sourceBlockId === editableCgBlockId;
              const updatePosition = (x: number, y: number) =>
                onCgOverlayChange?.({
                  ...state.overlay,
                  x: clamp(x, 0, 100),
                  y: clamp(y, 0, 100),
                });
              return (
                <div
                  key={`${key}:${state.cgId}:${state.variantId}`}
                  className={`galgame-player-cg${editable ? " is-editable" : ""}`}
                  data-cg-id={state.cgId}
                  data-variant-id={state.variantId}
                  data-display-mode={state.displayMode}
                  data-fit={state.fit}
                  data-entering={
                    state.entering && state.transition.fade ? "true" : undefined
                  }
                  data-exiting={state.exiting ? "true" : undefined}
                  tabIndex={editable ? 0 : -1}
                  style={
                    {
                      "--galgame-cg-opacity": state.overlay.opacity,
                      left: overlay ? `${state.overlay.x}%` : undefined,
                      top: overlay ? `${state.overlay.y}%` : undefined,
                      width: overlay ? `${state.overlay.width}%` : undefined,
                      zIndex:
                        overlay &&
                        state.overlay.placement === "behindCharacters"
                          ? 5
                          : 35,
                      transitionDuration: `${state.transition.fade ? state.transition.durationMs : 0}ms`,
                      animationDuration: `${state.transition.fade ? state.transition.durationMs : 0}ms`,
                    } as CSSProperties
                  }
                  aria-label={`${editable ? "调整 " : ""}${cg?.name ?? "剧情 CG"} · ${variant?.label ?? "默认差分"}`}
                  onPointerDown={
                    editable && onCgOverlayChange
                      ? (event) => {
                          if (
                            event.target instanceof Element &&
                            event.target.closest(".galgame-player-cg-resize")
                          )
                            return;
                          const stage =
                            event.currentTarget.closest(".galgame-stage");
                          if (!(stage instanceof HTMLElement)) return;
                          event.currentTarget.setPointerCapture(
                            event.pointerId,
                          );
                          const move = (moveEvent: PointerEvent) => {
                            const bounds = stage.getBoundingClientRect();
                            updatePosition(
                              ((moveEvent.clientX - bounds.left) /
                                bounds.width) *
                                100,
                              ((moveEvent.clientY - bounds.top) /
                                bounds.height) *
                                100,
                            );
                          };
                          const finish = () => {
                            window.removeEventListener("pointermove", move);
                            window.removeEventListener("pointerup", finish);
                            window.removeEventListener("pointercancel", finish);
                          };
                          window.addEventListener("pointermove", move);
                          window.addEventListener("pointerup", finish, {
                            once: true,
                          });
                          window.addEventListener("pointercancel", finish, {
                            once: true,
                          });
                        }
                      : undefined
                  }
                  onKeyDown={
                    editable && onCgOverlayChange
                      ? (event) => {
                          const step = event.shiftKey ? 5 : 1;
                          const delta = {
                            ArrowLeft: [-step, 0],
                            ArrowRight: [step, 0],
                            ArrowUp: [0, -step],
                            ArrowDown: [0, step],
                          }[event.key];
                          if (!delta) return;
                          event.preventDefault();
                          updatePosition(
                            state.overlay.x + delta[0],
                            state.overlay.y + delta[1],
                          );
                        }
                      : undefined
                  }
                >
                  <StoryAssetImage
                    fileId={asset.fileId}
                    alt=""
                    className="galgame-player-cg-image"
                    fallback={null}
                  />
                  {editable && onCgOverlayChange ? (
                    <i
                      role="separator"
                      tabIndex={0}
                      className="galgame-player-cg-resize"
                      aria-label="调整 CG 画面宽度"
                      onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        const stage =
                          event.currentTarget.closest(".galgame-stage");
                        if (!(stage instanceof HTMLElement)) return;
                        event.currentTarget.setPointerCapture(event.pointerId);
                        const startX = event.clientX;
                        const startWidth = state.overlay.width;
                        const move = (moveEvent: PointerEvent) => {
                          const bounds = stage.getBoundingClientRect();
                          onCgOverlayChange({
                            ...state.overlay,
                            width: clamp(
                              startWidth +
                                ((moveEvent.clientX - startX) / bounds.width) *
                                  200,
                              5,
                              200,
                            ),
                          });
                        };
                        const finish = () => {
                          window.removeEventListener("pointermove", move);
                          window.removeEventListener("pointerup", finish);
                          window.removeEventListener("pointercancel", finish);
                        };
                        window.addEventListener("pointermove", move);
                        window.addEventListener("pointerup", finish, {
                          once: true,
                        });
                        window.addEventListener("pointercancel", finish, {
                          once: true,
                        });
                      }}
                      onKeyDown={(event) => {
                        if (
                          event.key !== "ArrowLeft" &&
                          event.key !== "ArrowRight"
                        )
                          return;
                        event.preventDefault();
                        event.stopPropagation();
                        const step = event.shiftKey ? 5 : 1;
                        onCgOverlayChange({
                          ...state.overlay,
                          width: clamp(
                            state.overlay.width +
                              (event.key === "ArrowRight" ? step : -step),
                            5,
                            200,
                          ),
                        });
                      }}
                    />
                  ) : null}
                </div>
              );
            })}
            {displayFrame.mode === "idle" ? (
              <button
                className="galgame-player-start"
                type="button"
                onClick={restart}
                disabled={mode === "edit"}
              >
                <Play aria-hidden />{" "}
                {mode === "edit" ? "选择一个 Block" : "开始试玩"}
              </button>
            ) : displayFrame.mode === "ending" ? (
              <div className="galgame-ending">
                <small>ENDING</small>
                <strong>{displayFrame.label}</strong>
                <button type="button" onClick={restart}>
                  重新开始
                </button>
              </div>
            ) : displayFrame.mode === "error" ? (
              <div className="galgame-player-error" role="alert">
                <strong>试玩已停止</strong>
                <span>{displayFrame.message}</span>
                <button type="button" onClick={restart}>
                  重新开始
                </button>
              </div>
            ) : displayFrame.mode === "stageOnly" ? (
              mode === "play" ? (
                <button
                  type="button"
                  className="galgame-stage-advance"
                  onClick={() => skipTimelineStep(1)}
                >
                  点击继续
                </button>
              ) : null
            ) : displayFrame.block.type === "branch" ? (
              <div className="galgame-choices">
                <strong>{displayFrame.block.prompt || "请选择"}</strong>
                {displayFrame.block.choices.map((choice) => (
                  <button
                    key={choice.id}
                    type="button"
                    onClick={() => enterFragment(choice.targetFragmentId)}
                  >
                    {choice.text || "未命名选项"}
                  </button>
                ))}
              </div>
            ) : displayFrame.block.type === "systemMessage" ? (
              <div
                className={`galgame-system-message tone-${displayFrame.block.tone}`}
                role="dialog"
                aria-modal="true"
                tabIndex={-1}
                autoFocus
                aria-label={
                  displayFrame.block.title ??
                  (displayFrame.block.mode === "confirm" ? "请确认" : "提示")
                }
                style={
                  systemMessageStyle
                    ? ({
                        "--message-panel": systemMessageStyle.panelColor,
                        "--message-title": systemMessageStyle.titleColor,
                        "--message-text": systemMessageStyle.textColor,
                        "--message-accent": systemMessageStyle.accentColor,
                        "--message-radius": `${systemMessageStyle.borderRadius}px`,
                        "--message-width": `${systemMessageStyle.width}px`,
                      } as CSSProperties)
                    : undefined
                }
                onKeyDown={(event) => {
                  if (event.key === "Escape") resolveSystemMessage(false);
                }}
              >
                <strong>
                  {displayFrame.block.title ??
                    (displayFrame.block.mode === "confirm" ? "请确认" : "提示")}
                </strong>
                <p>{displayFrame.block.text}</p>
                <footer>
                  {displayFrame.block.mode === "confirm" ? (
                    <button
                      type="button"
                      onClick={() => resolveSystemMessage(false)}
                    >
                      {displayFrame.block.cancelLabel || "取消"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="primary"
                    onClick={() => resolveSystemMessage(true)}
                  >
                    {displayFrame.block.acceptLabel ||
                      (displayFrame.block.mode === "confirm"
                        ? "确认"
                        : "知道了")}
                  </button>
                </footer>
              </div>
            ) : displayFrame.block.type === "wait" ? (
              <button
                type="button"
                className="galgame-player-wait"
                onClick={
                  mode === "play" && displayFrame.block.mode === "player"
                    ? advance
                    : undefined
                }
              >
                <Clock3 aria-hidden />
                <strong>
                  {displayFrame.block.mode === "player"
                    ? "点击继续"
                    : `等待 ${displayFrame.block.durationMs ?? 0}ms`}
                </strong>
                <small>
                  {displayFrame.block.mode === "player"
                    ? "空格 / Enter / 向下滚轮"
                    : "定时等待"}
                </small>
              </button>
            ) : displayFrame.block.type === "storyParagraph" ? (
              <button
                type="button"
                className={`galgame-story-paragraph style-${runtimeRef.current.paragraph.styleRef.id}`}
                onClick={mode === "play" ? advance : undefined}
              >
                <span>
                  {paragraphVisibleContents.map(({ block, content }, index) => (
                    <p
                      key={block.id}
                      className={
                        paragraphGroup &&
                        paragraphGroup.start + index < displayFrame.blockIndex
                          ? "is-read"
                          : undefined
                      }
                    >
                      <RichTextView
                        content={content}
                        document={document}
                        variables={runtimeVariables}
                      />
                    </p>
                  ))}
                </span>
                <em>
                  {visibleTextLength < Array.from(displayText).length
                    ? "点击显示全文"
                    : "点击继续"}
                </em>
              </button>
            ) : displayText ? (
              <button
                className="galgame-dialogue-box"
                type="button"
                onClick={mode === "play" ? advance : undefined}
                style={{
                  backgroundColor: hexToRgba(
                    dialogueStyle.backgroundColor,
                    dialogueStyle.backgroundOpacity,
                  ),
                  borderRadius: `${dialogueStyle.borderRadius}px`,
                  color: dialogueStyle.textColor,
                  // Keep dialogue readable while the responsive stage changes size.
                  // cqw follows the stage width, while the clamp prevents narrow
                  // previews from shrinking the text below a usable size.
                  fontSize: `clamp(14px, ${dialogueStyle.fontScale * 1.25}cqw, 28px)`,
                }}
              >
                {dialogueSkinAsset ? (
                  <StoryAssetImage
                    fileId={dialogueSkinAsset.fileId}
                    alt=""
                    className="galgame-dialogue-skin-image"
                    fallback={null}
                  />
                ) : null}
                {displayFrame.block.type === "dialogue" ? (
                  <>
                    {dialogueAvatarAsset?.type === "image" ? (
                      <span
                        className="galgame-dialogue-runtime-avatar"
                        style={
                          {
                            "--avatar-x": `${activeDialogueAvatar?.crop?.x ?? 50}%`,
                            "--avatar-y": `${activeDialogueAvatar?.crop?.y ?? 25}%`,
                            "--avatar-scale":
                              activeDialogueAvatar?.crop?.scale ?? 1.8,
                          } as CSSProperties
                        }
                      >
                        <StoryAssetImage
                          fileId={dialogueAvatarAsset.fileId}
                          alt=""
                          fallback={null}
                        />
                      </span>
                    ) : null}
                    <strong style={{ color: dialogueStyle.nameColor }}>
                      {dialogueSpeakerIds(displayFrame.block)
                        .map((speakerId, index) => {
                          const character = characters.get(speakerId);
                          return index === 0
                            ? dialogueDisplayName(
                                character,
                                activeDialogue?.displayNameId,
                                runtimeVariables,
                              )
                            : (character?.name ?? "未知角色");
                        })
                        .join("、")}
                    </strong>
                  </>
                ) : (
                  <small>旁白</small>
                )}
                <span>
                  {visibleRichContent ? (
                    <RichTextView
                      content={visibleRichContent}
                      document={document}
                      variables={runtimeVariables}
                    />
                  ) : (
                    Array.from(displayText).slice(0, visibleTextLength).join("")
                  )}
                </span>
                <em>
                  {mode === "edit"
                    ? "编辑预览"
                    : inlinePlayerWait
                      ? "等待玩家继续"
                      : visibleTextLength < Array.from(displayText).length
                        ? "点击显示全文"
                        : advanceMode === "auto"
                          ? "自动播放"
                          : "点击继续"}
                </em>
              </button>
            ) : null}
          </div>
        </div>
        {mode === "play" && displayFrame.mode !== "idle" ? (
          <div
            className="galgame-player-runtime-controls"
            aria-label="试玩控制"
          >
            {activeTimeline &&
            (displayFrame.mode === "content" ||
              displayFrame.mode === "stageOnly") ? (
              <>
                <span className="galgame-player-runtime-transport">
                  <button
                    type="button"
                    onClick={() => skipTimelineStep(-1)}
                    aria-label="上一步"
                  >
                    <SkipBack aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={toggleTimeline}
                    aria-label={timelinePlaying ? "暂停时间轴" : "播放时间轴"}
                  >
                    {timelinePlaying ? (
                      <Pause aria-hidden />
                    ) : (
                      <Play aria-hidden />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => skipTimelineStep(1)}
                    aria-label="下一步"
                  >
                    <SkipForward aria-hidden />
                  </button>
                </span>
                <input
                  type="range"
                  min="0"
                  max={activeTimeline.durationMs}
                  step="100"
                  value={Math.min(
                    timelinePositionMs,
                    activeTimeline.durationMs,
                  )}
                  onChange={(event) => seekTimeline(Number(event.target.value))}
                  aria-label="剧情时间轴进度"
                />
                <time>
                  {formatTimelineTime(timelinePositionMs)} /{" "}
                  {formatTimelineTime(activeTimeline.durationMs)}
                </time>
              </>
            ) : (
              <span className="galgame-player-runtime-hint">点击对话继续</span>
            )}
            <span className="galgame-player-advance-control">
              <small>推进</small>
              <span
                className="galgame-player-advance-mode"
                aria-label="推进模式"
              >
                <button
                  type="button"
                  className={advanceMode === "manual" ? "active" : ""}
                  onClick={() => selectAdvanceMode("manual")}
                >
                  手动
                </button>
                <button
                  type="button"
                  className={advanceMode === "auto" ? "active" : ""}
                  onClick={() => selectAdvanceMode("auto")}
                >
                  自动
                </button>
                <button
                  type="button"
                  className={advanceMode === "skip" ? "active" : ""}
                  onClick={() => selectAdvanceMode("skip")}
                >
                  跳过
                </button>
              </span>
            </span>
          </div>
        ) : null}
      </section>
    );
  },
);
