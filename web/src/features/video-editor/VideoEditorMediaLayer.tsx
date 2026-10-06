import { useEffect, useRef, type CSSProperties } from "react";
import {
  paintChromaCanvas,
  recordChromaDuplicateFrameSkip,
} from "./chromaCanvas";
import { clipSourceTimeUs } from "./editorModel";
import { syncMediaClock } from "./previewClock";
import type { VideoProxyCrop, PreviewMediaGeometry } from "./previewGeometry";
import type { VideoEditorClip, VideoEditorAsset } from "./types";
const PREVIEW_VIDEO_SYNC_TOLERANCE_S = 0.12;

function ProxyVideo({
  source,
  clip,
  localUs,
  playing,
  crop,
  chromaKey,
}: {
  source: string;
  clip: VideoEditorClip;
  localUs: number;
  playing: boolean;
  crop: VideoProxyCrop;
  chromaKey?: VideoEditorClip["chromaKey"];
}) {
  const video = useRef<HTMLVideoElement>(null);
  const keyedCanvas = useRef<HTMLCanvasElement>(null);
  const wasPlayingRef = useRef(false);
  useEffect(() => {
    const node = video.current;
    if (!node) return;
    const target = clipSourceTimeUs(clip, localUs) / 1_000_000;
    const rate = clip.playbackRate ?? 1;
    if (node.playbackRate !== rate) node.playbackRate = rate;
    const playStarted = playing && !wasPlayingRef.current;
    wasPlayingRef.current = playing;
    const sync = () =>
      syncMediaClock(node, target, {
        playing,
        playStarted,
        toleranceSeconds: PREVIEW_VIDEO_SYNC_TOLERANCE_S,
      });
    sync();
    node.addEventListener("loadedmetadata", sync);
    node.addEventListener("seeked", sync);
    return () => {
      node.removeEventListener("loadedmetadata", sync);
      node.removeEventListener("seeked", sync);
    };
  }, [clip, localUs, playing]);
  useEffect(() => {
    const node = video.current;
    if (!node) return;
    if (playing) void node.play().catch(() => undefined);
    else node.pause();
  }, [playing]);
  useEffect(() => {
    if (!chromaKey?.enabled) return;
    const node = video.current;
    const canvas = keyedCanvas.current;
    if (!node || !canvas) return;
    let cancelled = false;
    let rafId = 0;
    let vfcId = 0;
    let lastMediaTime = Number.NaN;
    const supportsVfc =
      typeof node.requestVideoFrameCallback === "function" &&
      typeof node.cancelVideoFrameCallback === "function";
    const paintOnce = (mediaTime?: number) => {
      if (!node.videoWidth || !node.videoHeight) return;
      if (
        mediaTime !== undefined &&
        Number.isFinite(lastMediaTime) &&
        mediaTime === lastMediaTime
      ) {
        recordChromaDuplicateFrameSkip();
        return;
      }
      if (mediaTime !== undefined) lastMediaTime = mediaTime;
      paintChromaCanvas(
        canvas,
        node,
        node.videoWidth,
        node.videoHeight,
        chromaKey,
      );
    };
    const schedule = () => {
      if (cancelled || !playing) return;
      if (supportsVfc) {
        vfcId = node.requestVideoFrameCallback((_now, meta) => {
          if (cancelled) return;
          paintOnce(meta.mediaTime);
          schedule();
        });
        return;
      }
      rafId = requestAnimationFrame(() => {
        if (cancelled) return;
        paintOnce();
        schedule();
      });
    };
    const onMediaEvent = () => {
      lastMediaTime = Number.NaN;
      paintOnce();
    };
    node.addEventListener("loadeddata", onMediaEvent);
    node.addEventListener("seeked", onMediaEvent);
    paintOnce();
    schedule();
    return () => {
      cancelled = true;
      if (supportsVfc) node.cancelVideoFrameCallback(vfcId);
      else cancelAnimationFrame(rafId);
      node.removeEventListener("loadeddata", onMediaEvent);
      node.removeEventListener("seeked", onMediaEvent);
    };
  }, [chromaKey, playing, source]);
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
        style={{
          ...placement,
          visibility: chromaKey?.enabled ? "hidden" : "visible",
        }}
      />
      {chromaKey?.enabled ? (
        <canvas
          ref={keyedCanvas}
          className="ve-keyed-media"
          style={placement}
          aria-hidden
        />
      ) : null}
    </>
  );
}

function ChromaImage({
  source,
  chromaKey,
}: {
  source: string;
  chromaKey: NonNullable<VideoEditorClip["chromaKey"]>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const node = new window.Image();
    node.onload = () => {
      if (canvas.current)
        paintChromaCanvas(
          canvas.current,
          node,
          node.naturalWidth,
          node.naturalHeight,
          chromaKey,
        );
    };
    node.src = source;
    return () => {
      node.onload = null;
    };
  }, [source, chromaKey]);
  return <canvas ref={canvas} className="ve-keyed-image" aria-hidden />;
}

export function VideoEditorMediaLayer({
  clip,
  asset,
  geometry,
  style,
  localUs,
  playing,
  selected,
}: {
  clip: VideoEditorClip;
  asset?: VideoEditorAsset;
  geometry?: PreviewMediaGeometry;
  style: CSSProperties;
  localUs: number;
  playing: boolean;
  selected: boolean;
}) {
  return (
    <div
      className={`ve-stage-layer ${selected ? "selected" : ""}`}
      style={style}
    >
      <div
        className="ve-stage-media-content"
        style={{ transform: clip.flipX ? "scaleX(-1)" : undefined }}
      >
        {clip.kind === "video" && asset?.proxyUrl && geometry?.proxyCrop ? (
          <div className="ve-stage-media-crop">
            <ProxyVideo
              source={asset.proxyUrl}
              clip={clip}
              localUs={localUs}
              playing={playing}
              crop={geometry.proxyCrop}
              chromaKey={clip.chromaKey}
            />
          </div>
        ) : clip.kind === "video" && asset && !asset.proxyUrl ? (
          <span className="ve-media-pending">
            {asset.processingStatus === "failed"
              ? "视频预览处理失败，请检查素材"
              : "视频预览准备中，可继续剪辑"}
          </span>
        ) : clip.kind === "image" && asset && clip.chromaKey?.enabled ? (
          <ChromaImage
            source={`/v1/files/${asset.id}/content`}
            chromaKey={clip.chromaKey}
          />
        ) : clip.kind === "image" && asset ? (
          <img src={`/v1/files/${asset.id}/content`} alt="" draggable={false} />
        ) : clip.kind === "color" ? (
          <i style={{ background: clip.color ?? "#000" }} />
        ) : null}
      </div>
    </div>
  );
}
