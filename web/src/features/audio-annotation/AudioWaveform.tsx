import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin, {
  type Region,
} from "wavesurfer.js/dist/plugins/regions.esm.js";
import TimelinePlugin from "wavesurfer.js/dist/plugins/timeline.esm.js";
import { fetchApiBlob } from "@platform/api/client";
import type {
  AudioAnnotationSegment,
  AudioAnnotationSpeaker,
} from "@features/audio-annotation/types";
import {
  clampWaveformZoom,
  waveformViewport,
} from "@features/audio-annotation/model";

export type AudioWaveformViewport = {
  startMs: number;
  endMs: number;
};

export type AudioWaveformHandle = {
  playPause: () => void;
  playRange: (startMs: number, endMs: number) => void;
  pause: () => void;
  seekMs: (milliseconds: number) => void;
  setRate: (rate: number) => void;
  setVolume: (volume: number) => void;
  zoom: (ratio: number, anchorMs?: number) => void;
  scrollTo: (startMs: number) => void;
  panBy: (viewportFraction: number) => void;
};

function regionColor(color: string, selected: boolean) {
  return selected
    ? `color-mix(in srgb, ${color} 34%, transparent)`
    : `color-mix(in srgb, ${color} 19%, transparent)`;
}

export const AudioWaveform = forwardRef<
  AudioWaveformHandle,
  {
    assetId: string;
    durationMs: number;
    peaks: number[][];
    segments: AudioAnnotationSegment[];
    speakers: AudioAnnotationSpeaker[];
    selectedId: string | null;
    focusSelectionMode: boolean;
    onSelect: (segmentId: string) => void;
    onUpdate: (segmentId: string, startMs: number, endMs: number) => void;
    onCreate: (startMs: number, endMs: number) => void;
    onTime: (milliseconds: number) => void;
    onPlayState: (playing: boolean) => void;
    onViewport: (viewport: AudioWaveformViewport) => void;
    onFocusRange: (startMs: number, endMs: number) => void;
    onReadyPeaks: (peaks: number[][]) => void;
    onError: (message: string) => void;
  }
