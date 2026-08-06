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

  const durationMs = fragment.timeline?.durationMs ?? cue.endMs;
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
          Math.min(next?.startMs ?? durationMs, requested),
        )
      : cue.endMs;
  return replaceCueRanges(
    fragment,
    new Map([[cue.block.id, { startMs, endMs }]]),
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
  const durationMs = fragment.timeline?.durationMs ?? cues.at(-1)?.endMs ?? 0;
  let deltaMs = snapTimelineTime(requestedDeltaMs, options.precise ?? false);

  if (options.ripple) {
    const last = cues.at(-1)!;
    deltaMs = Math.max(
      (previous?.endMs ?? 0) - cue.startMs,
      Math.min(durationMs - last.endMs, deltaMs),
    );
    return replaceCueRanges(
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
      : durationMs - cue.endMs;
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
    return replaceCueRanges(fragment, ranges);
  }

  deltaMs = Math.max(
    (previous?.endMs ?? 0) - cue.startMs,
    Math.min((next?.startMs ?? durationMs) - cue.endMs, deltaMs),
  );
  return replaceCueRanges(
    fragment,
    new Map([
      [
        cue.block.id,
        { startMs: cue.startMs + deltaMs, endMs: cue.endMs + deltaMs },
      ],
    ]),
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
