import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  MapPinned,
  Music2,
  Pause,
  Play,
  Repeat2,
  SkipBack,
  SkipForward,
  UserRound,
  Users,
  Volume2,
  Waves,
} from "lucide-react";
import { fetchApiBlob } from "@platform/api/client";
import type {
  GalgameStoryFragment,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import {
  activeTimelineCue,
  effectivePointTime,
  formatTimecode,
  moveTimelineCue,
  parseTimecode,
  resizeTimelineCueEnd,
  setTimelineCueEdge,
  setTimelineDuration,
  setTimelineGapEdge,
  setTimelinePointTime,
  timelineCues,
  timelineBeats,
  timelineBeatRange,
  timelineEvents,
  timelineGaps,
  timelineStageMarkers,
} from "@features/galgame-workshop/editor/timeline";
import {
  createAudioLevelMonitor,
  type AudioLevelMonitor,
} from "@features/galgame-workshop/editor/lipSync";
import { dialogueSpeakerIds } from "@features/galgame-workshop/editor/dialogue";
import {
  MAX_TIMELINE_ZOOM,
  MIN_TIMELINE_ZOOM,
  type TimelinePreferences,
} from "@features/galgame-workshop/editor/timelinePreferences";
import { TimelineClock } from "@features/galgame-workshop/editor/timelineClock";

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
  kind:
    | "cue"
    | "point"
    | "boundary"
    | "cue-start"
    | "cue-end"
    | "gap-start"
    | "gap-end";
  itemId: string;
  startX: number;
  source: GalgameStoryFragment;
};