>(function AudioWaveform(
  {
    assetId,
    durationMs,
    peaks,
    segments,
    speakers,
    selectedId,
    focusSelectionMode,
    onSelect,
    onUpdate,
    onCreate,
    onTime,
    onPlayState,
    onViewport,
    onFocusRange,
    onReadyPeaks,
    onError,
  },
  ref,
) {
  const container = useRef<HTMLDivElement>(null);
  const waveSurfer = useRef<WaveSurfer | null>(null);
  const regions = useRef<RegionsPlugin | null>(null);
  const syncing = useRef(false);
  const focusSelectionModeRef = useRef(focusSelectionMode);
  const zoomRatio = useRef(1);
  const viewport = useRef<AudioWaveformViewport>({
    startMs: 0,
    endMs: durationMs,
  });
  const segmentsRef = useRef(segments);
  const callbacks = useRef({
    onSelect,
    onUpdate,
    onCreate,
    onTime,
    onPlayState,
    onViewport,
    onFocusRange,
    onReadyPeaks,
    onError,
  });
  const [ready, setReady] = useState(false);
  segmentsRef.current = segments;
  focusSelectionModeRef.current = focusSelectionMode;
  callbacks.current = {
    onSelect,
    onUpdate,
    onCreate,
    onTime,
    onPlayState,
    onViewport,
    onFocusRange,
    onReadyPeaks,
    onError,
  };

  useImperativeHandle(
    ref,
    () => ({
      playPause: () => void waveSurfer.current?.playPause(),
      playRange: (startMs, endMs) => {
        const instance = waveSurfer.current;
        if (!instance) return;
        void instance
          .play(startMs / 1000, endMs / 1000)
          .catch((error: unknown) =>
            callbacks.current.onError(
              error instanceof Error ? error.message : "片段播放失败",
            ),
          );
      },
      pause: () => waveSurfer.current?.pause(),
      seekMs: (milliseconds) =>
        waveSurfer.current?.setTime(milliseconds / 1000),
      setRate: (rate) => waveSurfer.current?.setPlaybackRate(rate),
      setVolume: (volume) => waveSurfer.current?.setVolume(volume),
      zoom: (ratio, anchorMs) => {
        const instance = waveSurfer.current;
        if (!instance) return;
        const nextRatio = clampWaveformZoom(ratio);
        const centerMs =
          anchorMs ?? (viewport.current.startMs + viewport.current.endMs) / 2;
        const nextViewport = waveformViewport(durationMs, nextRatio, centerMs);
        zoomRatio.current = nextRatio;
        instance.zoom((instance.getWidth() / (durationMs / 1000)) * nextRatio);
        if (nextRatio === 1) instance.setScroll(0);
        else instance.setScrollTime(nextViewport.startMs / 1000);
        viewport.current = nextViewport;
        callbacks.current.onViewport(nextViewport);
      },
      scrollTo: (startMs) => {
        const instance = waveSurfer.current;
        if (!instance) return;
        const visibleMs = durationMs / zoomRatio.current;
        const safeStart = Math.min(
          Math.max(0, startMs),
          Math.max(0, durationMs - visibleMs),
        );
        const nextViewport = {
          startMs: safeStart,
          endMs: Math.min(durationMs, safeStart + visibleMs),
        };
        instance.setScrollTime(safeStart / 1000);
        viewport.current = nextViewport;
        callbacks.current.onViewport(nextViewport);
      },
      panBy: (viewportFraction) => {
        const instance = waveSurfer.current;
        if (!instance) return;
        const visibleMs = durationMs / zoomRatio.current;
        const safeStart = Math.min(
          Math.max(0, viewport.current.startMs + visibleMs * viewportFraction),
          Math.max(0, durationMs - visibleMs),
        );
        const nextViewport = {
          startMs: safeStart,
          endMs: Math.min(durationMs, safeStart + visibleMs),
        };
        instance.setScrollTime(safeStart / 1000);
        viewport.current = nextViewport;
        callbacks.current.onViewport(nextViewport);
      },
    }),
    [durationMs],
  );

  useEffect(() => {
    if (!container.current) return;
    let active = true;
    setReady(false);
    const instance = WaveSurfer.create({
      container: container.current,
      height: 236,
      waveColor: "#6c746c",
      progressColor: "#ed7a52",
      cursorColor: "#ed7a52",
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
      minPxPerSec: 0,
      autoScroll: true,
      autoCenter: true,
    });
    const regionPlugin = instance.registerPlugin(RegionsPlugin.create());
    instance.registerPlugin(
      TimelinePlugin.create({
        height: 24,
        timeInterval: 5,
        primaryLabelInterval: 4,
        style: { fontSize: "10px", color: "#8b9189" },
      }),
    );
    waveSurfer.current = instance;
    regions.current = regionPlugin;

    const subscriptions = [
      instance.on("ready", () => {
        if (!active) return;
        setReady(true);
        const initialViewport = { startMs: 0, endMs: durationMs };
        viewport.current = initialViewport;
        callbacks.current.onViewport(initialViewport);
        regionPlugin.enableDragSelection(
          { color: "rgba(237, 122, 82, 0.18)", minLength: 0.1 },
          4,
        );
        if (!peaks.length) {
          callbacks.current.onReadyPeaks(
            instance.exportPeaks({
              channels: 2,
              maxLength: Math.min(36_000, Math.ceil(durationMs / 100)),
              precision: 1000,
            }),
          );
        }
      }),
      instance.on("timeupdate", (seconds) =>
        callbacks.current.onTime(Math.round(seconds * 1000)),
      ),
      instance.on("play", () => callbacks.current.onPlayState(true)),
      instance.on("pause", () => callbacks.current.onPlayState(false)),
      instance.on("finish", () => callbacks.current.onPlayState(false)),
      instance.on("scroll", (visibleStartTime, visibleEndTime) => {
        const nextViewport = {
          startMs: Math.round(visibleStartTime * 1000),
          endMs: Math.round(visibleEndTime * 1000),
        };
        viewport.current = nextViewport;
        callbacks.current.onViewport(nextViewport);
      }),
      instance.on("error", (error) =>
        callbacks.current.onError(error.message || "波形加载失败"),
      ),
      regionPlugin.on("region-clicked", (region, event) => {
        event.stopPropagation();
        callbacks.current.onSelect(region.id);
        instance.setTime(region.start);
      }),
      regionPlugin.on("region-updated", (region) => {
        if (
          !syncing.current &&
          segmentsRef.current.some((item) => item.id === region.id)
        ) {
          callbacks.current.onUpdate(
            region.id,
            Math.round(region.start * 1000),
            Math.round(region.end * 1000),
          );
        }
      }),
      regionPlugin.on("region-created", (region: Region) => {
        if (
          syncing.current ||
          segmentsRef.current.some((item) => item.id === region.id)
        )
          return;
        if (focusSelectionModeRef.current) {
          callbacks.current.onFocusRange(
            Math.round(region.start * 1000),
            Math.round(region.end * 1000),
          );
          region.remove();
          return;
        }
        callbacks.current.onCreate(
          Math.round(region.start * 1000),
          Math.round(region.end * 1000),
        );
        region.remove();
      }),
    ];

    void fetchApiBlob(`/v1/files/${encodeURIComponent(assetId)}/content`)
      .then((blob) =>
        instance.loadBlob(
          blob,
          peaks.length ? peaks : undefined,
          durationMs / 1000,
        ),
      )
      .catch((error) =>
        callbacks.current.onError(
          error instanceof Error ? error.message : "音频加载失败",
        ),
      );

    return () => {
      active = false;
      subscriptions.forEach((unsubscribe) => unsubscribe());
      instance.destroy();
      waveSurfer.current = null;
      regions.current = null;
    };
  }, [assetId, durationMs, peaks]);

  useEffect(() => {
    if (!ready || !regions.current) return;
    syncing.current = true;
    regions.current.clearRegions();
    const speakerById = new Map(
      speakers.map((speaker) => [speaker.id, speaker]),
    );
    segments
      .map((segment, index) => ({ segment, index }))
      .sort(
        (left, right) =>
          Number(left.segment.id === selectedId) -
          Number(right.segment.id === selectedId),
      )
      .forEach(({ segment, index }) => {
        const speaker = segment.speaker_id
          ? speakerById.get(segment.speaker_id)
          : undefined;
        const label = document.createElement("span");
        label.className = "annotation-region-label";
        label.textContent = `${String(index + 1).padStart(2, "0")}  ${speaker?.name ?? "未指定"}`;
        Object.assign(label.style, {
          position: "absolute",
          zIndex: "4",
          top: "8px",
          left: "8px",
          maxWidth: "calc(100% - 16px)",
          padding: "3px 7px",
          overflow: "hidden",
          border: "1px solid rgba(255, 255, 255, 0.22)",
          borderRadius: "5px",
          background: "rgba(24, 27, 24, 0.76)",
          color: "#f4f3ef",
          fontSize: "10px",
          lineHeight: "1.25",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          pointerEvents: "none",
        });
        const renderedRegion = regions.current?.addRegion({
          id: segment.id,
          start: segment.start_ms / 1000,
          end: segment.end_ms / 1000,
          color: regionColor(
            speaker?.color ?? "#8b9189",
            selectedId === segment.id,
          ),
          content: label,
          minLength: 0.1,
          drag: !focusSelectionMode,
          resize: !focusSelectionMode,
        });
        if (focusSelectionMode && renderedRegion?.element)
          renderedRegion.element.style.pointerEvents = "none";
      });
    syncing.current = false;
  }, [focusSelectionMode, ready, segments, speakers, selectedId]);

  return (
    <div
      className={`annotation-waveform-shell${focusSelectionMode ? " is-focus-selecting" : ""}`}
    >
      <div
        ref={container}
        className="annotation-waveform"
        aria-label="录音波形时间轴"
      />
      {!ready ? (
        <div className="annotation-waveform-loading">正在准备音频波形…</div>
      ) : null}
      {ready && focusSelectionMode ? (
        <div className="annotation-waveform-selection-hint" role="status">
          在波形上拖拽框选，松手后只显示该时间范围
        </div>
      ) : null}
    </div>
  );
});
