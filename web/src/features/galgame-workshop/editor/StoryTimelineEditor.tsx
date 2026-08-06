import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  MapPinned,
  Pause,
  Play,
  Repeat2,
  SkipBack,
  SkipForward,
  Users,
} from "lucide-react";
import { fetchApiBlob } from "@platform/api/client";
import type {
  GalgameStoryFragment,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import {
  activeTimelineCue,
  formatTimecode,
  moveTimelineCue,
  resizeTimelineBoundary,
  setTimelineCueEdge,
  setTimelineGapEdge,
  timelineCues,
  timelineGaps,
  timelineStageMarkers,
} from "@features/galgame-workshop/editor/timeline";
import {
  createAudioLevelMonitor,
  type AudioLevelMonitor,
} from "@features/galgame-workshop/editor/lipSync";

const TIMELINE_PREFERENCES_KEY = "future_props_galgame_timeline_preferences";
const MIN_ZOOM = 120;
const MAX_ZOOM = 960;

function loadPreferences() {
  try {
    const value = JSON.parse(
      localStorage.getItem(TIMELINE_PREFERENCES_KEY) ?? "null",
    ) as { zoom?: number; ripple?: boolean; loop?: boolean } | null;
    return {
      zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value?.zoom ?? 300)),
      ripple: value?.ripple ?? false,
      loop: value?.loop ?? false,
    };
  } catch {
    return { zoom: 300, ripple: false, loop: false };
  }
}

