import type { GalgameStoryProject } from "@features/galgame-workshop/api";
import { characterStageSettings } from "@features/galgame-workshop/editor/characterStageSettings";
import type { GalgameStoryDialogueBlock } from "@features/galgame-workshop/editor/dialogue";
import type { FastPreviewDialogueDraft } from "@features/galgame-workshop/editor/fastPreviewDialogueEdit";
import type { FastPreviewStageActorEditor } from "@features/galgame-workshop/editor/fastPreviewStageActors";
import { FastPreviewStageActorList } from "@features/galgame-workshop/editor/FastPreviewStageActorList";
import { FastPreviewSaveActions } from "@features/galgame-workshop/editor/FastPreviewSaveActions";
import { DEFAULT_CHARACTER_TRANSITION } from "@features/galgame-workshop/editor/stage";
import { formatTimelineTime } from "@features/galgame-workshop/editor/storyPlayerModel";
import { CustomSelect } from "@shared/ui/CustomSelect";

const DISTANCE_OPTIONS = [
  { value: "far", label: "远景" },
  { value: "medium", label: "中景" },
  { value: "near", label: "近景" },
];

export function FastPreviewQuickEdit({
  document,
  block,
  draft,
  positionMs,
  dirty,
  saving,
  message,
  canSave,
  canSaveAll,
  pendingCount,
  autoRevealPortraits,
  stageActors,
  selectedActorId,
  editingCurrentDialogue,
  onDraft,
  onSave,
  onSaveAll,
  onAutoRevealPortraits,
  onSelectStageActor,
}: {
  document: GalgameStoryProject;
  block: GalgameStoryDialogueBlock;
  draft: FastPreviewDialogueDraft;
  positionMs: number;
  dirty: boolean;
  saving: boolean;
  message: string;
  canSave: boolean;
  canSaveAll: boolean;
  pendingCount: number;
  autoRevealPortraits: boolean;
  stageActors: FastPreviewStageActorEditor[];
  selectedActorId?: string;
  editingCurrentDialogue: boolean;
  onDraft: (draft: FastPreviewDialogueDraft) => void;
  onSave: () => void;
  onSaveAll: () => void;
  onAutoRevealPortraits: (enabled: boolean) => void;
  onSelectStageActor: (actor: FastPreviewStageActorEditor) => void;
}) {
  const character = document.characters?.find(
    (candidate) => candidate.id === block.characterId,
  );
  if (!character) return <p>当前对白缺少可编辑角色。</p>;
  const settings = characterStageSettings(document, character.id);
  const portraitMode = draft.portrait?.mode ?? "legacy";
  const stagePortrait = () => ({
    mode: "stage" as const,
    visible: true,
    keepAfter: true,
    distance: draft.portrait?.distance ?? ("medium" as const),
    positionId:
      draft.portrait?.positionId ?? settings.defaultPositionId ?? null,
    skinId: draft.portrait?.skinId ?? null,
    transform: null,
    transition: draft.portrait?.transition ?? DEFAULT_CHARACTER_TRANSITION,
  });
  const updatePortrait = (
    patch: Partial<NonNullable<GalgameStoryDialogueBlock["portrait"]>>,
  ) => onDraft({ ...draft, portrait: { ...stagePortrait(), ...patch } });

  return (
    <section className="galgame-fast-preview-quick-edit">
      <header className="galgame-fast-preview-editor-header">
        <span>
          <small>快速修改</small>
          <strong>{character.name}</strong>
          {dirty ? <em>实时草稿</em> : <small>已保存</small>}
        </span>
        <time>{formatTimelineTime(positionMs)}</time>
      </header>
      <section className="galgame-fast-preview-editor-section">
        <header>
          <span>
            <strong>舞台角色</strong>
            <small>选择任意角色修改表情与立绘</small>
          </span>
          <label className="galgame-fast-preview-auto-reveal">
            <input
              type="checkbox"
              checked={autoRevealPortraits}
              onChange={(event) => onAutoRevealPortraits(event.target.checked)}
            />
            辅助显示隐藏角色（不改导出）
          </label>
        </header>
        <FastPreviewStageActorList
          actors={stageActors}
          selectedActorId={selectedActorId}
          onSelect={onSelectStageActor}
        />
      </section>
      <section className="galgame-fast-preview-editor-section">
        <header>
          <span>
            <strong>角色表演</strong>
            <small>正在编辑：{character.name}</small>
          </span>
        </header>
        <label>
          <span>表情</span>
          <CustomSelect
            ariaLabel="快速修改对白表情"
            value={draft.expressionId}
            options={[
              { value: "", label: "跟随角色默认表情" },
              ...(character.expressions ?? []).map((expression) => ({
                value: expression.id,
                label: expression.label,
              })),
            ]}
            onChange={(expressionId) => onDraft({ ...draft, expressionId })}
          />
        </label>
        <div className="galgame-fast-preview-presentation-grid">
          <label>
            <span>立绘演出</span>
            <CustomSelect
              ariaLabel="快速修改立绘演出"
              value={portraitMode}
              options={[
                { value: "legacy", label: "沿用原有呈现" },
                { value: "stage", label: "舞台立绘" },
                { value: "dialogueAvatar", label: "仅对白头像" },
              ]}
              onChange={(mode) =>
                onDraft({
                  ...draft,
                  portrait:
                    mode === "legacy"
                      ? null
                      : {
                          ...stagePortrait(),
                          mode: mode as "stage" | "dialogueAvatar",
                          keepAfter: mode === "stage",
                        },
                })
              }
            />
          </label>
        </div>
        {portraitMode === "stage" ? (
          <div className="galgame-fast-preview-segment-field">
            <span>景别</span>
            <div>
              {DISTANCE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={
                    (draft.portrait?.distance ?? "medium") === option.value
                  }
                  onClick={() =>
                    updatePortrait({
                      distance: option.value as "far" | "medium" | "near",
                    })
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {portraitMode === "stage" ? (
          <div className="galgame-fast-preview-segment-field">
            <span>站位</span>
            <div>
              {settings.positionPresets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={
                    (draft.portrait?.positionId ??
                      settings.defaultPositionId) === preset.id
                  }
                  onClick={() => updatePortrait({ positionId: preset.id })}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {draft.portrait ? (
          <div className="galgame-fast-preview-presentation-toggles">
            <label>
              <input
                type="checkbox"
                checked={draft.portrait.visible !== false}
                onChange={(event) =>
                  updatePortrait({ visible: event.target.checked })
                }
              />
              <span>成片中显示立绘</span>
            </label>
            {portraitMode === "stage" ? (
              <label>
                <input
                  type="checkbox"
                  checked={draft.portrait.keepAfter}
                  onChange={(event) =>
                    updatePortrait({ keepAfter: event.target.checked })
                  }
                />
                <span>对白后保留</span>
              </label>
            ) : null}
          </div>
        ) : null}
      </section>
      <section className="galgame-fast-preview-editor-section">
        <header>
          <span>
            <strong>
              {editingCurrentDialogue ? "当前对白" : "角色来源对白"}
            </strong>
            <small>
              {editingCurrentDialogue
                ? "文本草稿会立即显示在舞台"
                : "切换回当前说话角色后可修改当前对白文本"}
            </small>
          </span>
        </header>
        {editingCurrentDialogue ? (
          <label>
            <textarea
              aria-label="对白文本"
              rows={5}
              value={draft.text}
              onChange={(event) =>
                onDraft({ ...draft, text: event.target.value })
              }
            />
          </label>
        ) : (
          <blockquote>{draft.text}</blockquote>
        )}
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
