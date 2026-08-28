import type { GalgameStoryProject } from "@features/galgame-workshop/api";
import { updateBlock } from "@features/galgame-workshop/editor/model";

export type FastPreviewStageExpressionEdit = {
  fragmentId: string;
  blockId: string;
  characterId: string;
  expressionId: string | null;
};

export type FastPreviewStageExpressionDraft = Omit<
  FastPreviewStageExpressionEdit,
  "expressionId"
> & { expressionId: string };

export type FastPreviewStageExpressionEditResult = {
  document: GalgameStoryProject;
  storyRevision: number;
};

export function applyFastPreviewStageExpressionEdit(
  document: GalgameStoryProject,
  edit: FastPreviewStageExpressionEdit,
) {
  return updateBlock(document, edit.fragmentId, edit.blockId, (block) => {
    if (block.type === "showCharacter")
      return block.characterId === edit.characterId
        ? { ...block, expressionId: edit.expressionId }
        : block;
    if (block.type === "setStageCast")
      return {
        ...block,
        members: (block.members ?? []).map((member) =>
          member.characterId === edit.characterId
            ? { ...member, expressionId: edit.expressionId }
            : member,
        ),
      };
    return block;
  });
}

export function stageSourceExpressionId(
  document: GalgameStoryProject,
  draft: FastPreviewStageExpressionDraft,
) {
  const block = document.chapters
    ?.flatMap((chapter) => chapter.fragments ?? [])
    .find((fragment) => fragment.id === draft.fragmentId)
    ?.blocks?.find((candidate) => candidate.id === draft.blockId);
  if (
    block?.type === "showCharacter" &&
    block.characterId === draft.characterId
  )
    return block.expressionId ?? "";
  if (block?.type === "setStageCast")
    return (
      block.members?.find((member) => member.characterId === draft.characterId)
        ?.expressionId ?? ""
    );
  return undefined;
}
