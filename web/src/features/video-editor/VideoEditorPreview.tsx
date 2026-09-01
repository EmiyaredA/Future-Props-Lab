import { useEffect, useMemo, useRef } from "react";
import { Maximize2, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { exactFrameUrl } from "./api";
import {
  clipOpacityAt,
  clipPropertyAt,
  formatTime,
  frameUs,
} from "./editorModel";
import {
  previewMediaGeometry,
  VIDEO_EDITOR_CANVAS_HEIGHT,
  VIDEO_EDITOR_CANVAS_WIDTH,
  type VideoProxyCrop,
} from "./previewGeometry";
import type {
  VideoEditorAsset,
  VideoEditorClip,
  VideoEditorTimeline,
} from "./types";

function ProxyVideo({
  source,
  clip,
  playheadUs,
  playing,
  crop,
}: {
  source: string;
  clip: VideoEditorClip;
  playheadUs: number;
  playing: boolean;
  crop: VideoProxyCrop;
}) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const node = video.current;
    if (!node) return;
    const target =
      (clip.sourceInUs + playheadUs - clip.timelineStartUs) / 1_000_000;
    if (!playing || Math.abs(node.currentTime - target) > 0.12)
      node.currentTime = Math.max(0, target);
    if (playing) void node.play().catch(() => undefined);
    else node.pause();
  }, [clip, playheadUs, playing]);
  return (
    <video
      ref={video}
      muted
      src={source}
      preload="auto"
      style={{
        left: `${crop.leftPercent}%`,
        top: `${crop.topPercent}%`,
        width: `${crop.widthPercent}%`,
        height: `${crop.heightPercent}%`,
      }}
    />
  );
}

type PreviewAudioChain = {
  id: string;
  assetId: string;
  clips: VideoEditorClip[];
};

function buildPreviewAudioChains(
  timeline: VideoEditorTimeline,
): PreviewAudioChain[] {
  return (timeline.document.tracks ?? [])
    .filter((track) => track.kind === "audio" && !track.muted)
    .flatMap((track) => {
      const chains: PreviewAudioChain[] = [];
      const clips = [...(track.clips ?? [])]
        .filter((clip) => Boolean(clip.assetId))
        .sort((left, right) => left.timelineStartUs - right.timelineStartUs);
      for (const clip of clips) {
        const chain = chains.at(-1);
        const previous = chain?.clips.at(-1);
        const isContinuous =
          previous &&
          previous.assetId === clip.assetId &&
          previous.sourceLoop === clip.sourceLoop &&
          previous.timelineStartUs + previous.durationUs ===
            clip.timelineStartUs &&
          previous.sourceInUs + previous.durationUs === clip.sourceInUs;
        if (chain && isContinuous) chain.clips.push(clip);
        else
          chains.push({
            id: `${track.id}:${clip.id}`,
            assetId: clip.assetId!,
            clips: [clip],
          });
      }
      return chains;
    });
}

