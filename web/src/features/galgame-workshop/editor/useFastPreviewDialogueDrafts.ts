import { useCallback, useMemo, useState } from "react";
import type { GalgameStoryProject } from "@features/galgame-workshop/api";
import {
  applyFastPreviewDialogueEdit,
  EMPTY_DIALOGUE_DRAFT,
  type FastPreviewDialogueDraft,
} from "@features/galgame-workshop/editor/fastPreviewDialogueEdit";
import type { GalgameStoryDialogueBlock } from "@features/galgame-workshop/editor/dialogue";
import { updateBlock } from "@features/galgame-workshop/editor/model";

function draftKey(fragmentId: string, blockId: string) {
  return `${fragmentId}\u0000${blockId}`;
}

function dialogueMatchesDraft(
  block: GalgameStoryDialogueBlock | undefined,
  draft: FastPreviewDialogueDraft,
) {
  return Boolean(
    block &&
    block.text === draft.text &&
    (block.expressionId ?? "") === draft.expressionId &&
    JSON.stringify(block.portrait ?? null) ===
      JSON.stringify(draft.portrait ?? null),
  );
}

function sourceDialogue(
  document: GalgameStoryProject,
  fragmentId: string,
  blockId: string,
) {
  const block = document.chapters
    ?.flatMap((chapter) => chapter.fragments ?? [])
    .find((fragment) => fragment.id === fragmentId)
    ?.blocks?.find((candidate) => candidate.id === blockId);
  return block?.type === "dialogue" ? block : undefined;
}

export function useFastPreviewDialogueDrafts(document: GalgameStoryProject) {
  const [editDraft, setEditDraft] =
    useState<FastPreviewDialogueDraft>(EMPTY_DIALOGUE_DRAFT);
  const [pendingDrafts, setPendingDrafts] = useState<
    Record<string, FastPreviewDialogueDraft>
  >({});
  const editedSourceBlock = useMemo(
    () => sourceDialogue(document, editDraft.fragmentId, editDraft.blockId),
    [document, editDraft.blockId, editDraft.fragmentId],
  );
  const editDirty = Boolean(
    editDraft.fragmentId &&
    editDraft.blockId &&
    !dialogueMatchesDraft(editedSourceBlock, editDraft),
  );
  const previewDocument = useMemo(
    () =>
      Object.values(pendingDrafts).reduce(
        (current, draft) =>
          updateBlock(current, draft.fragmentId, draft.blockId, (block) =>
            block.type === "dialogue"
              ? applyFastPreviewDialogueEdit(block, {
                  fragmentId: draft.fragmentId,
                  blockId: draft.blockId,
                  text: draft.text,
                  expressionId: draft.expressionId || null,
                  portrait: draft.portrait,
                })
              : block,
          ),
        document,
      ),
    [document, pendingDrafts],
  );
  const selectDialogue = useCallback(
    (fragmentId: string, sourceBlock: GalgameStoryDialogueBlock) => {
      const pending = pendingDrafts[draftKey(fragmentId, sourceBlock.id)];
      setEditDraft(
        pending ?? {
          fragmentId,
          blockId: sourceBlock.id,
          text: sourceBlock.text,
          expressionId: sourceBlock.expressionId ?? "",
          portrait: sourceBlock.portrait ?? null,
        },
      );
    },
    [pendingDrafts],
  );
  const updateDraft = useCallback(
    (nextDraft: FastPreviewDialogueDraft) => {
      setEditDraft(nextDraft);
      setPendingDrafts((current) => {
        const key = draftKey(nextDraft.fragmentId, nextDraft.blockId);
        const source = sourceDialogue(
          document,
          nextDraft.fragmentId,
          nextDraft.blockId,
        );
        if (!dialogueMatchesDraft(source, nextDraft))
          return { ...current, [key]: nextDraft };
        if (!(key in current)) return current;
        const next = { ...current };
        delete next[key];
        return next;
      });
    },
    [document],
  );
  const discardDraft = useCallback((fragmentId: string, blockId: string) => {
    setPendingDrafts((current) => {
      const key = draftKey(fragmentId, blockId);
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  return {
    discardDraft,
    editDraft,
    editDirty,
    hasDirtyDrafts: Object.keys(pendingDrafts).length > 0,
    pendingDraftCount: Object.keys(pendingDrafts).length,
    previewDocument,
    selectDialogue,
    updateDraft,
  };
}
