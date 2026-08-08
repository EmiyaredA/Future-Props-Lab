import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Pause,
  Play,
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
  GalgameStoryFragment,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import {
  DEFAULT_DIALOGUE_BOX_STYLE,
  DEFAULT_STAGE_STYLE,
  DEFAULT_UI_STYLE,
  firstChapter,
  fragmentById,
  scenePalette,
} from "@features/galgame-workshop/editor/model";
import {
  applyAutomaticStageBlock,
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
import { dialogueSpeakerIds } from "@features/galgame-workshop/editor/dialogue";
import { StoryAssetImage } from "@features/galgame-workshop/editor/StoryAssetImage";
import {
  createAudioLevelMonitor,
  LipSyncLevelTracker,
  resolveLipSyncExpressionId,
  type AudioLevelMonitor,
  type LipSyncFrame,
} from "@features/galgame-workshop/editor/lipSync";
import { TimelineClock } from "@features/galgame-workshop/editor/timelineClock";
import {
  estimatedCueDuration,
  effectivePointTime,
  projectFragmentTimeline,
  timelineAudioStateAt,
  timelineCues,
  timelineEvents,
} from "@features/galgame-workshop/editor/timeline";

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

function nextFrame(
  document: GalgameStoryProject,
  fragmentId: string,
  blockIndex: number,
  initialStage: GalgameStageState,
  onAudio?: (block: GalgameStoryAudioBlock) => void,
): PlayerFrame {
  const chapter = firstChapter(document);
  const currentFragmentId = fragmentId;
  let currentBlockIndex = blockIndex;
  let stage = initialStage;
  for (let steps = 0; steps < 100; steps += 1) {
    if (!chapter)
      return {
        mode: "error",
        message: "工程没有可试玩章节",
        stage,
      };
    const fragment = fragmentById(chapter, currentFragmentId);
    if (!fragment)
      return {
        mode: "error",
        message: "试玩线路引用了不存在的 Fragment",
        stage,
      };
    const block = (fragment.blocks ?? [])[currentBlockIndex];
    if (!block)
      return {
        mode: "error",
        message: "线路在没有结局的位置中断",
        stage,
      };
    if (
      block.type === "scene" ||
      block.type === "showCharacter" ||
      block.type === "removeCharacter"
    ) {
      stage = applyAutomaticStageBlock(stage, block, document);
      currentBlockIndex += 1;
      continue;
    }
    if (block.type === "audio") {
      onAudio?.(block);
      currentBlockIndex += 1;
      continue;
    }
    if (block.type === "endChapter")
      return {
        mode: "ending",
        label: block.label,
        stage: emptyStageState(),
      };
    return {
      mode: "content",
      fragmentId: currentFragmentId,
      blockIndex: currentBlockIndex,
      block,
      stage: enterContentBlock(stage, block, document),
    };
  }
  return {
    mode: "error",
    message: "线路执行超过安全步数，请检查循环",
    stage,
  };
}

export interface StoryPlayerHandle {
  restart: () => void;
}

type StoryPlayerProps = {
  document: GalgameStoryProject;
  mode?: "edit" | "play";
  editFragment?: GalgameStoryFragment;
  editBlockIndex?: number;
  editTimelinePositionMs?: number | null;
  editAudioLevelDb?: number | null;
  editTimelinePlaying?: boolean;
  editableCharacterId?: string;
  onCharacterPosition?: (x: number, y: number) => void;
  onPlaybackPosition?: (position: {
    fragmentId: string;
    positionMs: number;
    blockId?: string;
  }) => void;
};

type MixChannel = "voice" | "bgm" | "ambient" | "sfx";

type PlayingAudio = {
  audio: HTMLAudioElement;
  baseVolume: number;
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
      document,
      mode = "play",
      editFragment,
      editBlockIndex,
      editTimelinePositionMs,
      editAudioLevelDb,
      editTimelinePlaying = false,
      editableCharacterId,
      onCharacterPosition,
      onPlaybackPosition,
    },
    ref,
  ) {
    const [frame, setFrame] = useState<PlayerFrame>({
      mode: "idle",
      stage: emptyStageState(),
    });
    const [mix, setMix] = useState(DEFAULT_MIX);
    const [mixerOpen, setMixerOpen] = useState(false);
    const [autoplayBlocked, setAutoplayBlocked] = useState(false);
    const [timelinePositionMs, setTimelinePositionMs] = useState(0);
    const [timelinePlaying, setTimelinePlaying] = useState(false);
    const [advanceMode, setAdvanceMode] = useState<"manual" | "auto">("manual");
    const [visibleTextLength, setVisibleTextLength] = useState(0);
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
    const chapter = firstChapter(document);
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
      (block: GalgameStoryAudioBlock) => {
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
            };
            audio.loop = block.loop;
            const target = playing.baseVolume * (mixRef.current[channel] / 100);
            audio.volume = block.fadeMs > 0 ? 0 : target;
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
            void tryPlay(audio);
            if (block.fadeMs > 0) fadeTo(playing, target, block.fadeMs);
          })
          .catch(() => undefined);
      },
      [document.assets, fadeTo, objectUrl, stopChannel, stopPlaying, tryPlay],
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
    const activeBackground = (activeScene?.backgrounds ?? []).find(
      (background) => background.id === displayFrame.stage.backgroundId,
    );
    const activeBackgroundAsset = (document.assets ?? []).find(
      (asset) => asset.id === activeBackground?.assetId,
    );
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
    const lipSyncSpeaking =
      stageStyle.lipSyncEnabled &&
      Boolean(activeDialogue) &&
      (mode === "edit" ? editTimelinePlaying : voicePlaying);
    const currentAudioLevelDb =
      mode === "edit" ? editAudioLevelDb : audioLevelDb;

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
          actor.expressionId ?? character.defaultExpressionId;
        const renderedExpressionId = resolveLipSyncExpressionId(
          character,
          authoredExpressionId,
          activeDialogueSpeakerIds.includes(actor.characterId) ? mouthFrame : 0,
        );
        const expression = (character.expressions ?? []).find(
          (candidate) => candidate.id === renderedExpressionId,
        );
        const asset = (document.assets ?? []).find(
          (candidate) => candidate.id === expression?.assetId,
        );
        return [{ actor, character, asset, renderedExpressionId }];
      },
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
        setFrame(
          terminator?.type === "endChapter"
            ? { mode: "ending", label: terminator.label, stage }
            : terminator?.type === "branch"
              ? {
                  mode: "content",
                  fragmentId: fragment.id,
                  blockIndex: terminatorIndex,
                  block: terminator,
                  stage: enterContentBlock(stage, terminator, document),
                }
              : {
                  mode: "error",
                  message: "时间轴结束，但 Fragment 没有分支或章节结局",
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
        stopChannel("bgm", 80);
        stopChannel("ambient", 80);
        const state = timelineAudioStateAt(fragment, milliseconds);
        if (state.bgm) executeAudioBlock(state.bgm);
        if (state.ambient) executeAudioBlock(state.ambient);
      },
      [executeAudioBlock, stopChannel],
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
            if (timelineRef.current === playing) setTimelinePlaying(next);
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
        const firstCue = timelineCues(fragment)[0];
        clock.seek(autoplay ? 0 : (firstCue?.startMs ?? 0));
        if (autoplay) clock.play();
        else if (firstCue)
          clock.playUntil(Math.max(firstCue.startMs, firstCue.endMs - 1));
      },
      [advanceMode, executeAudioBlock, finishTimeline, showTimelinePosition],
    );

    const restart = () => {
      cleanupPlayback();
      setAdvanceMode("manual");
      if (!chapter) {
        setFrame({
          mode: "error",
          message: "工程没有可试玩章节",
          stage: emptyStageState(),
        });
        return;
      }
      const entryFragment = fragmentById(chapter, chapter.entryFragmentId);
      if (entryFragment?.timeline) {
        startTimeline(entryFragment, false);
        return;
      }
      setFrame(
        nextFrame(
          document,
          chapter.entryFragmentId,
          0,
          emptyStageState(),
          executeAudioBlock,
        ),
      );
    };
    useImperativeHandle(ref, () => ({ restart }));
    const enterFragment = (fragmentId: string) => {
      if (!chapter) return;
      timelineRef.current?.clock.dispose();
      timelineRef.current = null;
      const target = fragmentById(chapter, fragmentId);
      if (target?.timeline) {
        startTimeline(target, advanceMode === "auto");
        return;
      }
      setFrame(
        nextFrame(
          document,
          fragmentId,
          0,
          emptyStageState(),
          executeAudioBlock,
        ),
      );
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
    const skipTimelineCue = (direction: -1 | 1) => {
      if (!activeFragment) return;
      fadeCurrentVoice();
      const cues = timelineCues(activeFragment);
      const currentIndex =
        frame.mode === "content"
          ? cues.findIndex(({ blockIndex }) => blockIndex === frame.blockIndex)
          : Math.max(
              0,
              cues.findIndex(
                ({ block }) => (block.startMs ?? 0) >= timelinePositionMs,
              ),
            );
      const nextIndex = Math.max(
        0,
        Math.min(cues.length - 1, currentIndex + direction),
      );
      if (direction === 1 && currentIndex >= cues.length - 1)
        seekTimeline(activeFragment.timeline?.durationMs ?? 0, true);
      else {
        const nextCue = cues[nextIndex];
        seekTimeline(nextCue?.startMs ?? 0, true);
        if (advanceModeRef.current === "manual" && nextCue)
          timelineRef.current?.clock.playUntil(
            Math.max(nextCue.startMs, nextCue.endMs - 1),
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
    const selectAdvanceMode = (next: "manual" | "auto") => {
      setAdvanceMode(next);
      const playing = timelineRef.current;
      if (!playing) return;
      if (next === "auto") {
        if (
          playing.clock.position >= (activeFragment?.timeline?.durationMs ?? 0)
        )
          playing.clock.seek(0);
        playing.clock.play();
      } else playing.clock.pause();
    };
    const advance = () => {
      if (frame.mode !== "content") return;
      if (
        (frame.block.type === "dialogue" || frame.block.type === "narration") &&
        visibleTextLength < Array.from(frame.block.text || "（空正文）").length
      ) {
        setVisibleTextLength(
          Array.from(frame.block.text || "（空正文）").length,
        );
        return;
      }
      if (activeTimeline) {
        skipTimelineCue(1);
        return;
      }
      fadeCurrentVoice();
      setFrame(
        nextFrame(
          document,
          frame.fragmentId,
          frame.blockIndex + 1,
          leaveContentBlock(frame.stage, frame.block),
          executeAudioBlock,
        ),
      );
    };
    advanceRef.current = advance;

    const displayText =
      displayFrame.mode === "content" &&
      (displayFrame.block.type === "dialogue" ||
        displayFrame.block.type === "narration")
        ? displayFrame.block.text || "（空正文）"
        : "";
    const displayBlockId =
      displayFrame.mode === "content" ? displayFrame.block.id : "";

    useEffect(() => {
      if (!displayText) {
        setVisibleTextLength(0);
        return;
      }
      if (
        mode === "edit" ||
        globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      ) {
        setVisibleTextLength(Array.from(displayText).length);
        return;
      }
      const characters = Array.from(displayText);
      const durationMs = Math.min(
        1800,
        Math.max(200, (characters.length / 40) * 1000),
      );
      const stepMs = Math.max(16, durationMs / Math.max(1, characters.length));
      setVisibleTextLength(0);
      const timer = window.setInterval(
        () =>
          setVisibleTextLength((current) => {
            const next = Math.min(characters.length, current + 1);
            if (next >= characters.length) window.clearInterval(timer);
            return next;
          }),
        stepMs,
      );
      return () => window.clearInterval(timer);
    }, [displayBlockId, displayText, mode]);

    useEffect(() => {
      if (
        mode !== "play" ||
        advanceMode !== "auto" ||
        activeTimeline ||
        activeVoiceAsset ||
        frame.mode !== "content" ||
        (frame.block.type !== "dialogue" && frame.block.type !== "narration")
      )
        return;
      const timer = window.setTimeout(
        () => advanceRef.current(),
        estimatedCueDuration(frame.block.text),
      );
      return () => window.clearTimeout(timer);
    }, [activeTimeline, activeVoiceAsset, advanceMode, frame, mode]);

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
            <strong>{mode === "edit" ? "舞台编辑" : "游戏预览"}</strong>
            <small>
              {scenes.get(displayFrame.stage.sceneId ?? "")?.name ?? "空舞台"}
            </small>
          </div>
          <span className="galgame-player-header-actions">
            {mode === "play" && displayFrame.mode !== "idle" ? (
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
              </span>
            ) : null}
            <button
              type="button"
              className={mixerOpen ? "active" : ""}
              onClick={() => setMixerOpen((current) => !current)}
              aria-label="试玩混音"
            >
              <SlidersHorizontal aria-hidden />
            </button>
            {mode === "play" ? (
              <button type="button" onClick={restart} aria-label="重新开始试玩">
                <RotateCcw aria-hidden />
              </button>
            ) : null}
          </span>
        </header>
        <div
          className="galgame-stage"
          style={{
            background: `radial-gradient(circle at 55% 25%, ${palette.first}, ${palette.second})`,
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
          {activeBackgroundAsset ? (
            <StoryAssetImage
              fileId={activeBackgroundAsset.fileId}
              alt=""
              className="galgame-player-background"
              fallback={null}
            />
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
                zIndex: component.layer + 2,
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
            ({ actor, character, asset, renderedExpressionId }) => {
              const focused =
                displayFrame.stage.activeSpeakerIds?.includes(
                  actor.characterId,
                ) ?? displayFrame.stage.activeSpeakerId === actor.characterId;
              const hasActiveSpeakers = Boolean(
                displayFrame.stage.activeSpeakerIds?.length ??
                displayFrame.stage.activeSpeakerId,
              );
              const focusMultiplier =
                stageStyle.speakerFocusEnabled && hasActiveSpeakers && !focused
                  ? stageStyle.inactiveBrightness
                  : 1;
              const editable =
                mode === "edit" && actor.characterId === editableCharacterId;
              return (
                <div
                  key={actor.characterId}
                  className={`galgame-stage-actor${editable ? " is-editable" : ""}`}
                  data-character-id={actor.characterId}
                  data-expression-id={renderedExpressionId ?? undefined}
                  data-entering={
                    actor.entering && actor.transition.fade ? "true" : undefined
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
                    zIndex: actor.transform.layer + 2,
                    opacity: actor.exiting ? 0 : actor.transform.opacity,
                    filter: `brightness(${actor.transform.brightness * focusMultiplier}) drop-shadow(0 6px 14px rgb(0 0 0 / 0.3))`,
                    transform: `translate(-50%, -100%) scale(${actor.transform.scale}) scaleX(${actor.transform.flipX ? -1 : 1})`,
                    transitionDuration: `${actor.transition.durationMs}ms, ${actor.transition.durationMs}ms, ${actor.transition.durationMs}ms, ${stageStyle.focusTransitionMs}ms, ${actor.transition.durationMs}ms`,
                    animationDuration: `${actor.transition.durationMs}ms`,
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
                </div>
              );
            },
          )}
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
                onClick={() => skipTimelineCue(1)}
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
          ) : displayFrame.block.type === "dialogue" ||
            displayFrame.block.type === "narration" ? (
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
                fontSize: `${dialogueStyle.fontScale}em`,
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
                <strong style={{ color: dialogueStyle.nameColor }}>
                  {dialogueSpeakerIds(displayFrame.block)
                    .map(
                      (speakerId) =>
                        characters.get(speakerId)?.name ?? "未知角色",
                    )
                    .join("、")}
                </strong>
              ) : (
                <small>旁白</small>
              )}
              <span>
                {Array.from(displayText).slice(0, visibleTextLength).join("")}
              </span>
              <em>
                {mode === "edit"
                  ? "编辑预览"
                  : visibleTextLength < Array.from(displayText).length
                    ? "点击显示全文"
                    : advanceMode === "auto"
                      ? "自动播放"
                      : "点击继续"}
              </em>
            </button>
          ) : null}
        </div>
        {activeTimeline &&
        (displayFrame.mode === "content" ||
          displayFrame.mode === "stageOnly") ? (
          <div
            className="galgame-player-timeline-controls"
            aria-label="剧情时间轴控制"
          >
            <button
              type="button"
              onClick={() => skipTimelineCue(-1)}
              aria-label="上一句"
            >
              <SkipBack aria-hidden />
            </button>
            <button
              type="button"
              onClick={toggleTimeline}
              aria-label={timelinePlaying ? "暂停时间轴" : "播放时间轴"}
            >
              {timelinePlaying ? <Pause aria-hidden /> : <Play aria-hidden />}
            </button>
            <button
              type="button"
              onClick={() => skipTimelineCue(1)}
              aria-label="下一句"
            >
              <SkipForward aria-hidden />
            </button>
            <input
              type="range"
              min="0"
              max={activeTimeline.durationMs}
              step="100"
              value={Math.min(timelinePositionMs, activeTimeline.durationMs)}
              onChange={(event) => seekTimeline(Number(event.target.value))}
              aria-label="剧情时间轴进度"
            />
            <span>
              {formatTimelineTime(timelinePositionMs)} /{" "}
              {formatTimelineTime(activeTimeline.durationMs)}
            </span>
          </div>
        ) : null}
      </section>
    );
  },
);
