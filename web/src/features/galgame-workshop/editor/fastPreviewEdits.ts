import type { GalgameStoryProject } from "@features/galgame-workshop/api";
import {
  applyFastPreviewDialogueEdit,
  type FastPreviewDialogueEdit,
} from "@features/galgame-workshop/editor/fastPreviewDialogueEdit";
import {
  applyFastPreviewStageExpressionEdit,
  type FastPreviewStageExpressionEdit,
} from "@features/galgame-workshop/editor/fastPreviewStageExpressionEdit";
import { updateBlock } from "@features/galgame-workshop/editor/model";

export type FastPreviewStoryEdit =
  | ({ type: "dialogue" } & FastPreviewDialogueEdit)
  | ({ type: "stageExpression" } & FastPreviewStageExpressionEdit);

export type FastPreviewStoryEditResult = {
  document: GalgameStoryProject;
  storyRevision: number;
};

export function applyFastPreviewStoryEdits(
  document: GalgameStoryProject,
  edits: FastPreviewStoryEdit[],
) {
  return edits.reduce((current, edit) => {
    if (edit.type === "stageExpression")
      return applyFastPreviewStageExpressionEdit(current, edit);
    return updateBlock(current, edit.fragmentId, edit.blockId, (block) =>
      block.type === "dialogue"
        ? applyFastPreviewDialogueEdit(block, edit)
        : block,
    );
  }, document);
}