function ProxyAudioChain({
  source,
  clips,
  playheadUs,
  playing,
}: {
  source: string;
  clips: VideoEditorClip[];
  playheadUs: number;
  playing: boolean;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const clip = clips.find(
    (item) =>
      item.timelineStartUs <= playheadUs &&
      item.timelineStartUs + item.durationUs > playheadUs,
  );
  useEffect(() => {
    const node = audio.current;
    if (!node) return;
    if (!clip) {
      node.pause();
      return;
    }
    const target =
      (clip.sourceInUs + playheadUs - clip.timelineStartUs) / 1_000_000;
    if (!playing || Math.abs(node.currentTime - target) > 0.12)
      node.currentTime = Math.max(0, target);
    node.volume = Math.max(
      0,
      Math.min(
        1,
        clipPropertyAt(
          clip,
          "volume",
          playheadUs - clip.timelineStartUs,
          clip.volume,
        ),
      ),
    );
    if (playing) void node.play().catch(() => undefined);
    else node.pause();
  }, [clip, playheadUs, playing]);
  return <audio ref={audio} src={source} preload="auto" />;
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
  preciseFrame,
  onPreciseFrameChange,
}: {
  projectId: string;
  timeline: VideoEditorTimeline;
  assets: VideoEditorAsset[];
  playheadUs: number;
  setPlayheadUs: (value: number | ((value: number) => number)) => void;
  playing: boolean;
  setPlaying: (value: boolean | ((value: boolean) => boolean)) => void;
  selectedClipId?: string;
  preciseFrame: boolean;
  onPreciseFrameChange: (value: boolean) => void;
}) {
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
  const audioChains = useMemo(
    () => buildPreviewAudioChains(timeline),
    [timeline],
  );
  const preciseUrl = exactFrameUrl(projectId, timeline.revision, playheadUs);
  return (
    <section className="ve-preview-panel">
      <header>
        <strong>节目监视器</strong>
        <div>
          <span>1920 × 1080</span>
          <button
            className={preciseFrame ? "active" : ""}
            onClick={() => onPreciseFrameChange(!preciseFrame)}
          >
            精确停帧
          </button>
          <button aria-label="全屏预览">
            <Maximize2 aria-hidden />
          </button>
        </div>
      </header>
      <div className="ve-stage-wrap">
        <div
          className="ve-stage"
          style={{
            background: timeline.document.settings?.backgroundColor ?? "#000",
          }}
        >
          {active.map((clip) => {
            const asset = assetMap.get(clip.assetId ?? "");
            const geometry = previewMediaGeometry(clip, asset);
            const transform = clip.transform ?? {
              x: 960,
              y: 540,
              scaleX: 1,
              scaleY: 1,
              rotation: 0,
              opacity: 1,
              anchor: "center" as const,
              brightness: 1,
            };
            const localUs = playheadUs - clip.timelineStartUs;
            const x = clipPropertyAt(clip, "x", localUs, transform.x);
            const y = clipPropertyAt(clip, "y", localUs, transform.y);
            const scaleX = clipPropertyAt(
              clip,
              "scaleX",
              localUs,
              transform.scaleX,
            );
            const scaleY = clipPropertyAt(
              clip,
              "scaleY",
              localUs,
              transform.scaleY,
            );
            const rotation = clipPropertyAt(
              clip,
              "rotation",
              localUs,
              transform.rotation,
            );
            const brightness = clipPropertyAt(
              clip,
              "brightness",
              localUs,
              transform.brightness ?? 1,
            );
            const anchorTranslate =
              transform.anchor === "bottomCenter"
                ? "translate(-50%, -100%)"
                : transform.anchor === "topLeft"
                  ? "translate(0, 0)"
                  : "translate(-50%, -50%)";
            const style = {
              left: `${(x / VIDEO_EDITOR_CANVAS_WIDTH) * 100}%`,
              top: `${(y / VIDEO_EDITOR_CANVAS_HEIGHT) * 100}%`,
              width: geometry
                ? `${(geometry.width / VIDEO_EDITOR_CANVAS_WIDTH) * 100}%`
                : undefined,
              height: geometry
                ? `${(geometry.height / VIDEO_EDITOR_CANVAS_HEIGHT) * 100}%`
                : undefined,
              opacity: clipOpacityAt(clip, localUs),
              filter: `brightness(${brightness})`,
              transformOrigin:
                transform.anchor === "bottomCenter"
                  ? "bottom center"
                  : transform.anchor === "topLeft"
                    ? "top left"
                    : "center",
              transform: `${anchorTranslate} rotate(${rotation}deg) scale(${clip.flipX ? -scaleX : scaleX}, ${scaleY})`,
            };
            return (
              <div
                key={clip.id}
                className={`ve-stage-layer ${selectedClipId === clip.id ? "selected" : ""}`}
                style={style}
              >
                {clip.kind === "video" &&
                asset?.proxyUrl &&
                geometry?.proxyCrop ? (
                  <div className="ve-stage-media-crop">
                    <ProxyVideo
                      source={asset.proxyUrl}
                      clip={clip}
                      playheadUs={playheadUs}
                      playing={playing}
                      crop={geometry.proxyCrop}
                    />
                  </div>
                ) : clip.kind === "image" && asset ? (
                  <img src={`/v1/files/${asset.id}/content`} alt="" />
                ) : clip.kind === "text" ? (
                  <span
                    style={{
                      color: clip.textColor,
                      fontSize: `${clip.fontSize / 19.2}vw`,
                    }}
                  >
                    {clip.text}
                  </span>
                ) : clip.kind === "color" ? (
                  <i style={{ background: clip.color ?? "#000" }} />
                ) : null}
              </div>
            );
          })}
          {!playing && preciseFrame ? (
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
        <div className="ve-proxy-audio" aria-hidden>
          {audioChains.map((chain) => {
            const asset = assetMap.get(chain.assetId);
            return asset?.proxyUrl ? (
              <ProxyAudioChain
                key={chain.id}
                source={asset.proxyUrl}
                clips={chain.clips}
                playheadUs={playheadUs}
                playing={playing}
              />
            ) : null;
          })}
        </div>
      </div>
      <footer className="ve-transport">
        <button
          aria-label="上一帧"
          onClick={() => {
            setPlaying(false);
            setPlayheadUs((value) => Math.max(0, value - frameUs(fps)));
          }}
        >
          <SkipBack aria-hidden />
        </button>
        <button className="play" onClick={() => setPlaying((value) => !value)}>
          {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
        </button>
        <button
          aria-label="下一帧"
          onClick={() => {
            setPlaying(false);
            setPlayheadUs((value) => value + frameUs(fps));
          }}
        >
          <SkipForward aria-hidden />
        </button>
        <strong>{formatTime(playheadUs)}</strong>
        <span>{fps} FPS · Space 播放 · ← → 逐帧</span>
      </footer>
    </section>
  );
}