export type TimelineBeatSelection = {
  anchorIndex: number;
  startIndex: number;
  endIndex: number;
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
  preferences,
  onPreferencesChange,
  beatSelection,
  onBeatSelection,
  readOnly = false,
  followPositionMs,
  followBlockId,
  estimated = false,
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
  preferences: TimelinePreferences;
  onPreferencesChange: (preferences: TimelinePreferences) => void;
  beatSelection?: TimelineBeatSelection;
  onBeatSelection: (selection: TimelineBeatSelection) => void;
  readOnly?: boolean;
  followPositionMs?: number | null;
  followBlockId?: string;
  estimated?: boolean;
}) {
  const { zoom, ripple, loop } = preferences;
  const [positionMs, setPositionMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [audioDurationMs, setAudioDurationMs] = useState<number | null>(null);
  const [durationInput, setDurationInput] = useState("");
  const [durationHint, setDurationHint] = useState("");
  const [error, setError] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioDurationRef = useRef(0);
  const clockRef = useRef<TimelineClock | null>(null);
  const levelMonitorRef = useRef<AudioLevelMonitor | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const beatDragAnchorRef = useRef<number | null>(null);
  const auditionRef = useRef<
    { startMs: number; endMs: number; loop: boolean } | undefined
  >(undefined);
  const cues = timelineCues(fragment);
  const beats = timelineBeats(fragment);
  const gaps = timelineGaps(fragment);
  const markers = timelineStageMarkers(fragment);
  const events = timelineEvents(fragment);
  const pointEvents = events.filter(
    (event) =>
      event.block.type === "scene" ||
      event.block.type === "showCharacter" ||
      event.block.type === "removeCharacter" ||
      event.block.type === "audio",
  );
  const durationMs = fragment.timeline?.durationMs ?? 0;
  const durationRef = useRef(durationMs);
  durationRef.current = durationMs;
  const onPreviewPositionRef = useRef(onPreviewPosition);
  onPreviewPositionRef.current = onPreviewPosition;
  const onPlayingChangeRef = useRef(onPlayingChange);
  onPlayingChangeRef.current = onPlayingChange;
  const onAudioLevelRef = useRef(onAudioLevel);
  onAudioLevelRef.current = onAudioLevel;
  const trackWidth = Math.max(640, (durationMs / 60_000) * zoom);
  const activeCue = activeTimelineCue(fragment, positionMs);
  const timelineAsset = (document.assets ?? []).find(
    (asset) => asset.id === fragment.timeline?.assetId,
  );
  const characters = new Map(
    (document.characters ?? []).map((character) => [character.id, character]),
  );
  const characterTrackIds = Array.from(
    new Set(
      pointEvents.flatMap((event) =>
        (event.block.type === "showCharacter" ||
          event.block.type === "removeCharacter") &&
        event.block.characterId
          ? [event.block.characterId]
          : [],
      ),
    ),
  );
  const laneHeight = 44;
  const lanes = [
    { id: "reference", label: "参考声轨" },
    { id: "scene", label: "场景" },
    ...characterTrackIds.map((characterId) => ({
      id: `character:${characterId}`,
      label: characters.get(characterId)?.name ?? "未知角色",
    })),
    { id: "dialogue", label: "对白 / 配音" },
    { id: "bgm", label: "BGM" },
    { id: "ambient", label: "环境音" },
    { id: "sfx", label: "音效" },
    { id: "structure", label: "分支 / 结局" },
  ];
  const beatBandHeight = 54;
  const laneTop = (laneId: string) =>
    42 +
    beatBandHeight +
    Math.max(
      0,
      lanes.findIndex((lane) => lane.id === laneId),
    ) *
      laneHeight;
  const dialogueTop = laneTop("dialogue");
  const trackHeight = 42 + beatBandHeight + lanes.length * laneHeight;
  const stateSegments = pointEvents.flatMap((event, eventIndex) => {
    const block = event.block;
    const laneId =
      block.type === "scene"
        ? "scene"
        : block.type === "showCharacter"
          ? `character:${block.characterId}`
          : block.type === "audio" &&
              block.action === "play" &&
              (block.channel === "bgm" || block.channel === "ambient")
            ? block.channel
            : undefined;
    if (!laneId) return [];
    const next = pointEvents.slice(eventIndex + 1).find((candidate) => {
      if (candidate.timeMs <= event.timeMs) return false;
      if (block.type === "scene") return candidate.block.type === "scene";
      if (block.type === "showCharacter")
        return (
          (candidate.block.type === "scene" &&
            candidate.block.clearCharacters !== false) ||
          ((candidate.block.type === "showCharacter" ||
            candidate.block.type === "removeCharacter") &&
            (candidate.block.type !== "removeCharacter" ||
              candidate.block.all ||
              candidate.block.characterId === block.characterId) &&
            (candidate.block.type !== "showCharacter" ||
              candidate.block.characterId === block.characterId))
        );
      if (block.type !== "audio") return false;
      return (
        candidate.block.type === "audio" &&
        candidate.block.channel === block.channel
      );
    });
    const asset =
      block.type === "audio"
        ? (document.assets ?? []).find((item) => item.id === block.assetId)
        : undefined;
    const label =
      block.type === "scene"
        ? ((document.scenes ?? []).find((scene) => scene.id === block.sceneId)
            ?.name ?? "场景")
        : block.type === "showCharacter"
          ? (characters.get(block.characterId)?.name ?? "角色")
          : asset?.type === "audio"
            ? asset.label
            : "声音";
    return [
      {
        id: `state:${block.id}`,
        laneId,
        label,
        startMs: event.timeMs,
        endMs: next?.timeMs ?? durationMs,
      },
    ];
  });

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    const audio = new Audio();
    audio.preload = "metadata";
    audioRef.current = audio;
    const syncAudio = (milliseconds: number, shouldPlay: boolean) => {
      const withinAudio = milliseconds < audioDurationRef.current;
      if (!withinAudio) {
        audio.pause();
        onAudioLevelRef.current?.(null);
        return;
      }
      audio.currentTime = milliseconds / 1000;
      if (shouldPlay)
        void audio.play().catch(() => {
          if (active) setError("声轨播放被阻止，剧情时间轴将继续静音播放");
        });
    };
    const clock = new TimelineClock(durationRef.current, {
      onPosition: (next) => {
        if (!active) return;
        setPositionMs(next);
        onPreviewPositionRef.current(next);
        const audition = auditionRef.current;
        if (!audition || next < audition.endMs) return;
        if (audition.loop) {
          clock.seek(audition.startMs);
          syncAudio(audition.startMs, true);
        } else {
          auditionRef.current = undefined;
          clock.pause();
          audio.pause();
          onAudioLevelRef.current?.(null);
        }
      },
      onPlayingChange: (next) => {
        if (!active) return;
        setPlaying(next);
        onPlayingChangeRef.current?.(next);
      },
      onFinish: () => {
        auditionRef.current = undefined;
        audio.pause();
        onAudioLevelRef.current?.(null);
      },
    });
    clockRef.current = clock;
    const loaded = () => {
      if (!active) return;
      const mediaDuration = Number.isFinite(audio.duration)
        ? Math.max(0, Math.round(audio.duration * 1000))
        : 0;
      audioDurationRef.current = mediaDuration;
      setAudioDurationMs(mediaDuration);
      setReady(true);
    };
    const ended = () => {
      if (!active) return;
      onAudioLevelRef.current?.(null);
    };
    const failed = () => active && setError("剧情时间轴音频无法读取");
    audio.addEventListener("loadedmetadata", loaded);
    audio.addEventListener("ended", ended);
    audio.addEventListener("error", failed);
    setReady(false);
    setPlaying(false);
    setPositionMs(0);
    setAudioDurationMs(null);
    audioDurationRef.current = 0;
    setError("");
    levelMonitorRef.current = createAudioLevelMonitor(audio, (decibels) => {
      if (active) onAudioLevelRef.current?.(decibels);
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
    else {
      setReady(true);
      setAudioDurationMs(0);
    }
    return () => {
      active = false;
      auditionRef.current = undefined;
      clock.dispose();
      levelMonitorRef.current?.dispose();
      levelMonitorRef.current = undefined;
      audio.pause();
      audio.removeEventListener("loadedmetadata", loaded);
      audio.removeEventListener("ended", ended);
      audio.removeEventListener("error", failed);
      audio.removeAttribute("src");
      audio.load();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (audioRef.current === audio) audioRef.current = null;
      if (clockRef.current === clock) clockRef.current = null;
      onAudioLevelRef.current?.(null);
      onPlayingChangeRef.current?.(false);
      onPreviewPositionRef.current(null);
    };
  }, [timelineAsset?.fileId, timelineAsset?.type]);

  useEffect(() => {
    clockRef.current?.setDuration(durationMs);
    setDurationInput(formatTimecode(durationMs));
  }, [durationMs]);

  useEffect(() => {
    if (!readOnly || followPositionMs == null) return;
    const target = Math.max(0, Math.min(durationMs, followPositionMs));
    clockRef.current?.seek(target);
    setPositionMs(target);
  }, [durationMs, followPositionMs, readOnly]);

  useEffect(() => {
    if (!readOnly) return;
    const followedIndex = followBlockId
      ? beats.findIndex(
          (beat) =>
            beat.content?.id === followBlockId ||
            beat.events.some((event) => event.block.id === followBlockId),
        )
      : beats.findIndex(
          (beat, index) =>
            beat.startMs <= (followPositionMs ?? 0) &&
            (beats[index + 1]?.startMs ?? durationMs + 1) >
              (followPositionMs ?? 0),
        );
    if (followedIndex < 0) return;
    if (
      beatSelection?.startIndex === followedIndex &&
      beatSelection.endIndex === followedIndex
    )
      return;
    onBeatSelection({
      anchorIndex: followedIndex,
      startIndex: followedIndex,
      endIndex: followedIndex,
    });
  }, [
    beatSelection?.endIndex,
    beatSelection?.startIndex,
    beats,
    durationMs,
    followBlockId,
    followPositionMs,
    onBeatSelection,
    readOnly,
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
    const clock = clockRef.current;
    if (!clock) return;
    clock.seek(target);
    if (!audio || !ready) return;
    if (target < audioDurationRef.current) {
      audio.currentTime = target / 1000;
      if (clock.isPlaying)
        void audio.play().catch(() => {
          setError("声轨播放被阻止，剧情时间轴将继续静音播放");
        });
    } else {
      audio.pause();
      onAudioLevelRef.current?.(null);
    }
  };

  const toggle = async () => {
    const audio = audioRef.current;
    const clock = clockRef.current;
    if (!audio || !clock || !ready) return;
    if (clock.isPlaying) {
      clock.pause();
      audio.pause();
      onAudioLevelRef.current?.(null);
      return;
    }
    auditionRef.current = undefined;
    if (clock.position >= durationMs) clock.seek(0);
    try {
      await levelMonitorRef.current?.resume();
      if (clock.position < audioDurationRef.current) {
        audio.currentTime = clock.position / 1000;
        await audio.play();
      }
      setError("");
    } catch {
      setError("声轨播放被阻止，剧情时间轴将继续静音播放");
    }
    clock.play();
  };

  const auditionSelected = async () => {
    const audio = audioRef.current;
    const cue = cues.find(
      (candidate) => candidate.block.id === selectedBlockId,
    );
    const clock = clockRef.current;
    if (!audio || !clock || !ready || !cue) return;
    const startMs = Math.max(0, cue.startMs - 300);
    auditionRef.current = {
      startMs: cue.startMs,
      endMs: cue.endMs,
      loop,
    };
    seek(startMs);
    try {
      await levelMonitorRef.current?.resume();
      if (startMs < audioDurationRef.current) await audio.play();
      setError("");
    } catch {
      setError("声轨播放被阻止，所选区间将继续静音预览");
    }
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

  const tickEveryMs = zoom >= 600 ? 5000 : zoom >= 240 ? 10_000 : 30_000;
  const ticks = Array.from(
    { length: Math.floor(durationMs / tickEveryMs) + 1 },
    (_, index) => index * tickEveryMs,
  );
  const selectedRange = beatSelection
    ? timelineBeatRange(
        fragment,
        beatSelection.startIndex,
        beatSelection.endIndex,
      )
    : undefined;
  const selectBeat = (index: number, extend = false) => {
    const anchorIndex = extend
      ? (beatSelection?.anchorIndex ?? beatSelection?.startIndex ?? index)
      : index;
    onBeatSelection({
      anchorIndex,
      startIndex: Math.min(anchorIndex, index),
      endIndex: Math.max(anchorIndex, index),
    });
  };
  const selectBlock = (blockId: string) => {
    const beatIndex = beats.findIndex(
      (beat) =>
        beat.content?.id === blockId ||
        beat.events.some((event) => event.block.id === blockId),
    );
    if (beatIndex >= 0) selectBeat(beatIndex);
    onSelectBlock(blockId);
  };

  return (
    <section
      className={`galgame-timeline-editor${readOnly ? " is-readonly" : ""}`}
      aria-label={readOnly ? "试玩剧情时间轴" : "Beat 多轨剧情时间轴"}
      tabIndex={0}
      onKeyDown={(event) => {
        if (
          !(event.metaKey || event.ctrlKey) ||
          event.key.toLowerCase() !== "a"
        )
          return;
        if (
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLTextAreaElement
        )
          return;
        event.preventDefault();
        if (beats.length)
          onBeatSelection({
            anchorIndex: 0,
            startIndex: 0,
            endIndex: beats.length - 1,
          });
      }}
    >
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
          {estimated ? <em>估算时间 · 编辑后保存</em> : null}
        </div>
        <div className="galgame-timeline-lengths">
          <span>
            声轨长度
            <strong>
              {audioDurationMs == null
                ? "读取中"
                : formatTimecode(audioDurationMs)}
            </strong>
          </span>
          <label>
            <span>剧情长度</span>
            <input
              type="text"
              inputMode="decimal"
              aria-label="剧情时间轴总长"
              value={durationInput}
              disabled={readOnly}
              onChange={(event) => {
                setDurationInput(event.target.value);
                setDurationHint("");
              }}
              onBlur={commitDuration}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                commitDuration();
                event.currentTarget.blur();
              }}
            />
          </label>
        </div>
        <label>
          <span>缩放</span>
          <input
            type="range"
            min={MIN_TIMELINE_ZOOM}
            max={MAX_TIMELINE_ZOOM}
            step="60"
            value={zoom}
            aria-label="时间轴缩放"
            onChange={(event) =>
              onPreferencesChange({
                ...preferences,
                zoom: Number(event.target.value),
              })
            }
          />
        </label>
        <label
          className="galgame-timeline-ripple"
          title="移动对白或拉伸右边界时，同步推移后续对白"
        >
          <input
            type="checkbox"
            checked={ripple}
            disabled={readOnly}
            onChange={(event) =>
              onPreferencesChange({
                ...preferences,
                ripple: event.target.checked,
              })
            }
          />
          <span>波纹编辑</span>
        </label>
        <button
          type="button"
          className="galgame-timeline-select-all"
          disabled={!beats.length}
          onClick={() =>
            onBeatSelection({
              anchorIndex: 0,
              startIndex: 0,
              endIndex: Math.max(0, beats.length - 1),
            })
          }
        >
          选择全部
        </button>
      </header>
      {durationHint ? (
        <small className="galgame-timeline-hint" role="status">
          {durationHint}
        </small>
      ) : null}
      <div className="galgame-timeline-calibration">
        <button
          type="button"
          disabled={readOnly || !selectedBlockId || !ready}
          onClick={() => void auditionSelected()}
        >
          <Play aria-hidden /> 预听所选（提前 300ms）
        </button>
        <label>
          <input
            type="checkbox"
            checked={loop}
            disabled={readOnly}
            onChange={(event) =>
              onPreferencesChange({
                ...preferences,
                loop: event.target.checked,
              })
            }
          />
          <Repeat2 aria-hidden /> 循环所选
        </label>
        <button
          type="button"
          disabled={readOnly || !selectedBlockId}
          onClick={() => setSelectedEdgeAtPlayhead("start")}
        >
          播放头设为开始
        </button>
        <button
          type="button"
          disabled={readOnly || !selectedBlockId}
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
          style={{ width: `${trackWidth}px`, height: `${trackHeight}px` }}
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
          {selectedRange ? (
            <div
              className="galgame-timeline-selection-range"
              style={{
                left: `${(selectedRange.startMs / Math.max(1, durationMs)) * 100}%`,
                width: `${Math.max(
                  0,
                  (selectedRange.durationMs / Math.max(1, durationMs)) * 100,
                )}%`,
                top: `${42 + beatBandHeight}px`,
                height: `${trackHeight - 42 - beatBandHeight}px`,
              }}
              aria-hidden
            />
          ) : null}
          <div
            className="galgame-timeline-beat-band"
            style={{ top: "42px", height: `${beatBandHeight}px` }}
            aria-label="Beat 选择带"
            onPointerLeave={() => undefined}
          >
            {beats.map((beat, index) => {
              const nextStart = beats[index + 1]?.startMs ?? durationMs;
              const widthPx = Math.max(
                30,
                ((Math.max(beat.endMs, nextStart) - beat.startMs) /
                  Math.max(1, durationMs)) *
                  trackWidth,
              );
              const selected = Boolean(
                beatSelection &&
                index >= beatSelection.startIndex &&
                index <= beatSelection.endIndex,
              );
              const structural = beat.events.some(
                (event) =>
                  event.block.type === "branch" ||
                  event.block.type === "endChapter",
              );
              return (
                <button
                  key={beat.id}
                  type="button"
                  className={`${selected ? "selected" : ""}${structural ? " structural" : ""}`}
                  style={{
                    left: `${(beat.startMs / Math.max(1, durationMs)) * trackWidth}px`,
                    width: `${widthPx}px`,
                  }}
                  aria-pressed={selected}
                  aria-label={`Beat ${index + 1}，${formatTimecode(beat.startMs)}`}
                  onClick={(event) => {
                    selectBeat(index, event.shiftKey);
                    seek(beat.startMs);
                  }}
                  onPointerDown={(event) => {
                    if (event.button !== 0 || event.shiftKey) return;
                    beatDragAnchorRef.current = index;
                    selectBeat(index);
                    const finish = () => {
                      beatDragAnchorRef.current = null;
                      window.removeEventListener("pointerup", finish);
                      window.removeEventListener("pointercancel", finish);
                    };
                    window.addEventListener("pointerup", finish);
                    window.addEventListener("pointercancel", finish);
                  }}
                  onPointerEnter={() => {
                    const anchorIndex = beatDragAnchorRef.current;
                    if (anchorIndex == null) return;
                    onBeatSelection({
                      anchorIndex,
                      startIndex: Math.min(anchorIndex, index),
                      endIndex: Math.max(anchorIndex, index),
                    });
                  }}
                >
                  <strong>Beat {index + 1}</strong>
                  <span>{formatTimecode(beat.startMs)}</span>
                </button>
              );
            })}
          </div>
          <div className="galgame-timeline-lanes" aria-hidden>
            {lanes.map((lane) => (
              <div
                key={lane.id}
                className="galgame-timeline-lane"
                style={{
                  top: `${laneTop(lane.id)}px`,
                  height: `${laneHeight}px`,
                }}
              >
                <span>{lane.label}</span>
              </div>
            ))}
          </div>
          {fragment.timeline?.assetId ? (
            <button
              type="button"
              className="galgame-timeline-reference"
              style={{
                top: `${laneTop("reference") + 7}px`,
                width: "100%",
              }}
              onClick={() => seek(0)}
              title="参考声轨只用于校准和试听，不进入正式多轨混音"
            >
              <Waves aria-hidden />
              {timelineAsset?.type === "audio"
                ? timelineAsset.label
                : "参考声轨缺失"}
            </button>
          ) : null}
          {stateSegments.map((segment) => (
            <div
              key={segment.id}
              className="galgame-timeline-state-segment"
              style={{
                left: `${(segment.startMs / Math.max(1, durationMs)) * 100}%`,
                top: `${laneTop(segment.laneId) + 10}px`,
                width: `${
                  ((segment.endMs - segment.startMs) /
                    Math.max(1, durationMs)) *
                  100
                }%`,
              }}
              title={`${segment.label} · 持续到 ${formatTimecode(segment.endMs)}`}
              aria-hidden
            >
              {segment.label}
            </div>
          ))}
          {pointEvents.map((event) => {
            const block = event.block;
            const laneId =
              block.type === "scene"
                ? "scene"
                : block.type === "showCharacter" ||
                    block.type === "removeCharacter"
                  ? `character:${block.characterId ?? characterTrackIds[0] ?? "unknown"}`
                  : block.type === "audio"
                    ? block.channel
                    : "structure";
            const asset =
              block.type === "audio"
                ? (document.assets ?? []).find(
                    (candidate) => candidate.id === block.assetId,
                  )
                : undefined;
            const label =
              block.type === "scene"
                ? ((document.scenes ?? []).find(
                    (scene) => scene.id === block.sceneId,
                  )?.name ?? "场景")
                : block.type === "showCharacter"
                  ? `登场 · ${characters.get(block.characterId)?.name ?? "角色"}`
                  : block.type === "removeCharacter"
                    ? block.all
                      ? "全部退场"
                      : `退场 · ${characters.get(block.characterId ?? "")?.name ?? "角色"}`
                    : block.type === "audio"
                      ? block.action === "stop"
                        ? "停止"
                        : asset?.type === "audio"
                          ? asset.label
                          : "声音"
                      : "事件";
            return (
              <button
                key={block.id}
                type="button"
                className={`galgame-timeline-point${block.id === selectedBlockId ? " selected" : ""}`}
                style={{
                  left: `${(event.timeMs / Math.max(1, durationMs)) * 100}%`,
                  top: `${laneTop(laneId) + 7}px`,
                }}
                title={`${label} · ${formatTimecode(event.timeMs)}${event.explicit ? "" : " · 兼容锚点"}`}
                aria-label={`${label} ${formatTimecode(event.timeMs)}`}
                onClick={() => {
                  selectBlock(block.id);
                  seek(event.timeMs);
                }}
                onPointerDown={(pointer) =>
                  startDrag(pointer, "point", block.id)
                }
                disabled={readOnly}
              >
                {block.type === "scene" ? (
                  <MapPinned aria-hidden />
                ) : block.type === "showCharacter" ||
                  block.type === "removeCharacter" ? (
                  <UserRound aria-hidden />
                ) : block.type === "audio" && block.channel === "bgm" ? (
                  <Music2 aria-hidden />
                ) : block.type === "audio" && block.channel === "ambient" ? (
                  <Waves aria-hidden />
                ) : (
                  <Volume2 aria-hidden />
                )}
                <span>{label}</span>
              </button>
            );
          })}
          {(fragment.blocks ?? [])
            .filter(
              (block) => block.type === "branch" || block.type === "endChapter",
            )
            .map((block) => (
              <button
                key={block.id}
                type="button"
                className={`galgame-timeline-structure${block.id === selectedBlockId ? " selected" : ""}`}
                style={{
                  left: `calc(100% - 28px)`,
                  top: `${laneTop("structure") + 7}px`,
                }}
                onClick={() => {
                  selectBlock(block.id);
                  seek(durationMs);
                }}
              >
                {block.type === "branch" ? "分支" : "结局"}
              </button>
            ))}
          <div
            className="galgame-timeline-gaps"
            style={{ inset: 0, height: `${trackHeight}px` }}
          >
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
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    top: `${dialogueTop + 5}px`,
                    height: `${laneHeight - 10}px`,
                  }}
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
          <div
            className="galgame-timeline-cues"
            style={{ inset: 0, height: `${trackHeight}px` }}
          >
            {cues.map((cue, index) => {
              const speakerIds =
                cue.block.type === "dialogue"
                  ? dialogueSpeakerIds(cue.block)
                  : [];
              const characterId =
                cue.block.type === "dialogue"
                  ? (speakerIds[0] ?? cue.block.characterId)
                  : "narration";
              const speakerName =
                cue.block.type === "dialogue"
                  ? speakerIds
                      .map(
                        (speakerId) =>
                          characters.get(speakerId)?.name ?? "未知角色",
                      )
                      .join("、")
                  : "旁白";
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
                    top: `${dialogueTop + 5}px`,
                    height: `${laneHeight - 10}px`,
                    backgroundColor: characterColor(characterId),
                  }}
                  aria-label={`${speakerName} ${formatTimecode(cue.startMs)} 到 ${formatTimecode(cue.endMs)}`}
                  title={`${speakerName} · ${cue.block.text}\n${formatTimecode(cue.startMs)}–${formatTimecode(cue.endMs)}`}
                  onClick={() => {
                    selectBlock(cue.block.id);
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
                      aria-label={`调整${speakerName}的开始时间`}
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
                  <strong>{speakerName}</strong>
                  <span>{cue.block.text}</span>
                  {index < cues.length - 1 ? (
                    <i
                      role="separator"
                      tabIndex={0}
                      aria-label={`调整${speakerName}后的对白分界`}
                      onPointerDown={(event) =>
                        startDrag(event, "boundary", cue.block.id)
                      }
                      onKeyDown={(event) => {
                        if (
                          readOnly ||
                          (event.key !== "ArrowLeft" &&
                            event.key !== "ArrowRight")
                        )
                          return;
                        event.preventDefault();
                        event.stopPropagation();
                        const step = event.shiftKey ? 1000 : 100;
                        onFragment(
                          resizeTimelineCueEnd(
                            fragment,
                            cue.block.id,
                            cue.endMs +
                              (event.key === "ArrowRight" ? step : -step),
                            {
                              precise: true,
                              ripple,
                              keepContinuous: true,
                            },
                          ),
                        );
                      }}
                    />
                  ) : (
                    <i
                      role="separator"
                      tabIndex={0}
                      className="end"
                      aria-label={`调整${speakerName}的结束时间`}
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
        <span>
          {beats.length} Beat · {cues.length} 句对白
        </span>
        <span>
          {ripple
            ? "波纹：拉伸右边界会推移后续对白"
            : "普通：拖动分界调整相邻切点"}
          {" · Alt 精确到 1ms · Shift+方向键 1s"}
        </span>
      </footer>
    </section>
  );
}
