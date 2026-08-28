import { Bug, GitBranch, ListTree, PencilLine, Variable } from "lucide-react";
import type { GalgameStoryProject } from "@features/galgame-workshop/api";
import type { GalgameStoryDialogueBlock } from "@features/galgame-workshop/editor/dialogue";
import type { FastPreviewDialogueDraft } from "@features/galgame-workshop/editor/fastPreviewDialogueEdit";
import { FastPreviewQuickEdit } from "@features/galgame-workshop/editor/FastPreviewQuickEdit";
import type { FastPreviewStageActorEditor } from "@features/galgame-workshop/editor/fastPreviewStageActors";
import type { FastPreviewStageExpressionDraft } from "@features/galgame-workshop/editor/fastPreviewStageExpressionEdit";
import { FastPreviewStageExpressionEditor } from "@features/galgame-workshop/editor/FastPreviewStageExpressionEditor";
import type { StageActor } from "@features/galgame-workshop/editor/stage";

export type FastPreviewInspectorTab =
  "stage" | "edit" | "variables" | "branches" | "logs";

export function FastPreviewInspector({
  tab,
  document,
  actors,
  stageActors,
  selectedActor,
  selectedActorId,
  editableDialogue,
  dialogueDraft,
  stageExpressionDraft,
  editingStageExpression,
  editingCurrentDialogue,
  dialogueDirty,
  stageExpressionDirty,
  saving,
  message,
  canSaveDialogue,
  canSaveStageExpression,
  canSaveAll,
  pendingDraftCount,
  autoRevealPortraits,
  positionMs,
  variables,
  branches,
  logs,
  onTab,
  onOpenEdit,
  onDialogueDraft,
  onStageExpressionDraft,
  onSaveDialogue,
  onSaveStageExpression,
  onSaveAll,
  onSelectStageActor,
  onAutoRevealPortraits,
}: {
  tab: FastPreviewInspectorTab;
  document: GalgameStoryProject;
  actors: StageActor[];
  stageActors: FastPreviewStageActorEditor[];
  selectedActor?: FastPreviewStageActorEditor;
  selectedActorId?: string;
  editableDialogue?: GalgameStoryDialogueBlock;
  dialogueDraft: FastPreviewDialogueDraft;
  stageExpressionDraft?: FastPreviewStageExpressionDraft;
  editingStageExpression: boolean;
  editingCurrentDialogue: boolean;
  dialogueDirty: boolean;
  stageExpressionDirty: boolean;
  saving: boolean;
  message: string;
  canSaveDialogue: boolean;
  canSaveStageExpression: boolean;
  canSaveAll: boolean;
  pendingDraftCount: number;
  autoRevealPortraits: boolean;
  positionMs: number;
  variables: Record<string, unknown>;
  branches: Array<{ id: string; text: string; targetFragmentId: string }>;
  logs: string[];
  onTab: (tab: FastPreviewInspectorTab) => void;
  onOpenEdit: () => void;
  onDialogueDraft: (draft: FastPreviewDialogueDraft) => void;
  onStageExpressionDraft: (draft: FastPreviewStageExpressionDraft) => void;
  onSaveDialogue: () => void;
  onSaveStageExpression: () => void;
  onSaveAll: () => void;
  onSelectStageActor: (actor: FastPreviewStageActorEditor) => void;
  onAutoRevealPortraits: (enabled: boolean) => void;
}) {
  const tabs = [
    { id: "stage" as const, label: "舞台", icon: ListTree },
    { id: "edit" as const, label: "快速修改", icon: PencilLine },
    { id: "variables" as const, label: "变量", icon: Variable },
    { id: "branches" as const, label: "分支", icon: GitBranch },
    { id: "logs" as const, label: "日志", icon: Bug },
  ];
  return (
    <aside className="galgame-fast-preview-inspector">
      <nav>
        {tabs.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={tab === item.id ? "active" : ""}
              onClick={() =>
                item.id === "edit" ? onOpenEdit() : onTab(item.id)
              }
            >
              <Icon aria-hidden />
              {item.label}
            </button>
          );
        })}
      </nav>
      <div>
        {tab === "stage"
          ? actors.map((actor) => (
              <article key={actor.characterId}>
                <strong>
                  {document.characters?.find(
                    (character) => character.id === actor.characterId,
                  )?.name ?? actor.characterId}
                </strong>
                <small>
                  {actor.positionId ?? "自定义位置"} · {actor.distance}
                </small>
              </article>
            ))
          : null}
        {tab === "edit" ? (
          editingStageExpression && selectedActor && stageExpressionDraft ? (
            <FastPreviewStageExpressionEditor
              document={document}
              actor={selectedActor}
              draft={stageExpressionDraft}
              positionMs={positionMs}
              dirty={stageExpressionDirty}
              saving={saving}
              message={message}
              canSave={canSaveStageExpression}
              canSaveAll={canSaveAll}
              pendingCount={pendingDraftCount}
              stageActors={stageActors}
              onDraft={onStageExpressionDraft}
              onSave={onSaveStageExpression}
              onSaveAll={onSaveAll}
              onSelectStageActor={onSelectStageActor}
            />
          ) : editableDialogue ? (
            <FastPreviewQuickEdit
              document={document}
              block={editableDialogue}
              draft={dialogueDraft}
              positionMs={positionMs}
              dirty={dialogueDirty}
              saving={saving}
              message={message}
              canSave={canSaveDialogue}
              canSaveAll={canSaveAll}
              pendingCount={pendingDraftCount}
              autoRevealPortraits={autoRevealPortraits}
              stageActors={stageActors}
              selectedActorId={selectedActorId}
              editingCurrentDialogue={editingCurrentDialogue}
              onDraft={onDialogueDraft}
              onSave={onSaveDialogue}
              onSaveAll={onSaveAll}
              onSelectStageActor={onSelectStageActor}
              onAutoRevealPortraits={onAutoRevealPortraits}
            />
          ) : (
            <p>当前角色没有可编辑的对白或舞台表情来源。</p>
          )
        ) : null}
        {tab === "variables"
          ? Object.entries(variables).map(([key, value]) => (
              <article key={key}>
                <strong>
                  {document.variables?.find((item) => item.id === key)?.name ??
                    key}
                </strong>
                <code>{String(value)}</code>
              </article>
            ))
          : null}
        {tab === "branches"
          ? branches.map((choice) => (
              <article key={choice.id}>
                <strong>{choice.text || "未命名选项"}</strong>
                <small>{choice.targetFragmentId}</small>
              </article>
            ))
          : null}
        {tab === "logs"
          ? logs.map((line, index) => (
              <code key={`${line}-${index}`}>{line}</code>
            ))
          : null}
        {tab === "stage" && !actors.length ? <p>舞台上没有角色</p> : null}
        {tab === "branches" && !branches.length ? (
          <p>当前没有待选分支</p>
        ) : null}
      </div>
    </aside>
  );
}
