import type { GalgameStoryBlock } from "@features/galgame-workshop/api";

export type GalgameStoryDialogueBlock = Extract<
  GalgameStoryBlock,
  { type: "dialogue" }
>;

export function dialogueSpeakerIds(block: GalgameStoryDialogueBlock) {
  const speakers = block.speakerIds?.filter(Boolean) ?? [];
  return speakers.length ? speakers : [block.characterId];
}

export function withDialogueSpeakers(
  block: GalgameStoryDialogueBlock,
  speakerIds: string[],
): GalgameStoryDialogueBlock {
  const unique = [...new Set(speakerIds.filter(Boolean))];
  const normalized = unique.length ? unique : [block.characterId];
  const primaryChanged = normalized[0] !== block.characterId;
  return {
    ...block,
    characterId: normalized[0],
    speakerIds: normalized.length > 1 ? normalized : null,
    expressionId: primaryChanged ? null : block.expressionId,
  };
}
