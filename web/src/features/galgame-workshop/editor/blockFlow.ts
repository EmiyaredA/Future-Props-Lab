import type {
  GalgameStoryBlock,
  GalgameStoryFragment,
} from "@features/galgame-workshop/api";
import {
  dialogueSpeakerIds,
  type GalgameStoryDialogueBlock,
} from "@features/galgame-workshop/editor/dialogue";
import {
  isTerminator,
  stableId,
} from "@features/galgame-workshop/editor/model";
import {
  estimatedCueDuration,
  timelineCues,
} from "@features/galgame-workshop/editor/timeline";

const DEFAULT_CUE_GAP_MS = 300;
const DEFAULT_TIMELINE_TAIL_MS = 500;

export function continuingDialogueBlock(
  source: GalgameStoryDialogueBlock,
): GalgameStoryDialogueBlock {
  return {
    id: stableId(),
    type: "dialogue",
    characterId: source.characterId,
    speakerIds: source.speakerIds,
    expressionId: source.expressionId,
    displayNameId: source.displayNameId,
    text: "",
    voiceVolume: 100,
    hideDialogueAfter: false,
    portrait: source.portrait ? structuredClone(source.portrait) : null,
  };
}

export function sameDialogueGroup(
  left?: GalgameStoryBlock,
  right?: GalgameStoryBlock,
) {
  if (left?.type !== "dialogue" || right?.type !== "dialogue") return false;
  const speakerKey = (block: GalgameStoryDialogueBlock) =>
    [...new Set(dialogueSpeakerIds(block))].sort().join("|");
  return speakerKey(left) === speakerKey(right);
}

type TimedStoryBlock = Extract<
  GalgameStoryBlock,
  { type: "dialogue" | "narration" | "storyParagraph" | "systemMessage" }
>;

export type StoryBlockBundle = {
  id: string;
  primaryBlock: GalgameStoryBlock;
  blocks: GalgameStoryBlock[];
  attachedCharacterBlocks: Array<
    Extract<
      GalgameStoryBlock,
      { type: "showCharacter" | "setStageCast" | "removeCharacter" }
    >
  >;
};

function isTimedBlock(block: GalgameStoryBlock): block is TimedStoryBlock {
  return (
    block.type === "dialogue" ||
    block.type === "narration" ||
    block.type === "storyParagraph" ||
    block.type === "systemMessage"
  );
}

function isCharacterBlock(
  block: GalgameStoryBlock,
): block is Extract<
  GalgameStoryBlock,
  { type: "showCharacter" | "setStageCast" | "removeCharacter" }
> {
  return (
    block.type === "showCharacter" ||
    block.type === "setStageCast" ||
    block.type === "removeCharacter"
  );
}

function attachmentTargets(fragment: GalgameStoryFragment) {
  const blocks = fragment.blocks ?? [];
  const targets = new Map<string, string>();
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!isCharacterBlock(block) || block.atMs != null) continue;
    const dialogue = blocks
      .slice(index + 1)
      .find((candidate) => candidate.type === "dialogue");
    if (dialogue) targets.set(block.id, dialogue.id);
  }
  return targets;
}

export function storyBlockBundles(
  fragment: GalgameStoryFragment,
): StoryBlockBundle[] {
  const blocks = fragment.blocks ?? [];
  const targets = attachmentTargets(fragment);
  const attachments = new Map<string, GalgameStoryBlock[]>();
  for (const block of blocks) {
    const targetId = targets.get(block.id);
    if (!targetId) continue;
    attachments.set(targetId, [...(attachments.get(targetId) ?? []), block]);
  }
  return blocks.flatMap((block): StoryBlockBundle[] => {
    if (targets.has(block.id)) return [];
    const attached = attachments.get(block.id) ?? [];
    return [
      {
        id: block.id,
        primaryBlock: block,
        blocks: [...attached, block],
        attachedCharacterBlocks: attached.filter(isCharacterBlock),
      },
    ];
  });
}

