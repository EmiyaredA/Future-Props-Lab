import type {
  GalgameStoryBlock,
  GalgameStoryFragment,
} from "@features/galgame-workshop/api";

export const TIMELINE_MIN_CUE_MS = 100;
export const TIMELINE_SNAP_MS = 100;

export type GalgameTimedBlock = Extract<
  GalgameStoryBlock,
  { type: "dialogue" | "narration" }
>;

export type GalgameTimelinePointBlock = Extract<
  GalgameStoryBlock,
  { type: "scene" | "showCharacter" | "removeCharacter" | "audio" }
>;

export type GalgameTimelineEvent = {
  block: GalgameStoryBlock;
  blockIndex: number;
  timeMs: number;
  priority: number;
  explicit: boolean;
};

export type GalgameTimelineBeat = {
  id: string;
  startMs: number;
  endMs: number;
  content?: GalgameTimedBlock;
  contentBlockIndex?: number;
  events: GalgameTimelineEvent[];
};

export type GalgameTimelineAudioState = {
  bgm?: Extract<GalgameTimelinePointBlock, { type: "audio" }>;
  ambient?: Extract<GalgameTimelinePointBlock, { type: "audio" }>;
};

export type GalgameTimelineCue = {
  block: GalgameTimedBlock;
  blockIndex: number;
  cueIndex: number;
  startMs: number;
  endMs: number;
};

export type GalgameTimelineGap = {
  id: string;
  kind: "leading" | "internal" | "trailing";
  startMs: number;
  endMs: number;
  previousCueId?: string;
  nextCueId?: string;
};

export type GalgameBeatRange = {
  startIndex: number;
  endIndex: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  beatIds: string[];
  blockIds: string[];
  structuralBlockIds: string[];
};

export type GalgameBeatRangeEditResult = {
  fragment: GalgameStoryFragment;
  error?: string;
};

export function timelineCues(fragment: GalgameStoryFragment) {
  return (fragment.blocks ?? [])
    .flatMap((block, blockIndex) => {
      if (
        (block.type !== "dialogue" && block.type !== "narration") ||
        block.startMs == null ||
        block.endMs == null
      )
        return [];
      return [
        {
          block,
          blockIndex,
          cueIndex: 0,
          startMs: block.startMs,
          endMs: block.endMs,
        },
      ];
    })
    .map((cue, cueIndex) => ({ ...cue, cueIndex }));
}

function eventPriority(block: GalgameStoryBlock) {
  if (block.type === "scene") return 0;
  if (block.type === "removeCharacter") return 1;
  if (block.type === "showCharacter") return 2;
  if (block.type === "audio" && block.action === "stop") return 3;
  if (
    block.type === "audio" &&
    block.action === "play" &&
    block.channel !== "sfx"
  )
    return 4;
  if (block.type === "audio") return 5;
  if (block.type === "dialogue" || block.type === "narration") return 6;
  return 7;
}

export function effectivePointTime(
  fragment: GalgameStoryFragment,
  blockIndex: number,
) {
  const block = fragment.blocks?.[blockIndex];
  if (
    !block ||
    (block.type !== "scene" &&
      block.type !== "showCharacter" &&
      block.type !== "removeCharacter" &&
      block.type !== "audio")
  )
    return undefined;
  if (block.atMs != null) return block.atMs;
  if (!fragment.timeline) return undefined;
  const cues = timelineCues(fragment);
  const next = cues.find((cue) => cue.blockIndex > blockIndex);
  if (next) return cues[0]?.blockIndex > blockIndex ? 0 : next.startMs;
  return fragment.timeline.durationMs;
}

export function timelineEvents(fragment: GalgameStoryFragment) {
  return (fragment.blocks ?? [])
    .flatMap((block, blockIndex): GalgameTimelineEvent[] => {
      if (
        (block.type === "dialogue" || block.type === "narration") &&
        block.startMs != null
      )
        return [
          {
            block,
            blockIndex,
            timeMs: block.startMs,
            priority: eventPriority(block),
            explicit: true,
          },
        ];
      const timeMs = effectivePointTime(fragment, blockIndex);
      return timeMs == null
        ? []
        : [
            {
              block,
              blockIndex,
              timeMs,
              priority: eventPriority(block),
              explicit: "atMs" in block && block.atMs != null,
            },
          ];
    })
    .sort(
      (left, right) =>
        left.timeMs - right.timeMs ||
        left.priority - right.priority ||
        left.blockIndex - right.blockIndex,
    );
}

