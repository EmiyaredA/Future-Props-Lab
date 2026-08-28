import type {
  GalgameStoryBlock,
  GalgameStoryFragment,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import type { GalgameStoryDialogueBlock } from "@features/galgame-workshop/editor/dialogue";
import type { StageActor } from "@features/galgame-workshop/editor/stage";
import type { FastPreviewStageExpressionDraft } from "@features/galgame-workshop/editor/fastPreviewStageExpressionEdit";
import { timelineEvents } from "@features/galgame-workshop/editor/timeline";

export type FastPreviewStageActorEditor = {
  actor: StageActor;
  characterId: string;
  name: string;
  expressionLabel: string;
  previewExpressionId?: string;
  sourceExpressionId?: string;
  source?:
    | { kind: "dialogue"; block: GalgameStoryDialogueBlock }
    | {
        kind: "showCharacter";
        block: Extract<GalgameStoryBlock, { type: "showCharacter" }>;
      }
    | {
        kind: "setStageCast";
        block: Extract<GalgameStoryBlock, { type: "setStageCast" }>;
      };
  sourceBlock?: GalgameStoryDialogueBlock;
  stageExpressionDraft?: FastPreviewStageExpressionDraft;
};

function attachedBlockSource(
  fragment: GalgameStoryFragment,
  activeBlockIndex: number,
  characterId: string,
  autoRevealPortraits: boolean,
) {
  const blocks = fragment.blocks ?? [];
  for (
    let index = Math.min(activeBlockIndex, blocks.length - 1);
    index >= 0;
    index -= 1
  ) {
    const block = blocks[index];
    if (block.type === "dialogue" && block.characterId === characterId) {
      if (index === activeBlockIndex && autoRevealPortraits)
        return { kind: "dialogue" as const, block };
      if (block.portrait?.mode === "stage" && block.portrait.visible !== false)
        return block.portrait.keepAfter === false && index < activeBlockIndex
          ? undefined
          : { kind: "dialogue" as const, block };
      continue;
    }
    if (block.type === "showCharacter" && block.characterId === characterId)
      return { kind: "showCharacter" as const, block };
    if (
      block.type === "setStageCast" &&
      block.members?.some((member) => member.characterId === characterId)
    )
      return { kind: "setStageCast" as const, block };
    if (
      block.type === "removeCharacter" &&
      (block.all || block.characterId === characterId)
    )
      return undefined;
  }
  return undefined;
}

function dialogueSource(
  fragment: GalgameStoryFragment,
  activeBlockIndex: number,
  positionMs: number,
  characterId: string,
  autoRevealPortraits: boolean,
) {
  const blocks = fragment.blocks ?? [];
  const activeBlock = blocks[activeBlockIndex];
  if (
    activeBlock?.type === "dialogue" &&
    activeBlock.characterId === characterId
  )
    return { kind: "dialogue" as const, block: activeBlock };

  const events = timelineEvents(fragment);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.timeMs > positionMs) continue;
    const block = event.block;
    if (block.type === "scene" && block.clearCharacters) return undefined;
    if (block.type === "removeCharacter") {
      if (block.all || block.characterId === characterId) return undefined;
      continue;
    }
    if (block.type === "setStageCast") {
      return block.members?.some((member) => member.characterId === characterId)
        ? { kind: "setStageCast" as const, block }
        : undefined;
    }
    if (block.type === "showCharacter" && block.characterId === characterId)
      return { kind: "showCharacter" as const, block };
    if (block.type === "dialogue" && block.characterId === characterId) {
      if (
        block.portrait?.mode === "stage" &&
        block.portrait.visible !== false &&
        block.portrait.keepAfter !== false
      )
        return { kind: "dialogue" as const, block };
    }
  }
  return attachedBlockSource(
    fragment,
    activeBlockIndex,
    characterId,
    autoRevealPortraits,
  );
}