export function storyBlockBundle(
  fragment: GalgameStoryFragment,
  blockId: string,
) {
  return storyBlockBundles(fragment).find((bundle) =>
    bundle.blocks.some((block) => block.id === blockId),
  );
}

export function canMoveStoryBlockBundle(
  fragment: GalgameStoryFragment,
  blockId: string,
  direction: -1 | 1,
) {
  const bundles = storyBlockBundles(fragment);
  const index = bundles.findIndex((bundle) =>
    bundle.blocks.some((block) => block.id === blockId),
  );
  const target = bundles[index + direction];
  return Boolean(
    index >= 0 &&
    target &&
    !isTerminator(bundles[index].primaryBlock) &&
    !isTerminator(target.primaryBlock),
  );
}

function replaceCueRanges(
  blocks: GalgameStoryBlock[],
  ranges: Map<string, { startMs: number; endMs: number }>,
) {
  return blocks.map((block) => {
    const range = ranges.get(block.id);
    return range && isTimedBlock(block) ? { ...block, ...range } : block;
  });
}

function explicitPointMaximum(blocks: GalgameStoryBlock[]) {
  return blocks.reduce(
    (maximum, block) =>
      "atMs" in block && typeof block.atMs === "number"
        ? Math.max(maximum, block.atMs)
        : maximum,
    0,
  );
}

function retimeReorderedCues(
  fragment: GalgameStoryFragment,
  reorderedBlocks: GalgameStoryBlock[],
) {
  if (!fragment.timeline) return reorderedBlocks;
  const previous = timelineCues(fragment);
  const next = reorderedBlocks.flatMap((block) =>
    isTimedBlock(block) && block.startMs != null && block.endMs != null
      ? [block]
      : [],
  );
  const firstChanged = next.findIndex(
    (block, index) => block.id !== previous[index]?.block.id,
  );
  if (firstChanged < 0 && next.length === previous.length)
    return reorderedBlocks;

  const metadata = new Map(
    previous.map((cue, index) => [
      cue.block.id,
      {
        durationMs: cue.endMs - cue.startMs,
        gapAfterMs:
          previous[index + 1] == null
            ? DEFAULT_CUE_GAP_MS
            : previous[index + 1].startMs - cue.endMs,
      },
    ]),
  );
  const changedIndex = Math.max(0, firstChanged);
  let cursorMs = previous[changedIndex]?.startMs ?? previous.at(-1)?.endMs ?? 0;
  const ranges = new Map<string, { startMs: number; endMs: number }>();
  for (const block of next.slice(changedIndex)) {
    const values = metadata.get(block.id) ?? {
      durationMs: estimatedCueDuration(block.text),
      gapAfterMs: DEFAULT_CUE_GAP_MS,
    };
    ranges.set(block.id, {
      startMs: cursorMs,
      endMs: cursorMs + values.durationMs,
    });
    cursorMs += values.durationMs + Math.max(0, values.gapAfterMs);
  }
  return replaceCueRanges(reorderedBlocks, ranges);
}

function timelineDurationAfterRetime(
  fragment: GalgameStoryFragment,
  blocks: GalgameStoryBlock[],
  preferredDuration?: number,
) {
  if (!fragment.timeline) return undefined;
  const lastCue = blocks
    .filter(isTimedBlock)
    .filter((block) => block.startMs != null && block.endMs != null)
    .at(-1);
  return Math.max(
    1,
    preferredDuration ?? 0,
    explicitPointMaximum(blocks),
    (lastCue?.endMs ?? 0) + DEFAULT_TIMELINE_TAIL_MS,
  );
}

function flattenBundles(bundles: StoryBlockBundle[]) {
  return bundles.flatMap((bundle) => bundle.blocks);
}

