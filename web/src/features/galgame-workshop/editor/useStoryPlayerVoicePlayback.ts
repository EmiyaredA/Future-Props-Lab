import { useEffect, type RefObject } from "react";
import type {
  GalgameStoryAudioAsset,
  GalgameStoryBlock,
} from "@features/galgame-workshop/api";
import { createAudioLevelMonitor } from "@features/galgame-workshop/editor/lipSync";
import type { StoryPlayerProps } from "@features/galgame-workshop/editor/storyPlayerModel";
import type { useStoryPlayerAudio } from "@features/galgame-workshop/editor/useStoryPlayerAudio";

type Dialogue = Extract<GalgameStoryBlock, { type: "dialogue" }>;
type PlayerAudio = ReturnType<typeof useStoryPlayerAudio>;

export function useStoryPlayerVoicePlayback({
  mode,
  dialogue,
  voiceAsset,
  hasTimelineMaster,
  voiceOffsetMs = 0,
  advanceModeRef,
  advanceRef,
  exportAudioEvent,
  audio,
}: {
  mode: "play" | "edit";
  dialogue?: Dialogue;
  voiceAsset?: GalgameStoryAudioAsset;
  hasTimelineMaster: boolean;
  voiceOffsetMs?: number;
  advanceModeRef: RefObject<"manual" | "auto" | "skip">;
  advanceRef: RefObject<() => void>;
  exportAudioEvent?: NonNullable<
    StoryPlayerProps["exportMode"]
  >["onAudioEvent"];
  audio: PlayerAudio;
}) {
  const {
    channelGenerationRef,
    generationRef,
    mixRef,
    objectUrl,
    setAudioLevelDb,
    setVoicePlaying,
    stopPlaying,
    tryPlay,
    voiceRef,
  } = audio;
  useEffect(() => {
    if (mode === "edit") return;
    channelGenerationRef.current.voice += 1;
    const requestGeneration = channelGenerationRef.current.voice;
    if (voiceRef.current)
      exportAudioEvent?.({ action: "stop", channel: "voice" });
    stopPlaying(voiceRef.current);
    voiceRef.current = null;
    if (hasTimelineMaster || !dialogue?.voiceAssetId || !voiceAsset) return;
    const playerGeneration = generationRef.current;
    let autoAdvanceTimer: number | undefined;
    void objectUrl(voiceAsset.fileId)
      .then((url) => {
        if (
          playerGeneration !== generationRef.current ||
          requestGeneration !== channelGenerationRef.current.voice
        )
          return;
        const element = new Audio(url);
        const playing = {
          audio: element,
          baseVolume: (dialogue.voiceVolume ?? 100) / 100,
          levelMonitor: createAudioLevelMonitor(element, setAudioLevelDb),
        };
        element.volume = playing.baseVolume * (mixRef.current.voice / 100);
        element.currentTime = Math.max(0, voiceOffsetMs) / 1000;
        element.addEventListener("play", () => setVoicePlaying(true));
        element.addEventListener(
          "play",
          () =>
            exportAudioEvent?.({
              action: "play",
              channel: "voice",
              storyAssetId: voiceAsset.id,
              offsetMs: Math.max(0, voiceOffsetMs),
              volume: playing.baseVolume * (mixRef.current.voice / 100),
              loop: false,
              fadeMs: 0,
            }),
          { once: true },
        );
        element.addEventListener("pause", () => setVoicePlaying(false));
        element.addEventListener("ended", () => {
          setVoicePlaying(false);
          if (advanceModeRef.current === "auto")
            autoAdvanceTimer = window.setTimeout(
              () => advanceRef.current(),
              400,
            );
        });
        voiceRef.current = playing;
        void (async () => {
          await playing.levelMonitor?.resume().catch(() => undefined);
          setVoicePlaying(await tryPlay(element));
        })();
      })
      .catch(() => undefined);
    return () => {
      if (autoAdvanceTimer != null) window.clearTimeout(autoAdvanceTimer);
    };
  }, [
    advanceModeRef,
    advanceRef,
    channelGenerationRef,
    dialogue?.id,
    dialogue?.voiceAssetId,
    dialogue?.voiceVolume,
    exportAudioEvent,
    generationRef,
    hasTimelineMaster,
    mode,
    mixRef,
    objectUrl,
    setAudioLevelDb,
    setVoicePlaying,
    stopPlaying,
    tryPlay,
    voiceAsset,
    voiceOffsetMs,
    voiceRef,
  ]);
}