export function timelineBeats(fragment: GalgameStoryFragment) {
  const cues = timelineCues(fragment);
  const beats: GalgameTimelineBeat[] = cues.map((cue) => ({
    id: `beat:${cue.block.id}`,
    startMs: cue.startMs,
    endMs: cue.endMs,
    content: cue.block,
    contentBlockIndex: cue.blockIndex,
    events: [],
  }));
  const events = timelineEvents(fragment).filter(
    (event) =>
      event.block.type !== "dialogue" && event.block.type !== "narration",
  );
  for (const event of events) {
    const target = beats.find((beat) => beat.startMs === event.timeMs);
    if (target) target.events.push(event);
    else
      beats.push({
        id: `beat:event:${event.block.id}`,
        startMs: event.timeMs,
        endMs: event.timeMs,
        events: [event],
      });
  }
  if (!beats.length && fragment.timeline)
    beats.push({
      id: `beat:fragment:${fragment.id}`,
      startMs: 0,
      endMs: fragment.timeline.durationMs,
      events,
    });
  const structuralEvents = (fragment.blocks ?? []).flatMap(
    (block, blockIndex): GalgameTimelineEvent[] =>
      block.type === "branch" || block.type === "endChapter"
        ? [
            {
              block,
              blockIndex,
              timeMs: fragment.timeline?.durationMs ?? 0,
              priority: eventPriority(block),
              explicit: true,
            },
          ]
        : [],
  );
  if (structuralEvents.length) {
    const terminalMs =
      fragment.timeline?.durationMs ?? beats.at(-1)?.endMs ?? 0;
    const terminalBeat = beats.find((beat) => beat.startMs === terminalMs);
    if (terminalBeat) terminalBeat.events.push(...structuralEvents);
    else
      beats.push({
        id: `beat:structure:${fragment.id}`,
        startMs: terminalMs,
        endMs: terminalMs,
        events: structuralEvents,
      });
  }
  return beats.sort((left, right) => left.startMs - right.startMs);
}

export function timelineAudioStateAt(
  fragment: GalgameStoryFragment,
  milliseconds: number,
) {
  const state: GalgameTimelineAudioState = {};
  for (const event of timelineEvents(fragment)) {
    if (event.timeMs > milliseconds || event.block.type !== "audio") continue;
    if (event.block.channel !== "bgm" && event.block.channel !== "ambient")
      continue;
    if (event.block.action === "stop") delete state[event.block.channel];
    else state[event.block.channel] = event.block;
  }
  return state;
}

export function estimatedCueDuration(text: string) {
  return Math.max(1500, Array.from(text.trim()).length * 180 + 400);
}

export function appendBlockToTimeline(
  fragment: GalgameStoryFragment,
  block: GalgameStoryBlock,
  requestedAtMs?: number,
) {
  if (!fragment.timeline)
    return { ...fragment, blocks: [...(fragment.blocks ?? []), block] };
  const cues = timelineCues(fragment);
  const requested = Math.max(
    0,
    requestedAtMs ??
      (block.type === "dialogue" || block.type === "narration"
        ? (cues.at(-1)?.endMs ?? 0) + (cues.length ? 300 : 0)
        : fragment.timeline.durationMs),
  );
  const estimatedDuration =
    block.type === "dialogue" || block.type === "narration"
      ? estimatedCueDuration(block.text)
      : 0;
  let atMs = requested;
  if (estimatedDuration)
    for (const cue of cues)
      if (atMs < cue.endMs && atMs + estimatedDuration > cue.startMs)
        atMs = cue.endMs + 300;
  const placed =
    block.type === "dialogue" || block.type === "narration"
      ? {
          ...block,
          startMs: atMs,
          endMs: atMs + estimatedDuration,
        }
      : block.type === "scene" ||
          block.type === "showCharacter" ||
          block.type === "removeCharacter" ||
          block.type === "audio"
        ? { ...block, atMs }
        : block;
  const endMs =
    placed.type === "dialogue" || placed.type === "narration"
      ? (placed.endMs ?? atMs) + 500
      : atMs;
  return expandTimelineTo(
    { ...fragment, blocks: [...(fragment.blocks ?? []), placed] },
    endMs,
  );
}

