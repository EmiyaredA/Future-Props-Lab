import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { fetchApiBlob } from "@platform/api/client";
import {
  activeTimelineCue,
  effectivePointTime,
  formatTimecode,
  moveTimelineCgRange,
  moveTimelineCue,
  parseTimecode,
  resizeTimelineCueEnd,
  setTimelineCgRangeEdge,
  setTimelineCueEdge,
  setTimelineDuration,
  setTimelineGapEdge,
  setTimelinePointTime,
  timelineAudioPlaybackStateAt,
  timelineCgRanges,
  timelineCues,
  timelineGaps,
} from "@features/galgame-workshop/editor/timeline";
import { TimelineClock } from "@features/galgame-workshop/editor/timelineClock";
import { storyTimelineEditorModel } from "@features/galgame-workshop/editor/storyTimelineEditorModel";
import type { TimelineDragState as DragState } from "@features/galgame-workshop/editor/timelineDragState";
import type { StoryTimelineEditorProps } from "@features/galgame-workshop/editor/storyTimelineEditorProps";
import {
  fittedTimelineZoom,
  timelineTrackGeometry,
} from "@features/galgame-workshop/editor/timeline/timelineTrackGeometry";

const TIMELINE_LABEL_WIDTH = 168;
const PREVIEW_SYNC_INTERVAL_MS = 100;

