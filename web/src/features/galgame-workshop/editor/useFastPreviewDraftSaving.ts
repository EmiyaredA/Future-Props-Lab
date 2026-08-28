import { useState } from "react";
import type { GalgameStoryProject } from "@features/galgame-workshop/api";
import type {
  FastPreviewDialogueDraft,
  FastPreviewDialogueEdit,
  FastPreviewDialogueEditResult,
} from "@features/galgame-workshop/editor/fastPreviewDialogueEdit";
import type {
  FastPreviewStageExpressionDraft,
  FastPreviewStageExpressionEdit,
  FastPreviewStageExpressionEditResult,
} from "@features/galgame-workshop/editor/fastPreviewStageExpressionEdit";

type SaveResult =
  FastPreviewDialogueEditResult | FastPreviewStageExpressionEditResult;

function dialogueEdit(
  draft: FastPreviewDialogueDraft,
): FastPreviewDialogueEdit {
  return {
    fragmentId: draft.fragmentId,
    blockId: draft.blockId,
    text: draft.text,
    expressionId: draft.expressionId || null,
    portrait: draft.portrait,
  };
}

export function useFastPreviewDraftSaving({
  dialogueDraft,
  dialogueDrafts,
  dialogueDirty,
  stageExpressionDraft,
  stageExpressionDirty,
  positionMs,
  playing,
  onPausePlayback,
  onRestorePosition,
  onApplyDialogueEdit,
  onApplyStageExpressionEdit,
  onDiscardDialogueDraft,
  onDocument,
  onRevision,
}: {
  dialogueDraft: FastPreviewDialogueDraft;
  dialogueDrafts: FastPreviewDialogueDraft[];
  dialogueDirty: boolean;
  stageExpressionDraft?: FastPreviewStageExpressionDraft;
  stageExpressionDirty: boolean;
  positionMs: number;
  playing: boolean;
  onPausePlayback: () => void;
  onRestorePosition: (positionMs: number) => void;
  onApplyDialogueEdit?: (
    edit: FastPreviewDialogueEdit,
  ) => Promise<FastPreviewDialogueEditResult>;
  onApplyStageExpressionEdit?: (
    edit: FastPreviewStageExpressionEdit,
  ) => Promise<FastPreviewStageExpressionEditResult>;
  onDiscardDialogueDraft: (fragmentId: string, blockId: string) => void;
  onDocument: (document: GalgameStoryProject) => void;
  onRevision: (revision: number) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const pendingCount = dialogueDrafts.length + (stageExpressionDirty ? 1 : 0);
  const canSaveAll = Boolean(
    pendingCount &&
    (!dialogueDrafts.length || onApplyDialogueEdit) &&
    (!stageExpressionDirty || onApplyStageExpressionEdit),
  );
  const prepare = () => {
    if (playing) onPausePlayback();
    return positionMs;
  };
  const accept = (result: SaveResult, restorePosition: number) => {
    onRestorePosition(restorePosition);
    onDocument(result.document);
    onRevision(result.storyRevision);
  };
  const saveDialogue = async () => {
    if (!dialogueDirty || !onApplyDialogueEdit) return;
    const restorePosition = prepare();
    setSaving(true);
    setMessage("");
    try {
      const result = await onApplyDialogueEdit(dialogueEdit(dialogueDraft));
      accept(result, restorePosition);
      onDiscardDialogueDraft(dialogueDraft.fragmentId, dialogueDraft.blockId);
      const remaining = Math.max(0, pendingCount - 1);
      setMessage(
        remaining
          ? `已保存当前对白，另有 ${remaining} 个未保存草稿`
          : "已保存，当前区间可继续播放",
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : "未知错误";
      setMessage(`保存失败：${reason}。草稿和当前位置已保留，可重试。`);
    } finally {
      setSaving(false);
    }
  };
  const saveStageExpression = async () => {
    if (
      !stageExpressionDirty ||
      !stageExpressionDraft ||
      !onApplyStageExpressionEdit
    )
      return;
    const restorePosition = prepare();
    setSaving(true);
    setMessage("");
    try {
      const result = await onApplyStageExpressionEdit({
        ...stageExpressionDraft,
        expressionId: stageExpressionDraft.expressionId || null,
      });
      accept(result, restorePosition);
      setMessage("已保存舞台角色表情");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "未知错误";
      setMessage(`保存失败：${reason}。表情草稿和当前位置已保留，可重试。`);
    } finally {
      setSaving(false);
    }
  };
  const saveAll = async () => {
    if (!canSaveAll) return;
    const restorePosition = prepare();
    const total = pendingCount;
    let completed = 0;
    setSaving(true);
    setMessage(`正在保存 0/${total} 项修改…`);
    try {
      for (const draft of dialogueDrafts) {
        const result = await onApplyDialogueEdit!(dialogueEdit(draft));
        accept(result, restorePosition);
        onDiscardDialogueDraft(draft.fragmentId, draft.blockId);
        completed += 1;
        setMessage(`正在保存 ${completed}/${total} 项修改…`);
      }
      if (stageExpressionDirty && stageExpressionDraft) {
        const result = await onApplyStageExpressionEdit!({
          ...stageExpressionDraft,
          expressionId: stageExpressionDraft.expressionId || null,
        });
        accept(result, restorePosition);
        completed += 1;
      }
      setMessage(`已保存全部 ${total} 项修改`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "未知错误";
      const remaining = total - completed;
      setMessage(
        `保存失败：全部保存已中断（${reason}）。已保存 ${completed} 项，另有 ${remaining} 个草稿已保留。`,
      );
    } finally {
      setSaving(false);
    }
  };
  return {
    canSaveAll,
    message,
    pendingCount,
    saveAll,
    saveDialogue,
    saveStageExpression,
    saving,
    setMessage,
  };
}