export function enableFragmentTimeline(fragment: GalgameStoryFragment) {
  if (fragment.timeline) return fragment;
  let cursorMs = 0;
  const timedBlocks = (fragment.blocks ?? []).map((block) => {
    if (block.type !== "dialogue" && block.type !== "narration") return block;
    const durationMs = estimatedCueDuration(block.text);
    const next = {
      ...block,
      startMs: cursorMs,
      endMs: cursorMs + durationMs,
    };
    cursorMs = next.endMs + 300;
    return next;
  });
  const durationMs = Math.max(1, cursorMs ? cursorMs - 300 + 500 : 500);
  const withTimeline: GalgameStoryFragment = {
    ...fragment,
    timeline: { durationMs },
    blocks: timedBlocks,
  };
  return {
    ...withTimeline,
    blocks: (withTimeline.blocks ?? []).map((block, blockIndex) => {
      if (
        block.type !== "scene" &&
        block.type !== "showCharacter" &&
        block.type !== "removeCharacter" &&
        block.type !== "audio"
      )
        return block;
      return {
        ...block,
        atMs: effectivePointTime(withTimeline, blockIndex) ?? 0,
      };
    }),
  };
}

/**
 * Returns an estimated, editable-shaped timeline without changing the story.
 * Callers only persist this value after the first actual timing mutation.
 */
export function projectFragmentTimeline(fragment: GalgameStoryFragment) {
  return fragment.timeline ? fragment : enableFragmentTimeline(fragment);
}

export function timelineBeatRange(
  fragment: GalgameStoryFragment,
  requestedStartIndex: number,
  requestedEndIndex = requestedStartIndex,
): GalgameBeatRange | undefined {
  const beats = timelineBeats(fragment);
  if (!beats.length) return undefined;
  const startIndex = Math.max(
    0,
    Math.min(
      beats.length - 1,
      Math.min(requestedStartIndex, requestedEndIndex),
    ),
  );
  const endIndex = Math.max(
    startIndex,
    Math.min(
      beats.length - 1,
      Math.max(requestedStartIndex, requestedEndIndex),
    ),
  );
  const selected = beats.slice(startIndex, endIndex + 1);
  const startMs = selected[0].startMs;
  const last = selected.at(-1)!;
  const next = beats[endIndex + 1];
  const timelineEnd = fragment.timeline?.durationMs ?? last.endMs;
  const endMs = Math.max(
    startMs,
    last.endMs,
    next ? next.startMs : timelineEnd,
  );
  const blocks = selected.flatMap((beat) => [
    ...beat.events.map((event) => event.block),
    ...(beat.content ? [beat.content] : []),
  ]);
  return {
    startIndex,
    endIndex,
    startMs,
    endMs,
    durationMs: endMs - startMs,
    beatIds: selected.map((beat) => beat.id),
    blockIds: Array.from(new Set(blocks.map((block) => block.id))),
    structuralBlockIds: blocks
      .filter((block) => block.type === "branch" || block.type === "endChapter")
      .map((block) => block.id),
  };
}

function blockTime(
  fragment: GalgameStoryFragment,
  block: GalgameStoryBlock,
  blockIndex: number,
) {
  if (block.type === "dialogue" || block.type === "narration")
    return block.startMs;
  return effectivePointTime(fragment, blockIndex);
}

function shiftBlock(
  block: GalgameStoryBlock,
  deltaMs: number,
): GalgameStoryBlock {
  if (block.type === "dialogue" || block.type === "narration")
    return block.startMs == null || block.endMs == null
      ? block
      : {
          ...block,
          startMs: block.startMs + deltaMs,
          endMs: block.endMs + deltaMs,
        };
  if (
    block.type === "scene" ||
    block.type === "showCharacter" ||
    block.type === "removeCharacter" ||
    block.type === "audio"
  )
    return block.atMs == null
      ? block
      : { ...block, atMs: block.atMs + deltaMs };
  return block;
}

