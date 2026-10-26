import { useLayoutEffect, useRef } from "react";
import {
  paintChromaCanvas,
  recordChromaDuplicateFrameSkip,
} from "./chromaCanvas";
import { clipSourceTimeUs } from "./editorModel";
import { paintSpinBlurCanvas } from "./spinBlurCanvas";
import {
  paintWhipPanCanvas,
  type WhipPanEffect,
} from "./directionalTransitionCanvas";
import type { VideoProxyCrop } from "./previewGeometry";
import type { VideoEditorClip } from "./types";
import { noTimedEffects, type ActiveTimedEffect } from "./timedEffects";
import { paintTimedEffectsCanvas } from "./timedEffectsCanvas";

/** Present only positioned frames; keep the last decoded frame across cuts. */
export function VideoEditorProxyVideo({
  source,
  clip,
  localUs,
  playing,
  crop,
  chromaKey,
  spinBlur = 0,
  whipPan,
  timedEffects = noTimedEffects,
  fittedWidth,
}: {
  source: string;
  clip: VideoEditorClip;
  localUs: number;
  playing: boolean;
  crop: VideoProxyCrop;
  chromaKey?: VideoEditorClip["chromaKey"];
  spinBlur?: number;
  whipPan?: WhipPanEffect;
  timedEffects?: ActiveTimedEffect[];
  fittedWidth?: number;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const paintedTime = useRef(Number.NaN);
  const playRequested = useRef(false);
  const updatePlayback = useRef<(() => void) | null>(null);
  const frame = useRef({
    target: 0,
    start: 0,
    end: 0,
    advancing: false,
    exact: true,
    rate: 1,
    chromaKey,
    spinBlur,
    whipPan,
    timedEffects,
    fittedWidth,
    crop,
  });
  const previous = useRef<
    | {
        clip: VideoEditorClip;
        source: string;
        playing: boolean;
        spinBlur: number;
        whipPan?: WhipPanEffect;
        timedEffects?: ActiveTimedEffect[];
      }
    | undefined
  >(undefined);
  useLayoutEffect(() => {
    const target = clipSourceTimeUs(clip, localUs) / 1_000_000;
    const start = clip.sourceInUs / 1_000_000;
    const end = clipSourceTimeUs(clip, clip.durationUs) / 1_000_000;
    const advancing = playing && localUs > 0 && localUs < clip.durationUs - 1;
    const prior = previous.current;
    const cut =
      prior &&
      (prior.source !== source ||
        (prior.clip.id !== clip.id &&
          (clipSourceTimeUs(prior.clip, prior.clip.durationUs) !==
            clip.sourceInUs ||
            (prior.clip.playbackRate ?? 1) !== (clip.playbackRate ?? 1))));
    const exact = !advancing || !prior?.playing || Boolean(cut);
    if (
      cut ||
      prior?.clip.chromaKey !== chromaKey ||
      prior?.spinBlur !== spinBlur ||
      prior?.whipPan?.amount !== whipPan?.amount ||
      prior?.whipPan?.direction !== whipPan?.direction ||
      prior?.timedEffects !== timedEffects
    )
      paintedTime.current = Number.NaN;
    previous.current = {
      clip,
      source,
      playing: advancing,
      spinBlur,
      whipPan,
      timedEffects,
    };
    frame.current = {
      target,
      start,
      end,
      advancing,
      exact,
      rate: clip.playbackRate ?? 1,
      chromaKey,
      spinBlur,
      whipPan,
      timedEffects,
      fittedWidth,
      crop,
    };
    updatePlayback.current?.();
  }, [
    clip,
    localUs,
    playing,
    source,
    chromaKey,
    spinBlur,
    whipPan,
    timedEffects,
    fittedWidth,
    crop,
  ]);
  useLayoutEffect(() => {
    const node = video.current;
    const surface = canvas.current;
    if (!node || !surface) return;
    let cancelled = false;
    let callback: number | undefined;
    let raf: number | undefined;
    const supportsFrames = typeof node.requestVideoFrameCallback === "function";
    const pause = () => {
      playRequested.current = false;
      node.pause();
    };
    const positioned = () => {
      const { start, end, target, exact } = frame.current;
      return (
        !node.seeking &&
        node.readyState >= 2 &&
        node.currentTime >= start &&
        node.currentTime < end &&
        Math.abs(node.currentTime - target) <= (exact ? 0.000001 : 0.12)
      );
    };
    const paint = (mediaTime = node.currentTime) => {
      const {
        start,
        end,
        target,
        chromaKey,
        spinBlur,
        whipPan,
        timedEffects,
        fittedWidth,
        crop,
      } = frame.current;
      if (!positioned() || !node.videoWidth || !node.videoHeight) return;
      if (
        mediaTime < start ||
        mediaTime >= end ||
        Math.abs(mediaTime - target) > 0.12
      )
        return;
      if (mediaTime === paintedTime.current) {
        if (chromaKey?.enabled) recordChromaDuplicateFrameSkip();
        return;
      }
      paintedTime.current = mediaTime;
      if (chromaKey?.enabled) {
        paintChromaCanvas(
          surface,
          node,
          node.videoWidth,
          node.videoHeight,
          chromaKey,
        );
      } else {
        if (surface.width !== node.videoWidth) surface.width = node.videoWidth;
        if (surface.height !== node.videoHeight)
          surface.height = node.videoHeight;
        surface.getContext("2d")?.drawImage(node, 0, 0);
      }
      if (spinBlur || whipPan || timedEffects.length) {
        // Remove letterboxing before sampling so proxy padding never becomes a trail.
        const width = (surface.width * 100) / crop.widthPercent;
        const height = (surface.height * 100) / crop.heightPercent;
        const area = {
          x: (-crop.leftPercent / 100) * width,
          y: (-crop.topPercent / 100) * height,
          width,
          height,
        };
        if (timedEffects.length) {
          paintSpinBlurCanvas(surface, surface, width, height, 0, area);
          paintTimedEffectsCanvas(surface, timedEffects, fittedWidth);
        }
        if (spinBlur)
          paintSpinBlurCanvas(
            surface,
            surface,
            timedEffects.length ? surface.width : width,
            timedEffects.length ? surface.height : height,
            spinBlur,
            timedEffects.length ? undefined : area,
          );
        if (whipPan)
          paintWhipPanCanvas(
            surface,
            surface,
            spinBlur || timedEffects.length ? surface.width : width,
            spinBlur || timedEffects.length ? surface.height : height,
            whipPan,
            spinBlur || timedEffects.length ? undefined : area,
          );
      }
    };
    const sync = () => {
      if (cancelled) return false;
      const { target, start, end, exact, advancing, rate } = frame.current;
      if (node.playbackRate !== rate) node.playbackRate = rate;
      const drift = Math.abs(node.currentTime - target);
      if (node.seeking) {
        pause();
        return false;
      }
      if (
        drift > (exact ? 0.000001 : 0.12) ||
        (node.currentTime < start && (exact || !advancing)) ||
        node.currentTime >= end
      ) {
        pause();
        // Do not publish loadeddata from the old position after assigning a seek.
        if (drift > 0.000001) node.currentTime = Math.max(0, target);
        return false;
      }
      if (advancing && node.readyState >= 2) {
        if (!playRequested.current) {
          playRequested.current = true;
          void node.play().catch(() => {
            if (!cancelled) playRequested.current = false;
          });
        }
      } else pause();
      return positioned();
    };
    const tick = (_now?: number, metadata?: VideoFrameCallbackMetadata) => {
      callback = undefined;
      raf = undefined;
      if (cancelled) return;
      if (sync()) paint(metadata?.mediaTime);
      schedule();
    };
    const schedule = () => {
      if (callback !== undefined || raf !== undefined) return;
      if (supportsFrames) callback = node.requestVideoFrameCallback(tick);
      else if (frame.current.advancing) raf = requestAnimationFrame(tick);
    };
    const mediaReady = () => {
      if (sync()) paint();
    };
    updatePlayback.current = () => {
      if (sync() && !frame.current.advancing) paint();
      schedule();
    };
    updatePlayback.current();
    node.addEventListener("loadedmetadata", sync);
    node.addEventListener("loadeddata", mediaReady);
    node.addEventListener("seeked", mediaReady);
    return () => {
      cancelled = true;
      updatePlayback.current = null;
      if (callback !== undefined) node.cancelVideoFrameCallback(callback);
      if (raf !== undefined) cancelAnimationFrame(raf);
      node.removeEventListener("loadedmetadata", sync);
      node.removeEventListener("loadeddata", mediaReady);
      node.removeEventListener("seeked", mediaReady);
    };
  }, []);
  const placement = {
    left: `${crop.leftPercent}%`,
    top: `${crop.topPercent}%`,
    width: `${crop.widthPercent}%`,
    height: `${crop.heightPercent}%`,
  };
  return (
    <>
      <video
        ref={video}
        muted
        src={source}
        preload="auto"
        style={{ ...placement, visibility: "hidden" }}
      />
      <canvas
        ref={canvas}
        className="ve-keyed-media"
        style={
          spinBlur || whipPan || timedEffects.length
            ? { left: 0, top: 0, width: "100%", height: "100%" }
            : placement
        }
        aria-hidden
      />
    </>
  );
}
