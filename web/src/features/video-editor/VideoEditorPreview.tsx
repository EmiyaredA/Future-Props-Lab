import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { exactFrameUrl } from "./api";
import { formatTime, frameUs } from "./editorModel";
import type { VideoEditorAsset, VideoEditorClip, VideoEditorTimeline } from "./types";

function ProxyVideo({
  source,
  clip,
  playheadUs,
  playing,
}: {
  source: string;
  clip: VideoEditorClip;
  playheadUs: number;
  playing: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const node = video.current;
    if (!node) return;
    const target = (clip.sourceInUs + playheadUs - clip.timelineStartUs) / 1_000_000;
    if (Math.abs(node.currentTime - target) > 0.12) node.currentTime = Math.max(0, target);
    if (playing) void node.play().catch(() => undefined);
    else node.pause();
  }, [clip, playheadUs, playing]);
  return <video ref={video} muted src={source} preload="auto" />;
}

export function VideoEditorPreview({
  projectId,
  timeline,
  assets,
  playheadUs,
  setPlayheadUs,
  playing,
  setPlaying,
  selectedClipId,
}: {
  projectId: string;
  timeline: VideoEditorTimeline;
  assets: VideoEditorAsset[];
  playheadUs: number;
  setPlayheadUs: (value: number | ((value: number) => number)) => void;
  playing: boolean;
  setPlaying: (value: boolean | ((value: boolean) => boolean)) => void;
  selectedClipId?: string;
}) {
  const [precise, setPrecise] = useState(true);
  const assetMap = useMemo(
    () => new Map(assets.map((asset) => [asset.id, asset])),
    [assets],
  );
  const fps = timeline.document.settings?.fps ?? 30;
  const active = (timeline.document.tracks ?? [])
    .filter((track) => track.kind === "visual" && !track.hidden)
    .sort((left, right) => right.order - left.order)
    .flatMap((track) => track.clips ?? [])
    .filter(
      (clip) =>
        clip.timelineStartUs <= playheadUs &&
        clip.timelineStartUs + clip.durationUs > playheadUs,
    );
  const preciseUrl = exactFrameUrl(projectId, timeline.revision, playheadUs);
  return (
    <section className="ve-preview-panel">
      <header>
        <strong>节目监视器</strong>
        <div>
          <span>1920 × 1080</span>
          <button
            className={precise ? "active" : ""}
            onClick={() => setPrecise((value) => !value)}
          >
            精确停帧
          </button>
          <button aria-label="全屏预览"><Maximize2 aria-hidden /></button>
        </div>
      </header>
      <div className="ve-stage-wrap">
        <div
          className="ve-stage"
          style={{ background: timeline.document.settings?.backgroundColor ?? "#000" }}
        >
          {active.map((clip) => {
            const asset = assetMap.get(clip.assetId ?? "");
            const transform = clip.transform ?? {
              x: 960,
              y: 540,
              scaleX: 1,
              scaleY: 1,
              rotation: 0,
              opacity: 1,
            };
            const style = {
              left: `${(transform.x / 1920) * 100}%`,
              top: `${(transform.y / 1080) * 100}%`,
              opacity: transform.opacity,
              transform: `translate(-50%, -50%) scale(${transform.scaleX}, ${transform.scaleY}) rotate(${transform.rotation}deg)`,
            };
            return (
              <div
                key={clip.id}
                className={`ve-stage-layer ${selectedClipId === clip.id ? "selected" : ""}`}
                style={style}
              >
                {clip.kind === "video" && asset?.proxyUrl ? (
                  <ProxyVideo
                    source={asset.proxyUrl}
                    clip={clip}
                    playheadUs={playheadUs}
                    playing={playing}
                  />
                ) : clip.kind === "image" && asset ? (
                  <img src={`/v1/files/${asset.id}/content`} alt="" />
                ) : clip.kind === "text" ? (
                  <span style={{ color: clip.textColor, fontSize: `${clip.fontSize / 19.2}vw` }}>
                    {clip.text}
                  </span>
                ) : clip.kind === "color" ? (
                  <i style={{ background: clip.color ?? "#000" }} />
                ) : null}
              </div>
            );
          })}
          {!playing && precise ? (
            <img
              className="ve-precise-frame"
              key={preciseUrl}
              src={preciseUrl}
              alt="后端精确停帧"
              onError={(event) => {
                event.currentTarget.style.display = "none";
              }}
            />
          ) : null}
          <span className="ve-safe-area" aria-hidden />
        </div>
      </div>
      <footer className="ve-transport">
        <button
          aria-label="上一帧"
          onClick={() => {
            setPlaying(false);
            setPlayheadUs((value) => Math.max(0, value - frameUs(fps)));
          }}
        ><SkipBack aria-hidden /></button>
        <button className="play" onClick={() => setPlaying((value) => !value)}>
          {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
        </button>
        <button
          aria-label="下一帧"
          onClick={() => {
            setPlaying(false);
            setPlayheadUs((value) => value + frameUs(fps));
          }}
        ><SkipForward aria-hidden /></button>
        <strong>{formatTime(playheadUs)}</strong>
        <span>{fps} FPS · Space 播放 · ← → 逐帧</span>
      </footer>
    </section>
  );
}