function validateBeatRangeEdit(
  original: GalgameStoryFragment,
  candidate: GalgameStoryFragment,
): GalgameBeatRangeEditResult {
  const cues = timelineCues(candidate);
  for (const [index, cue] of cues.entries()) {
    if (cue.startMs < 0)
      return { fragment: original, error: "操作会把 Beat 移到时间轴起点之前" };
    if (cue.endMs - cue.startMs < TIMELINE_MIN_CUE_MS)
      return { fragment: original, error: "对白或旁白不能短于 100ms" };
    if (index > 0 && cues[index - 1].endMs > cue.startMs)
      return { fragment: original, error: "操作会造成对白或旁白时间重叠" };
  }
  const conflictKeys = new Map<string, string>();
  for (const event of timelineEvents(candidate)) {
    const block = event.block;
    let key: string | undefined;
    if (block.type === "scene") key = `scene:${event.timeMs}`;
    else if (
      block.type === "showCharacter" ||
      block.type === "removeCharacter"
    ) {
      const characterId =
        block.type === "showCharacter"
          ? block.characterId
          : block.all
            ? "*"
            : block.characterId;
      if (characterId) key = `character:${characterId}:${event.timeMs}`;
    } else if (
      block.type === "audio" &&
      block.action === "play" &&
      (block.channel === "bgm" || block.channel === "ambient")
    )
      key = `audio:${block.channel}:${event.timeMs}`;
    if (!key) continue;
    const existing = conflictKeys.get(key);
    if (existing && existing !== block.id)
      return {
        fragment: original,
        error: "操作会造成同一时间的舞台或持续声音冲突",
      };
    conflictKeys.set(key, block.id);
  }
  const durationMs = candidate.timeline?.durationMs ?? 0;
  if (
    timelineEvents(candidate).some(
      (event) => event.timeMs < 0 || event.timeMs > durationMs,
    ) ||
    cues.some((cue) => cue.endMs > durationMs)
  )
    return { fragment: original, error: "操作结果超出了剧情总时长" };
  return { fragment: candidate };
}

function rangeOrError(
  fragment: GalgameStoryFragment,
  startIndex: number,
  endIndex: number,
) {
  const materialized = projectFragmentTimeline(fragment);
  const range = timelineBeatRange(materialized, startIndex, endIndex);
  return range
    ? { materialized, range }
    : { materialized, error: "当前 Fragment 没有可处理的 Beat" };
}

export function translateTimelineBeatRange(
  fragment: GalgameStoryFragment,
  startIndex: number,
  endIndex: number,
  requestedDeltaMs: number,
): GalgameBeatRangeEditResult {
  const resolved = rangeOrError(fragment, startIndex, endIndex);
  if (!resolved.range) return { fragment, error: resolved.error };
  const { materialized, range } = resolved;
  const selected = new Set(range.blockIds);
  const deltaMs = snapTimelineTime(requestedDeltaMs, true);
  if (!deltaMs) return { fragment: materialized };
  const blocks = (materialized.blocks ?? []).map((block, blockIndex) => {
    const timeMs = blockTime(materialized, block, blockIndex);
    return selected.has(block.id) || (timeMs != null && timeMs >= range.endMs)
      ? shiftBlock(block, deltaMs)
      : block;
  });
  const candidate = withTimelineDuration(
    { ...materialized, blocks },
    (materialized.timeline?.durationMs ?? 0) + deltaMs,
  );
  return validateBeatRangeEdit(fragment, candidate);
}

export function scaleTimelineBeatRange(
  fragment: GalgameStoryFragment,
  startIndex: number,
  endIndex: number,
  requestedScale: number,
): GalgameBeatRangeEditResult {
  const resolved = rangeOrError(fragment, startIndex, endIndex);
  if (!resolved.range) return { fragment, error: resolved.error };
  const { materialized, range } = resolved;
  if (!Number.isFinite(requestedScale) || requestedScale <= 0)
    return { fragment, error: "缩放比例必须大于 0" };
  if (range.durationMs <= 0)
    return { fragment, error: "结构 Beat 没有可缩放的时间范围" };
  const selected = new Set(range.blockIds);
  const nextDuration = Math.round(range.durationMs * requestedScale);
  const durationDelta = nextDuration - range.durationMs;
  const blocks = (materialized.blocks ?? []).map((block, blockIndex) => {
    if (selected.has(block.id)) {
      if (
        (block.type === "dialogue" || block.type === "narration") &&
        block.startMs != null &&
        block.endMs != null
      )
        return {
          ...block,
          startMs: Math.round(
            range.startMs + (block.startMs - range.startMs) * requestedScale,
          ),
          endMs: Math.round(
            range.startMs + (block.endMs - range.startMs) * requestedScale,
          ),
        };
      if (
        (block.type === "scene" ||
          block.type === "showCharacter" ||
          block.type === "removeCharacter" ||
          block.type === "audio") &&
        block.atMs != null
      )
        return {
          ...block,
          atMs: Math.round(
            range.startMs + (block.atMs - range.startMs) * requestedScale,
          ),
        };
      return block;
    }
    const timeMs = blockTime(materialized, block, blockIndex);
    return timeMs != null && timeMs >= range.endMs
      ? shiftBlock(block, durationDelta)
      : block;
  });
  const candidate = withTimelineDuration(
    { ...materialized, blocks },
    (materialized.timeline?.durationMs ?? 0) + durationDelta,
  );
  return validateBeatRangeEdit(fragment, candidate);
}