export function useStoryTimelineController({
  document,
  fragment,
  selectedBlockId,
  selectedGapId,
  onSelectBlock,
  onSelectGap,
  onFragment,
  onPreviewPosition,
  preferences,
  onPreferencesChange,
  onRequestAddMenu,
  addControl,
  readOnly = false,
  followPositionMs,
  estimated = false,
}: StoryTimelineEditorProps) {
  const { zoom, ripple, loop, characterTracksExpanded } = preferences;
  const [positionMs, setPositionMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(true);
  const [durationInput, setDurationInput] = useState("");
  const [durationHint, setDurationHint] = useState("");
  const [error, setError] = useState("");
  const [hiddenCharacterTrackIds, setHiddenCharacterTrackIds] = useState<
    Set<string>
  >(() => new Set());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const clockRef = useRef<TimelineClock | null>(null);
  const syncBgmRef = useRef<
    (milliseconds: number, shouldPlay: boolean) => Promise<void>
  >(async () => undefined);
  const fragmentRef = useRef(fragment);
  fragmentRef.current = fragment;
  const scrollRef = useRef<HTMLDivElement>(null);
  const rulerScrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const auditionRef = useRef<
    { startMs: number; endMs: number; loop: boolean } | undefined
  >(undefined);
  const {
    attachedCharacterEvents,
    bgmAssets,
    cgs,
    cgRanges,
    characterTrackIds,
    characters,
    cues,
    durationMs,
    gaps,
    markers,
    pointEvents,
    stateSegments,
  } = useMemo(
    () => storyTimelineEditorModel(document, fragment),
    [document, fragment],
  );
  const displayPositionMs =
    readOnly && followPositionMs != null
      ? Math.max(0, Math.min(durationMs, followPositionMs))
      : positionMs;
  const durationRef = useRef(durationMs);
  durationRef.current = durationMs;
  const onPreviewPositionRef = useRef(onPreviewPosition);
  onPreviewPositionRef.current = onPreviewPosition;
  const lastPreviewSyncRef = useRef(Number.NEGATIVE_INFINITY);
  const activeCue = activeTimelineCue(fragment, displayPositionMs);
  const visibleCharacterTrackIds = useMemo(
    () =>
      characterTrackIds.filter(
        (characterId) => !hiddenCharacterTrackIds.has(characterId),
      ),
    [characterTrackIds, hiddenCharacterTrackIds],
  );
  const setCharacterTrackVisible = (characterId: string, visible: boolean) => {
    setHiddenCharacterTrackIds((current) => {
      const next = new Set(current);
      if (visible) next.delete(characterId);
      else next.add(characterId);
      return next;
    });
  };
  const {
    trackWidth,
    laneHeight,
    lanes,
    laneTop,
    dialogueTop,
    trackHeight,
    tickEveryMs,
    ticks,
  } = useMemo(
    () =>
      timelineTrackGeometry({
        durationMs,
        zoom,
        characterTracksExpanded,
        visibleCharacterTrackIds,
        characters,
      }),
    [
      characterTracksExpanded,
      characters,
      durationMs,
      visibleCharacterTrackIds,
      zoom,
    ],
  );
  useEffect(() => {
    if (readOnly) return;
    let active = true;
    let activeBlockId = "";
    const urls = new Map<string, string>();
    const assetsById = new Map(bgmAssets.map((asset) => [asset.id, asset]));
    const audio = new Audio();
    audio.preload = "metadata";
    audioRef.current = audio;

    const syncBgm = async (milliseconds: number, shouldPlay: boolean) => {
      if (!active) return;
      const state = timelineAudioPlaybackStateAt(
        fragmentRef.current,
        milliseconds,
      ).bgm;
      if (!state) {
        activeBlockId = "";
        audio.pause();
        return;
      }
      const asset = assetsById.get(state.block.assetId ?? "");
      const url = asset ? urls.get(asset.id) : undefined;
      if (!url) {
        audio.pause();
        return;
      }
      if (activeBlockId !== state.block.id) {
        audio.pause();
        activeBlockId = state.block.id;
        audio.src = url;
        audio.loop = state.block.loop;
        audio.volume = state.block.volume / 100;
        audio.load();
      }
      const offsetMs = Math.max(0, milliseconds - state.startedAtMs);
      const apply = async () => {
        if (!active || activeBlockId !== state.block.id) return;
        const mediaDurationMs = Number.isFinite(audio.duration)
          ? Math.max(0, audio.duration * 1000)
          : 0;
        if (mediaDurationMs > 0 && !audio.loop && offsetMs >= mediaDurationMs) {
          try {
            audio.currentTime = audio.duration;
          } catch {
            // The media remains paused even if the browser rejects the seek.
          }
          audio.pause();
          return;
        }
        const targetMs =
          mediaDurationMs > 0 && audio.loop
            ? offsetMs % mediaDurationMs
            : offsetMs;
        try {
          audio.currentTime = targetMs / 1000;
          if (shouldPlay) await audio.play();
          else audio.pause();
          if (active) setError("");
        } catch {
          if (active) setError("BGM 播放被阻止，剧情时间轴将继续静音播放");
        }
      };
      if (offsetMs > 0 && audio.readyState < 1) {
        audio.addEventListener("loadedmetadata", () => void apply(), {
          once: true,
        });
        if (!shouldPlay) audio.pause();
        return;
      }
      await apply();
    };
    syncBgmRef.current = syncBgm;

    const clock = new TimelineClock(durationRef.current, {
      onPosition: (next) => {
        if (!active) return;
        setPositionMs(next);
        const now = performance.now();
        if (
          !clockRef.current?.isPlaying ||
          now - lastPreviewSyncRef.current >= PREVIEW_SYNC_INTERVAL_MS ||
          next >= durationRef.current
        ) {
          lastPreviewSyncRef.current = now;
          onPreviewPositionRef.current(next);
        }
        const audition = auditionRef.current;
        if (!audition || next < audition.endMs) return;
        if (audition.loop) {
          clock.seek(audition.startMs);
          void syncBgm(audition.startMs, true);
        } else {
          auditionRef.current = undefined;
          clock.pause();
        }
      },
      onPlayingChange: (next) => {
        if (!active) return;
        setPlaying(next);
        void syncBgm(clock.position, next);
      },
      onFinish: () => {
        auditionRef.current = undefined;
        audio.pause();
      },
    });
    clockRef.current = clock;
    setReady(false);
    setPlaying(false);
    setPositionMs(0);
    setError("");
    void Promise.all(
      bgmAssets.map(async (asset) => {
        const blob = await fetchApiBlob(`/v1/files/${asset.fileId}/content`);
        if (!active) return;
        urls.set(asset.id, URL.createObjectURL(blob));
      }),
    )
      .catch(() => {
        if (active) setError("BGM 无法读取，剧情时间轴将继续静音播放");
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
      auditionRef.current = undefined;
      syncBgmRef.current = async () => undefined;
      clock.dispose();
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      for (const url of urls.values()) URL.revokeObjectURL(url);
      if (audioRef.current === audio) audioRef.current = null;
      if (clockRef.current === clock) clockRef.current = null;
      onPreviewPositionRef.current(null);
    };
  }, [bgmAssets, fragment.id, readOnly]);

  useEffect(() => {
    clockRef.current?.setDuration(durationMs);
    setDurationInput(formatTimecode(durationMs));
  }, [durationMs]);

  useEffect(() => {
    if (!readOnly) return;
    auditionRef.current = undefined;
    clockRef.current?.pause();
    audioRef.current?.pause();
  }, [readOnly]);

  useEffect(() => {
    if (!playing || !scrollRef.current) return;
    const container = scrollRef.current;
    const x =
      TIMELINE_LABEL_WIDTH +
      (positionMs / Math.max(1, durationMs)) * trackWidth;
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
    const clock = clockRef.current;
    if (!clock) return;
    clock.seek(target);
    if (ready) void syncBgmRef.current(target, clock.isPlaying);
  };

  const seekAtClientX = (clientX: number) => {
    const bounds = trackRef.current?.getBoundingClientRect();
    if (!bounds?.width) return;
    seek(((clientX - bounds.left) / bounds.width) * durationMs);
  };

  const startPlayheadDrag = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || readOnly) return;
    event.preventDefault();
    event.stopPropagation();
    seekAtClientX(event.clientX);
    dragCleanupRef.current?.();
    const move = (pointer: globalThis.PointerEvent) => {
      pointer.preventDefault();
      seekAtClientX(pointer.clientX);
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

  const seekPlayheadWithKeyboard = (event: KeyboardEvent<HTMLElement>) => {
    let target: number | undefined;
    if (event.key === "Home") target = 0;
    else if (event.key === "End") target = durationMs;
    else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const step = event.shiftKey ? 1000 : 100;
      target = positionMs + (event.key === "ArrowRight" ? step : -step);
    }
    if (target == null || readOnly) return;
    event.preventDefault();
    event.stopPropagation();
    seek(target);
  };

  const toggle = async () => {
    const clock = clockRef.current;
    if (!clock || !ready) return;
    if (clock.isPlaying) {
      clock.pause();
      return;
    }
    auditionRef.current = undefined;
    if (clock.position >= durationMs) clock.seek(0);
    await syncBgmRef.current(clock.position, true);
    clock.play();
  };

  const auditionSelected = async () => {
    const cue = cues.find(
      (candidate) => candidate.block.id === selectedBlockId,
    );
    const clock = clockRef.current;
    if (!clock || !ready || !cue) return;
    const startMs = Math.max(0, cue.startMs - 300);
    auditionRef.current = {
      startMs: cue.startMs,
      endMs: cue.endMs,
      loop,
    };
    seek(startMs);
    await syncBgmRef.current(startMs, true);
    clock.play();
  };

  const commitDuration = () => {
    if (readOnly) return;
    const parsed = parseTimecode(durationInput);
    if (parsed == null || parsed < 1) {
      setDurationHint("请输入有效的 mm:ss.mmm 时间码");
      setDurationInput(formatTimecode(durationMs));
      return;
    }
    const updated = setTimelineDuration(fragment, parsed);
    const nextDuration = updated.timeline?.durationMs ?? durationMs;
    setDurationInput(formatTimecode(nextDuration));
    setDurationHint(
      nextDuration > parsed
        ? `已保留到最后一个 Block 的结束时间 ${formatTimecode(nextDuration)}`
        : "",
    );
    onFragment(updated);
  };

  const setSelectedEdgeAtPlayhead = (edge: "start" | "end") => {
    if (!selectedBlockId || readOnly) return;
    onFragment(
      edge === "end"
        ? resizeTimelineCueEnd(fragment, selectedBlockId, positionMs, {
            precise: true,
            ripple,
            keepContinuous: false,
          })
        : setTimelineCueEdge(
            fragment,
            selectedBlockId,
            edge,
            positionMs,
            false,
          ),
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
    if (event.button !== 0 || readOnly) return;
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
      if (drag.kind === "point") {
        const sourceIndex = drag.source.blocks?.findIndex(
          (block) => block.id === drag.itemId,
        );
        if (sourceIndex == null || sourceIndex < 0) return;
        const sourceTime = effectivePointTime(drag.source, sourceIndex);
        if (sourceTime == null) return;
        onFragment(
          setTimelinePointTime(
            drag.source,
            drag.itemId,
            sourceTime + deltaMs,
            pointer.altKey,
          ),
        );
      } else if (drag.kind === "cg-range") {
        onFragment(
          moveTimelineCgRange(
            drag.source,
            drag.itemId,
            deltaMs,
            pointer.altKey,
          ),
        );
      } else if (drag.kind === "cg-start" || drag.kind === "cg-end") {
        const sourceRange = timelineCgRanges(drag.source).find(
          (range) => range.showBlock.id === drag.itemId,
        );
        if (!sourceRange) return;
        const edge = drag.kind === "cg-start" ? "start" : "end";
        onFragment(
          setTimelineCgRangeEdge(
            drag.source,
            drag.itemId,
            edge,
            sourceRange[edge === "start" ? "startMs" : "endMs"] + deltaMs,
            pointer.altKey,
          ),
        );
      } else if (drag.kind === "boundary") {
        const sourceCue = timelineCues(drag.source).find(
          (cue) => cue.block.id === drag.itemId,
        );
        if (!sourceCue) return;
        onFragment(
          resizeTimelineCueEnd(
            drag.source,
            drag.itemId,
            sourceCue.endMs + deltaMs,
            {
              precise: pointer.altKey,
              ripple,
              keepContinuous: true,
            },
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
          edge === "end"
            ? resizeTimelineCueEnd(
                drag.source,
                drag.itemId,
                sourceCue.endMs + deltaMs,
                {
                  precise: pointer.altKey,
                  ripple,
                  keepContinuous: false,
                },
              )
            : setTimelineCueEdge(
                drag.source,
                drag.itemId,
                edge,
                sourceCue.startMs + deltaMs,
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
    if (readOnly || (event.key !== "ArrowLeft" && event.key !== "ArrowRight"))
      return;
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
    if (readOnly || (event.key !== "ArrowLeft" && event.key !== "ArrowRight"))
      return;
    event.preventDefault();
    event.stopPropagation();
    const cue = cues.find((candidate) => candidate.block.id === cueId);
    if (!cue) return;
    const step = event.shiftKey ? 1000 : 100;
    const requested =
      cue[edge === "start" ? "startMs" : "endMs"] +
      (event.key === "ArrowRight" ? step : -step);
    onFragment(
      edge === "end"
        ? resizeTimelineCueEnd(fragment, cueId, requested, {
            precise: true,
            ripple,
            keepContinuous: false,
          })
        : setTimelineCueEdge(fragment, cueId, edge, requested, false, true),
    );
  };

  const moveGapEdgeWithKeyboard = (
    event: KeyboardEvent<HTMLElement>,
    gapId: string,
    edge: "start" | "end",
  ) => {
    if (readOnly || (event.key !== "ArrowLeft" && event.key !== "ArrowRight"))
      return;
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

  const moveCgRangeWithKeyboard = (
    event: KeyboardEvent<HTMLElement>,
    showBlockId: string,
    edge?: "start" | "end",
  ) => {
    if (readOnly || (event.key !== "ArrowLeft" && event.key !== "ArrowRight"))
      return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 1000 : 100;
    const deltaMs = event.key === "ArrowRight" ? step : -step;
    if (!edge) {
      onFragment(moveTimelineCgRange(fragment, showBlockId, deltaMs, true));
      return;
    }
    const range = cgRanges.find(
      (candidate) => candidate.showBlock.id === showBlockId,
    );
    if (!range) return;
    onFragment(
      setTimelineCgRangeEdge(
        fragment,
        showBlockId,
        edge,
        range[edge === "start" ? "startMs" : "endMs"] + deltaMs,
        true,
      ),
    );
  };

  const selectBlock = (blockId: string) => onSelectBlock(blockId);
  const fitTimelineWidth = () => {
    const container = scrollRef.current;
    if (!container || durationMs <= 0) return;
    onPreferencesChange({
      ...preferences,
      zoom: fittedTimelineZoom(container, durationMs, TIMELINE_LABEL_WIDTH),
    });
  };

  return {
    document,
    fragment,
    selectedBlockId,
    selectedGapId,
    onSelectBlock,
    onSelectGap,
    onFragment,
    onPreviewPosition,
    preferences,
    onPreferencesChange,
    onRequestAddMenu,
    addControl,
    readOnly,
    followPositionMs,
    estimated,
    zoom,
    ripple,
    loop,
    characterTracksExpanded,
    positionMs,
    setPositionMs,
    playing,
    setPlaying,
    ready,
    setReady,
    durationInput,
    setDurationInput,
    durationHint,
    setDurationHint,
    error,
    setError,
    hiddenCharacterTrackIds,
    setHiddenCharacterTrackIds,
    audioRef,
    scrollRef,
    rulerScrollRef,
    trackRef,
    attachedCharacterEvents,
    bgmAssets,
    cgs,
    cgRanges,
    characterTrackIds,
    characters,
    cues,
    durationMs,
    gaps,
    markers,
    pointEvents,
    stateSegments,
    displayPositionMs,
    trackWidth,
    activeCue,
    visibleCharacterTrackIds,
    setCharacterTrackVisible,
    laneHeight,
    lanes,
    laneTop,
    dialogueTop,
    trackHeight,
    seek,
    seekAtClientX,
    startPlayheadDrag,
    seekPlayheadWithKeyboard,
    toggle,
    auditionSelected,
    commitDuration,
    setSelectedEdgeAtPlayhead,
    skip,
    startDrag,
    moveWithKeyboard,
    moveCueEdgeWithKeyboard,
    moveGapEdgeWithKeyboard,
    moveCgRangeWithKeyboard,
    tickEveryMs,
    ticks,
    selectBlock,
    fitTimelineWidth,
  };
}
