import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  Images,
  MapPinned,
  Maximize2,
  Music2,
  Pause,
  Play,
  Repeat2,
  SkipBack,
  SkipForward,
  Unlink2,
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
  timelineCharacterTiming,
  timelineCues,
  timelineEvents,
  timelineGaps,
  timelineStageMarkers,
  timelineStructureEvents,
  type GalgameTimelineCharacterBlock,
} from "@features/galgame-workshop/editor/timeline";
import { dialogueSpeakerIds } from "@features/galgame-workshop/editor/dialogue";
import {
  MAX_TIMELINE_ZOOM,
  MIN_TIMELINE_ZOOM,
  type TimelinePreferences,
} from "@features/galgame-workshop/editor/timelinePreferences";
import { TimelineClock } from "@features/galgame-workshop/editor/timelineClock";
import { TimelineAdvancedSettings } from "@features/galgame-workshop/editor/TimelineAdvancedSettings";
import { TimelineTrackLabels } from "@features/galgame-workshop/editor/TimelineTrackLabels";

const TIMELINE_LABEL_WIDTH = 168;

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
    | "gap-end"
    | "cg-range"
    | "cg-start"
    | "cg-end";
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
  preferences,
  onPreferencesChange,
  onRequestAddMenu,
  addControl,
  readOnly = false,
  followPositionMs,
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
  preferences: TimelinePreferences;
  onPreferencesChange: (preferences: TimelinePreferences) => void;
  onRequestAddMenu?: () => void;
  addControl?: ReactNode;
  readOnly?: boolean;
  followPositionMs?: number | null;
  estimated?: boolean;
}) {
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
  const cues = timelineCues(fragment);
  const gaps = timelineGaps(fragment);
  const markers = timelineStageMarkers(fragment);
  const events = timelineEvents(fragment);
  const cgRanges = timelineCgRanges(fragment);
  const bgmAssets = useMemo(
    () =>
      Array.from(
        new Map(
          timelineEvents(fragment).flatMap((event) => {
            const block = event.block;
            if (
              block.type !== "audio" ||
              block.action !== "play" ||
              block.channel !== "bgm" ||
              !block.assetId
            )
              return [];
            const asset = (document.assets ?? []).find(
              (candidate) =>
                candidate.type === "audio" && candidate.id === block.assetId,
            );
            return asset?.type === "audio" ? [[asset.id, asset] as const] : [];
          }),
        ).values(),
      ),
    [document.assets, fragment],
  );
  const pointEvents = events.filter(
    (event) =>
      event.block.type === "scene" ||
      event.block.type === "showCg" ||
      event.block.type === "hideCg" ||
      event.block.type === "showCharacter" ||
      event.block.type === "removeCharacter" ||
      event.block.type === "audio",
  );
  const durationMs = fragment.timeline?.durationMs ?? 0;
  const durationRef = useRef(durationMs);
  durationRef.current = durationMs;
  const onPreviewPositionRef = useRef(onPreviewPosition);
  onPreviewPositionRef.current = onPreviewPosition;
  const trackWidth = Math.max(640, (durationMs / 60_000) * zoom);
  const activeCue = activeTimelineCue(fragment, positionMs);
  const characters = new Map(
    (document.characters ?? []).map((character) => [character.id, character]),
  );
  const cgs = new Map((document.cgs ?? []).map((cg) => [cg.id, cg]));
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
  const visibleCharacterTrackIds = characterTrackIds.filter(
    (characterId) => !hiddenCharacterTrackIds.has(characterId),
  );
  const attachedCharacterEvents = new Map<
    string,
    GalgameTimelineCharacterBlock[]
  >();
  for (const block of fragment.blocks ?? []) {
    if (block.type !== "showCharacter" && block.type !== "removeCharacter")
      continue;
    const timing = timelineCharacterTiming(fragment, block.id);
    if (timing?.mode !== "dialogue") continue;
    attachedCharacterEvents.set(timing.dialogueBlockId, [
      ...(attachedCharacterEvents.get(timing.dialogueBlockId) ?? []),
      block,
    ]);
  }
  const setCharacterTrackVisible = (characterId: string, visible: boolean) => {
    setHiddenCharacterTrackIds((current) => {
      const next = new Set(current);
      if (visible) next.delete(characterId);
      else next.add(characterId);
      return next;
    });
  };
  const laneHeight = 40;
  const lanes = [
    { id: "scene", label: "场景" },
    { id: "cg", label: "CG" },
    ...(characterTracksExpanded
      ? visibleCharacterTrackIds.map((characterId) => ({
          id: `character:${characterId}`,
          label: characters.get(characterId)?.name ?? "未知角色",
        }))
      : []),
    { id: "dialogue", label: "对白 / 角色 / 配音" },
    { id: "bgm", label: "BGM" },
    { id: "ambient", label: "环境音" },
    { id: "sfx", label: "音效" },
    { id: "structure", label: "分支 / 结局" },
  ];
  const laneTop = (laneId: string) =>
    Math.max(
      0,
      lanes.findIndex((lane) => lane.id === laneId),
    ) * laneHeight;
  const dialogueTop = laneTop("dialogue");
  const trackHeight = lanes.length * laneHeight;
  const stateSegments = pointEvents.flatMap((event, eventIndex) => {
    const block = event.block;
    const laneId =
      block.type === "scene"
        ? "scene"
        : block.type === "showCg"
          ? "cg"
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
      if (block.type === "showCg")
        return (
          candidate.block.type === "showCg" || candidate.block.type === "hideCg"
        );
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
          : block.type === "showCg"
            ? (cgs.get(block.cgId)?.name ?? "剧情 CG")
            : asset?.type === "audio"
              ? asset.label
              : "声音";
    return [
      {
        id: `state:${block.id}`,
        laneId,
        label,
        kind:
          block.type === "scene"
            ? ("scene" as const)
            : block.type === "showCharacter"
              ? ("character" as const)
              : block.type === "showCg"
                ? ("cg" as const)
                : block.type === "audio"
                  ? block.channel
                  : ("scene" as const),
        startMs: event.timeMs,
        endMs: next?.timeMs ?? durationMs,
      },
    ];
  });

  useEffect(() => {
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
        onPreviewPositionRef.current(next);
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
  }, [bgmAssets, fragment.id]);

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

  const tickEveryMs = zoom >= 600 ? 5000 : zoom >= 240 ? 10_000 : 30_000;
  const ticks = Array.from(
    { length: Math.floor(durationMs / tickEveryMs) + 1 },
    (_, index) => index * tickEveryMs,
  );
  const selectBlock = (blockId: string) => onSelectBlock(blockId);
  const fitTimelineWidth = () => {
    const container = scrollRef.current;
    if (!container || durationMs <= 0) return;
    const configuredLabelWidth = Number.parseFloat(
      globalThis
        .getComputedStyle(container)
        .getPropertyValue("--galgame-timeline-label-width"),
    );
    const labelWidth = Number.isFinite(configuredLabelWidth)
      ? configuredLabelWidth
      : TIMELINE_LABEL_WIDTH;
    const availableWidth = Math.max(320, container.clientWidth - labelWidth);
    const fittedZoom = Math.min(
      MAX_TIMELINE_ZOOM,
      Math.max(
        MIN_TIMELINE_ZOOM,
        Math.floor((availableWidth * 60_000) / durationMs),
      ),
    );
    onPreferencesChange({ ...preferences, zoom: fittedZoom });
  };

  return (
    <section
      className={`galgame-timeline-editor${readOnly ? " is-readonly" : ""}`}
      aria-label={readOnly ? "试玩剧情时间轴" : "多轨剧情时间轴"}
    >
      <div className="galgame-timeline-controls">
        <header className="galgame-timeline-toolbar">
          <div className="galgame-timeline-transport">
            <span className="galgame-timeline-mode-label">
              {readOnly ? "跟随试玩" : "时间轴试听"}
            </span>
            {!readOnly ? (
              <>
                <button
                  type="button"
                  aria-label="上一句"
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
                  aria-label="下一句"
                  onClick={() => skip(1)}
                >
                  <SkipForward aria-hidden />
                </button>
              </>
            ) : null}
            <strong>
              {formatTimecode(positionMs)} / {formatTimecode(durationMs)}
            </strong>
            {estimated ? <em>估算时间 · 编辑后保存</em> : null}
          </div>
          {!readOnly ? addControl : null}
          {!readOnly && selectedBlockId ? (
            <details className="galgame-timeline-context-menu">
              <summary>内容项工具</summary>
              <div className="galgame-timeline-calibration">
                <button
                  type="button"
                  disabled={!ready}
                  onClick={() => void auditionSelected()}
                >
                  <Play aria-hidden /> 预听所选
                </button>
                <small>提前 300ms</small>
                <label>
                  <input
                    type="checkbox"
                    checked={loop}
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
                  onClick={() => setSelectedEdgeAtPlayhead("start")}
                >
                  设为开始
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedEdgeAtPlayhead("end")}
                >
                  设为结束
                </button>
              </div>
            </details>
          ) : null}
          <label className="galgame-timeline-zoom">
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
          <button
            type="button"
            className="galgame-timeline-fit"
            aria-label="适配时间轴宽度"
            title="在当前窗口中显示完整剧情"
            onClick={fitTimelineWidth}
          >
            <Maximize2 aria-hidden />
            适配宽度
          </button>
          {characterTrackIds.length ? (
            <label
              className="galgame-timeline-performance-details"
              title="展开逐角色轨道，检查独立或精确角色演出"
            >
              <input
                type="checkbox"
                checked={characterTracksExpanded}
                onChange={(event) =>
                  onPreferencesChange({
                    ...preferences,
                    characterTracksExpanded: event.target.checked,
                  })
                }
              />
              <span>演出细节</span>
            </label>
          ) : null}
          {!readOnly ? (
            <>
              <label
                className="galgame-timeline-ripple"
                title="移动对白或拉伸右边界时，同步推移后续对白"
              >
                <input
                  type="checkbox"
                  checked={ripple}
                  onChange={(event) =>
                    onPreferencesChange({
                      ...preferences,
                      ripple: event.target.checked,
                    })
                  }
                />
                <span>波纹编辑</span>
              </label>
              <TimelineAdvancedSettings
                durationInput={durationInput}
                readOnly={readOnly}
                characterTrackIds={characterTrackIds}
                visibleCharacterTrackIds={visibleCharacterTrackIds}
                characterNames={
                  new Map(
                    Array.from(characters, ([id, character]) => [
                      id,
                      character.name,
                    ]),
                  )
                }
                onDurationInput={(value) => {
                  setDurationInput(value);
                  setDurationHint("");
                }}
                onDurationCommit={commitDuration}
                onCharacterTrackVisible={setCharacterTrackVisible}
                onShowAllCharacterTracks={() =>
                  setHiddenCharacterTrackIds(new Set())
                }
                onHideAllCharacterTracks={() =>
                  setHiddenCharacterTrackIds(new Set(characterTrackIds))
                }
              />
            </>
          ) : null}
        </header>
        <div className="galgame-timeline-ruler-row">
          <strong>时间</strong>
          <div ref={rulerScrollRef} className="galgame-timeline-ruler-scroll">
            <div
              className="galgame-timeline-ruler"
              style={{ width: `${trackWidth}px` }}
              aria-hidden
            >
              {ticks.map((tick) => (
                <i
                  key={tick}
                  className={tick % 60_000 === 0 ? "major" : ""}
                  style={{
                    left: `${(tick / Math.max(1, durationMs)) * trackWidth}px`,
                  }}
                >
                  <span>{formatTimecode(tick).slice(0, 5)}</span>
                </i>
              ))}
            </div>
          </div>
        </div>
      </div>
      {durationHint ? (
        <small className="galgame-timeline-hint" role="status">
          {durationHint}
        </small>
      ) : null}
      {error ? <small className="galgame-timeline-error">{error}</small> : null}
      <div
        ref={scrollRef}
        className="galgame-timeline-scroll"
        onScroll={(event) => {
          if (rulerScrollRef.current)
            rulerScrollRef.current.scrollLeft = event.currentTarget.scrollLeft;
        }}
      >
        <div
          className="galgame-timeline-track"
          style={{
            width: `calc(${trackWidth}px + var(--galgame-timeline-label-width))`,
            height: `${trackHeight}px`,
          }}
        >
          <TimelineTrackLabels
            lanes={lanes}
            laneHeight={laneHeight}
            laneTop={laneTop}
          />
          <div
            ref={trackRef}
            className="galgame-timeline-time-area"
            style={{ width: `${trackWidth}px`, height: `${trackHeight}px` }}
            onPointerDown={(event) => {
              if (event.target !== event.currentTarget) return;
              const bounds = event.currentTarget.getBoundingClientRect();
              seek(((event.clientX - bounds.left) / bounds.width) * durationMs);
            }}
            onContextMenu={(event) => {
              if (readOnly || !onRequestAddMenu) return;
              const target = event.target;
              if (
                target instanceof Element &&
                target.closest(
                  "button, input, textarea, [role='button'], [role='separator']",
                )
              )
                return;
              event.preventDefault();
              const bounds = event.currentTarget.getBoundingClientRect();
              seek(((event.clientX - bounds.left) / bounds.width) * durationMs);
              onRequestAddMenu();
            }}
          >
            <div className="galgame-timeline-lanes" aria-hidden>
              {lanes.map((lane) => (
                <div
                  key={lane.id}
                  className="galgame-timeline-lane"
                  style={{
                    top: `${laneTop(lane.id)}px`,
                    height: `${laneHeight}px`,
                  }}
                />
              ))}
            </div>
            {stateSegments
              .filter(
                (segment) =>
                  lanes.some((lane) => lane.id === segment.laneId) &&
                  segment.laneId !== "cg",
              )
              .map((segment) => (
                <div
                  key={segment.id}
                  className={`galgame-timeline-state-segment is-${segment.kind}`}
                  style={{
                    left: `${(segment.startMs / Math.max(1, durationMs)) * 100}%`,
                    top: `${laneTop(segment.laneId) + 8}px`,
                    width: `${
                      ((segment.endMs - segment.startMs) /
                        Math.max(1, durationMs)) *
                      100
                    }%`,
                  }}
                  title={`${segment.label} · 持续到 ${formatTimecode(segment.endMs)}`}
                  aria-hidden
                >
                  {segment.kind === "scene" ? (
                    <MapPinned />
                  ) : segment.kind === "character" ? (
                    <UserRound />
                  ) : segment.kind === "bgm" ? (
                    <Music2 />
                  ) : segment.kind === "ambient" ? (
                    <Waves />
                  ) : null}
                  <span>{segment.label}</span>
                </div>
              ))}
            {lanes.some((lane) => lane.id === "cg")
              ? cgRanges.map((range) => {
                  const label =
                    cgs.get(range.showBlock.cgId)?.name ?? "剧情 CG";
                  return (
                    <div
                      key={range.id}
                      role="button"
                      tabIndex={readOnly ? -1 : 0}
                      className={`galgame-timeline-cg-range${range.showBlock.id === selectedBlockId ? " selected" : ""}`}
                      style={{
                        left: `${(range.startMs / Math.max(1, durationMs)) * 100}%`,
                        top: `${laneTop("cg") + 8}px`,
                        width: `${((range.endMs - range.startMs) / Math.max(1, durationMs)) * 100}%`,
                        height: `${laneHeight - 16}px`,
                      }}
                      aria-label={`${label} ${formatTimecode(range.startMs)} 到 ${formatTimecode(range.endMs)}`}
                      title={`${label} · ${formatTimecode(range.startMs)}–${formatTimecode(range.endMs)}`}
                      onClick={() => {
                        selectBlock(range.showBlock.id);
                        seek(range.startMs);
                      }}
                      onPointerDown={(event) =>
                        startDrag(event, "cg-range", range.showBlock.id)
                      }
                      onKeyDown={(event) =>
                        moveCgRangeWithKeyboard(event, range.showBlock.id)
                      }
                    >
                      <i
                        role="separator"
                        tabIndex={readOnly ? -1 : 0}
                        className="start"
                        aria-label={`调整 ${label} 的开始时间`}
                        onPointerDown={(event) =>
                          startDrag(event, "cg-start", range.showBlock.id)
                        }
                        onKeyDown={(event) =>
                          moveCgRangeWithKeyboard(
                            event,
                            range.showBlock.id,
                            "start",
                          )
                        }
                      />
                      <Images aria-hidden />
                      <strong>{label}</strong>
                      <span>{formatTimecode(range.endMs - range.startMs)}</span>
                      <i
                        role="separator"
                        tabIndex={readOnly ? -1 : 0}
                        className="end"
                        aria-label={`调整 ${label} 的结束时间`}
                        onPointerDown={(event) =>
                          startDrag(event, "cg-end", range.showBlock.id)
                        }
                        onKeyDown={(event) =>
                          moveCgRangeWithKeyboard(
                            event,
                            range.showBlock.id,
                            "end",
                          )
                        }
                      />
                    </div>
                  );
                })
              : null}
            {pointEvents.map((event) => {
              const block = event.block;
              const characterEvent =
                block.type === "showCharacter" ||
                block.type === "removeCharacter";
              const characterTiming = characterEvent
                ? timelineCharacterTiming(fragment, block.id)
                : undefined;
              const collapsedCharacterEvent =
                characterEvent &&
                !characterTracksExpanded &&
                characterTiming?.mode !== "dialogue";
              const isCgEvent =
                block.type === "showCg" || block.type === "hideCg";
              const isStateEvent =
                block.type === "scene" ||
                block.type === "showCharacter" ||
                block.type === "removeCharacter" ||
                (block.type === "audio" &&
                  (block.channel === "bgm" || block.channel === "ambient"));
              const laneId =
                block.type === "scene"
                  ? "scene"
                  : block.type === "showCg" || block.type === "hideCg"
                    ? "cg"
                    : block.type === "showCharacter" ||
                        block.type === "removeCharacter"
                      ? characterTracksExpanded
                        ? `character:${block.characterId ?? visibleCharacterTrackIds[0] ?? "unknown"}`
                        : "dialogue"
                      : block.type === "audio"
                        ? block.channel
                        : "structure";
              if (
                characterEvent &&
                !characterTracksExpanded &&
                characterTiming?.mode === "dialogue"
              )
                return null;
              if (!lanes.some((lane) => lane.id === laneId)) return null;
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
                  : block.type === "showCg"
                    ? `显示 · ${cgs.get(block.cgId)?.name ?? "剧情 CG"}`
                    : block.type === "hideCg"
                      ? "隐藏 CG"
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
                  className={`galgame-timeline-point${
                    isCgEvent
                      ? ` is-cg-event is-${block.type === "showCg" ? "show" : "hide"}-cg`
                      : ""
                  }${
                    block.type === "audio" && block.channel === "sfx"
                      ? " is-sfx-event"
                      : ""
                  }${
                    isStateEvent
                      ? ` is-state-event is-${
                          block.type === "scene"
                            ? "scene"
                            : block.type === "showCharacter" ||
                                block.type === "removeCharacter"
                              ? "character"
                              : block.channel
                        }-event`
                      : ""
                  }${collapsedCharacterEvent ? " is-character-summary-event" : ""}${
                    characterTiming?.mode === "independent"
                      ? " is-independent-event"
                      : ""
                  }${
                    event.timeMs <= 0 && !collapsedCharacterEvent
                      ? " is-timeline-start"
                      : ""
                  }${
                    block.id === selectedBlockId && block.type !== "showCg"
                      ? " selected"
                      : ""
                  }`}
                  style={{
                    left: `${(event.timeMs / Math.max(1, durationMs)) * 100}%`,
                    top: `${laneTop(laneId) + 7}px`,
                  }}
                  title={`${label} · ${formatTimecode(event.timeMs)}${
                    characterTiming?.mode === "independent"
                      ? " · 独立演出"
                      : characterTiming?.mode === "timelineEnd"
                        ? " · 跟随剧情结尾"
                        : event.explicit
                          ? ""
                          : " · 跟随对白"
                  }`}
                  aria-label={`${label} ${formatTimecode(event.timeMs)}`}
                  onClick={() => {
                    selectBlock(block.id);
                    seek(event.timeMs);
                  }}
                  onPointerDown={(pointer) =>
                    startDrag(
                      pointer,
                      block.type === "showCg" ? "cg-start" : "point",
                      block.id,
                    )
                  }
                  disabled={readOnly}
                >
                  {block.type === "scene" ? (
                    <MapPinned aria-hidden />
                  ) : block.type === "showCg" || block.type === "hideCg" ? (
                    <Images aria-hidden />
                  ) : characterEvent ? (
                    characterTiming?.mode === "independent" ? (
                      <Unlink2 aria-hidden />
                    ) : (
                      <UserRound aria-hidden />
                    )
                  ) : block.type === "audio" && block.channel === "bgm" ? (
                    <Music2 aria-hidden />
                  ) : block.type === "audio" && block.channel === "ambient" ? (
                    <Waves aria-hidden />
                  ) : (
                    <Volume2 aria-hidden />
                  )}
                  {!isCgEvent && !isStateEvent ? <span>{label}</span> : null}
                </button>
              );
            })}
            {timelineStructureEvents(fragment).map(({ block }) =>
              block.type === "branch" || block.type === "endChapter" ? (
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
              ) : null,
            )}
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
                      top: `${dialogueTop + 8}px`,
                      height: `${laneHeight - 16}px`,
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
                const cueMarkers = (markers.get(cue.block.id) ?? []).filter(
                  (block) =>
                    block.type !== "showCharacter" &&
                    block.type !== "removeCharacter",
                );
                const cueCharacterEvents = !characterTracksExpanded
                  ? (attachedCharacterEvents.get(cue.block.id) ?? [])
                  : [];
                const dialogueCharacter =
                  cue.block.type === "dialogue"
                    ? characters.get(cue.block.characterId)
                    : undefined;
                const dialogueBlock =
                  cue.block.type === "dialogue" ? cue.block : undefined;
                const expressionLabel = dialogueBlock
                  ? dialogueCharacter?.expressions?.find(
                      (expression) =>
                        expression.id ===
                        (dialogueBlock.expressionId ??
                          dialogueCharacter.defaultExpressionId),
                    )?.label
                  : undefined;
                const portraitLabel = !dialogueBlock
                  ? undefined
                  : !dialogueBlock.portrait
                    ? "旧版临时立绘"
                    : dialogueBlock.portrait.mode === "stage"
                      ? dialogueBlock.portrait.keepAfter
                        ? "舞台·保留"
                        : "舞台·句后退场"
                      : dialogueBlock.portrait.mode === "dialogueAvatar"
                        ? "仅对白头像"
                        : dialogueBlock.portrait.visible === false
                          ? "隐藏立绘"
                          : "旧版单人特写";
                const dialogueMeta = [
                  expressionLabel ? `表情 ${expressionLabel}` : undefined,
                  dialogueBlock
                    ? dialogueBlock.voiceAssetId
                      ? "已配音"
                      : "待配音"
                    : undefined,
                  portraitLabel,
                ]
                  .filter(Boolean)
                  .join(" · ");
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
                      top: `${dialogueTop + 8}px`,
                      height: `${laneHeight - 16}px`,
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
                        ) : cueMarkers.some(
                            (block) =>
                              block.type === "showCg" ||
                              block.type === "hideCg",
                          ) ? (
                          <Images aria-hidden />
                        ) : (
                          <Users aria-hidden />
                        )}
                        {cueMarkers.length}
                      </span>
                    ) : null}
                    {cueCharacterEvents.length ? (
                      <span
                        className="galgame-timeline-character-markers"
                        title={cueCharacterEvents
                          .map((block) =>
                            block.type === "showCharacter"
                              ? `登场 · ${characters.get(block.characterId)?.name ?? "角色"}`
                              : block.all
                                ? "全部退场"
                                : `退场 · ${characters.get(block.characterId ?? "")?.name ?? "角色"}`,
                          )
                          .join("\n")}
                      >
                        <UserRound aria-hidden />
                        {cueCharacterEvents.length}
                      </span>
                    ) : null}
                    <strong>{speakerName}</strong>
                    <span>{cue.block.text}</span>
                    {dialogueMeta ? (
                      <span
                        className="galgame-timeline-dialogue-meta"
                        title={dialogueMeta}
                      >
                        {dialogueBlock?.voiceAssetId ? (
                          <Volume2 aria-hidden />
                        ) : null}
                        {expressionLabel ?? portraitLabel}
                      </span>
                    ) : null}
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
              style={{
                left: `${(positionMs / Math.max(1, durationMs)) * 100}%`,
              }}
              role="slider"
              tabIndex={readOnly ? -1 : 0}
              aria-label="时间轴播放头"
              aria-valuemin={0}
              aria-valuemax={durationMs}
              aria-valuenow={Math.round(positionMs)}
              aria-valuetext={formatTimecode(positionMs)}
              aria-disabled={readOnly || undefined}
              title={readOnly ? undefined : "拖动播放头跳转时间"}
              onPointerDown={startPlayheadDrag}
              onKeyDown={seekPlayheadWithKeyboard}
            />
          </div>
        </div>
      </div>
      <footer>
        <span>{cues.length} 句对白</span>
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