function defaultDuplicateId(block: GalgameStoryBlock) {
  const suffix =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `${block.type}-${suffix}`;
}

export function duplicateTimelineBeatRange(
  fragment: GalgameStoryFragment,
  startIndex: number,
  endIndex: number,
  makeId: (block: GalgameStoryBlock) => string = defaultDuplicateId,
): GalgameBeatRangeEditResult {
  const resolved = rangeOrError(fragment, startIndex, endIndex);
  if (!resolved.range) return { fragment, error: resolved.error };
  const { materialized, range } = resolved;
  if (range.durationMs <= 0) return { fragment, error: "结构 Beat 不能复制" };
  const selected = new Set(range.blockIds);
  const copyable = (materialized.blocks ?? []).filter(
    (block) =>
      selected.has(block.id) &&
      block.type !== "branch" &&
      block.type !== "endChapter",
  );
  if (!copyable.length)
    return { fragment, error: "所选范围没有可复制的演出事件" };
  const shifted = (materialized.blocks ?? []).map((block, blockIndex) => {
    const timeMs = blockTime(materialized, block, blockIndex);
    return !selected.has(block.id) && timeMs != null && timeMs >= range.endMs
      ? shiftBlock(block, range.durationMs)
      : block;
  });
  const copies = copyable.map((block) => ({
    ...shiftBlock(block, range.durationMs),
    id: makeId(block),
  }));
  const selectedIndexes = shifted.flatMap((block, index) =>
    selected.has(block.id) &&
    block.type !== "branch" &&
    block.type !== "endChapter"
      ? [index]
      : [],
  );
  const terminalIndex = shifted.findIndex(
    (block) => block.type === "branch" || block.type === "endChapter",
  );
  const insertionIndex = Math.min(
    terminalIndex < 0 ? shifted.length : terminalIndex,
    Math.max(...selectedIndexes) + 1,
  );
  const blocks = [
    ...shifted.slice(0, insertionIndex),
    ...copies,
    ...shifted.slice(insertionIndex),
  ];
  const candidate = withTimelineDuration(
    { ...materialized, blocks },
    (materialized.timeline?.durationMs ?? 0) + range.durationMs,
  );
  return validateBeatRangeEdit(fragment, candidate);
}

export function deleteTimelineBeatRange(
  fragment: GalgameStoryFragment,
  startIndex: number,
  endIndex: number,
): GalgameBeatRangeEditResult {
  const resolved = rangeOrError(fragment, startIndex, endIndex);
  if (!resolved.range) return { fragment, error: resolved.error };
  const { materialized, range } = resolved;
  const selected = new Set(range.blockIds);
  const removable = new Set(
    (materialized.blocks ?? [])
      .filter(
        (block) =>
          selected.has(block.id) &&
          block.type !== "branch" &&
          block.type !== "endChapter",
      )
      .map((block) => block.id),
  );
  if (!removable.size) return { fragment, error: "结构 Beat 受保护，不能删除" };
  const blocks = (materialized.blocks ?? []).flatMap((block, blockIndex) => {
    if (removable.has(block.id)) return [];
    const timeMs = blockTime(materialized, block, blockIndex);
    return [
      timeMs != null && timeMs >= range.endMs
        ? shiftBlock(block, -range.durationMs)
        : block,
    ];
  });
  const minimumDuration = Math.max(
    1,
    ...blocks.flatMap((block) =>
      block.type === "dialogue" || block.type === "narration"
        ? [block.endMs ?? 0]
        : block.type === "scene" ||
            block.type === "showCharacter" ||
            block.type === "removeCharacter" ||
            block.type === "audio"
          ? [block.atMs ?? 0]
          : [],
    ),
  );
  const candidate = withTimelineDuration(
    { ...materialized, blocks },
    Math.max(
      minimumDuration,
      (materialized.timeline?.durationMs ?? 0) - range.durationMs,
    ),
  );
  return validateBeatRangeEdit(fragment, candidate);
}

