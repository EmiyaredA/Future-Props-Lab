import { useEffect, useId, useRef, type FormEvent } from "react";
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
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(onCancel);
  const pendingRef = useRef(pending);
  cancelRef.current = onCancel;
  pendingRef.current = pending;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pendingRef.current) cancelRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    (
      inputRef.current ??
      dialogRef.current?.querySelector<HTMLElement>("button")
    )?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, []);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onRename();
  };
  return (
    <div className="workshop-dialog-backdrop" role="presentation">
      <div
        ref={dialogRef}
        className="workshop-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={editor.mode === "delete" ? descriptionId : undefined}
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
          <button
            type="button"
            disabled={pending}
            aria-label="关闭"
            onClick={onCancel}
          >
            <X aria-hidden />
          </button>
        </header>
        {editor.mode === "rename" ? (
          <form onSubmit={submit}>
            <label>
              {noun}名称
              <input
                ref={inputRef}
                required
                maxLength={120}
                value={editor.title}
                onChange={(event) => onTitleChange(event.target.value)}
              />
            </label>
            <div className="workshop-dialog-actions">
              <button type="button" disabled={pending} onClick={onCancel}>
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
            <p id={descriptionId}>{deleteDescription}</p>
            <div>
              <button type="button" disabled={pending} onClick={onCancel}>
                取消
              </button>
              <button
                type="button"
                className="danger"
                disabled={pending}
                onClick={onDelete}
              >
                确认删除
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
