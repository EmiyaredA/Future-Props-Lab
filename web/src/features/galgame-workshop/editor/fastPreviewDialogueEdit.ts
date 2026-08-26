import type { GalgameStoryProject } from "@features/galgame-workshop/api";
import type { GalgameStoryDialogueBlock } from "@features/galgame-workshop/editor/dialogue";
import { plainRichText } from "@features/galgame-workshop/editor/richText";

export type FastPreviewDialogueEdit = {
  fragmentId: string;
  blockId: string;
  text: string;
  expressionId: string | null;
  portrait: GalgameStoryDialogueBlock["portrait"];
};

export type FastPreviewDialogueEditResult = {
  document: GalgameStoryProject;
  storyRevision: number;
};

export type FastPreviewDialogueDraft = {
  fragmentId: string;
  blockId: string;
  text: string;
  expressionId: string;
  portrait: GalgameStoryDialogueBlock["portrait"];
};

export const EMPTY_DIALOGUE_DRAFT: FastPreviewDialogueDraft = {
  fragmentId: "",
  blockId: "",
  text: "",
  expressionId: "",
  portrait: null,
};

export function applyFastPreviewDialogueEdit(
  block: GalgameStoryDialogueBlock,
  edit: FastPreviewDialogueEdit,
): GalgameStoryDialogueBlock {
  return {
    ...block,
    text: edit.text,
    content: plainRichText(edit.text),
    expressionId: edit.expressionId,
    portrait: edit.portrait,
  };
}
