import { useEffect, useRef, useState } from "react";
import {
  audioSweepFrequency,
  audioTransitionGain,
  audioTransitionProgress,
  type AudioTransitionKind,
} from "./audioTransitionCurves";
import type { VideoEditorClip } from "./types";

type Session = { stop: () => void };

function loaded(audio: HTMLAudioElement): Promise<void> {
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

function seek(audio: HTMLAudioElement, time: number): Promise<void> {
  if (Math.abs(audio.currentTime - time) < 0.01) return Promise.resolve();
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
    audio.currentTime = time;
  });
}

export function useAudioTransitionAudition() {
  const session = useRef<Session | undefined>(undefined);
  const [playing, setPlaying] = useState(false);
  const stop = () => {
    session.current?.stop();
    session.current = undefined;
    setPlaying(false);
  };
  useEffect(() => () => session.current?.stop(), []);
  const play = async (
    fromUrl: string,
    toUrl: string,
    from: VideoEditorClip,
    to: VideoEditorClip,
    kind: AudioTransitionKind,
    durationUs: number,
    easing: string,
  ) => {
    stop();
    const context = new AudioContext();
    const left = new Audio(fromUrl);
    const right = new Audio(toUrl);
    const leftFilter = context.createBiquadFilter();
    const rightFilter = context.createBiquadFilter();
    const leftGain = context.createGain();
    const rightGain = context.createGain();
    leftFilter.type = "lowpass";
    rightFilter.type = "highpass";
    leftFilter.frequency.value = 20_000;
    rightFilter.frequency.value = 20;
    leftGain.gain.value = 1;
    rightGain.gain.value = 0;
    context
      .createMediaElementSource(left)
      .connect(leftFilter)
      .connect(leftGain)
      .connect(context.destination);
    context
      .createMediaElementSource(right)
      .connect(rightFilter)
      .connect(rightGain)
      .connect(context.destination);
    left.playbackRate = from.playbackRate ?? 1;
    right.playbackRate = to.playbackRate ?? 1;
    const timers: number[] = [];
    let interval: number | undefined;
    let stopped = false;
    const current: Session = {
      stop: () => {
        if (stopped) return;
        stopped = true;
        timers.forEach(window.clearTimeout);
        if (interval !== undefined) window.clearInterval(interval);
        left.pause();
        right.pause();
        left.removeAttribute("src");
        right.removeAttribute("src");
        void context.close();
      },
    };
    session.current = current;
    try {
      await Promise.all([loaded(left), loaded(right)]);
      if (stopped) return;
      const seamSeconds = durationUs / 1_000_000;
      const beforeSeconds = Math.min(
        from.durationUs / 1_000_000,
        Math.max(2, seamSeconds + 0.5),
      );
      const sourceEndUs = from.sourceInUs + from.durationUs * left.playbackRate;
      await Promise.all([
        seek(
          left,
          (sourceEndUs - beforeSeconds * 1_000_000 * left.playbackRate) /
            1_000_000,
        ),
        seek(right, to.sourceInUs / 1_000_000),
      ]);
      if (stopped) return;
      await context.resume();
      await left.play();
      if (stopped) return;
      setPlaying(true);
      const delayMs = Math.max(0, (beforeSeconds - seamSeconds) * 1000);
      timers.push(
        window.setTimeout(() => {
          if (stopped) return;
          void right
            .play()
            .then(() => {
              if (stopped) return;
              const started = context.currentTime;
              const update = () => {
                const progress = audioTransitionProgress(
                  (context.currentTime - started) / (durationUs / 1_000_000),
                  easing,
                );
                leftGain.gain.value = audioTransitionGain(
                  kind,
                  progress,
                  false,
                );
                rightGain.gain.value = audioTransitionGain(
                  kind,
                  progress,
                  true,
                );
                leftFilter.frequency.value =
                  kind === "audio-filter-sweep"
                    ? audioSweepFrequency(progress, false)
                    : 20_000;
                rightFilter.frequency.value =
                  kind === "audio-filter-sweep"
                    ? audioSweepFrequency(progress, true)
                    : 20;
              };
              update();
              interval = window.setInterval(update, 20);
            })
            .catch(stop);
        }, delayMs),
      );
      timers.push(window.setTimeout(stop, beforeSeconds * 1000 + 1000));
    } catch (error) {
      stop();
      throw error;
    }
  };
  return { play, stop, playing };
}
