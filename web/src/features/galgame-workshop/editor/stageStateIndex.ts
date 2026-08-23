import type {
  GalgameStoryBlock,
  GalgameStoryFragment,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import {
  applyAutomaticStageBlock,
  emptyStageState,
  enterContentBlock,
  leaveContentBlock,
  type GalgameStageState,
} from "@features/galgame-workshop/editor/stage";

const AUTOMATIC_STAGE_BLOCKS = new Set<GalgameStoryBlock["type"]>([
  "scene",
  "showCg",
  "hideCg",
  "showCharacter",
  "setStageCast",
  "removeCharacter",
  "destroyScene",
  "camera",
  "resetCamera",
  "particle",
  "floatingText",
  "curtain",
  "video",
  "stageAnimation",
  "animateSprite",
  "autoPlay",
  "switchDialogueStyle",
]);

export type StageStateIndex = {
  beforeBlock: ReadonlyMap<string, GalgameStageState>;
  afterBlock: ReadonlyMap<string, GalgameStageState>;
  afterRawIndex: readonly GalgameStageState[];
  traversalCount: number;
};

/** Build every post-block stage snapshot with one forward pass. */
export function buildStageStateIndex(
  document: GalgameStoryProject,
  fragment: GalgameStoryFragment,
): StageStateIndex {
  const afterBlock = new Map<string, GalgameStageState>();
  const beforeBlock = new Map<string, GalgameStageState>();
  const afterRawIndex: GalgameStageState[] = [];
  let state = emptyStageState();
  let previousContent: GalgameStoryBlock | undefined;
  let traversalCount = 0;

  for (const block of fragment.blocks ?? []) {
    traversalCount += 1;
    if (previousContent) {
      state = leaveContentBlock(state, previousContent);
      previousContent = undefined;
    }
    beforeBlock.set(block.id, state);
    if (AUTOMATIC_STAGE_BLOCKS.has(block.type))
      state = applyAutomaticStageBlock(state, block, document);
    else if (block.type !== "audio" && block.type !== "endChapter") {
      state = enterContentBlock(state, block, document);
      previousContent = block;
    }
    afterBlock.set(block.id, state);
    afterRawIndex.push(state);
  }
  return { beforeBlock, afterBlock, afterRawIndex, traversalCount };
}
