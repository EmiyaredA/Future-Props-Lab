import { usePreviewTransform } from "./usePreviewTransform";
import { VideoEditorTransformBox } from "./VideoEditorTransformBox";
import { transformAt, type TransformDraft } from "./transformModel";
import { VideoEditorTextLayer } from "./VideoEditorTextLayer";
import { VideoEditorSourceMonitor } from "./VideoEditorSourceMonitor";
import { syncMediaClock } from "./previewClock";
import { VideoEditorMediaLayer } from "./VideoEditorMediaLayer";
import { activeTimedEffects } from "./timedEffects";
import { VideoEditorLightLeak } from "./VideoEditorLightLeak";
import { VideoEditorPreciseFrame } from "./VideoEditorPreciseFrame";
import { previewVideoPlaybackKeys } from "./previewPlayback";
import type { TimelineEditBuilder } from "./timelineSaveQueue";
import { useAccountPermission } from "@platform/auth/AccountAccess";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  ChevronsLeft,
  ChevronsRight,
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
  audioSeamGainAt,
  audioSeamFilterAt,
  clipAudioGainAt,
  clipPropertyAt,
  clipSourceTimeUs,
  formatTime,
  frameUs,
  timelineDuration,
} from "./editorModel";
import {
  previewMediaGeometry,
  previewLayerStyle,
  VIDEO_EDITOR_CANVAS_HEIGHT,
  VIDEO_EDITOR_CANVAS_WIDTH,
} from "./previewGeometry";
import {
  eyelidOverlayPaths,
  mergeTransitionOverlay,
  previewVisualLayers,
} from "./previewTransitions";
import type {
  VideoEditorAsset,
  VideoEditorClip,
  VideoEditorTimeline,
  VideoEditorOperation,
} from "./types";

/**
 * Audio seeks flush the decoder buffer and sound like stutter. Preview playhead
 * is wall-clock rAF while media runs on its own clock, so under decode load they
 * drift; tolerate more before correcting, and never stack seeks.
 */
