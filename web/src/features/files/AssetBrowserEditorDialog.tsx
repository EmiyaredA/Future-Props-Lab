import { Trash2, X } from "lucide-react";
import { CustomSelect, type SelectOption } from "@shared/ui/CustomSelect";
import {
  type FileEditor,
  fileDisplayName,
} from "@features/files/AssetBrowserParts";
import type { FormEvent, RefObject } from "react";

export function AssetBrowserEditorDialog({
  dialogRef,
  dialogTitleId,
  editor,
  editorTitle,
  editorError,
  editorSubmitLabel,
  editorSubmitDisabled,
  pending,
  moveTargetOptions,
  onClose,
  onSubmit,
  onUpdateName,
  onUpdateTarget,
}: {
  dialogRef: RefObject<HTMLDivElement | null>;
  dialogTitleId: string;
  editor: Exclude<FileEditor, null>;
  editorTitle: string;
  editorError: string;
  editorSubmitLabel: string;
  editorSubmitDisabled: boolean;
  pending: boolean;
  moveTargetOptions: SelectOption[];
  onClose: () => void;
  onSubmit: (event?: FormEvent) => void;
  onUpdateName: (name: string) => void;
  onUpdateTarget: (target: string) => void;
}) {
  return (
    <div
      className="file-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="file-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={dialogTitleId}
      >
        <header>
          <div>
            <span>文件操作</span>
            <h2 id={dialogTitleId}>{editorTitle}</h2>
          </div>
          <button
            type="button"
            aria-label={`关闭${editorTitle}`}
            disabled={pending}
            onClick={onClose}
          >
            <X aria-hidden />
          </button>
        </header>
        {editor.kind === "create-folder" ||
        editor.kind === "rename-folder" ||
        editor.kind === "rename-file" ? (
          <form onSubmit={onSubmit}>
            <label>
              <span>
                {editor.kind === "create-folder" ? "文件夹名称" : "新名称"}
              </span>
              <input
                autoFocus
                required
                maxLength={120}
                value={editor.name}
                onChange={(event) => onUpdateName(event.target.value)}
                placeholder="请输入名称"
              />
            </label>
            {editorError ? (
              <p className="file-dialog-error">{editorError}</p>
            ) : null}
            <div className="file-dialog-actions">
              <button type="button" disabled={pending} onClick={onClose}>
                取消
              </button>
              <button
                className="primary"
                disabled={pending || editorSubmitDisabled}
              >
                {pending ? "处理中…" : editorSubmitLabel}
              </button>
            </div>
          </form>
        ) : editor.kind === "move-folder" || editor.kind === "move-file" ? (
          <form onSubmit={onSubmit}>
            <label>
              <span>目标文件夹</span>
              <CustomSelect
                ariaLabel="目标文件夹"
                className="file-move-select"
                value={editor.target}
                options={moveTargetOptions}
                disabled={pending}
                onChange={onUpdateTarget}
              />
            </label>
            <small>移动后可通过上方路径继续访问该内容。</small>
            {editorError ? (
              <p className="file-dialog-error">{editorError}</p>
            ) : null}
            <div className="file-dialog-actions">
              <button type="button" disabled={pending} onClick={onClose}>
                取消
              </button>
              <button
                className="primary"
                disabled={pending || editorSubmitDisabled}
              >
                {pending ? "处理中…" : editorSubmitLabel}
              </button>
            </div>
          </form>
        ) : (
          <div className="file-delete-dialog">
            <div className="file-delete-icon">
              <Trash2 aria-hidden />
            </div>
            <p>
              {editor.kind === "delete-folder"
                ? `删除“${editor.folder.name}”及其中全部文件和子文件夹后将无法恢复。`
                : editor.file.is_reference
                  ? "只会从当前项目移除引用，文件管理中的源文件不会受到影响。"
                  : `删除“${fileDisplayName(editor.file)}”后将无法恢复。`}
            </p>
            {editorError ? (
              <p className="file-dialog-error">{editorError}</p>
            ) : null}
            <div className="file-dialog-actions">
              <button type="button" disabled={pending} onClick={onClose}>
                取消
              </button>
              <button
                type="button"
                className="danger"
                disabled={pending}
                onClick={() => onSubmit()}
              >
                {pending ? "处理中…" : editorSubmitLabel}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