export function moveStoryBlockBundle(
  fragment: GalgameStoryFragment,
  blockId: string,
  direction: -1 | 1,
) {
  if (!canMoveStoryBlockBundle(fragment, blockId, direction)) return fragment;
  const bundles = storyBlockBundles(fragment);
  const index = bundles.findIndex((bundle) =>
    bundle.blocks.some((block) => block.id === blockId),
  );
  const reordered = [...bundles];
  [reordered[index], reordered[index + direction]] = [
    reordered[index + direction],
    reordered[index],
  ];
  let blocks = flattenBundles(reordered);
  blocks = retimeReorderedCues(fragment, blocks);
  return {
    ...fragment,
    ...(fragment.timeline
      ? {
          timeline: {
            durationMs: timelineDurationAfterRetime(
              fragment,
              blocks,
              fragment.timeline.durationMs,
            )!,
          },
        }
      : {}),
    blocks,
  };
}

function rawInsertionIndex(
  fragment: GalgameStoryFragment,
  beforeBundleId?: string,
) {
  const blocks = fragment.blocks ?? [];
  if (beforeBundleId) {
    const bundle = storyBlockBundle(fragment, beforeBundleId);
    const indexes = bundle?.blocks.map((member) =>
      blocks.findIndex((block) => block.id === member.id),
    );
    const valid = indexes?.filter((index) => index >= 0) ?? [];
    if (valid.length) return Math.min(...valid);
  }
  const terminatorIndex = blocks.findIndex(isTerminator);
  return terminatorIndex < 0 ? blocks.length : terminatorIndex;
}

function insertAt<T>(items: T[], index: number, item: T) {
  return [...items.slice(0, index), item, ...items.slice(index)];
}

export function insertStoryBlock(
  fragment: GalgameStoryFragment,
  block: GalgameStoryBlock,
  beforeBundleId?: string,
) {
  const blocks = fragment.blocks ?? [];
  const insertionIndex = rawInsertionIndex(fragment, beforeBundleId);
  if (!fragment.timeline)
    return { ...fragment, blocks: insertAt(blocks, insertionIndex, block) };

  const cues = timelineCues(fragment);
  const nextCue = cues.find((cue) => cue.blockIndex >= insertionIndex);
  if (isTimedBlock(block)) {
    const durationMs = estimatedCueDuration(block.text);
    const startMs =
      nextCue?.startMs ??
      (cues.length ? cues.at(-1)!.endMs + DEFAULT_CUE_GAP_MS : 0);
    const shiftMs = durationMs + DEFAULT_CUE_GAP_MS;
    const shiftedRanges = new Map(
      cues
        .filter((cue) => cue.startMs >= startMs)
        .map((cue) => [
          cue.block.id,
          {
            startMs: cue.startMs + shiftMs,
            endMs: cue.endMs + shiftMs,
          },
        ]),
    );
    const placed = { ...block, startMs, endMs: startMs + durationMs };
    const nextBlocks = insertAt(
      replaceCueRanges(blocks, shiftedRanges),
      insertionIndex,
      placed,
    );
    return {
      ...fragment,
      timeline: {
        durationMs: Math.max(
          fragment.timeline.durationMs + shiftMs,
          placed.endMs + DEFAULT_TIMELINE_TAIL_MS,
        ),
      },
      blocks: nextBlocks,
    };
  }

  const placed = { ...block };
  if ("atMs" in placed) delete placed.atMs;
  return {
    ...fragment,
    blocks: insertAt(blocks, insertionIndex, placed),
  };
}

export function deleteStoryBlockBundle(
  fragment: GalgameStoryFragment,
  blockId: string,
) {
  const bundle = storyBlockBundle(fragment, blockId);
  if (!bundle) return fragment;
  const deletedIds = new Set(bundle.blocks.map((block) => block.id));
  let blocks = (fragment.blocks ?? []).filter(
    (block) => !deletedIds.has(block.id),
  );
  if (!fragment.timeline || !isTimedBlock(bundle.primaryBlock))
    return { ...fragment, blocks };

  blocks = retimeReorderedCues(fragment, blocks);
  return {
    ...fragment,
    timeline: {
      durationMs: timelineDurationAfterRetime(fragment, blocks)!,
    },
    blocks,
  };
}
