import type { GalgameStoryProject } from "@features/galgame-workshop/api";
import { FastPreviewStageActorList } from "@features/galgame-workshop/editor/FastPreviewStageActorList";
import { FastPreviewSaveActions } from "@features/galgame-workshop/editor/FastPreviewSaveActions";
import type { FastPreviewStageActorEditor } from "@features/galgame-workshop/editor/fastPreviewStageActors";
import type { FastPreviewStageExpressionDraft } from "@features/galgame-workshop/editor/fastPreviewStageExpressionEdit";
import { formatTimelineTime } from "@features/galgame-workshop/editor/storyPlayerModel";
import { CustomSelect } from "@shared/ui/CustomSelect";

export function FastPreviewStageExpressionEditor({
  document,
  actor,
  draft,
  positionMs,
  dirty,
  saving,
  message,
  canSave,
  canSaveAll,
  pendingCount,
  stageActors,
  onDraft,
  onSave,
  onSaveAll,
  onSelectStageActor,
}: {
  document: GalgameStoryProject;
  actor: FastPreviewStageActorEditor;
  draft: FastPreviewStageExpressionDraft;
  positionMs: number;
  dirty: boolean;
  saving: boolean;
  message: string;
  canSave: boolean;
  canSaveAll: boolean;
  pendingCount: number;
  stageActors: FastPreviewStageActorEditor[];
  onDraft: (draft: FastPreviewStageExpressionDraft) => void;
  onSave: () => void;
  onSaveAll: () => void;
  onSelectStageActor: (actor: FastPreviewStageActorEditor) => void;
}) {
  const character = document.characters?.find(
    (candidate) => candidate.id === actor.characterId,
  );
  return (
    <section className="galgame-fast-preview-quick-edit">
      <header className="galgame-fast-preview-editor-header">
        <span>
          <small>快速修改</small>
          <strong>{actor.name}</strong>
          {dirty ? <em>实时草稿</em> : <small>已保存</small>}
        </span>
        <time>{formatTimelineTime(positionMs)}</time>
      </header>
      <section className="galgame-fast-preview-editor-section">
        <header>
          <span>
            <strong>舞台角色</strong>
            <small>有对白可改对白与表情；舞台指令角色可改表情</small>
          </span>
        </header>
        <FastPreviewStageActorList
          actors={stageActors}
          selectedActorId={actor.characterId}
          onSelect={onSelectStageActor}
        />
      </section>
      <section className="galgame-fast-preview-editor-section">
        <header>
          <span>
            <strong>立绘表情</strong>
            <small>来源：舞台指令，不需要对白</small>
          </span>
        </header>
        <label>
          <span>表情</span>
          <CustomSelect
            ariaLabel="快速修改舞台角色表情"
            value={draft.expressionId}
            options={[
              { value: "", label: "跟随角色默认表情" },
              ...(character?.expressions ?? []).map((expression) => ({
                value: expression.id,
                label: expression.label,
              })),
            ]}
            onChange={(expressionId) => onDraft({ ...draft, expressionId })}
          />
        </label>
      </section>
      <FastPreviewSaveActions
        dirty={dirty}
        saving={saving}
        message={message}
        canSave={canSave}
        canSaveAll={canSaveAll}
        pendingCount={pendingCount}
        onSave={onSave}
        onSaveAll={onSaveAll}
      />
    </section>
  );
}