export function fastPreviewStageActorEditors({
  document,
  fragment,
  activeBlockIndex,
  positionMs,
  actors,
  autoRevealPortraits,
}: {
  document: GalgameStoryProject;
  fragment?: GalgameStoryFragment;
  activeBlockIndex?: number;
  positionMs?: number;
  actors: StageActor[];
  autoRevealPortraits: boolean;
}): FastPreviewStageActorEditor[] {
  if (!fragment || activeBlockIndex == null || positionMs == null) return [];
  return actors
    .filter((actor) => !actor.exiting)
    .map((actor) => {
      const character = document.characters?.find(
        (candidate) => candidate.id === actor.characterId,
      );
      const source = dialogueSource(
        fragment,
        activeBlockIndex,
        positionMs,
        actor.characterId,
        autoRevealPortraits,
      );
      const sourceExpressionId =
        source?.kind === "setStageCast"
          ? source.block.members?.find(
              (member) => member.characterId === actor.characterId,
            )?.expressionId
          : source?.block.expressionId;
      const previewExpressionId =
        sourceExpressionId ||
        actor.expressionId ||
        character?.defaultExpressionId ||
        undefined;
      const expression = character?.expressions?.find(
        (candidate) => candidate.id === previewExpressionId,
      );
      return {
        actor,
        characterId: actor.characterId,
        name: character?.name ?? actor.characterId,
        expressionLabel: expression?.label ?? "默认表情",
        previewExpressionId,
        sourceExpressionId: sourceExpressionId ?? undefined,
        source,
        sourceBlock: source?.kind === "dialogue" ? source.block : undefined,
        stageExpressionDraft:
          source && source.kind !== "dialogue"
            ? {
                fragmentId: fragment.id,
                blockId: source.block.id,
                characterId: actor.characterId,
                expressionId: sourceExpressionId ?? "",
              }
            : undefined,
      };
    });
}

export function fastPreviewExpressionOverrides(
  actors: FastPreviewStageActorEditor[],
) {
  return Object.fromEntries(
    actors.flatMap((actor) =>
      actor.source && actor.previewExpressionId
        ? [[actor.characterId, actor.previewExpressionId]]
        : [],
    ),
  );
}

function dialogueWarmupFileId(
  document: GalgameStoryProject,
  block: GalgameStoryBlock | undefined,
) {
  if (block?.type !== "dialogue") return undefined;
  const character = document.characters?.find(
    (candidate) => candidate.id === block.characterId,
  );
  const expressionId = block.expressionId ?? character?.defaultExpressionId;
  const expression = character?.expressions?.find(
    (candidate) => candidate.id === expressionId,
  );
  const assetId =
    expression?.renderMode === "frameSequence"
      ? expression.sequence?.frames[0]?.assetId
      : expression?.assetId;
  const asset = document.assets?.find((candidate) => candidate.id === assetId);
  return asset?.type === "image" ? asset.fileId : undefined;
}

function currentSpeakerExpressionFileIds(
  document: GalgameStoryProject,
  block: GalgameStoryBlock | undefined,
) {
  if (block?.type !== "dialogue") return [];
  const character = document.characters?.find(
    (candidate) => candidate.id === block.characterId,
  );
  return (character?.expressions ?? []).slice(0, 8).flatMap((expression) => {
    const assetId =
      expression.renderMode === "frameSequence"
        ? expression.sequence?.frames[0]?.assetId
        : expression.assetId;
    const asset = document.assets?.find(
      (candidate) => candidate.id === assetId,
    );
    return asset?.type === "image" ? [asset.fileId] : [];
  });
}

export function fastPreviewPortraitWarmupFileIds(
  document: GalgameStoryProject,
  blocks: Array<GalgameStoryBlock | undefined>,
) {
  return [
    ...new Set([
      ...blocks.flatMap((block) => {
        const fileId = dialogueWarmupFileId(document, block);
        return fileId ? [fileId] : [];
      }),
      ...currentSpeakerExpressionFileIds(document, blocks[1]),
    ]),
  ];
}