const PREVIEW_AUDIO_SYNC_TOLERANCE_S = 0.45;

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
  transitions,
  clipsById,
  playheadUs,
  playing,
}: {
  source: string;
  clips: VideoEditorClip[];
  transitions: VideoEditorTimeline["document"]["transitions"];
  clipsById: Map<string, VideoEditorClip>;
  playheadUs: number;
  playing: boolean;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const graph = useRef<
    | {
        context: AudioContext;
        gain: GainNode;
        lowpass: BiquadFilterNode;
        highpass: BiquadFilterNode;
      }
    | undefined
  >(undefined);
  const wasPlayingRef = useRef(false);
  const hasSweep = (transitions ?? []).some(
    (item) =>
      item.kind === "audio-filter-sweep" &&
      clips.some(
        (clip) => item.fromClipId === clip.id || item.toClipId === clip.id,
      ),
  );
  useEffect(() => {
    if (
      !hasSweep ||
      graph.current ||
      !audio.current ||
      typeof AudioContext === "undefined"
    )
      return;
    const context = new AudioContext();
    const lowpass = context.createBiquadFilter();
    const highpass = context.createBiquadFilter();
    const gain = context.createGain();
    lowpass.type = "lowpass";
    highpass.type = "highpass";
    lowpass.frequency.value = 20_000;
    highpass.frequency.value = 20;
    context
      .createMediaElementSource(audio.current)
      .connect(lowpass)
      .connect(highpass)
      .connect(gain)
      .connect(context.destination);
    graph.current = { context, gain, lowpass, highpass };
  }, [hasSweep]);
  useEffect(
    () => () => {
      void graph.current?.context.close();
    },
    [],
  );
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
    const volume = Math.max(
      0,
      Math.min(1, clipPropertyAt(clip, "volume", localUs, clip.volume)) *
        clipAudioGainAt(clip, localUs) *
        audioSeamGainAt(clip, playheadUs, transitions ?? [], clipsById),
    );
    if (graph.current) {
      const frequencies = audioSeamFilterAt(
        clip,
        playheadUs,
        transitions ?? [],
        clipsById,
      );
      node.volume = 1;
      graph.current.gain.gain.value = volume;
      graph.current.lowpass.frequency.value = frequencies.lowpass;
      graph.current.highpass.frequency.value = frequencies.highpass;
    } else node.volume = volume;
  }, [clip, clipsById, hasSweep, playheadUs, playing, transitions]);
  useEffect(() => {
    const node = audio.current;
    if (!node) return;
    if (playing && active) {
      void graph.current?.context.resume();
      void node.play().catch(() => undefined);
    } else node.pause();
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
  selectedClipIds,
  onTransformDraft,
  preciseFrame,
  onPreciseFrameChange,
  onFrameSaved,
  onSelectClip,
  commit,
  saving = false,
  previewingAsset,
  onClearPreviewingAsset,
}: {
  onSelectClip?: (clipId: string) => void;
  commit?: (
    redo: VideoEditorOperation[] | TimelineEditBuilder,
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
  selectedClipIds?: string[];
  onTransformDraft?: (draft: TransformDraft | undefined) => void;
  preciseFrame: boolean;
  onPreciseFrameChange: (value: boolean) => void;
  onFrameSaved?: () => void | Promise<unknown>;
  previewingAsset?: VideoEditorAsset;
  onClearPreviewingAsset?: () => void;
}) {
  const canWrite = useAccountPermission("content.write");
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
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [comparePercent, setComparePercent] = useState(50);
  const [compareView, setCompareView] = useState<"split" | "before" | "after">(
    "split",
  );
  const [compareHint, setCompareHint] = useState("");
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
  const allClips = useMemo(
    () =>
      (timeline.document.tracks ?? []).flatMap((track) => track.clips ?? []),
    [timeline.document.tracks],
  );
  const allClipsById = useMemo(
    () => new Map(allClips.map((clip) => [clip.id, clip])),
    [allClips],
  );
  const visualLayers = useMemo(
    () =>
      previewVisualLayers(
        timeline.document.tracks ?? [],
        playheadUs,
        timeline.document.transitions ?? [],
      ),
    [playheadUs, timeline.document.tracks, timeline.document.transitions],
  );
  const videoPlaybackKeys = useMemo(
    () =>
      previewVideoPlaybackKeys(
        timeline.document.tracks ?? [],
        timeline.document.transitions ?? [],
      ),
    [timeline.document.tracks, timeline.document.transitions],
  );
  const selectedLayer = visualLayers.find(
    ({ clip }) =>
      clip.id === selectedClipId &&
      ["video", "image", "color"].includes(clip.kind) &&
      playheadUs >= clip.timelineStartUs &&
      playheadUs < clip.timelineStartUs + clip.durationUs,
  );
  const selectedGeometry = selectedLayer
    ? previewMediaGeometry(
        selectedLayer.clip,
        assetMap.get(selectedLayer.clip.assetId ?? ""),
        { width: canvasWidth, height: canvasHeight },
      )
    : undefined;
  const transformGeometry =
    selectedGeometry && selectedLayer
      ? {
          ...selectedGeometry,
          flipX: selectedLayer.clip.flipX,
          multiplier: selectedLayer.effect.scaleMultiplier,
        }
      : undefined;
  const transformControl = usePreviewTransform({
    clip: selectedLayer?.clip,
    localUs: selectedLayer?.localUs ?? 0,
    geometry: transformGeometry,
    revision: timeline.revision,
    playheadUs,
    stageRef,
    canvasWidth,
    canvasHeight,
    disabled:
      !canWrite ||
      saving ||
      playing ||
      Boolean(previewingAsset) ||
      (selectedClipIds?.length ?? 1) > 1 ||
      Boolean(
        timeline.document.tracks?.find(
          (track) => track.id === selectedLayer?.clip.trackId,
        )?.locked,
      ),
    commit,
    onDraft: onTransformDraft,
    onStart: () => {
      setPlaying(false);
      setCompareEnabled(false);
    },
  });
  const transitionOverlay = mergeTransitionOverlay(visualLayers);
  const audioChains = useMemo(
    () => buildPreviewAudioChains(timeline),
    [timeline],
  );
  const preciseUrl = exactFrameUrl(projectId, timeline.revision, playheadUs);
  const selectedKeyedClip = allClips.find(
    (clip) => clip.id === selectedClipId && clip.chromaKey?.enabled,
  );
  const compareClip = visualLayers.find(
    (layer) =>
      layer.clip.id === selectedClipId && layer.clip.chromaKey?.enabled,
  )?.clip;
  const compareActive = compareEnabled && Boolean(compareClip) && !playing;
  const compareButtonTitle = selectedKeyedClip
    ? compareActive
      ? "关闭抠像对比"
      : "暂停后左右对比选中片段的抠像前后画面，可拖动紫色分界线"
    : "请先选中已启用抠像的视频或图片片段";
  const toggleCompare = () => {
    setPlaying(false);
    if (!selectedKeyedClip) {
      setCompareEnabled(false);
      setCompareHint("请先在时间轴选中已启用抠像的片段");
      return;
    }
    if (
      playheadUs < selectedKeyedClip.timelineStartUs ||
      playheadUs >=
        selectedKeyedClip.timelineStartUs + selectedKeyedClip.durationUs
    ) {
      setPlayheadUs(
        selectedKeyedClip.timelineStartUs +
          Math.min(selectedKeyedClip.durationUs / 2, 500_000),
      );
    }
    setCompareEnabled((value) => !value);
    setCompareView("split");
    setCompareHint("");
  };
  useEffect(() => {
    if (!selectedKeyedClip) setCompareEnabled(false);
  }, [selectedKeyedClip]);
  const beforeFrameUrl =
    compareActive && compareClip
      ? exactFrameUrl(
          projectId,
          timeline.revision,
          playheadUs,
          960,
          compareClip.id,
        )
      : "";
  const beforeClipPath =
    compareView === "before"
      ? "inset(0 0 0 0)"
      : compareView === "after"
        ? "inset(0 100% 0 0)"
        : `inset(0 ${100 - comparePercent}% 0 0)`;
  if (previewingAsset) {
    return (
      <section className="ve-preview-panel">
        <VideoEditorSourceMonitor
          asset={previewingAsset}
          fps={fps}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          showCanvasGuides={showCanvasGuides}
          onToggleCanvasGuides={() => setShowCanvasGuides((value) => !value)}
          onExitSource={() => onClearPreviewingAsset?.()}
        />
      </section>
    );
  }
  return (
    <section className="ve-preview-panel">
      <header>
        <strong>节目监视器</strong>
        <div>
          <span className="ve-preview-meta">
            {canvasWidth}×{canvasHeight}
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
            className={
              compareActive || (compareEnabled && selectedKeyedClip)
                ? "active"
                : ""
            }
            disabled={!selectedKeyedClip}
            aria-pressed={compareActive}
            title={compareButtonTitle}
            onClick={toggleCompare}
          >
            抠像对比
          </button>
          {compareActive ? (
            <div
              className="ve-chroma-compare-modes"
              role="group"
              aria-label="抠像对比视图"
            >
              <button
                type="button"
                aria-pressed={compareView === "before"}
                title="整屏查看抠像前"
                onClick={() => setCompareView("before")}
              >
                原图
              </button>
              <button
                type="button"
                aria-pressed={compareView === "split"}
                title="左右分屏，拖动分界线对比"
                onClick={() => setCompareView("split")}
              >
                分屏
              </button>
              <button
                type="button"
                aria-pressed={compareView === "after"}
                title="整屏查看抠像后"
                onClick={() => setCompareView("after")}
              >
                抠像后
              </button>
            </div>
          ) : null}
          {compareHint ? (
            <span className="ve-chroma-compare-status" role="status">
              {compareHint}
            </span>
          ) : null}
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
              const node = stageRef.current?.parentElement;
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
          className="ve-stage ve-transform-stage"
          style={{
            aspectRatio: canvasWidth / canvasHeight,
            background: timeline.document.settings?.backgroundColor ?? "#000",
          }}
        >
          <div className="ve-stage-content">
            {visualLayers.map(({ clip, localUs, effect }) => {
              const asset = assetMap.get(clip.assetId ?? "");
              const geometry = previewMediaGeometry(clip, asset, {
                width: canvasWidth,
                height: canvasHeight,
              });
              const style = previewLayerStyle(
                clip,
                localUs,
                effect,
                geometry,
                { width: canvasWidth, height: canvasHeight },
                transformControl.draft?.clipId === clip.id
                  ? {
                      ...transformAt(clip, localUs),
                      ...transformControl.draft.values,
                    }
                  : undefined,
              );
              if (clip.kind === "text")
                return (
                  <VideoEditorTextLayer
                    key={clip.id}
                    projectId={projectId}
                    revision={timeline.revision}
                    clip={clip}
                    style={style}
                    spinBlur={effect.spinBlur}
                    whipPan={effect.whipPan}
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
                <VideoEditorMediaLayer
                  key={videoPlaybackKeys.get(clip.id) ?? clip.id}
                  clip={clip}
                  asset={asset}
                  geometry={geometry}
                  style={style}
                  spinBlur={effect.spinBlur}
                  whipPan={effect.whipPan}
                  localUs={localUs}
                  timedEffects={activeTimedEffects(
                    clip,
                    playheadUs - clip.timelineStartUs,
                    timeline.document.settings?.fps ?? 30,
                  )}
                  playing={playing}
                  selected={selectedClipId === clip.id}
                />
              );
            })}
            {transitionOverlay.opacity > 0 ? (
              <div
                className="ve-transition-flash"
                style={{
                  backgroundColor: transitionOverlay.color,
                  opacity: transitionOverlay.opacity,
                }}
                aria-hidden
              />
            ) : null}
            {transitionOverlay.eyelidProgress !== undefined ? (
              <svg
                className="ve-transition-eyelids"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path
                  d={eyelidOverlayPaths(transitionOverlay.eyelidProgress).upper}
                />
                <path
                  d={eyelidOverlayPaths(transitionOverlay.eyelidProgress).lower}
                />
              </svg>
            ) : null}
            {transitionOverlay.lightLeak ? (
              <VideoEditorLightLeak
                effect={transitionOverlay.lightLeak}
                width={canvasWidth}
                height={canvasHeight}
              />
            ) : null}
            {preciseFrame &&
            !playing &&
            !draggingText &&
            !transformControl.draft ? (
              <VideoEditorPreciseFrame
                key={`${projectId}:${timeline.revision}`}
                url={preciseUrl}
              />
            ) : null}
            {compareActive && compareClip ? (
              <div
                className={`ve-chroma-compare is-${compareView}`}
                style={
                  { "--compare-percent": `${comparePercent}%` } as CSSProperties
                }
              >
                <img
                  src={beforeFrameUrl}
                  alt="抠像前的节目帧"
                  style={{ clipPath: beforeClipPath }}
                />
                {compareView === "split" ? (
                  <>
                    <span className="ve-chroma-compare-handle" aria-hidden />
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={comparePercent}
                      aria-label="调整抠像前后对比分界线"
                      onChange={(event) =>
                        setComparePercent(Number(event.target.value))
                      }
                    />
                  </>
                ) : null}
              </div>
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
          {selectedLayer && transformGeometry && (
            <VideoEditorTransformBox
              transform={{
                ...transformAt(selectedLayer.clip, selectedLayer.localUs),
                ...transformControl.draft?.values,
              }}
              geometry={transformGeometry}
              canvasWidth={canvasWidth}
              canvasHeight={canvasHeight}
              control={transformControl}
              compareSplit={compareActive && compareView === "split"}
            />
          )}
          {transformControl.error && (
            <span className="ve-transform-error" role="alert">
              {transformControl.error}
            </span>
          )}
        </div>
        <div className="ve-proxy-audio" aria-hidden>
          {audioChains.map((chain) => {
            const asset = assetMap.get(chain.assetId);
            return asset?.proxyUrl ? (
              <ProxyAudioChain
                key={chain.id}
                source={asset.proxyUrl}
                clips={chain.clips}
                transitions={timeline.document.transitions}
                clipsById={allClipsById}
                playheadUs={playheadUs}
                playing={playing}
              />
            ) : null;
          })}
        </div>
      </div>
      <footer className="ve-transport">
        <button
          aria-label="跳到开头"
          onClick={() => {
            setPlaying(false);
            setPlayheadUs(0);
          }}
        >
          <ChevronsLeft aria-hidden />
        </button>
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
        <button
          aria-label="跳到结尾"
          onClick={() => {
            setPlaying(false);
            setPlayheadUs(timelineDuration(timeline));
          }}
        >
          <ChevronsRight aria-hidden />
        </button>
        <strong>{formatTime(playheadUs)}</strong>
        <span>{fps} FPS · Space 播放 · ← → 逐帧 · Home/End 跳转</span>
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
