import type {
  GalgameStoryBlock,
  GalgameStoryFragment,
} from "@features/galgame-workshop/api";

export const TIMELINE_MIN_CUE_MS = 100;
export const TIMELINE_SNAP_MS = 100;

export type GalgameTimedBlock = Extract<
  GalgameStoryBlock,
  { type: "dialogue" | "narration" | "storyParagraph" | "systemMessage" }
>;

export function isTimelineCueBlock(
  block: GalgameStoryBlock,
): block is GalgameTimedBlock {
  return (
    block.type === "dialogue" ||
    block.type === "narration" ||
    block.type === "storyParagraph" ||
    block.type === "systemMessage"
  );
}

export type GalgameTimelinePointBlock = Extract<
  GalgameStoryBlock,
  {
    type:
      | "scene"
      | "showCg"
      | "hideCg"
      | "showCharacter"
      | "removeCharacter"
      | "audio";
  }
>;

export type GalgameTimelineCharacterBlock = Extract<
  GalgameTimelinePointBlock,
  { type: "showCharacter" | "removeCharacter" }
>;

export type GalgameTimelineCharacterTiming =
  | { mode: "dialogue"; dialogueBlockId: string }
  | { mode: "timelineEnd" }
  | { mode: "independent"; timeMs: number };

export type GalgameTimelineEvent = {
  block: GalgameStoryBlock;
  blockIndex: number;
  timeMs: number;
  priority: number;
  explicit: boolean;
};

export type GalgameTimelinePlaybackStep = {
  startMs: number;
  endMs: number;
  contentBlockIndex?: number;
};

export type GalgameTimelineAudioState = {
  bgm?: Extract<GalgameTimelinePointBlock, { type: "audio" }>;
  ambient?: Extract<GalgameTimelinePointBlock, { type: "audio" }>;
};

export type GalgameTimelineAudioPlayback = {
  block: Extract<GalgameTimelinePointBlock, { type: "audio" }>;
  startedAtMs: number;
};

export type GalgameTimelineAudioPlaybackState = {
  bgm?: GalgameTimelineAudioPlayback;
  ambient?: GalgameTimelineAudioPlayback;
};

export type GalgameTimelineCue = {
  block: GalgameTimedBlock;
  blockIndex: number;
  cueIndex: number;
  startMs: number;
  endMs: number;
};

type TimelineCueCacheEntry = {
  blocks: GalgameStoryFragment["blocks"];
  timeline: GalgameStoryFragment["timeline"];
  cues: GalgameTimelineCue[];
};

type TimelineEventCacheEntry = {
  blocks: GalgameStoryFragment["blocks"];
  timeline: GalgameStoryFragment["timeline"];
  events: GalgameTimelineEvent[];
};

const timelineCueCache = new WeakMap<
  GalgameStoryFragment,
  TimelineCueCacheEntry
>();
const timelineEventCache = new WeakMap<
  GalgameStoryFragment,
  TimelineEventCacheEntry
>();

export type GalgameTimelineGap = {
  id: string;
  kind: "leading" | "internal" | "trailing";
  startMs: number;
  endMs: number;
  previousCueId?: string;
  nextCueId?: string;
};

export type GalgameTimelineCgRange = {
  id: string;
  showBlock: Extract<GalgameTimelinePointBlock, { type: "showCg" }>;
  startMs: number;
  endMs: number;
  endBlock?: Extract<GalgameTimelinePointBlock, { type: "showCg" | "hideCg" }>;
  endKind: "hide" | "replace" | "timeline";
};

