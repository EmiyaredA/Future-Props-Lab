import { VideoEditorTextLayer } from "./VideoEditorTextLayer";
import { useWorkspacePermission } from "@platform/auth/WorkspacePermissions";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  ImageDown,
  Maximize2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { fetchApiBlob } from "@platform/api/client";
import { FrameExportDialog } from "@shared/ui/FrameExportDialog";
import { exactFramePath, exactFrameUrl, uploadVideoEditorAsset } from "./api";
import {
  clipOpacityAt,
  clipAudioGainAt,
  clipPropertyAt,
  clipSourceTimeUs,
  formatTime,
  frameUs,
  timelineDuration,
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
  VideoEditorOperation,
} from "./types";

/** Visual sync can stay tight; small frame jumps are less jarring than audio chops. */
const PREVIEW_VIDEO_SYNC_TOLERANCE_S = 0.12;
/**
 * Audio seeks flush the decoder buffer and sound like stutter. Preview playhead
 * is wall-clock rAF while media runs on its own clock, so under decode load they
 * drift; tolerate more before correcting, and never stack seeks.
 */
const PREVIEW_AUDIO_SYNC_TOLERANCE_S = 0.45;

function syncMediaClock(
  node: HTMLMediaElement,
  targetSeconds: number,
  {
    playing,
    playStarted,
    toleranceSeconds,
  }: {
    playing: boolean;
    playStarted: boolean;
    toleranceSeconds: number;
  },
) {
  if (node.seeking) return;
  const drift = Math.abs(node.currentTime - targetSeconds);
  if (!playing || playStarted || drift > toleranceSeconds) {
    node.currentTime = Math.max(0, targetSeconds);
  }
}

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
  const wasPlayingRef = useRef(false);
  useEffect(() => {
    const node = video.current;
    if (!node) return;
    const target =
      clipSourceTimeUs(clip, playheadUs - clip.timelineStartUs) / 1_000_000;
    const rate = clip.playbackRate ?? 1;
    if (node.playbackRate !== rate) node.playbackRate = rate;
    const playStarted = playing && !wasPlayingRef.current;
    wasPlayingRef.current = playing;
    syncMediaClock(node, target, {
      playing,
      playStarted,
      toleranceSeconds: PREVIEW_VIDEO_SYNC_TOLERANCE_S,
    });
  }, [clip, playheadUs, playing]);
  useEffect(() => {
    const node = video.current;
    if (!node) return;
    if (playing) void node.play().catch(() => undefined);
    else node.pause();
  }, [playing]);
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
    .filter(
      (track) =>
        (track.kind === "audio" || track.kind === "mixed") && !track.muted,
    )
    .flatMap((track) => {
      const chains: PreviewAudioChain[] = [];
      const clips = [...(track.clips ?? [])]
        .filter(
          (clip) =>
            ["video", "audio"].includes(clip.kind) &&
            Boolean(clip.assetId) &&
            !clip.muted,
        )
        .sort((left, right) => left.timelineStartUs - right.timelineStartUs);
      for (const clip of clips) {
        const chain = chains.at(-1);
        const previous = chain?.clips.at(-1);
        const isContinuous =
          previous &&
          previous.assetId === clip.assetId &&
          previous.sourceLoop === clip.sourceLoop &&
          (previous.playbackRate ?? 1) === (clip.playbackRate ?? 1) &&
          previous.timelineStartUs + previous.durationUs ===
            clip.timelineStartUs &&
          clipSourceTimeUs(previous, previous.durationUs) === clip.sourceInUs;
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
  const wasPlayingRef = useRef(false);
  const clip = clips.find(
    (item) =>
      item.timelineStartUs <= playheadUs &&
      item.timelineStartUs + item.durationUs > playheadUs,
  );
  const active = Boolean(clip);
  useEffect(() => {
    const node = audio.current;
    if (!node || !clip) return;
    const target =
      clipSourceTimeUs(clip, playheadUs - clip.timelineStartUs) / 1_000_000;
    const rate = clip.playbackRate ?? 1;
    if (node.playbackRate !== rate) {
      node.playbackRate = rate;
      node.preservesPitch = true;
    }
    const playStarted = playing && !wasPlayingRef.current;
    wasPlayingRef.current = playing;
    syncMediaClock(node, target, {
      playing,
      playStarted,
      toleranceSeconds: PREVIEW_AUDIO_SYNC_TOLERANCE_S,
    });
    const localUs = playheadUs - clip.timelineStartUs;
    node.volume = Math.max(
      0,
      Math.min(1, clipPropertyAt(clip, "volume", localUs, clip.volume)) *
        clipAudioGainAt(clip, localUs),
    );
  }, [clip, playheadUs, playing]);
  useEffect(() => {
    const node = audio.current;
    if (!node) return;
    if (playing && active) void node.play().catch(() => undefined);
    else node.pause();
  }, [active, playing]);
  return <audio ref={audio} src={source} preload="auto" />;
}

export function VideoEditorPreview({
  projectId,
  projectTitle = "剪辑",
  timeline,
  assets,
  playheadUs,
  setPlayheadUs,
  playing,
  setPlaying,
  selectedClipId,
  preciseFrame,
  onPreciseFrameChange,
  onFrameSaved,
  onSelectClip,
  commit,
  saving = false,
}: {
  onSelectClip?: (clipId: string) => void;
  commit?: (
    redo: VideoEditorOperation[],
    undo?: VideoEditorOperation[],
  ) => Promise<void>;
  saving?: boolean;
  projectId: string;
  projectTitle?: string;
  timeline: VideoEditorTimeline;
  assets: VideoEditorAsset[];
  playheadUs: number;
  setPlayheadUs: (value: number | ((value: number) => number)) => void;
  playing: boolean;
  setPlaying: (value: boolean | ((value: boolean) => boolean)) => void;
  selectedClipId?: string;
  preciseFrame: boolean;
  onPreciseFrameChange: (value: boolean) => void;
  onFrameSaved?: () => void | Promise<unknown>;
}) {
  const canWrite = useWorkspacePermission("content.write");
  const [frameExport, setFrameExport] = useState<{
    revision: number;
    timeUs: number;
    durationUs: number;
    stepUs: number;
    width: number;
    height: number;
  }>();
  const [draggingText, setDraggingText] = useState(false);
  const [showCanvasGuides, setShowCanvasGuides] = useState(true);
  const stageRef = useRef<HTMLDivElement>(null);
  const assetMap = useMemo(
    () => new Map(assets.map((asset) => [asset.id, asset])),
    [assets],
  );
  const fps = timeline.document.settings?.fps ?? 30;
  const canvasWidth =
    timeline.document.settings?.width ?? VIDEO_EDITOR_CANVAS_WIDTH;
  const canvasHeight =
    timeline.document.settings?.height ?? VIDEO_EDITOR_CANVAS_HEIGHT;
  const active = (timeline.document.tracks ?? [])
    .filter(
      (track) =>
        (track.kind === "visual" || track.kind === "mixed") && !track.hidden,
    )
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
          <span>
            {canvasWidth} × {canvasHeight}
          </span>
          <button
            className={showCanvasGuides ? "active" : ""}
            onClick={() => setShowCanvasGuides((value) => !value)}
            aria-pressed={showCanvasGuides}
            title="显示或隐藏画布边界辅助线"
          >
            边界线
          </button>
          <button
            className={preciseFrame ? "active" : ""}
            onClick={() => onPreciseFrameChange(!preciseFrame)}
            title="暂停或拖动时始终使用与导出一致的精确画面"
          >
            精确停帧
          </button>
          <button
            disabled={!canWrite}
            aria-label="导出当前节目帧"
            title="导出当前节目帧"
            onClick={() => {
              setPlaying(false);
              const stepUs = frameUs(fps);
              setFrameExport({
                revision: timeline.revision,
                timeUs: playheadUs,
                durationUs: timelineDuration(timeline),
                stepUs,
                width: timeline.document.settings?.width ?? 1920,
                height: timeline.document.settings?.height ?? 1080,
              });
            }}
          >
            <ImageDown aria-hidden />
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
          className="ve-stage"
          style={{
            aspectRatio: canvasWidth / canvasHeight,
            background: timeline.document.settings?.backgroundColor ?? "#000",
          }}
        >
          {active.map((clip) => {
            const asset = assetMap.get(clip.assetId ?? "");
            const geometry = previewMediaGeometry(clip, asset, {
              width: canvasWidth,
              height: canvasHeight,
            });
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
              left: `${(x / canvasWidth) * 100}%`,
              top: `${(y / canvasHeight) * 100}%`,
              width: geometry
                ? `${(geometry.width / canvasWidth) * 100}%`
                : undefined,
              height: geometry
                ? `${(geometry.height / canvasHeight) * 100}%`
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
            if (clip.kind === "text")
              return (
                <VideoEditorTextLayer
                  key={clip.id}
                  projectId={projectId}
                  revision={timeline.revision}
                  clip={clip}
                  style={style}
                  canvasWidth={canvasWidth}
                  canvasHeight={canvasHeight}
                  stageRef={stageRef}
                  playheadUs={playheadUs}
                  selected={selectedClipId === clip.id}
                  disabled={
                    !canWrite ||
                    saving ||
                    Boolean(
                      timeline.document.tracks?.find(
                        (track) => track.id === clip.trackId,
                      )?.locked,
                    )
                  }
                  onSelect={onSelectClip}
                  setPlaying={setPlaying}
                  onDragging={setDraggingText}
                  commit={commit}
                />
              );
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
                ) : clip.kind === "video" && asset && !asset.proxyUrl ? (
                  <span className="ve-media-pending">
                    {asset.processingStatus === "failed"
                      ? "视频预览处理失败，请检查素材"
                      : "视频预览准备中，可继续剪辑"}
                  </span>
                ) : clip.kind === "image" && asset ? (
                  <img src={`/v1/files/${asset.id}/content`} alt="" />
                ) : clip.kind === "color" ? (
                  <i style={{ background: clip.color ?? "#000" }} />
                ) : null}
              </div>
            );
          })}
          {!playing && !draggingText ? (
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
        <button
          className="play"
          aria-label={playing ? "暂停" : "播放"}
          onClick={() => setPlaying((value) => !value)}
        >
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
      {frameExport ? (
        <FrameExportDialog
          baseName={`${projectTitle}-frame`}
          destination="下载到本机，并加入当前剪辑的素材区"
          initialTime={frameExport.timeUs / 1_000_000}
          maxTime={
            Math.max(0, frameExport.durationUs - frameExport.stepUs) / 1_000_000
          }
          step={frameExport.stepUs / 1_000_000}
          loadSnapshot={async (capturedAt, signal) => ({
            blob: await fetchApiBlob(
              exactFramePath(
                projectId,
                frameExport.revision,
                Math.round(capturedAt * 1_000_000),
                frameExport.width,
              ),
              { signal },
            ),
            capturedAt,
            width: frameExport.width,
            height: frameExport.height,
          })}
          onClose={() => setFrameExport(undefined)}
          onSave={async (file) => {
            await uploadVideoEditorAsset(projectId, file);
            await onFrameSaved?.();
          }}
        />
      ) : null}
    </section>
  );
}
