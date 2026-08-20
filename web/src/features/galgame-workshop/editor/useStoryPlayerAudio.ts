import { useCallback, useEffect, useRef, useState } from "react";
import { fetchApiBlob } from "@platform/api/client";
import type {
  GalgameStoryAudioBlock,
  GalgameStoryFragment,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import {
  LipSyncLevelTracker,
  type AudioLevelMonitor,
  type LipSyncFrame,
} from "@features/galgame-workshop/editor/lipSync";
import { timelineAudioPlaybackStateAt } from "@features/galgame-workshop/editor/timeline";
import type { TimelineClock } from "@features/galgame-workshop/editor/timelineClock";

export type StoryPlayerMixChannel = "voice" | "bgm" | "ambient" | "sfx";

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

export function useStoryPlayerAudio(
  document: GalgameStoryProject,
  mix: Record<StoryPlayerMixChannel, number>,
) {
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [timelinePositionMs, setTimelinePositionMs] = useState(0);
  const [timelinePlaying, setTimelinePlaying] = useState(false);
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
  const channelGenerationRef = useRef({ bgm: 0, ambient: 0, sfx: 0, voice: 0 });

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
    const pending = fetchApiBlob(`/v1/files/${fileId}/content`).then((blob) => {
      const url = URL.createObjectURL(blob);
      if (generation !== generationRef.current) {
        URL.revokeObjectURL(url);
        throw new Error("player_reset");
      }
      return url;
    });
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

  return {
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
    channelRefs,
    sfxRef,
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
  };
}
