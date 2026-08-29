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
      | "setStageCast"
      | "removeCharacter"
      | "audio";
  }
>;

export type GalgameTimelineCharacterBlock = Extract<
  GalgameTimelinePointBlock,
  { type: "showCharacter" | "setStageCast" | "removeCharacter" }
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
  if (block.type === "setStageCast") return 2;
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
      block.type !== "setStageCast" &&
      block.type !== "removeCharacter" &&
      block.type !== "audio")
  )
    return undefined;
  if (block.atMs != null) return block.atMs;
  if (!fragment.timeline) return undefined;
  const cues = timelineCues(fragment);
  const next = cues.find((cue) => cue.blockIndex > blockIndex);
  if (next)
    return block.type === "showCharacter" ||
      block.type === "setStageCast" ||
      block.type === "removeCharacter"
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
    (block.type !== "showCharacter" &&
      block.type !== "setStageCast" &&
      block.type !== "removeCharacter")
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
    (block.type !== "showCharacter" &&
      block.type !== "setStageCast" &&
      block.type !== "removeCharacter")
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
