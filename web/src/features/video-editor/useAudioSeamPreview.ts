import { useEffect, useRef, useState } from "react";
import type { VideoEditorClip } from "./types";

type Playback = { stop: () => void };

function ready(audio: HTMLAudioElement): Promise<void> {
  if (audio.readyState >= 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    audio.addEventListener("loadedmetadata", () => resolve(), { once: true });
    audio.addEventListener(
      "error",
      () => reject(new Error("音频预听加载失败")),
      {
        once: true,
      },
    );
    audio.load();
  });
}

function seek(audio: HTMLAudioElement, seconds: number): Promise<void> {
  if (Math.abs(audio.currentTime - seconds) < 0.01) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error("音频定位超时")),
      5000,
    );
    audio.addEventListener(
      "seeked",
      () => {
        window.clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
    audio.currentTime = seconds;
  });
}

export function useAudioSeamPreview() {
  const playback = useRef<Playback | undefined>(undefined);
  const [playing, setPlaying] = useState(false);
  const stop = () => {
    playback.current?.stop();
    playback.current = undefined;
    setPlaying(false);
  };
  useEffect(() => () => playback.current?.stop(), []);
  const play = async (
    url: string,
    from: VideoEditorClip,
    to: VideoEditorClip,
    sourceInUs: number,
    fadeUs: number,
  ) => {
    stop();
    const context = new AudioContext();
    const left = new Audio(url);
    const right = new Audio(url);
    const leftGain = context.createGain();
    const rightGain = context.createGain();
    context
      .createMediaElementSource(left)
      .connect(leftGain)
      .connect(context.destination);
    context
      .createMediaElementSource(right)
      .connect(rightGain)
      .connect(context.destination);
    leftGain.gain.value = 1;
    rightGain.gain.value = 0;
    left.playbackRate = from.playbackRate ?? 1;
    right.playbackRate = to.playbackRate ?? 1;
    const timers: number[] = [];
    let stopped = false;
    const current: Playback = {
      stop: () => {
        if (stopped) return;
        stopped = true;
        timers.forEach(window.clearTimeout);
        left.pause();
        right.pause();
        left.removeAttribute("src");
        right.removeAttribute("src");
        void context.close();
      },
    };
    playback.current = current;
    try {
      await Promise.all([ready(left), ready(right)]);
      if (stopped) return;
      const leftSourceEndUs =
        from.sourceInUs + from.durationUs * (from.playbackRate ?? 1);
      const beforeSeconds = Math.min(2, from.durationUs / 1_000_000);
      await Promise.all([
        seek(
          left,
          (leftSourceEndUs - beforeSeconds * 1_000_000 * left.playbackRate) /
            1_000_000,
        ),
        seek(right, sourceInUs / 1_000_000),
      ]);
      if (stopped) return;
      await context.resume();
      await left.play();
      if (stopped) return;
      setPlaying(true);
      const seamDelayMs = Math.max(0, beforeSeconds * 1000 - fadeUs / 1000);
      timers.push(
        window.setTimeout(() => {
          if (stopped) return;
          void right
            .play()
            .then(() => {
              if (stopped) return;
              const at = context.currentTime;
              leftGain.gain.setValueAtTime(1, at);
              leftGain.gain.linearRampToValueAtTime(0, at + fadeUs / 1_000_000);
              rightGain.gain.setValueAtTime(0, at);
              rightGain.gain.linearRampToValueAtTime(
                1,
                at + fadeUs / 1_000_000,
              );
            })
            .catch(() => stop());
        }, seamDelayMs),
      );
      timers.push(window.setTimeout(stop, beforeSeconds * 1000 + 2000));
    } catch (error) {
      stop();
      throw error;
    }
  };
  return { play, stop, playing };
}
