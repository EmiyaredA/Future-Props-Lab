import { formatTime, frameUs } from "./editorModel";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Maximize2, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import type { VideoEditorAsset } from "./types";

function sourceMediaUrl(asset: VideoEditorAsset) {
  if (asset.mediaKind === "video" || asset.mediaKind === "audio") {
    return asset.proxyUrl || `/v1/files/${asset.id}/content`;
  }
  if (asset.mediaKind === "image") {
    return `/v1/files/${asset.id}/content`;
  }
  return "";
}

function sourceDurationUs(asset: VideoEditorAsset) {
  const probed = Number(asset.probe?.durationUs);
  if (Number.isFinite(probed) && probed > 0) return probed;
  if (asset.mediaKind === "image") return 0;
  return 5_000_000;
}

function mediaNearEnd(media: HTMLMediaElement, durationUs: number) {
  if (media.ended) return true;
  if (!(durationUs > 0)) return false;
  return media.currentTime * 1_000_000 >= durationUs - 40_000;
}

export function VideoEditorSourceMonitor({
  asset,
  fps,
  canvasWidth,
  canvasHeight,
  showCanvasGuides,
  onToggleCanvasGuides,
  onExitSource,
}: {
  asset: VideoEditorAsset;
  fps: number;
  canvasWidth: number;
  canvasHeight: number;
  showCanvasGuides: boolean;
  onToggleCanvasGuides: () => void;
  onExitSource: () => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const playingRef = useRef(false);
  const playheadRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [playheadUs, setPlayheadUs] = useState(0);
  const durationUs = sourceDurationUs(asset);
  const mediaUrl = sourceMediaUrl(asset);
  const stepUs = frameUs(fps);
  const isImage = asset.mediaKind === "image";
  const isAudio = asset.mediaKind === "audio";
  const isVideo = asset.mediaKind === "video";
  const canScrub = !isImage && durationUs > 0;

  playheadRef.current = playheadUs;

  const mediaElement = useCallback(
    () => (isImage ? null : isAudio ? audioRef.current : videoRef.current),
    [isImage, isAudio],
  );

  const seekMedia = (nextUs: number) => {
    const clamped = Math.max(0, Math.min(durationUs, nextUs));
    playheadRef.current = clamped;
    setPlayheadUs(clamped);
    const media = mediaElement();
    if (!media) return;
    const target = clamped / 1_000_000;
    if (Math.abs(media.currentTime - target) > 0.01) {
      media.currentTime = target;
    }
  };

  const stopPlayback = () => {
    playingRef.current = false;
    setPlaying(false);
    const media = mediaElement();
    if (!media) return;
    try {
      media.pause();
    } catch {
      /* jsdom may not implement pause */
    }
  };

  const startPlayback = async () => {
    const media = mediaElement();
    if (!media || isImage) return;
    if (mediaNearEnd(media, durationUs)) {
      media.currentTime = 0;
      playheadRef.current = 0;
      setPlayheadUs(0);
    }
    playingRef.current = true;
    setPlaying(true);
    try {
      await media.play();
      if (!playingRef.current) {
        try {
          media.pause();
        } catch {
          /* ignore */
        }
      }
    } catch {
      // Browser aborts play when currentTime is written mid-flight; keep UI honest.
      if (playingRef.current) {
        playingRef.current = false;
        setPlaying(false);
      }
    }
  };

  const togglePlayback = () => {
    if (playingRef.current) stopPlayback();
    else void startPlayback();
  };

  useEffect(() => {
    playingRef.current = false;
    setPlaying(false);
    playheadRef.current = 0;
    setPlayheadUs(0);
  }, [asset.id]);

  useEffect(() => {
    const media = mediaElement();
    if (!media || isImage) return;
    const onTimeUpdate = () => {
      if (!playingRef.current || media.seeking) return;
      const next = Math.round(media.currentTime * 1_000_000);
      const clamped = Math.max(0, Math.min(durationUs, next));
      playheadRef.current = clamped;
      setPlayheadUs(clamped);
    };
    const onEnded = () => {
      playingRef.current = false;
      setPlaying(false);
      const end = durationUs > 0 ? durationUs : 0;
      playheadRef.current = end;
      setPlayheadUs(end);
    };
    media.addEventListener("timeupdate", onTimeUpdate);
    media.addEventListener("ended", onEnded);
    return () => {
      media.removeEventListener("timeupdate", onTimeUpdate);
      media.removeEventListener("ended", onEnded);
    };
  }, [asset.id, durationUs, isAudio, isImage, mediaElement]);

  useEffect(() => {
    if (!playing || isImage) return;
    let frame = 0;
    const tick = () => {
      const media = mediaElement();
      if (media && !media.seeking) {
        const next = Math.round(media.currentTime * 1_000_000);
        const clamped = Math.max(0, Math.min(durationUs, next));
        playheadRef.current = clamped;
        setPlayheadUs(clamped);
        if (media.ended || (durationUs > 0 && next >= durationUs)) {
          playingRef.current = false;
          setPlaying(false);
          playheadRef.current = durationUs;
          setPlayheadUs(durationUs);
          return;
        }
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [durationUs, isAudio, isImage, playing, mediaElement]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      )
        return;
      if (event.code === "Space") {
        event.preventDefault();
        event.stopPropagation();
        if (!isImage) togglePlayback();
        return;
      }
      if (
        canScrub &&
        (event.code === "ArrowLeft" || event.code === "ArrowRight")
      ) {
        event.preventDefault();
        event.stopPropagation();
        stopPlayback();
        const direction = event.code === "ArrowLeft" ? -1 : 1;
        seekMedia(playheadRef.current + direction * stepUs);
      }
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  });

  return (
    <>
      <header>
        <div
          className="ve-preview-mode-tabs"
          role="group"
          aria-label="监视器模式"
        >
          <button type="button" className="active" aria-pressed="true">
            素材监视器
          </button>
          <button type="button" aria-pressed="false" onClick={onExitSource}>
            节目监视器
          </button>
        </div>
        <div>
          <span className="ve-preview-meta" title={asset.displayName}>
            {asset.displayName}
          </span>
          <button
            className={showCanvasGuides ? "active" : ""}
            onClick={onToggleCanvasGuides}
            aria-pressed={showCanvasGuides}
            title="显示或隐藏画布边界辅助线"
          >
            边界线
          </button>
          <button
            aria-label="全屏预览"
            title="全屏预览"
            onClick={() => {
              const node = stageRef.current;
              if (!node) return;
              if (document.fullscreenElement) {
                void document.exitFullscreen();
              } else {
                void node.requestFullscreen?.();
              }
            }}
          >
            <Maximize2 aria-hidden />
          </button>
        </div>
      </header>
      <div
        className="ve-stage-wrap"
        style={
          { "--ve-canvas-ratio": canvasWidth / canvasHeight } as CSSProperties
        }
      >
        <div
          ref={stageRef}
          className="ve-stage ve-source-stage"
          style={{
            aspectRatio: canvasWidth / canvasHeight,
            background: "#000",
          }}
        >
          {isVideo && mediaUrl ? (
            <video
              ref={videoRef}
              className="ve-source-media"
              src={mediaUrl}
              preload="auto"
              playsInline
            />
          ) : null}
          {isImage && mediaUrl ? (
            <img className="ve-source-media" src={mediaUrl} alt="" />
          ) : null}
          {isAudio ? (
            <>
              <span className="ve-source-audio-label">音频素材</span>
              <audio ref={audioRef} src={mediaUrl} preload="auto" />
            </>
          ) : null}
          {!mediaUrl ? (
            <span className="ve-media-pending">该素材暂无可预览内容</span>
          ) : null}
          <span
            className={`ve-canvas-guides ${showCanvasGuides ? "is-visible" : ""}`}
            aria-hidden="true"
          >
            <i className="ve-canvas-guides-label">
              画布边界 · {canvasWidth} × {canvasHeight}
            </i>
            <i className="ve-canvas-guides-center" />
          </span>
          <span className="ve-safe-area" aria-hidden />
        </div>
      </div>
      <footer className="ve-transport">
        <button
          aria-label="上一帧"
          disabled={!canScrub}
          onClick={() => {
            stopPlayback();
            seekMedia(playheadUs - stepUs);
          }}
        >
          <SkipBack aria-hidden />
        </button>
        <button
          className="play"
          aria-label={playing ? "暂停" : "播放"}
          disabled={isImage}
          onClick={togglePlayback}
        >
          {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
        </button>
        <button
          aria-label="下一帧"
          disabled={!canScrub}
          onClick={() => {
            stopPlayback();
            seekMedia(playheadUs + stepUs);
          }}
        >
          <SkipForward aria-hidden />
        </button>
        <input
          className="ve-transport-seek"
          type="range"
          min={0}
          max={Math.max(durationUs, 1)}
          step={stepUs}
          value={Math.min(playheadUs, Math.max(durationUs, 1))}
          disabled={!canScrub}
          aria-label="素材播放位置"
          style={
            {
              "--ve-seek-progress": `${
                durationUs > 0
                  ? Math.min(100, Math.max(0, (playheadUs / durationUs) * 100))
                  : 0
              }%`,
            } as CSSProperties
          }
          onInput={(event) => {
            stopPlayback();
            seekMedia(Number(event.currentTarget.value));
          }}
          onChange={(event) => {
            stopPlayback();
            seekMedia(Number(event.currentTarget.value));
          }}
        />
        <strong>
          {formatTime(playheadUs)}
          {canScrub ? ` / ${formatTime(durationUs)}` : ""}
        </strong>
        <span>
          {isImage ? "图片预览" : `${fps} FPS · Space 播放 · ← → 逐帧`}
        </span>
      </footer>
    </>
  );
}