export function setTimelinePointTime(
  fragment: GalgameStoryFragment,
  blockId: string,
  requestedMs: number,
  precise = false,
) {
  if (!fragment.timeline) return fragment;
  const atMs = Math.max(0, snapTimelineTime(requestedMs, precise));
  return expandTimelineTo(
    {
      ...fragment,
      blocks: (fragment.blocks ?? []).map((block) =>
        block.id === blockId &&
        (block.type === "scene" ||
          block.type === "showCharacter" ||
          block.type === "removeCharacter" ||
          block.type === "audio")
          ? { ...block, atMs }
          : block,
      ),
    },
    atMs,
  );
}

export function timelineGaps(fragment: GalgameStoryFragment) {
  const cues = timelineCues(fragment);
  const durationMs = fragment.timeline?.durationMs ?? cues.at(-1)?.endMs ?? 0;
  const gaps: GalgameTimelineGap[] = [];
  const first = cues[0];
  if (!first) {
    if (durationMs > 0)
      gaps.push({
        id: "gap:empty",
        kind: "leading",
        startMs: 0,
        endMs: durationMs,
      });
    return gaps;
  }
  if (first.startMs > 0)
    gaps.push({
      id: `gap:leading:${first.block.id}`,
      kind: "leading",
      startMs: 0,
      endMs: first.startMs,
      nextCueId: first.block.id,
    });
  for (let index = 0; index < cues.length - 1; index += 1) {
    const previous = cues[index];
    const next = cues[index + 1];
    if (previous.endMs >= next.startMs) continue;
    gaps.push({
      id: `gap:${previous.block.id}:${next.block.id}`,
      kind: "internal",
      startMs: previous.endMs,
      endMs: next.startMs,
      previousCueId: previous.block.id,
      nextCueId: next.block.id,
    });
  }
  const last = cues.at(-1)!;
  if (last.endMs < durationMs)
    gaps.push({
      id: `gap:trailing:${last.block.id}`,
      kind: "trailing",
      startMs: last.endMs,
      endMs: durationMs,
      previousCueId: last.block.id,
    });
  return gaps;
}

export function timelineStageMarkers(fragment: GalgameStoryFragment) {
  const markers = new Map<string, GalgameStoryBlock[]>();
  let pending: GalgameStoryBlock[] = [];
  for (const block of fragment.blocks ?? []) {
    if (
      (block.type === "dialogue" || block.type === "narration") &&
      block.startMs != null &&
      block.endMs != null
    ) {
      if (pending.length) markers.set(block.id, pending);
      pending = [];
      continue;
    }
    if (
      block.type === "scene" ||
      block.type === "showCharacter" ||
      block.type === "removeCharacter"
    )
      pending.push(block);
  }
  return markers;
}

export function snapTimelineTime(value: number, precise = false) {
  const step = precise ? 1 : TIMELINE_SNAP_MS;
  return Math.round(value / step) * step;
}

export function formatTimecode(milliseconds: number) {
  const value = Math.max(0, Math.round(milliseconds));
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.floor((value % 60_000) / 1000);
  const millis = value % 1000;
  return `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}.${millis.toString().padStart(3, "0")}`;
}

export function parseTimecode(value: string) {
  const normalized = value.trim();
  const match = /^(?:(\d+):)?(\d{1,2})(?:\.(\d{1,3}))?$/.exec(normalized);
  if (!match) return undefined;
  const minutes = Number(match[1] ?? 0);
  const seconds = Number(match[2]);
  if (seconds >= 60) return undefined;
  const millis = Number((match[3] ?? "").padEnd(3, "0") || 0);
  return minutes * 60_000 + seconds * 1000 + millis;
}

function replaceCueRanges(
  fragment: GalgameStoryFragment,
  ranges: Map<string, { startMs: number; endMs: number }>,
) {
  return {
    ...fragment,
    blocks: (fragment.blocks ?? []).map((block) => {
      const range = ranges.get(block.id);
      if (!range || (block.type !== "dialogue" && block.type !== "narration"))
        return block;
      return { ...block, ...range };
    }),
  };
}

function withTimelineDuration(
  fragment: GalgameStoryFragment,
  durationMs: number,
) {
  if (!fragment.timeline) return fragment;
  return {
    ...fragment,
    timeline: {
      ...fragment.timeline,
      durationMs: Math.max(1, Math.round(durationMs)),
    },
  };
}

