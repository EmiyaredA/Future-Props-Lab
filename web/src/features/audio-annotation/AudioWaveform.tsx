import { LoadingState } from "@shared/ui/LoadingState";
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
  segmentSpeakerIds,
  stabilizeWaveformRegionSegments,
  stabilizeWaveformRegionSpeakers,
  waveformSegmentSpeakerLabel,
  waveformViewport,
} from "@features/audio-annotation/model";
import type {
  WaveformRegionSegment,
  WaveformRegionSpeaker,
} from "@features/audio-annotation/model";
import { audioBufferRangeToWav } from "@features/audio-annotation/audioClip";

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
  setFocusSelectionMode: (enabled: boolean) => void;
  exportRangeWav: (startMs: number, endMs: number) => Blob | null;
};

async function decodeAudioBlob(blob: Blob): Promise<AudioBuffer> {
  const context = new AudioContext();
  try {
    return await context.decodeAudioData(await blob.arrayBuffer());
  } finally {
    await context.close();
  }
}

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
    flashToken?: number;
    focusSelectionMode: boolean;
    onSelect: (segmentId: string) => void;
    onUpdate: (segmentId: string, startMs: number, endMs: number) => void;
    onCreate: (startMs: number, endMs: number) => void;
    onTime: (milliseconds: number) => void;
    onPlayState: (playing: boolean) => void;
    onViewport: (viewport: AudioWaveformViewport) => void;
    onFocusRange: (startMs: number, endMs: number) => void;
    onReadyPeaks: (peaks: number[][]) => void;
    onAudioReady: (ready: boolean) => void;
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
    flashToken = 0,
    focusSelectionMode,
    onSelect,
    onUpdate,
    onCreate,
    onTime,
    onPlayState,
    onViewport,
    onFocusRange,
    onReadyPeaks,
    onAudioReady,
    onError,
  },
  ref,
) {
  const container = useRef<HTMLDivElement>(null);
  const waveSurfer = useRef<WaveSurfer | null>(null);
  const decodedAudio = useRef<AudioBuffer | null>(null);
  const regions = useRef<RegionsPlugin | null>(null);
  const syncing = useRef(false);
  const focusSelectionModeRef = useRef(focusSelectionMode);
  const peaksRef = useRef(peaks);
  const zoomRatio = useRef(1);
  const viewport = useRef<AudioWaveformViewport>({
    startMs: 0,
    endMs: durationMs,
  });
  const segmentsRef = useRef(segments);
  const renderedSegmentsRef = useRef<WaveformRegionSegment[]>([]);
  const renderedSpeakersRef = useRef<WaveformRegionSpeaker[]>([]);
  const callbacks = useRef({
    onSelect,
    onUpdate,
    onCreate,
    onTime,
    onPlayState,
    onViewport,
    onFocusRange,
    onReadyPeaks,
    onAudioReady,
    onError,
  });
  const [ready, setReady] = useState(false);
  segmentsRef.current = segments;
  peaksRef.current = peaks;
  renderedSegmentsRef.current = stabilizeWaveformRegionSegments(
    renderedSegmentsRef.current,
    segments,
  );
  renderedSpeakersRef.current = stabilizeWaveformRegionSpeakers(
    renderedSpeakersRef.current,
    speakers,
  );
  const renderedSegments = renderedSegmentsRef.current;
  const renderedSpeakers = renderedSpeakersRef.current;
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
    onAudioReady,
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
      setFocusSelectionMode: (enabled) => {
        focusSelectionModeRef.current = enabled;
        for (const region of regions.current?.getRegions() ?? []) {
          region.setOptions({ drag: !enabled, resize: !enabled });
          if (region.element)
            region.element.style.pointerEvents = enabled ? "none" : "";
        }
      },
      exportRangeWav: (startMs, endMs) => {
        const decoded = decodedAudio.current;
        return decoded ? audioBufferRangeToWav(decoded, startMs, endMs) : null;
      },
    }),
    [durationMs],
  );

  useEffect(() => {
    if (!container.current) return;
    const initialPeaks = peaksRef.current;
    let active = true;
    setReady(false);
    decodedAudio.current = null;
    callbacks.current.onAudioReady(false);
    const instance = WaveSurfer.create({
      container: container.current,
      height: 112,
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
        height: 18,
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
        if (!initialPeaks.length) {
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
      instance.on("error", (error) => {
        callbacks.current.onAudioReady(false);
        callbacks.current.onError(error.message || "波形加载失败");
      }),
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
      .then(async (blob) => {
        const [, explicitlyDecoded] = await Promise.all([
          instance.loadBlob(
            blob,
            initialPeaks.length ? initialPeaks : undefined,
            durationMs / 1000,
          ),
          initialPeaks.length ? decodeAudioBlob(blob) : Promise.resolve(null),
        ]);
        if (!active) return;
        const decoded = explicitlyDecoded ?? instance.getDecodedData();
        if (!decoded) throw new Error("音频解码失败");
        decodedAudio.current = decoded;
        callbacks.current.onAudioReady(true);
      })
      .catch((error) =>
        callbacks.current.onError(
          error instanceof Error ? error.message : "音频加载失败",
        ),
      );

    return () => {
      active = false;
      callbacks.current.onAudioReady(false);
      decodedAudio.current = null;
      subscriptions.forEach((unsubscribe) => unsubscribe());
      instance.destroy();
      waveSurfer.current = null;
      regions.current = null;
    };
  }, [assetId, durationMs]);

  useEffect(() => {
    if (!ready || !regions.current) return;
    syncing.current = true;
    regions.current.clearRegions();
    const speakerById = new Map(
      renderedSpeakers.map((speaker) => [speaker.id, speaker]),
    );
    renderedSegments
      .map((segment, index) => ({ segment, index }))
      .sort(
        (left, right) =>
          Number(left.segment.id === selectedId) -
          Number(right.segment.id === selectedId),
      )
      .forEach(({ segment, index }) => {
        const segmentSpeakers = segmentSpeakerIds(segment)
          .map((speakerId) => speakerById.get(speakerId))
          .filter(
            (speaker): speaker is WaveformRegionSpeaker =>
              speaker !== undefined,
          );
        const speaker = segmentSpeakers[0];
        const labelText = waveformSegmentSpeakerLabel(
          index,
          segmentSpeakers.map((item) => item.name),
        );
        const label = document.createElement("span");
        const multipleSpeakers = segmentSpeakers.length > 1;
        const selected = selectedId === segment.id;
        label.className = `annotation-region-label${multipleSpeakers ? " is-multiple" : ""}`;
        label.title = labelText;
        label.setAttribute("aria-label", labelText);

        const number = document.createElement("strong");
        number.textContent = String(index + 1).padStart(2, "0");
        Object.assign(number.style, {
          flex: "none",
          fontWeight: "700",
        });
        label.append(number);

        const dots = document.createElement("span");
        dots.setAttribute("aria-hidden", "true");
        Object.assign(dots.style, {
          display: "inline-flex",
          flex: "none",
          paddingLeft: "2px",
        });
        const dotColors = segmentSpeakers.length
          ? segmentSpeakers.map((item) => item.color)
          : ["#8b9189"];
        dotColors.slice(0, 4).forEach((color, dotIndex) => {
          const dot = document.createElement("i");
          Object.assign(dot.style, {
            width: "7px",
            height: "7px",
            marginLeft: dotIndex ? "-2px" : "0",
            border: "1px solid rgba(24, 27, 24, 0.8)",
            borderRadius: "50%",
            background: color,
          });
          dots.append(dot);
        });
        label.append(dots);

        const names = document.createElement("span");
        names.textContent = segmentSpeakers.length
          ? segmentSpeakers.map((item) => item.name).join("、")
          : "未指定";
        Object.assign(names.style, {
          minWidth: "0",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        });
        label.append(names);
        Object.assign(label.style, {
          position: "absolute",
          zIndex: selected ? "6" : "4",
          top: "8px",
          left: "8px",
          maxWidth:
            selected && multipleSpeakers
              ? "min(320px, calc(100vw - 48px))"
              : "calc(100% - 16px)",
          width: selected && multipleSpeakers ? "max-content" : "auto",
          padding: "3px 7px",
          display: "inline-flex",
          alignItems: "center",
          gap: "5px",
          overflow: "hidden",
          border: "1px solid rgba(255, 255, 255, 0.22)",
          borderRadius: "5px",
          background: "rgba(24, 27, 24, 0.76)",
          color: "#f4f3ef",
          fontSize: "10px",
          lineHeight: "1.25",
          whiteSpace: "nowrap",
          pointerEvents: "none",
        });
        const renderedRegion = regions.current?.addRegion({
          id: segment.id,
          start: segment.start_ms / 1000,
          end: segment.end_ms / 1000,
          color: regionColor(speaker?.color ?? "#8b9189", selected),
          content: label,
          minLength: 0.1,
          drag: !focusSelectionMode,
          resize: !focusSelectionMode,
        });
        if (renderedRegion?.element) {
          renderedRegion.element.dataset.amadeusId = segment.id;
          if (focusSelectionMode)
            renderedRegion.element.style.pointerEvents = "none";
        }
      });
    syncing.current = false;
  }, [
    focusSelectionMode,
    ready,
    renderedSegments,
    renderedSpeakers,
    selectedId,
  ]);

  // Flash only when the list bumps flashToken; selectedId is read from that same render.
  // Omitting selectedId from deps avoids re-flashing when the waveform itself changes selection.
  // Regions live in WaveSurfer's shadow root, so light-DOM CSS classes never apply — animate the
  // element directly with the Web Animations API.
  useEffect(() => {
    if (!ready || !flashToken || !selectedId || !regions.current) return;
    const targetId = selectedId;
    let cancelled = false;
    let animation: Animation | null = null;
    let frame = 0;

    const runFlash = () => {
      if (cancelled || !regions.current) return;
      const region = regions.current
        .getRegions()
        .find((item) => item.id === targetId);
      const element = region?.element;
      if (!element) return;
      const baseBackground = element.style.backgroundColor || "transparent";
      animation?.cancel();
      animation = element.animate(
        [
          {
            backgroundColor: baseBackground,
            opacity: 1,
            filter: "brightness(1)",
            offset: 0,
          },
          {
            backgroundColor: "rgba(255, 255, 255, 0.92)",
            opacity: 1,
            filter: "brightness(1.8)",
            offset: 0.14,
          },
          {
            backgroundColor: baseBackground,
            opacity: 0.12,
            filter: "brightness(0.6)",
            offset: 0.28,
          },
          {
            backgroundColor: "rgba(255, 255, 255, 0.92)",
            opacity: 1,
            filter: "brightness(1.8)",
            offset: 0.42,
          },
          {
            backgroundColor: baseBackground,
            opacity: 0.12,
            filter: "brightness(0.6)",
            offset: 0.56,
          },
          {
            backgroundColor: "rgba(255, 255, 255, 0.92)",
            opacity: 1,
            filter: "brightness(1.8)",
            offset: 0.7,
          },
          {
            backgroundColor: baseBackground,
            opacity: 0.12,
            filter: "brightness(0.6)",
            offset: 0.84,
          },
          {
            backgroundColor: baseBackground,
            opacity: 1,
            filter: "brightness(1)",
            offset: 1,
          },
        ],
        { duration: 1000, easing: "ease-in-out" },
      );
    };

    // Wait until after the regions-sync effect has rebuilt DOM for a new selectedId.
    frame = requestAnimationFrame(runFlash);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      animation?.cancel();
    };
  }, [flashToken, ready]); // eslint-disable-line react-hooks/exhaustive-deps -- see above

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
        <LoadingState
          label="正在准备音频波形…"
          variant="region"
          className="annotation-waveform-loading"
        />
      ) : null}
      {ready && focusSelectionMode ? (
        <div className="annotation-waveform-selection-hint" role="status">
          在波形上拖拽框选，松手后只显示该时间范围
        </div>
      ) : null}
    </div>
  );
});