export function timelineCues(fragment: GalgameStoryFragment) {
  const cached = timelineCueCache.get(fragment);
  if (
    cached &&
    cached.blocks === fragment.blocks &&
    cached.timeline === fragment.timeline
  )
    return cached.cues;
  const cues = (fragment.blocks ?? [])
    .flatMap((block, blockIndex) => {
      if (
        !isTimelineCueBlock(block) ||
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
  timelineCueCache.set(fragment, {
    blocks: fragment.blocks,
    timeline: fragment.timeline,
    cues,
  });
  return cues;
}

function eventPriority(block: GalgameStoryBlock) {
  if (block.type === "scene") return 0;
  if (block.type === "removeCharacter") return 1;
  if (block.type === "showCharacter") return 2;
  if (block.type === "showCg" || block.type === "hideCg") return 3;
  if (block.type === "audio" && block.action === "stop") return 4;
  if (
    block.type === "audio" &&
    block.action === "play" &&
    block.channel !== "sfx"
  )
    return 5;
  if (block.type === "audio") return 6;
  if (isTimelineCueBlock(block)) return 7;
  return 8;
}

export function effectivePointTime(
  fragment: GalgameStoryFragment,
  blockIndex: number,
) {
  const block = fragment.blocks?.[blockIndex];
  if (
    !block ||
    (block.type !== "scene" &&
      block.type !== "showCg" &&
      block.type !== "hideCg" &&
      block.type !== "showCharacter" &&
      block.type !== "removeCharacter" &&
      block.type !== "audio")
  )
    return undefined;
  if (block.atMs != null) return block.atMs;
  if (!fragment.timeline) return undefined;
  const cues = timelineCues(fragment);
  const next = cues.find((cue) => cue.blockIndex > blockIndex);
  if (next)
    return block.type === "showCharacter" || block.type === "removeCharacter"
      ? next.startMs
      : cues[0]?.blockIndex > blockIndex
        ? 0
        : next.startMs;
  return fragment.timeline.durationMs;
}

export function timelineCharacterTiming(
  fragment: GalgameStoryFragment,
  blockId: string,
): GalgameTimelineCharacterTiming | undefined {
  const blocks = fragment.blocks ?? [];
  const blockIndex = blocks.findIndex((block) => block.id === blockId);
  const block = blocks[blockIndex];
  if (
    !block ||
    (block.type !== "showCharacter" && block.type !== "removeCharacter")
  )
    return undefined;
  if (block.atMs != null) return { mode: "independent", timeMs: block.atMs };
  const dialogue = blocks
    .slice(blockIndex + 1)
    .find((candidate) => candidate.type === "dialogue");
  return dialogue
    ? { mode: "dialogue", dialogueBlockId: dialogue.id }
    : { mode: "timelineEnd" };
}

export function attachTimelineCharacterEvent(
  fragment: GalgameStoryFragment,
  blockId: string,
  dialogueBlockId: string,
) {
  const blocks = fragment.blocks ?? [];
  const blockIndex = blocks.findIndex((block) => block.id === blockId);
  const targetIndex = blocks.findIndex(
    (block) => block.id === dialogueBlockId && block.type === "dialogue",
  );
  const block = blocks[blockIndex];
  if (
    blockIndex < 0 ||
    targetIndex < 0 ||
    !block ||
    (block.type !== "showCharacter" && block.type !== "removeCharacter")
  )
    return fragment;

  const attachedBlock = { ...block };
  delete attachedBlock.atMs;
  const nextDialogue = blocks
    .slice(blockIndex + 1)
    .find((candidate) => candidate.type === "dialogue");
  if (nextDialogue?.id === dialogueBlockId)
    return {
      ...fragment,
      blocks: blocks.map((candidate) =>
        candidate.id === blockId ? attachedBlock : candidate,
      ),
    };

  const withoutBlock = blocks.filter((candidate) => candidate.id !== blockId);
  const insertionIndex = withoutBlock.findIndex(
    (candidate) => candidate.id === dialogueBlockId,
  );
  if (insertionIndex < 0) return fragment;
  return {
    ...fragment,
    blocks: [
      ...withoutBlock.slice(0, insertionIndex),
      attachedBlock,
      ...withoutBlock.slice(insertionIndex),
    ],
  };
}

export function timelineEvents(fragment: GalgameStoryFragment) {
  const cached = timelineEventCache.get(fragment);
  if (
    cached &&
    cached.blocks === fragment.blocks &&
    cached.timeline === fragment.timeline
  )
    return cached.events;
  const events = (fragment.blocks ?? [])
    .flatMap((block, blockIndex): GalgameTimelineEvent[] => {
      if (isTimelineCueBlock(block) && block.startMs != null)
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
  timelineEventCache.set(fragment, {
    blocks: fragment.blocks,
    timeline: fragment.timeline,
    events,
  });
  return events;
}

export function timelineCgRanges(
  fragment: GalgameStoryFragment,
): GalgameTimelineCgRange[] {
  const durationMs = fragment.timeline?.durationMs ?? 0;
  const events = timelineEvents(fragment).filter(
    (event) => event.block.type === "showCg" || event.block.type === "hideCg",
  );
  return events.flatMap((event, index) => {
    if (event.block.type !== "showCg") return [];
    const next = events[index + 1];
    const endBlock =
      next?.block.type === "showCg" || next?.block.type === "hideCg"
        ? next.block
        : undefined;
    return [
      {
        id: `cg-range:${event.block.id}`,
        showBlock: event.block,
        startMs: event.timeMs,
        endMs: next?.timeMs ?? durationMs,
        endBlock,
        endKind:
          endBlock?.type === "hideCg"
            ? ("hide" as const)
            : endBlock?.type === "showCg"
              ? ("replace" as const)
              : ("timeline" as const),
      },
    ];
  });
}

export function timelineStructureEvents(fragment: GalgameStoryFragment) {
  const terminalMs = fragment.timeline?.durationMs ?? 0;
  return (fragment.blocks ?? []).flatMap(
    (block, blockIndex): GalgameTimelineEvent[] =>
      block.type === "branch" || block.type === "endChapter"
        ? [
            {
              block,
              blockIndex,
              timeMs: terminalMs,
              priority: eventPriority(block),
              explicit: true,
            },
          ]
        : [],
  );
}

export function timelinePlaybackSteps(fragment: GalgameStoryFragment) {
  const cues = [...timelineCues(fragment)].sort(
    (left, right) =>
      left.startMs - right.startMs || left.blockIndex - right.blockIndex,
  );
  const durationMs = fragment.timeline?.durationMs ?? cues.at(-1)?.endMs ?? 0;
  if (!durationMs) return [];

  const steps: GalgameTimelinePlaybackStep[] = [];
  if (!cues.length) {
    steps.push({
      startMs: 0,
      endMs: durationMs,
    });
  } else {
    if (cues[0].startMs > 0)
      steps.push({
        startMs: 0,
        endMs: cues[0].startMs,
      });
    for (const [index, cue] of cues.entries())
      steps.push({
        startMs: cue.startMs,
        endMs: Math.max(cue.endMs, cues[index + 1]?.startMs ?? durationMs),
        contentBlockIndex: cue.blockIndex,
      });
  }
  return steps;
}

export function timelineAudioStateAt(
  fragment: GalgameStoryFragment,
  milliseconds: number,
) {
  const playback = timelineAudioPlaybackStateAt(fragment, milliseconds);
  return {
    bgm: playback.bgm?.block,
    ambient: playback.ambient?.block,
  } satisfies GalgameTimelineAudioState;
}

export function timelineAudioPlaybackStateAt(
  fragment: GalgameStoryFragment,
  milliseconds: number,
) {
  const state: GalgameTimelineAudioPlaybackState = {};
  for (const event of timelineEvents(fragment)) {
    if (event.timeMs > milliseconds || event.block.type !== "audio") continue;
    if (event.block.channel !== "bgm" && event.block.channel !== "ambient")
      continue;
    if (event.block.action === "stop") delete state[event.block.channel];
    else
      state[event.block.channel] = {
        block: event.block,
        startedAtMs: event.timeMs,
      };
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
  const blocks = fragment.blocks ?? [];
  const terminalIndex = blocks.findIndex(
    (candidate) =>
      candidate.type === "branch" || candidate.type === "endChapter",
  );
  const appendBeforeTerminator = (nextBlock: GalgameStoryBlock) =>
    terminalIndex < 0
      ? [...blocks, nextBlock]
      : [
          ...blocks.slice(0, terminalIndex),
          nextBlock,
          ...blocks.slice(terminalIndex),
        ];
  if (!fragment.timeline)
    return { ...fragment, blocks: appendBeforeTerminator(block) };
  const cues = timelineCues(fragment);
  const requested = Math.max(
    0,
    requestedAtMs ??
      (isTimelineCueBlock(block)
        ? (cues.at(-1)?.endMs ?? 0) + (cues.length ? 300 : 0)
        : fragment.timeline.durationMs),
  );
  const estimatedDuration = isTimelineCueBlock(block)
    ? estimatedCueDuration(block.text)
    : 0;
  let atMs = requested;
  if (estimatedDuration)
    for (const cue of cues)
      if (atMs < cue.endMs && atMs + estimatedDuration > cue.startMs)
        atMs = cue.endMs + 300;
  if (block.type === "hideCg") {
    const insertionIndex = terminalIndex < 0 ? blocks.length : terminalIndex;
    const showMs = previousActiveCgShowTime(fragment, insertionIndex);
    if (showMs != null) atMs = Math.max(atMs, showMs + TIMELINE_MIN_CUE_MS);
  }
  const placed = isTimelineCueBlock(block)
    ? {
        ...block,
        startMs: atMs,
        endMs: atMs + estimatedDuration,
      }
    : block.type === "scene" ||
        block.type === "showCg" ||
        block.type === "hideCg" ||
        block.type === "showCharacter" ||
        block.type === "removeCharacter" ||
        block.type === "audio"
      ? { ...block, atMs }
      : block;
  const endMs = isTimelineCueBlock(placed)
    ? (placed.endMs ?? atMs) + 500
    : atMs;
  return expandTimelineTo(
    { ...fragment, blocks: appendBeforeTerminator(placed) },
    endMs,
  );
}

export function enableFragmentTimeline(fragment: GalgameStoryFragment) {
  if (fragment.timeline) return fragment;
  let cursorMs = 0;
  const timedBlocks = (fragment.blocks ?? []).map((block) => {
    if (!isTimelineCueBlock(block)) return block;
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
      if (block.type === "showCharacter" || block.type === "removeCharacter")
        return block;
      if (
        block.type !== "scene" &&
        block.type !== "showCg" &&
        block.type !== "hideCg" &&
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

export function setTimelinePointTime(
  fragment: GalgameStoryFragment,
  blockId: string,
  requestedMs: number,
  precise = false,
) {
  if (!fragment.timeline) return fragment;
  const blocks = fragment.blocks ?? [];
  const blockIndex = blocks.findIndex((block) => block.id === blockId);
  const target = blocks[blockIndex];
  let minimumMs = 0;
  if (target?.type === "hideCg") {
    const showMs = previousActiveCgShowTime(fragment, blockIndex);
    if (showMs != null) minimumMs = showMs + TIMELINE_MIN_CUE_MS;
  }
  const atMs = Math.max(
    minimumMs,
    Math.max(0, snapTimelineTime(requestedMs, precise)),
  );
  return expandTimelineTo(
    {
      ...fragment,
      blocks: (fragment.blocks ?? []).map((block) =>
        block.id === blockId &&
        (block.type === "scene" ||
          block.type === "showCg" ||
          block.type === "hideCg" ||
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

function previousActiveCgShowTime(
  fragment: GalgameStoryFragment,
  beforeBlockIndex: number,
) {
  const blocks = fragment.blocks ?? [];
  for (let index = beforeBlockIndex - 1; index >= 0; index -= 1) {
    const candidate = blocks[index];
    if (candidate.type === "hideCg") return undefined;
    if (candidate.type !== "showCg") continue;
    return effectivePointTime(fragment, index);
  }
  return undefined;
}

function defaultCgHideId() {
  const suffix =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `hide-cg-${suffix}`;
}

function cgEventBounds(fragment: GalgameStoryFragment, blockId: string) {
  const events = timelineEvents(fragment).filter(
    (event) => event.block.type === "showCg" || event.block.type === "hideCg",
  );
  const index = events.findIndex((event) => event.block.id === blockId);
  return {
    previousMs: index > 0 ? events[index - 1].timeMs : undefined,
    nextMs: index >= 0 ? events[index + 1]?.timeMs : undefined,
  };
}

export function setTimelineCgRangeEdge(
  fragment: GalgameStoryFragment,
  showBlockId: string,
  edge: "start" | "end",
  requestedMs: number,
  precise = false,
  makeHideId: () => string = defaultCgHideId,
) {
  if (!fragment.timeline) return fragment;
  const range = timelineCgRanges(fragment).find(
    (candidate) => candidate.showBlock.id === showBlockId,
  );
  if (!range) return fragment;
  const snapped = Math.max(0, snapTimelineTime(requestedMs, precise));
  if (edge === "start") {
    const { previousMs } = cgEventBounds(fragment, showBlockId);
    const startMs = Math.min(
      range.endMs - TIMELINE_MIN_CUE_MS,
      Math.max(
        (previousMs ?? -TIMELINE_MIN_CUE_MS) + TIMELINE_MIN_CUE_MS,
        snapped,
      ),
    );
    return setTimelinePointTime(fragment, showBlockId, startMs, true);
  }

  const endMs = Math.max(range.startMs + TIMELINE_MIN_CUE_MS, snapped);
  if (!range.endBlock)
    return appendBlockToTimeline(
      fragment,
      {
        id: makeHideId(),
        type: "hideCg",
        transition: { durationMs: 400, fade: true },
      },
      endMs,
    );

  const { nextMs } = cgEventBounds(fragment, range.endBlock.id);
  const minimumEndMs = range.startMs + TIMELINE_MIN_CUE_MS;
  const maximumEndMs =
    nextMs == null ? Number.POSITIVE_INFINITY : nextMs - TIMELINE_MIN_CUE_MS;
  if (maximumEndMs < minimumEndMs) return fragment;
  const boundedEndMs = Math.max(minimumEndMs, Math.min(maximumEndMs, endMs));
  return setTimelinePointTime(fragment, range.endBlock.id, boundedEndMs, true);
}

export function moveTimelineCgRange(
  fragment: GalgameStoryFragment,
  showBlockId: string,
  requestedDeltaMs: number,
  precise = false,
  makeHideId: () => string = defaultCgHideId,
) {
  if (!fragment.timeline) return fragment;
  let source = fragment;
  let range = timelineCgRanges(source).find(
    (candidate) => candidate.showBlock.id === showBlockId,
  );
  if (!range) return fragment;
  if (!range.endBlock) {
    source = setTimelineCgRangeEdge(
      source,
      showBlockId,
      "end",
      range.endMs,
      true,
      makeHideId,
    );
    range = timelineCgRanges(source).find(
      (candidate) => candidate.showBlock.id === showBlockId,
    );
  }
  if (!range?.endBlock) return fragment;

  const requestedDelta = snapTimelineTime(requestedDeltaMs, precise);
  const { previousMs } = cgEventBounds(source, showBlockId);
  const { nextMs } = cgEventBounds(source, range.endBlock.id);
  const minimumDelta = Math.max(
    -range.startMs,
    (previousMs ?? -TIMELINE_MIN_CUE_MS) + TIMELINE_MIN_CUE_MS - range.startMs,
  );
  const maximumDelta =
    nextMs == null
      ? Number.POSITIVE_INFINITY
      : nextMs - TIMELINE_MIN_CUE_MS - range.endMs;
  if (maximumDelta < minimumDelta) return source;
  const deltaMs = Math.min(
    maximumDelta,
    Math.max(minimumDelta, requestedDelta),
  );
  if (!deltaMs) return source;
  const movingIds = new Set([showBlockId, range.endBlock.id]);
  return expandTimelineTo(
    {
      ...source,
      blocks: (source.blocks ?? []).map((block, blockIndex) => {
        if (!movingIds.has(block.id)) return block;
        const timeMs = effectivePointTime(source, blockIndex);
        return timeMs == null ||
          (block.type !== "showCg" && block.type !== "hideCg")
          ? block
          : { ...block, atMs: timeMs + deltaMs };
      }),
    },
    range.endMs + deltaMs,
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
      isTimelineCueBlock(block) &&
      block.startMs != null &&
      block.endMs != null
    ) {
      if (pending.length) markers.set(block.id, pending);
      pending = [];
      continue;
    }
    if (
      block.type === "scene" ||
      block.type === "showCg" ||
      block.type === "hideCg" ||
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
      if (!range || !isTimelineCueBlock(block)) return block;
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