function expandTimelineTo(fragment: GalgameStoryFragment, endMs: number) {
  if (!fragment.timeline || endMs <= fragment.timeline.durationMs)
    return fragment;
  return withTimelineDuration(fragment, endMs);
}

export function setTimelineDuration(
  fragment: GalgameStoryFragment,
  requestedMs: number,
) {
  if (!fragment.timeline) return fragment;
  const minimum = Math.max(1, timelineCues(fragment).at(-1)?.endMs ?? 1);
  return withTimelineDuration(fragment, Math.max(minimum, requestedMs));
}

export function resizeTimelineBoundary(
  fragment: GalgameStoryFragment,
  leftCueId: string,
  requestedMs: number,
  precise = false,
) {
  const cues = timelineCues(fragment);
  const leftIndex = cues.findIndex((cue) => cue.block.id === leftCueId);
  const left = cues[leftIndex];
  const right = cues[leftIndex + 1];
  if (!left || !right) return fragment;
  const boundary = Math.min(
    right.endMs - TIMELINE_MIN_CUE_MS,
    Math.max(
      left.startMs + TIMELINE_MIN_CUE_MS,
      snapTimelineTime(requestedMs, precise),
    ),
  );
  return replaceCueRanges(
    fragment,
    new Map([
      [left.block.id, { startMs: left.startMs, endMs: boundary }],
      [right.block.id, { startMs: boundary, endMs: right.endMs }],
    ]),
  );
}

export function resizeTimelineCueEnd(
  fragment: GalgameStoryFragment,
  cueId: string,
  requestedMs: number,
  options: {
    precise?: boolean;
    ripple?: boolean;
    keepContinuous?: boolean;
  } = {},
) {
  if (!options.ripple)
    return setTimelineCueEdge(
      fragment,
      cueId,
      "end",
      requestedMs,
      options.keepContinuous,
      options.precise,
    );

  const cues = timelineCues(fragment);
  const index = cues.findIndex((cue) => cue.block.id === cueId);
  const cue = cues[index];
  if (!cue) return fragment;
  const requested = snapTimelineTime(requestedMs, options.precise ?? false);
  const requestedDelta = requested - cue.endMs;
  const minimumDelta = cue.startMs + TIMELINE_MIN_CUE_MS - cue.endMs;
  const deltaMs = Math.max(minimumDelta, requestedDelta);
  const ranges = new Map<string, { startMs: number; endMs: number }>([
    [cue.block.id, { startMs: cue.startMs, endMs: cue.endMs + deltaMs }],
  ]);
  for (const candidate of cues.slice(index + 1))
    ranges.set(candidate.block.id, {
      startMs: candidate.startMs + deltaMs,
      endMs: candidate.endMs + deltaMs,
    });
  const updated = replaceCueRanges(fragment, ranges);
  return deltaMs > 0 && fragment.timeline
    ? withTimelineDuration(updated, fragment.timeline.durationMs + deltaMs)
    : updated;
}

export function setTimelineCueEdge(
  fragment: GalgameStoryFragment,
  cueId: string,
  edge: "start" | "end",
  requestedMs: number,
  keepContinuous = true,
  precise = true,
) {
  const cues = timelineCues(fragment);
  const index = cues.findIndex((cue) => cue.block.id === cueId);
  const cue = cues[index];
  if (!cue) return fragment;
  const previous = cues[index - 1];
  const next = cues[index + 1];
  if (edge === "start" && keepContinuous && previous)
    return resizeTimelineBoundary(
      fragment,
      previous.block.id,
      requestedMs,
      precise,
    );
  if (edge === "end" && keepContinuous && next)
    return resizeTimelineBoundary(fragment, cue.block.id, requestedMs, precise);

  const requested = snapTimelineTime(requestedMs, precise);
  const startMs =
    edge === "start"
      ? Math.min(
          cue.endMs - TIMELINE_MIN_CUE_MS,
          Math.max(previous?.endMs ?? 0, requested),
        )
      : cue.startMs;
  const endMs =
    edge === "end"
      ? Math.max(
          cue.startMs + TIMELINE_MIN_CUE_MS,
          Math.min(next?.startMs ?? requested, requested),
        )
      : cue.endMs;
  return expandTimelineTo(
    replaceCueRanges(fragment, new Map([[cue.block.id, { startMs, endMs }]])),
    endMs,
  );
}