function characterColor(characterId: string) {
  const palette = [
    "#6d8dff",
    "#d36cff",
    "#ff7b8b",
    "#f4a84d",
    "#4ec9a4",
    "#4aaee8",
    "#b5c94c",
    "#df72b0",
  ];
  let hash = 0;
  for (const character of characterId)
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

type DragState = {
  kind: "cue" | "boundary" | "cue-start" | "cue-end" | "gap-start" | "gap-end";
  itemId: string;
  startX: number;
  source: GalgameStoryFragment;
};

export function StoryTimelineEditor({
  document,
  fragment,
  selectedBlockId,
  selectedGapId,
  onSelectBlock,
  onSelectGap,
  onFragment,
  onPreviewPosition,
  onAudioLevel,
  onPlayingChange,
}: {
  document: GalgameStoryProject;
  fragment: GalgameStoryFragment;
  selectedBlockId?: string;
  selectedGapId?: string;
  onSelectBlock: (blockId: string) => void;
  onSelectGap: (gapId: string) => void;
  onFragment: (fragment: GalgameStoryFragment) => void;
  onPreviewPosition: (milliseconds: number | null) => void;
  onAudioLevel?: (decibels: number | null) => void;
  onPlayingChange?: (playing: boolean) => void;
}) {
  const initialPreferences = useMemo(loadPreferences, []);
  const [zoom, setZoom] = useState(initialPreferences.zoom);
  const [ripple, setRipple] = useState(initialPreferences.ripple);
  const [loop, setLoop] = useState(initialPreferences.loop);
  const [positionMs, setPositionMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const levelMonitorRef = useRef<AudioLevelMonitor | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const auditionRef = useRef<
    { startMs: number; endMs: number; loop: boolean } | undefined
  >(undefined);
  const cues = timelineCues(fragment);
  const gaps = timelineGaps(fragment);
  const markers = timelineStageMarkers(fragment);
  const durationMs = fragment.timeline?.durationMs ?? 0;
  const trackWidth = Math.max(640, (durationMs / 60_000) * zoom);
  const activeCue = activeTimelineCue(fragment, positionMs);
  const timelineAsset = (document.assets ?? []).find(
    (asset) => asset.id === fragment.timeline?.assetId,
  );
  const characters = new Map(
    (document.characters ?? []).map((character) => [character.id, character]),
  );

  useEffect(() => {
    localStorage.setItem(
      TIMELINE_PREFERENCES_KEY,
      JSON.stringify({ zoom, ripple, loop }),
    );
  }, [loop, ripple, zoom]);

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    const audio = new Audio();
    audio.preload = "metadata";
    audioRef.current = audio;
    const update = () => {
      if (!active) return;
      const next = Math.min(durationMs, Math.max(0, audio.currentTime * 1000));
      setPositionMs(next);
      onPreviewPosition(next);
      const audition = auditionRef.current;
      if (!audition || next < audition.endMs) return;
      if (audition.loop) {
        audio.currentTime = audition.startMs / 1000;
        void audio.play();
      } else {
        auditionRef.current = undefined;
        audio.pause();
      }
    };
    const loaded = () => active && setReady(true);
    const paused = () => {
      if (!active) return;
      setPlaying(false);
      onPlayingChange?.(false);
    };
    const started = () => {
      if (!active) return;
      setPlaying(true);
      onPlayingChange?.(true);
    };
    const failed = () => active && setError("剧情时间轴音频无法读取");
    audio.addEventListener("timeupdate", update);
    audio.addEventListener("seeked", update);
    audio.addEventListener("loadedmetadata", loaded);
    audio.addEventListener("play", started);
    audio.addEventListener("pause", paused);
    audio.addEventListener("ended", paused);
    audio.addEventListener("error", failed);
    setReady(false);
    setPlaying(false);
    setPositionMs(0);
    setError("");
    levelMonitorRef.current = createAudioLevelMonitor(audio, (decibels) => {
      if (active) onAudioLevel?.(decibels);
    });
    if (timelineAsset?.type === "audio")
      void fetchApiBlob(`/v1/files/${timelineAsset.fileId}/content`)
        .then((blob) => {
          if (!active) return;
          objectUrl = URL.createObjectURL(blob);
          audio.src = objectUrl;
          audio.load();
        })
        .catch(failed);
    else setError("剧情时间轴素材不存在");
    return () => {
      active = false;
      auditionRef.current = undefined;
      levelMonitorRef.current?.dispose();
      levelMonitorRef.current = undefined;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (audioRef.current === audio) audioRef.current = null;
      onAudioLevel?.(null);
      onPlayingChange?.(false);
      onPreviewPosition(null);
    };
  }, [
    durationMs,
    onPreviewPosition,
    onAudioLevel,
    onPlayingChange,
    timelineAsset?.fileId,
    timelineAsset?.type,
  ]);

  useEffect(() => {
    if (!playing || !scrollRef.current) return;
    const container = scrollRef.current;
    const x = (positionMs / Math.max(1, durationMs)) * trackWidth;
    if (
      x < container.scrollLeft + 48 ||
      x > container.scrollLeft + container.clientWidth - 48
    )
      container.scrollTo({ left: Math.max(0, x - container.clientWidth / 3) });
  }, [durationMs, playing, positionMs, trackWidth]);

  useEffect(
    () => () => {
      dragCleanupRef.current?.();
    },
    [],
  );

  const seek = (milliseconds: number) => {
    const target = Math.min(durationMs, Math.max(0, milliseconds));
    const audio = audioRef.current;
    if (audio && ready) audio.currentTime = target / 1000;
    setPositionMs(target);
    onPreviewPosition(target);
  };

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio || !ready) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    try {
      auditionRef.current = undefined;
      await levelMonitorRef.current?.resume();
      await audio.play();
      setError("");
    } catch {
      setError("浏览器阻止了播放，请再次点击");
    }
  };

  const auditionSelected = async () => {
    const audio = audioRef.current;
    const cue = cues.find(
      (candidate) => candidate.block.id === selectedBlockId,
    );
    if (!audio || !ready || !cue) return;
    const startMs = Math.max(0, cue.startMs - 300);
    auditionRef.current = {
      startMs: cue.startMs,
      endMs: cue.endMs,
      loop,
    };
    seek(startMs);
    try {
      await levelMonitorRef.current?.resume();
      await audio.play();
      setError("");
    } catch {
      setError("浏览器阻止了播放，请再次点击");
    }
  };

  const setSelectedEdgeAtPlayhead = (edge: "start" | "end") => {
    if (!selectedBlockId) return;
    onFragment(
      setTimelineCueEdge(fragment, selectedBlockId, edge, positionMs, false),
    );
  };

  const skip = (direction: -1 | 1) => {
    if (!cues.length) return;
    const currentIndex =
      activeCue?.cueIndex ?? cues.findIndex((cue) => cue.startMs >= positionMs);
    const targetIndex = Math.min(
      cues.length - 1,
      Math.max(
        0,
        (currentIndex < 0 ? cues.length - 1 : currentIndex) + direction,
      ),
    );
    const cue = cues[targetIndex];
    onSelectBlock(cue.block.id);
    seek(cue.startMs);
  };

  const startDrag = (
    event: PointerEvent<HTMLElement>,
    kind: DragState["kind"],
    itemId: string,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (kind.startsWith("gap")) onSelectGap(itemId);
    else onSelectBlock(itemId);
    const drag: DragState = {
      kind,
      itemId,
      startX: event.clientX,
      source: fragment,
    };
    dragCleanupRef.current?.();
    const move = (pointer: globalThis.PointerEvent) => {
      const deltaMs = ((pointer.clientX - drag.startX) / zoom) * 60_000;
      if (drag.kind === "boundary") {
        const sourceCue = timelineCues(drag.source).find(
          (cue) => cue.block.id === drag.itemId,
        );
        if (!sourceCue) return;
        onFragment(
          resizeTimelineBoundary(
            drag.source,
            drag.itemId,
            sourceCue.endMs + deltaMs,
            pointer.altKey,
          ),
        );
      } else if (drag.kind === "cue")
        onFragment(
          moveTimelineCue(drag.source, drag.itemId, deltaMs, {
            precise: pointer.altKey,
            ripple,
            keepContinuous: true,
          }),
        );
      else if (drag.kind === "cue-start" || drag.kind === "cue-end") {
        const sourceCue = timelineCues(drag.source).find(
          (cue) => cue.block.id === drag.itemId,
        );
        if (!sourceCue) return;
        const edge = drag.kind === "cue-start" ? "start" : "end";
        onFragment(
          setTimelineCueEdge(
            drag.source,
            drag.itemId,
            edge,
            sourceCue[edge === "start" ? "startMs" : "endMs"] + deltaMs,
            false,
            pointer.altKey,
          ),
        );
      } else {
        const sourceGap = timelineGaps(drag.source).find(
          (gap) => gap.id === drag.itemId,
        );
        if (!sourceGap) return;
        const edge = drag.kind === "gap-start" ? "start" : "end";
        onFragment(
          setTimelineGapEdge(
            drag.source,
            drag.itemId,
            edge,
            sourceGap[edge === "start" ? "startMs" : "endMs"] + deltaMs,
            pointer.altKey,
          ),
        );
      }
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      dragCleanupRef.current = null;
    };
    dragCleanupRef.current = finish;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  const moveWithKeyboard = (
    event: KeyboardEvent<HTMLElement>,
    cueId: string,
  ) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.shiftKey ? 1000 : 100;
    const direction = event.key === "ArrowRight" ? 1 : -1;
    onFragment(
      moveTimelineCue(fragment, cueId, direction * step, {
        precise: true,
        ripple,
        keepContinuous: true,
      }),
    );
  };

  const moveCueEdgeWithKeyboard = (
    event: KeyboardEvent<HTMLElement>,
    cueId: string,
    edge: "start" | "end",
  ) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    const cue = cues.find((candidate) => candidate.block.id === cueId);
    if (!cue) return;
    const step = event.shiftKey ? 1000 : 100;
    onFragment(
      setTimelineCueEdge(
        fragment,
        cueId,
        edge,
        cue[edge === "start" ? "startMs" : "endMs"] +
          (event.key === "ArrowRight" ? step : -step),
        false,
        true,
      ),
    );
  };

  const moveGapEdgeWithKeyboard = (
    event: KeyboardEvent<HTMLElement>,
    gapId: string,
    edge: "start" | "end",
  ) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    const gap = gaps.find((candidate) => candidate.id === gapId);
    if (!gap) return;
    const step = event.shiftKey ? 1000 : 100;
    onFragment(
      setTimelineGapEdge(
        fragment,
        gapId,
        edge,
        gap[edge === "start" ? "startMs" : "endMs"] +
          (event.key === "ArrowRight" ? step : -step),
        true,
      ),
    );
  };

  const tickEveryMs = zoom >= 600 ? 5000 : zoom >= 240 ? 10_000 : 30_000;
  const ticks = Array.from(
    { length: Math.floor(durationMs / tickEveryMs) + 1 },
    (_, index) => index * tickEveryMs,
  );

  return (
    <section className="galgame-timeline-editor" aria-label="可编辑剧情时间轴">
      <header className="galgame-timeline-toolbar">
        <div className="galgame-timeline-transport">
          <button
            type="button"
            aria-label="时间轴上一句"
            onClick={() => skip(-1)}
          >
            <SkipBack aria-hidden />
          </button>
          <button
            type="button"
            aria-label={playing ? "暂停编辑时间轴" : "播放编辑时间轴"}
            disabled={!ready}
            onClick={() => void toggle()}
          >
            {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
          </button>
          <button
            type="button"
            aria-label="时间轴下一句"
            onClick={() => skip(1)}
          >
            <SkipForward aria-hidden />
          </button>
          <strong>
            {formatTimecode(positionMs)} / {formatTimecode(durationMs)}
          </strong>
        </div>
        <label>
          <span>缩放</span>
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step="60"
            value={zoom}
            aria-label="时间轴缩放"
            onChange={(event) => setZoom(Number(event.target.value))}
          />
        </label>
        <label className="galgame-timeline-ripple">
          <input
            type="checkbox"
            checked={ripple}
            onChange={(event) => setRipple(event.target.checked)}
          />
          <span>连锁移动</span>
        </label>
      </header>
      <div className="galgame-timeline-calibration">
        <button
          type="button"
          disabled={!selectedBlockId || !ready}
          onClick={() => void auditionSelected()}
        >
          <Play aria-hidden /> 预听所选（提前 300ms）
        </button>
        <label>
          <input
            type="checkbox"
            checked={loop}
            onChange={(event) => setLoop(event.target.checked)}
          />
          <Repeat2 aria-hidden /> 循环所选
        </label>
        <button
          type="button"
          disabled={!selectedBlockId}
          onClick={() => setSelectedEdgeAtPlayhead("start")}
        >
          播放头设为开始
        </button>
        <button
          type="button"
          disabled={!selectedBlockId}
          onClick={() => setSelectedEdgeAtPlayhead("end")}
        >
          播放头设为结束
        </button>
      </div>
      {error ? <small className="galgame-timeline-error">{error}</small> : null}
      <div ref={scrollRef} className="galgame-timeline-scroll">
        <div
          ref={trackRef}
          className="galgame-timeline-track"
          style={{ width: `${trackWidth}px` }}
          onPointerDown={(event) => {
            if (event.target !== event.currentTarget) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            seek(((event.clientX - bounds.left) / bounds.width) * durationMs);
          }}
        >
          <div className="galgame-timeline-ruler" aria-hidden>
            {ticks.map((tick) => (
              <i
                key={tick}
                className={tick % 60_000 === 0 ? "major" : ""}
                style={{ left: `${(tick / Math.max(1, durationMs)) * 100}%` }}
              >
                <span>{formatTimecode(tick).slice(0, 5)}</span>
              </i>
            ))}
          </div>
          <div className="galgame-timeline-gaps">
            {gaps.map((gap) => {
              const left = (gap.startMs / Math.max(1, durationMs)) * 100;
              const width =
                ((gap.endMs - gap.startMs) / Math.max(1, durationMs)) * 100;
              return (
                <div
                  key={gap.id}
                  role="button"
                  tabIndex={0}
                  className={`galgame-timeline-gap${gap.id === selectedGapId ? " selected" : ""}`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  aria-label={`无对白 ${formatTimecode(gap.startMs)} 到 ${formatTimecode(gap.endMs)}`}
                  title={`无对白 · ${formatTimecode(gap.startMs)}–${formatTimecode(gap.endMs)}`}
                  onClick={() => {
                    onSelectGap(gap.id);
                    seek(gap.startMs);
                  }}
                >
                  <strong>无对白</strong>
                  <span>{formatTimecode(gap.endMs - gap.startMs)}</span>
                  {gap.previousCueId ? (
                    <i
                      role="separator"
                      tabIndex={0}
                      className="start"
                      aria-label="调整无对白开始时间"
                      onPointerDown={(event) =>
                        startDrag(event, "gap-start", gap.id)
                      }
                      onKeyDown={(event) =>
                        moveGapEdgeWithKeyboard(event, gap.id, "start")
                      }
                    />
                  ) : null}
                  {gap.nextCueId ? (
                    <i
                      role="separator"
                      tabIndex={0}
                      className="end"
                      aria-label="调整无对白结束时间"
                      onPointerDown={(event) =>
                        startDrag(event, "gap-end", gap.id)
                      }
                      onKeyDown={(event) =>
                        moveGapEdgeWithKeyboard(event, gap.id, "end")
                      }
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="galgame-timeline-cues">
            {cues.map((cue, index) => {
              const characterId =
                cue.block.type === "dialogue"
                  ? cue.block.characterId
                  : "narration";
              const character = characters.get(characterId);
              const cueMarkers = markers.get(cue.block.id) ?? [];
              const left = (cue.startMs / Math.max(1, durationMs)) * 100;
              const width =
                ((cue.endMs - cue.startMs) / Math.max(1, durationMs)) * 100;
              const selected = cue.block.id === selectedBlockId;
              const active = cue.block.id === activeCue?.block.id;
              return (
                <div
                  key={cue.block.id}
                  role="button"
                  tabIndex={0}
                  className={`galgame-timeline-cue${selected ? " selected" : ""}${active ? " active" : ""}`}
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    backgroundColor: characterColor(characterId),
                  }}
                  aria-label={`${character?.name ?? "旁白"} ${formatTimecode(cue.startMs)} 到 ${formatTimecode(cue.endMs)}`}
                  title={`${character?.name ?? "旁白"} · ${cue.block.text}\n${formatTimecode(cue.startMs)}–${formatTimecode(cue.endMs)}`}
                  onClick={() => {
                    onSelectBlock(cue.block.id);
                    seek(cue.startMs);
                  }}
                  onPointerDown={(event) =>
                    startDrag(event, "cue", cue.block.id)
                  }
                  onKeyDown={(event) => moveWithKeyboard(event, cue.block.id)}
                >
                  {index === 0 ? (
                    <i
                      role="separator"
                      tabIndex={0}
                      className="start"
                      aria-label={`调整${character?.name ?? "旁白"}的开始时间`}
                      onPointerDown={(event) =>
                        startDrag(event, "cue-start", cue.block.id)
                      }
                      onKeyDown={(event) =>
                        moveCueEdgeWithKeyboard(event, cue.block.id, "start")
                      }
                    />
                  ) : null}
                  {cueMarkers.length ? (
                    <span className="galgame-timeline-markers">
                      {cueMarkers.some((block) => block.type === "scene") ? (
                        <MapPinned aria-hidden />
                      ) : (
                        <Users aria-hidden />
                      )}
                      {cueMarkers.length}
                    </span>
                  ) : null}
                  <strong>{character?.name ?? "旁白"}</strong>
                  <span>{cue.block.text}</span>
                  {index < cues.length - 1 ? (
                    <i
                      role="separator"
                      tabIndex={0}
                      aria-label={`调整${character?.name ?? "旁白"}后的对白分界`}
                      onPointerDown={(event) =>
                        startDrag(event, "boundary", cue.block.id)
                      }
                      onKeyDown={(event) => {
                        if (
                          event.key !== "ArrowLeft" &&
                          event.key !== "ArrowRight"
                        )
                          return;
                        event.preventDefault();
                        event.stopPropagation();
                        const step = event.shiftKey ? 1000 : 100;
                        onFragment(
                          resizeTimelineBoundary(
                            fragment,
                            cue.block.id,
                            cue.endMs +
                              (event.key === "ArrowRight" ? step : -step),
                            true,
                          ),
                        );
                      }}
                    />
                  ) : (
                    <i
                      role="separator"
                      tabIndex={0}
                      className="end"
                      aria-label={`调整${character?.name ?? "旁白"}的结束时间`}
                      onPointerDown={(event) =>
                        startDrag(event, "cue-end", cue.block.id)
                      }
                      onKeyDown={(event) =>
                        moveCueEdgeWithKeyboard(event, cue.block.id, "end")
                      }
                    />
                  )}
                </div>
              );
            })}
          </div>
          <div
            className="galgame-timeline-playhead"
            style={{ left: `${(positionMs / Math.max(1, durationMs)) * 100}%` }}
            aria-hidden
          />
        </div>
      </div>
      <footer>
        <span>{cues.length} 句对白</span>
        <span>拖动分界调整切点 · Alt 精确到 1ms · Shift+方向键 1s</span>
      </footer>
    </section>
  );
}
