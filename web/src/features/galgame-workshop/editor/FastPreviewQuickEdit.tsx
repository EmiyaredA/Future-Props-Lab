import { Save } from "lucide-react";
import type { GalgameStoryProject } from "@features/galgame-workshop/api";
import { characterStageSettings } from "@features/galgame-workshop/editor/characterStageSettings";
import type { GalgameStoryDialogueBlock } from "@features/galgame-workshop/editor/dialogue";
import type { FastPreviewDialogueDraft } from "@features/galgame-workshop/editor/fastPreviewDialogueEdit";
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
  onDraft,
  onSave,
}: {
  document: GalgameStoryProject;
  block: GalgameStoryDialogueBlock;
  draft: FastPreviewDialogueDraft;
  positionMs: number;
  dirty: boolean;
  saving: boolean;
  message: string;
  canSave: boolean;
  onDraft: (draft: FastPreviewDialogueDraft) => void;
  onSave: () => void;
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
      <header>
        <span>
          <strong>{character.name}</strong>
          {dirty ? <em>实时草稿</em> : <small>已保存</small>}
        </span>
        <small>{formatTimelineTime(positionMs)}</small>
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
        {portraitMode === "stage" ? (
          <label>
            <span>景别</span>
            <CustomSelect
              ariaLabel="快速修改立绘景别"
              value={draft.portrait?.distance ?? "medium"}
              options={DISTANCE_OPTIONS}
              onChange={(distance) =>
                updatePortrait({
                  distance: distance as "far" | "medium" | "near",
                })
              }
            />
          </label>
        ) : null}
        {portraitMode === "stage" ? (
          <label>
            <span>站位</span>
            <CustomSelect
              ariaLabel="快速修改立绘站位"
              value={
                draft.portrait?.positionId ?? settings.defaultPositionId ?? ""
              }
              options={settings.positionPresets.map((preset) => ({
                value: preset.id,
                label: preset.name,
              }))}
              onChange={(positionId) => updatePortrait({ positionId })}
            />
          </label>
        ) : null}
      </div>
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
            <span>显示立绘</span>
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
      <label>
        <span>对白文本</span>
        <textarea
          aria-label="对白文本"
          rows={7}
          value={draft.text}
          onChange={(event) => onDraft({ ...draft, text: event.target.value })}
        />
      </label>
      <small>草稿会立即显示在舞台；主音频和对白时间保持不变。</small>
      <button
        type="button"
        disabled={saving || !canSave || !dirty}
        title={canSave ? undefined : "当前预览没有连接可保存的故事修订"}
        onClick={onSave}
      >
        <Save aria-hidden />
        {saving ? "正在保存…" : dirty ? "保存这些修改" : "已保存"}
      </button>
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
