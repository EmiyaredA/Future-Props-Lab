import type { FormEvent } from "react";
import { X } from "lucide-react";

export type ProjectEditorState<T> =
  | { mode: "rename"; project: T; title: string }
  | { mode: "delete"; project: T };

export function ProjectEditorDialog<T extends { title: string }>({
  editor,
  noun,
  pending,
  deleteDescription,
  onTitleChange,
  onCancel,
  onRename,
  onDelete,
}: {
  editor: ProjectEditorState<T>;
  noun: string;
  pending: boolean;
  deleteDescription: string;
  onTitleChange: (title: string) => void;
  onCancel: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const titleId = `project-editor-${noun}`;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onRename();
  };
  return (
    <div className="workshop-dialog-backdrop" role="presentation">
      <div
        className="workshop-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header>
          <div>
            <span>
              {editor.mode === "rename" ? `编辑${noun}` : `删除${noun}`}
            </span>
            <h2 id={titleId}>
              {editor.mode === "rename"
                ? `重命名${noun}`
                : `删除“${editor.project.title}”？`}
            </h2>
          </div>
          <button disabled={pending} aria-label="关闭" onClick={onCancel}>
            <X aria-hidden />
          </button>
        </header>
        {editor.mode === "rename" ? (
          <form onSubmit={submit}>
            <label>
              {noun}名称
              <input
                autoFocus
                required
                maxLength={120}
                value={editor.title}
                onChange={(event) => onTitleChange(event.target.value)}
              />
            </label>
            <div className="workshop-dialog-actions">
              <button type="button" onClick={onCancel}>
                取消
              </button>
              <button
                className="workshop-primary"
                disabled={pending || !editor.title.trim()}
              >
                保存名称
              </button>
            </div>
          </form>
        ) : (
          <div className="workshop-delete-copy">
            <p>{deleteDescription}</p>
            <div>
              <button onClick={onCancel}>取消</button>
              <button className="danger" disabled={pending} onClick={onDelete}>
                确认删除
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