export function setTimelineGapEdge(
  fragment: GalgameStoryFragment,
  gapId: string,
  edge: "start" | "end",
  requestedMs: number,
  precise = true,
) {
  const gap = timelineGaps(fragment).find(
    (candidate) => candidate.id === gapId,
  );
  if (!gap) return fragment;
  const cues = timelineCues(fragment);
  const previous = cues.find((cue) => cue.block.id === gap.previousCueId);
  const next = cues.find((cue) => cue.block.id === gap.nextCueId);
  const requested = snapTimelineTime(requestedMs, precise);
  const ranges = new Map<string, { startMs: number; endMs: number }>();
  if (edge === "start" && previous) {
    const endMs = Math.min(
      next?.startMs ?? fragment.timeline?.durationMs ?? requested,
      Math.max(previous.startMs + TIMELINE_MIN_CUE_MS, requested),
    );
    ranges.set(previous.block.id, { startMs: previous.startMs, endMs });
  }
  if (edge === "end" && next) {
    const startMs = Math.max(
      previous?.endMs ?? 0,
      Math.min(next.endMs - TIMELINE_MIN_CUE_MS, requested),
    );
    ranges.set(next.block.id, { startMs, endMs: next.endMs });
  }
  return ranges.size ? replaceCueRanges(fragment, ranges) : fragment;
}

export function moveTimelineCue(
  fragment: GalgameStoryFragment,
  cueId: string,
  requestedDeltaMs: number,
  options: {
    precise?: boolean;
    ripple?: boolean;
    keepContinuous?: boolean;
  } = {},
) {
  const cues = timelineCues(fragment);
  const index = cues.findIndex((cue) => cue.block.id === cueId);
  const cue = cues[index];
  if (!cue) return fragment;
  const previous = cues[index - 1];
  const next = cues[index + 1];
  let deltaMs = snapTimelineTime(requestedDeltaMs, options.precise ?? false);

  if (options.ripple) {
    deltaMs = Math.max((previous?.endMs ?? 0) - cue.startMs, deltaMs);
    const updated = replaceCueRanges(
      fragment,
      new Map(
        cues.slice(index).map((candidate) => [
          candidate.block.id,
          {
            startMs: candidate.startMs + deltaMs,
            endMs: candidate.endMs + deltaMs,
          },
        ]),
      ),
    );
    return deltaMs > 0 && fragment.timeline
      ? withTimelineDuration(updated, fragment.timeline.durationMs + deltaMs)
      : updated;
  }

  if (options.keepContinuous !== false) {
    const previousIsContinuous = previous?.endMs === cue.startMs;
    const nextIsContinuous = next?.startMs === cue.endMs;
    const minimumDelta = previous
      ? previousIsContinuous
        ? previous.startMs + TIMELINE_MIN_CUE_MS - cue.startMs
        : previous.endMs - cue.startMs
      : -cue.startMs;
    const maximumDelta = next
      ? nextIsContinuous
        ? next.endMs - TIMELINE_MIN_CUE_MS - cue.endMs
        : next.startMs - cue.endMs
      : deltaMs;
    deltaMs = Math.max(minimumDelta, Math.min(maximumDelta, deltaMs));
    const ranges = new Map<string, { startMs: number; endMs: number }>([
      [
        cue.block.id,
        {
          startMs: cue.startMs + deltaMs,
          endMs: cue.endMs + deltaMs,
        },
      ],
    ]);
    if (previous && previousIsContinuous)
      ranges.set(previous.block.id, {
        startMs: previous.startMs,
        endMs: cue.startMs + deltaMs,
      });
    if (next && nextIsContinuous)
      ranges.set(next.block.id, {
        startMs: cue.endMs + deltaMs,
        endMs: next.endMs,
      });
    return expandTimelineTo(
      replaceCueRanges(fragment, ranges),
      cue.endMs + deltaMs,
    );
  }

  deltaMs = Math.max(
    (previous?.endMs ?? 0) - cue.startMs,
    Math.min(next ? next.startMs - cue.endMs : deltaMs, deltaMs),
  );
  return expandTimelineTo(
    replaceCueRanges(
      fragment,
      new Map([
        [
          cue.block.id,
          { startMs: cue.startMs + deltaMs, endMs: cue.endMs + deltaMs },
        ],
      ]),
    ),
    cue.endMs + deltaMs,
  );
}

export function activeTimelineCue(
  fragment: GalgameStoryFragment,
  milliseconds: number,
) {
  return timelineCues(fragment).find(
    (cue) => cue.startMs <= milliseconds && milliseconds < cue.endMs,
  );
}
